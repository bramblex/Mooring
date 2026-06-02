import {
  DEFAULT_WORKSPACE_COLOR,
} from "./workspace.constants";
import {
  formatWorkspaceTitle,
  nextWorkspaceName,
  parseWorkspaceTitle,
} from "./workspace.helpers";
import { ensureRootFolder, getWorkspaceFolder, listWorkspaceFolders } from "./workspace.bookmarks";
import { WorkspacePageModel } from "./workspace-page.model";
import { WorkspaceRuntimeStore } from "./workspace.runtime";
import type {
  TabGroupColor,
  WorkspaceFolder,
  WorkspaceView,
} from "./workspace.types";
export type { TabGroupColor, UnmanagedGroupView, WorkspaceState, WorkspaceView } from "./workspace.types";

// docs/workspace-model.md: WorkspaceModel 只负责 Workspace 容器、
// Bookmark folder、Workspace 排序和 Workspace <-> Chrome Group 投影。
// Workspace 内 Page 生命周期由 WorkspacePageModel 处理；
// 未管理 Chrome Tab / Chrome Group 由 UnmanagedModel 处理。
export class WorkspaceModel {
  pages: WorkspacePageModel;

  constructor(private runtime = new WorkspaceRuntimeStore()) {
    this.pages = new WorkspacePageModel(this.runtime, (workspaceId, seedTabId) =>
      this.ensureWorkspaceGroup(workspaceId, seedTabId),
    );
  }

  clearRuntimeBindings() {
    this.runtime.clear();
  }

  markRuntimeBindingsRebuildNeeded() {
    this.runtime.markRebuildNeeded();
  }

  async getWorkspaces(windowId: number): Promise<WorkspaceView[]> {
    await this.runtime.ensureLoaded();

    const root = await ensureRootFolder();
    let groups = await chrome.tabGroups.query({ windowId });
    let tabs = await chrome.tabs.query({ windowId });

    if (this.runtime.consumeRebuildNeeded()) {
      // docs/window-model.md: 主窗口关闭或重启后清空 runtime binding，
      // Bookmark 保留；不主动拆散 Chrome Group。
      this.runtime.clearWithoutCleanup();
      groups = await chrome.tabGroups.query({ windowId });
      tabs = await chrome.tabs.query({ windowId });
    }

    const freshFolders = await listWorkspaceFolders(root.id);

    this.runtime.pruneGroups(groups);
    this.bindKnownGroups(freshFolders, groups);
    await this.mergeDuplicateMatchedGroups(freshFolders, groups);
    groups = await chrome.tabGroups.query({ windowId });
    tabs = await chrome.tabs.query({ windowId });
    this.runtime.pruneGroups(groups);

    const workspaces = await Promise.all(
      freshFolders.map(async (folder) => {
        const groupId = this.runtime.workspaceGroupIds.get(folder.id);

        const group = groupId === undefined ? undefined : groups.find((item) => item.id === groupId);
        if (group && group.collapsed !== folder.collapsed) {
          await chrome.tabGroups.update(group.id, { collapsed: folder.collapsed });
        }
        const groupTabs = groupId === undefined
          ? []
          : tabs.filter((tab) => tab.groupId === groupId).sort((a, b) => a.index - b.index);
        const bookmarks = (await chrome.bookmarks.getChildren(folder.id)).filter((node) => node.url);

        const pages = this.pages.buildWorkspacePages(folder.id, bookmarks, groupTabs);

        return {
          id: folder.id,
          name: folder.name,
          color: folder.color,
          order: folder.index,
          collapsed: folder.collapsed,
          groupId,
          pages,
        };
      }),
    );

    return workspaces;
  }

  async findProjectedWindowId() {
    await this.runtime.ensureLoaded();

    const root = await ensureRootFolder();
    const folders = await listWorkspaceFolders(root.id);
    if (folders.length === 0) return undefined;

    const groups = await chrome.tabGroups.query({});
    this.runtime.pruneGroups(groups);

    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    const storedBindingWindowScores = new Map<number, number>();

    for (const [workspaceId, groupId] of this.runtime.workspaceGroupIds.entries()) {
      const folder = foldersById.get(workspaceId);
      const group = groups.find((item) => item.id === groupId);
      if (!folder || !group) {
        this.runtime.workspaceGroupIds.delete(workspaceId);
        this.runtime.groupWorkspaceIds.delete(groupId);
        continue;
      }

      const matchesFolder = this.workspaceMatchKey(group.title || "", group.color)
        === this.workspaceMatchKey(folder.name, folder.color);
      if (!matchesFolder) {
        this.runtime.workspaceGroupIds.delete(workspaceId);
        this.runtime.groupWorkspaceIds.delete(groupId);
        continue;
      }

      storedBindingWindowScores.set(group.windowId, (storedBindingWindowScores.get(group.windowId) || 0) + 1);
    }

    if (storedBindingWindowScores.size > 0) {
      void this.runtime.persist();
      return this.bestScoredWindowId(storedBindingWindowScores);
    }

    const matchedWindowScores = new Map<number, number>();
    const unmatchedGroups = [...groups];

    for (const folder of folders) {
      const matchIndex = unmatchedGroups.findIndex((group) =>
        this.workspaceMatchKey(group.title || "", group.color) === this.workspaceMatchKey(folder.name, folder.color)
      );
      if (matchIndex < 0) continue;

      const [group] = unmatchedGroups.splice(matchIndex, 1);
      this.runtime.bindWorkspace(folder.id, group.id);
      matchedWindowScores.set(group.windowId, (matchedWindowScores.get(group.windowId) || 0) + 1);
    }

    return this.bestScoredWindowId(matchedWindowScores);
  }

  async createWorkspace(windowId: number) {
    await this.runtime.ensureLoaded();

    const root = await ensureRootFolder();
    const folders = await listWorkspaceFolders(root.id);
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: formatWorkspaceTitle(nextWorkspaceName(folders), DEFAULT_WORKSPACE_COLOR, false),
    });

    // docs/workspace-model.md: 创建空 Workspace 只创建 Bookmark 文件夹，
    // 不立即创建 Chrome Tab 或 Chrome Group。
    void windowId;
    return folder.id;
  }

  async ensureStarterWorkspace() {
    await this.runtime.ensureLoaded();

    const root = await ensureRootFolder();
    const folders = await listWorkspaceFolders(root.id);
    if (folders.length > 0) return;

    const name = chrome.i18n.getMessage("starterWorkspaceName") || "Inbox";
    await chrome.bookmarks.create({
      parentId: root.id,
      title: formatWorkspaceTitle(name, "blue", false),
    });
  }

  async renameWorkspace(workspaceId: string, name: string) {
    await this.runtime.ensureLoaded();

    // docs/product-logic.md: Workspace 是 Mooring 长期对象，不允许空名字；
    // 空输入视为取消重命名，保留当前 bookmark title。
    const nextName = name.trim();
    if (!nextName) return;

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(nextName, parsed.color, parsed.collapsed),
    });

    const groupId = this.runtime.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { title: nextName });
    }
  }

  async updateWorkspaceColor(workspaceId: string, color: TabGroupColor) {
    await this.runtime.ensureLoaded();

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(parsed.name, color, parsed.collapsed),
    });

    const groupId = this.runtime.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { color });
    }
  }

  async toggleWorkspace(workspaceId: string) {
    await this.runtime.ensureLoaded();

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const collapsed = !parsed.collapsed;

    // docs/workspace-model.md: Workspace 显示/隐藏状态和颜色一样写在
    // Workspace Bookmark folder title 上；没有 Chrome Group 时也能切换。
    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(parsed.name, parsed.color, collapsed),
    });

    const groupId = this.runtime.workspaceGroupIds.get(workspaceId);
    if (groupId === undefined) return;

    await chrome.tabGroups.update(groupId, { collapsed });
  }

  async deleteWorkspace(workspaceId: string) {
    await this.runtime.ensureLoaded();

    const groupId = this.runtime.workspaceGroupIds.get(workspaceId);

    await chrome.bookmarks.removeTree(workspaceId);

    if (groupId !== undefined) {
      const tabs = await chrome.tabs.query({ groupId });
      const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
      if (tabIds.length > 0) {
        // docs/mvp-checklist.md: 删除 Workspace 不关闭用户页面；
        // 已打开 Chrome Tabs 释放到 Unmanaged 区。
        await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
        tabIds.forEach((tabId) => this.runtime.removePageOrder(`chrome-tab:${tabId}`));
      }
      this.runtime.groupWorkspaceIds.delete(groupId);
    }

    this.runtime.workspaceGroupIds.delete(workspaceId);
    void this.runtime.persist();
  }

  async moveChromeGroupToWorkspace(groupId: number, workspaceId: string, index: number) {
    await this.runtime.ensureLoaded();

    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

    const tabs = (await chrome.tabs.query({ groupId }))
      .filter((tab) => tab.id)
      .sort((a, b) => a.index - b.index);
    const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
    if (tabIds.length === 0) return;

    const workspaceGroupId = await this.ensureWorkspaceGroup(workspaceId, tabIds[0]);

    // docs/product-logic.md: unmanaged Chrome Group 拖入 Workspace 时，
    // 只批量移动其中 Chrome Tab；Chrome Group 不会变成 Workspace。
    await chrome.tabs.group({
      tabIds: tabIds as [number, ...number[]],
      groupId: workspaceGroupId,
    });

    const insertIndex = Math.max(0, index);
    tabIds.forEach((tabId, offset) => {
      this.runtime.movePageOrder(workspaceId, `chrome-tab:${tabId}`, insertIndex + offset);
    });
    void this.runtime.persist();
  }

  async closeWorkspacePages(workspaceId: string) {
    await this.runtime.ensureLoaded();

    await this.pages.closeWorkspacePages(workspaceId, await this.validWorkspaceGroupId(workspaceId));
  }

  async moveWorkspace(sourceWorkspaceId: string, index: number) {
    await this.runtime.ensureLoaded();

    const root = await ensureRootFolder();
    const folders = await listWorkspaceFolders(root.id);
    const sourceFolder = folders.find((folder) => folder.id === sourceWorkspaceId);
    if (!sourceFolder) return;

    const finalOrder = folders.filter((folder) => folder.id !== sourceWorkspaceId);
    const nextIndex = Math.max(0, Math.min(index, finalOrder.length));

    finalOrder.splice(nextIndex, 0, sourceFolder);

    const finalIndex = finalOrder.findIndex((folder) => folder.id === sourceWorkspaceId);
    const destination: { parentId: string; index?: number } = {
      parentId: root.id,
    };

    if (finalIndex < finalOrder.length - 1) {
      destination.index = finalIndex;
    }

    await chrome.bookmarks.move(sourceWorkspaceId, destination);
  }

  private bindKnownGroups(folders: WorkspaceFolder[], groups: chrome.tabGroups.TabGroup[]) {
    const groupedByTitle = new Map<string, chrome.tabGroups.TabGroup[]>();

    groups.forEach((group) => {
      const key = this.workspaceMatchKey(group.title || "", group.color);
      groupedByTitle.set(key, [...(groupedByTitle.get(key) || []), group]);
    });

    folders.forEach((folder) => {
      const boundGroupId = this.runtime.workspaceGroupIds.get(folder.id);
      if (boundGroupId !== undefined && groups.some((group) => group.id === boundGroupId)) return;

      const matches = groupedByTitle.get(this.workspaceMatchKey(folder.name, folder.color));
      const group = matches?.shift();
      if (group) {
        this.runtime.bindWorkspace(folder.id, group.id);
      }
    });
  }

  private async mergeDuplicateMatchedGroups(
    folders: WorkspaceFolder[],
    groups: chrome.tabGroups.TabGroup[],
  ) {
    for (const folder of folders) {
      const boundGroupId = this.runtime.workspaceGroupIds.get(folder.id);
      if (boundGroupId === undefined) continue;

      const duplicateGroups = groups.filter((group) => {
        if (group.id === boundGroupId) return false;
        if (this.runtime.groupWorkspaceIds.has(group.id)) return false;
        return this.workspaceMatchKey(group.title || "", group.color)
          === this.workspaceMatchKey(folder.name, folder.color);
      });

      for (const group of duplicateGroups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
        if (tabIds.length === 0) continue;

        // docs/product-logic.md: Chrome 创建或恢复的 Group 匹配已打开 Workspace 时，
        // 把该 Chrome Group 内 Chrome Tabs 合并进 Workspace 已绑定的 Chrome Group。
        await chrome.tabs.group({
          tabIds: tabIds as [number, ...number[]],
          groupId: boundGroupId,
        });
      }
    }
  }

  private workspaceMatchKey(name: string, color: TabGroupColor) {
    return `${color}:${name}`;
  }

  private bestScoredWindowId(scores: Map<number, number>) {
    let bestWindowId: number | undefined;
    let bestScore = 0;
    let tied = false;

    for (const [windowId, score] of scores.entries()) {
      if (score > bestScore) {
        bestWindowId = windowId;
        bestScore = score;
        tied = false;
        continue;
      }

      if (score === bestScore) {
        tied = true;
      }
    }

    return tied ? undefined : bestWindowId;
  }

  private async ensureWorkspaceGroup(workspaceId: string, seedTabId: number) {
    const existingGroupId = await this.validWorkspaceGroupId(workspaceId);
    if (existingGroupId !== undefined) {
      return existingGroupId;
    }

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const seedTab = await chrome.tabs.get(seedTabId);
    const groups = await chrome.tabGroups.query({ windowId: seedTab.windowId });
    const matchedGroup = groups.find((group) => {
      if (this.runtime.groupWorkspaceIds.has(group.id)) return false;
      return this.workspaceMatchKey(group.title || "", group.color)
        === this.workspaceMatchKey(parsed.name, parsed.color);
    });

    if (matchedGroup) {
      // docs/workspace-model.md: 恢复 Page 前先按 Workspace 名称和颜色
      // 匹配当前窗口里已有 Chrome Group，避免 runtime binding 丢失后重复建组。
      this.runtime.bindWorkspace(workspaceId, matchedGroup.id);
      if (matchedGroup.collapsed !== parsed.collapsed) {
        await chrome.tabGroups.update(matchedGroup.id, { collapsed: parsed.collapsed });
      }
      return matchedGroup.id;
    }

    const groupId = await chrome.tabs.group({ tabIds: seedTabId });
    await chrome.tabGroups.update(groupId, {
      title: parsed.name,
      color: parsed.color,
      collapsed: parsed.collapsed,
    });
    this.runtime.bindWorkspace(workspaceId, groupId);
    return groupId;
  }

  private async groupExists(groupId: number) {
    try {
      await chrome.tabGroups.get(groupId);
      return true;
    } catch {
      return false;
    }
  }

  private async validWorkspaceGroupId(workspaceId: string) {
    const groupId = this.runtime.workspaceGroupIds.get(workspaceId);
    if (groupId === undefined) return undefined;

    if (await this.groupExists(groupId)) return groupId;

    this.runtime.workspaceGroupIds.delete(workspaceId);
    this.runtime.groupWorkspaceIds.delete(groupId);
    void this.runtime.persist();
    return undefined;
  }

}
