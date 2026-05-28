import type { PageModel } from "./page.model";
import {
  DEFAULT_WORKSPACE_COLOR,
  NO_GROUP,
  RUNTIME_BINDINGS_STORAGE_KEY,
} from "./workspace.constants";
import {
  bookmarkKey,
  canBookmarkTab,
  chromeTabTitle,
  chromeTabUrl,
  formatWorkspaceTitle,
  nextWorkspaceName,
  parseWorkspaceTitle,
} from "./workspace.helpers";
import { ensureRootFolder, getWorkspaceFolder, listWorkspaceFolders } from "./workspace.bookmarks";
import { parsePageId, pinnedPageModel, tempPageModel } from "./workspace.page-factory";
import type {
  RuntimeBindingsStorage,
  TabGroupColor,
  UnmanagedGroupView,
  WorkspaceFolder,
  WorkspaceState,
} from "./workspace.types";
export type { TabGroupColor, UnmanagedGroupView, WorkspaceState, WorkspaceView } from "./workspace.types";

export class WorkspaceModel {
  private workspaceGroupIds = new Map<string, number>();
  private groupWorkspaceIds = new Map<number, string>();
  private chromeTabBookmarkIds = new Map<number, string>();
  private workspacePageOrders = new Map<string, string[]>();
  private runtimeBindingsLoaded = false;
  private shouldRebuildRuntimeBindings = false;

  clearRuntimeBindings() {
    this.workspaceGroupIds.clear();
    this.groupWorkspaceIds.clear();
    this.chromeTabBookmarkIds.clear();
    this.workspacePageOrders.clear();
    this.runtimeBindingsLoaded = true;
    void this.persistRuntimeBindings();
    this.markRuntimeBindingsRebuildNeeded();
  }

  markRuntimeBindingsRebuildNeeded() {
    this.shouldRebuildRuntimeBindings = true;
  }

  async getState(windowId: number): Promise<WorkspaceState> {
    await this.ensureRuntimeBindingsLoaded();

    const root = await ensureRootFolder();
    let groups = await chrome.tabGroups.query({ windowId });
    let tabs = await chrome.tabs.query({ windowId });

    if (this.shouldRebuildRuntimeBindings) {
      // docs/window-model.md: 主窗口关闭或重启后清空 runtime binding，
      // Bookmark 保留；不主动拆散 Chrome Group。
      this.clearRuntimeBindingsWithoutCleanup();
      this.shouldRebuildRuntimeBindings = false;
      groups = await chrome.tabGroups.query({ windowId });
      tabs = await chrome.tabs.query({ windowId });
    }

    const freshFolders = await listWorkspaceFolders(root.id);

    this.pruneBindings(groups);
    this.bindKnownGroups(freshFolders, groups);
    await this.mergeDuplicateMatchedGroups(freshFolders, groups);
    groups = await chrome.tabGroups.query({ windowId });
    tabs = await chrome.tabs.query({ windowId });
    this.pruneBindings(groups);

    const workspaces = await Promise.all(
      freshFolders.map(async (folder) => {
        const groupId = this.workspaceGroupIds.get(folder.id);

        const group = groupId === undefined ? undefined : groups.find((item) => item.id === groupId);
        if (group && group.collapsed !== folder.collapsed) {
          await chrome.tabGroups.update(group.id, { collapsed: folder.collapsed });
        }
        const groupTabs = groupId === undefined
          ? []
          : tabs.filter((tab) => tab.groupId === groupId).sort((a, b) => a.index - b.index);
        const bookmarks = (await chrome.bookmarks.getChildren(folder.id)).filter((node) => node.url);

        const pages = this.buildWorkspacePages(folder.id, bookmarks, groupTabs);

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

    const managedGroupIds = new Set(this.workspaceGroupIds.values());
    const unmanagedGroupsWithIndex = await Promise.all(
      groups
        .filter((group) => !managedGroupIds.has(group.id))
        .map(async (group) => {
          const groupTabs = (await chrome.tabs.query({ groupId: group.id }))
            .sort((a, b) => a.index - b.index);

          return {
            firstIndex: groupTabs[0]?.index ?? Number.MAX_SAFE_INTEGER,
            group: {
              id: group.id,
              title: group.title || "",
              color: group.color,
              collapsed: group.collapsed,
              order: groupTabs[0]?.index ?? Number.MAX_SAFE_INTEGER,
              pages: groupTabs.map((tab) => tempPageModel(tab, false)),
            },
          };
        }),
    );
    const unmanagedGroups = unmanagedGroupsWithIndex
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map((item) => item.group);

    const unmanagedPages = tabs
      .filter((tab) => tab.groupId === NO_GROUP)
      .sort((a, b) => a.index - b.index)
      .map((tab) => tempPageModel(tab, false));

    return {
      workspaces,
      unmanagedPages,
      unmanagedGroups,
    };
  }

  async createWorkspace(windowId: number) {
    await this.ensureRuntimeBindingsLoaded();

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

  async renameWorkspace(workspaceId: string, name: string) {
    await this.ensureRuntimeBindingsLoaded();

    // docs/product-logic.md: Workspace 是 Mooring 长期对象，不允许空名字；
    // 空输入视为取消重命名，保留当前 bookmark title。
    const nextName = name.trim();
    if (!nextName) return;

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(nextName, parsed.color, parsed.collapsed),
    });

    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { title: nextName });
    }
  }

  async updateWorkspaceColor(workspaceId: string, color: TabGroupColor) {
    await this.ensureRuntimeBindingsLoaded();

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(parsed.name, color, parsed.collapsed),
    });

    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { color });
    }
  }

  async toggleWorkspace(workspaceId: string) {
    await this.ensureRuntimeBindingsLoaded();

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const collapsed = !parsed.collapsed;

    // docs/workspace-model.md: Workspace 显示/隐藏状态和颜色一样写在
    // Workspace Bookmark folder title 上；没有 Chrome Group 时也能切换。
    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(parsed.name, parsed.color, collapsed),
    });

    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId === undefined) return;

    await chrome.tabGroups.update(groupId, { collapsed });
  }

  async deleteWorkspace(workspaceId: string) {
    await this.ensureRuntimeBindingsLoaded();

    const groupId = this.workspaceGroupIds.get(workspaceId);

    await chrome.bookmarks.removeTree(workspaceId);

    if (groupId !== undefined) {
      const tabs = await chrome.tabs.query({ groupId });
      const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
      if (tabIds.length > 0) {
        // docs/mvp-checklist.md: 删除 Workspace 不关闭用户页面；
        // 已打开 Chrome Tabs 释放到 Unmanaged 区。
        await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
        tabIds.forEach((tabId) => this.removeWorkspacePageOrder(`chrome-tab:${tabId}`));
      }
      this.groupWorkspaceIds.delete(groupId);
    }

    this.workspaceGroupIds.delete(workspaceId);
    void this.persistRuntimeBindings();
  }

  async renameUnmanagedGroup(groupId: number, title: string) {
    await this.ensureRuntimeBindingsLoaded();

    if (this.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.update(groupId, {
      title: title.trim(),
    });
  }

  async ungroupUnmanagedGroup(groupId: number) {
    await this.ensureRuntimeBindingsLoaded();

    if (this.groupWorkspaceIds.has(groupId)) return;

    const tabIds = (await chrome.tabs.query({ groupId }))
      .flatMap((tab) => (tab.id ? [tab.id] : []));
    if (tabIds.length === 0) return;

    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
  }

  async updateUnmanagedGroupColor(groupId: number, color: TabGroupColor) {
    await this.ensureRuntimeBindingsLoaded();

    if (this.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.update(groupId, { color });
  }

  async moveUnmanagedItem(
    itemType: "page" | "group",
    itemId: string | number,
    index: number,
    windowId: number,
  ) {
    await this.ensureRuntimeBindingsLoaded();

    const items = await this.unmanagedOrderItems(windowId, itemType, itemId);
    const targetIndex = Math.max(0, Math.min(index, items.length));
    const chromeIndex = this.chromeInsertionIndex(items, targetIndex);

    if (itemType === "page") {
      const parsedId = parsePageId(String(itemId));
      if (!parsedId.chromeTabId) return;

      await chrome.tabs.ungroup(parsedId.chromeTabId);
      await chrome.tabs.move(parsedId.chromeTabId, { windowId, index: chromeIndex });
      return;
    }

    const groupId = Number(itemId);
    if (this.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.move(groupId, { windowId, index: chromeIndex });
  }

  async moveUnmanagedPageToGroup(pageId: string, groupId: number, index: number) {
    await this.ensureRuntimeBindingsLoaded();

    if (this.groupWorkspaceIds.has(groupId)) return;

    const parsedId = parsePageId(pageId);
    if (!parsedId.chromeTabId) return;

    const targetTabs = (await chrome.tabs.query({ groupId }))
      .filter((tab) => tab.id !== parsedId.chromeTabId)
      .sort((a, b) => a.index - b.index);
    const moveIndex = targetTabs[index]?.index ?? (targetTabs.at(-1)?.index ?? -1) + 1;

    if (moveIndex >= 0) {
      await chrome.tabs.move(parsedId.chromeTabId, { index: moveIndex });
    }
    await chrome.tabs.group({ tabIds: parsedId.chromeTabId, groupId });
  }

  async moveUnmanagedGroupToWorkspace(groupId: number, workspaceId: string, index: number) {
    await this.ensureRuntimeBindingsLoaded();

    if (this.groupWorkspaceIds.has(groupId)) return;

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
      this.moveWorkspacePageOrder(workspaceId, `chrome-tab:${tabId}`, insertIndex + offset);
    });
    void this.persistRuntimeBindings();
  }

  async openWorkspacePage(
    workspaceId: string,
    pageId: string,
    windowId: number,
    preferredChromeTabId?: number,
  ) {
    await this.ensureRuntimeBindingsLoaded();

    const parsedId = parsePageId(pageId);
    const bookmarkId = parsedId.bookmarkId;

    const existingChromeTabId = preferredChromeTabId || parsedId.chromeTabId;
    if (existingChromeTabId && await this.chromeTabExists(existingChromeTabId)) {
      if (bookmarkId) {
        this.chromeTabBookmarkIds.set(existingChromeTabId, bookmarkId);
        void this.persistRuntimeBindings();
      }
      await chrome.tabs.update(existingChromeTabId, { active: true });
      return;
    }

    if (!bookmarkId) return;

    const openChromeTabId = await this.findOpenChromeTabIdByBookmarkId(bookmarkId);
    if (openChromeTabId) {
      await chrome.tabs.update(openChromeTabId, { active: true });
      return;
    }

    const [bookmark] = await chrome.bookmarks.get(bookmarkId);
    if (!bookmark?.url) return;

    const createProperties: chrome.tabs.CreateProperties = {
      windowId,
      url: bookmark.url,
      active: true,
    };

    const tab = await chrome.tabs.create(createProperties);

    if (!tab.id) return;

    // docs/page-model.md: 关闭态 Pinned Page 被点击时才创建 Chrome Tab，
    // 并按 Workspace 的运行时投影创建或加入 Chrome Group。
    const groupId = await this.ensureWorkspaceGroup(workspaceId, tab.id);
    const restoredTab = await chrome.tabs.get(tab.id);
    if (restoredTab.groupId !== groupId) {
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    }
    this.chromeTabBookmarkIds.set(tab.id, bookmarkId);
    void this.persistRuntimeBindings();
  }

  async closeWorkspacePage(chromeTabId: number) {
    await this.ensureRuntimeBindingsLoaded();

    await chrome.tabs.remove(chromeTabId);
    this.chromeTabBookmarkIds.delete(chromeTabId);
    this.removeWorkspacePageOrder(`chrome-tab:${chromeTabId}`);
    void this.persistRuntimeBindings();
  }

  async closeWorkspacePages(workspaceId: string) {
    await this.ensureRuntimeBindingsLoaded();

    const groupId = await this.validWorkspaceGroupId(workspaceId);
    if (groupId === undefined) return;

    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
    if (tabIds.length === 0) return;

    await chrome.tabs.remove(tabIds as [number, ...number[]]);
    tabIds.forEach((tabId) => {
      this.chromeTabBookmarkIds.delete(tabId);
      this.removeWorkspacePageOrder(`chrome-tab:${tabId}`, false);
    });
    void this.persistRuntimeBindings();
  }

  async restorePinnedPage(bookmarkId: string, chromeTabId?: number) {
    await this.ensureRuntimeBindingsLoaded();

    const [bookmark] = await chrome.bookmarks.get(bookmarkId);
    if (!bookmark?.url) return;

    const openChromeTabId = chromeTabId && await this.chromeTabExists(chromeTabId)
      ? chromeTabId
      : await this.findOpenChromeTabIdByBookmarkId(bookmarkId);
    if (!openChromeTabId) return;

    // docs/page-model.md: Dirty Pinned Page 不自动更新 bookmark URL；
    // 用户显式恢复时，把当前 Chrome Tab 导回 bookmark URL。
    await chrome.tabs.update(openChromeTabId, {
      url: bookmark.url,
      active: true,
    });
    this.chromeTabBookmarkIds.set(openChromeTabId, bookmarkId);
    void this.persistRuntimeBindings();
  }

  async pinPage(workspaceId: string, chromeTabId: number) {
    await this.ensureRuntimeBindingsLoaded();

    const tab = await chrome.tabs.get(chromeTabId);
    if (!canBookmarkTab(tab)) return;

    const existingBookmarkId = this.chromeTabBookmarkIds.get(chromeTabId);
    if (existingBookmarkId) return;

    // docs/page-model.md: Temp Page 固定时创建 Bookmark，并继续绑定当前 Chrome Tab。
    const bookmark = await chrome.bookmarks.create({
      parentId: workspaceId,
      title: chromeTabTitle(tab),
      url: chromeTabUrl(tab),
    });
    this.chromeTabBookmarkIds.set(chromeTabId, bookmark.id);
    this.replaceWorkspacePageOrder(workspaceId, `chrome-tab:${chromeTabId}`, `bookmark:${bookmark.id}`);
    void this.persistRuntimeBindings();
  }

  async unpinPage(chromeTabId?: number, bookmarkId?: string) {
    await this.ensureRuntimeBindingsLoaded();

    const resolvedBookmarkId = bookmarkId || (chromeTabId ? this.chromeTabBookmarkIds.get(chromeTabId) : undefined);
    if (!resolvedBookmarkId) return;

    // docs/page-model.md: 取消固定只删除 Bookmark，不关闭仍然打开的 Chrome Tab。
    await chrome.bookmarks.remove(resolvedBookmarkId);

    if (chromeTabId) {
      this.chromeTabBookmarkIds.delete(chromeTabId);
      await this.appendTempPageOrderForTab(chromeTabId, `bookmark:${resolvedBookmarkId}`);
      void this.persistRuntimeBindings();
      return;
    }

    for (const [openTabId, openBookmarkId] of this.chromeTabBookmarkIds.entries()) {
      if (openBookmarkId === resolvedBookmarkId) {
        this.chromeTabBookmarkIds.delete(openTabId);
        await this.appendTempPageOrderForTab(openTabId, `bookmark:${resolvedBookmarkId}`);
      }
    }
    void this.persistRuntimeBindings();
  }

  async updatePinnedPageTitle(bookmarkId: string, title: string) {
    await this.ensureRuntimeBindingsLoaded();

    await chrome.bookmarks.update(bookmarkId, {
      title: title.trim() || "Untitled page",
    });
  }

  async movePageToWorkspace(pageId: string, workspaceId: string | null, index: number, windowId: number) {
    await this.ensureRuntimeBindingsLoaded();

    const parsedId = parsePageId(pageId);
    const bookmarkId = parsedId.bookmarkId
      || (parsedId.chromeTabId ? this.chromeTabBookmarkIds.get(parsedId.chromeTabId) : undefined);
    const openChromeTabId = parsedId.chromeTabId
      || (bookmarkId ? await this.findOpenChromeTabIdByBookmarkId(bookmarkId) : undefined);
    const pageOrderId = bookmarkId ? `bookmark:${bookmarkId}` : pageId;

    if (!workspaceId) {
      // docs/page-model.md: Pinned Page 拖到 unmanaged 不删除 bookmark；
      // unmanaged 只接收没有 Bookmark 的 Temp Page。
      if (bookmarkId) return;
      if (!openChromeTabId) return;

      const moveIndex = await this.ungroupedChromeIndex(windowId, openChromeTabId, index);
      this.removeWorkspacePageOrder(pageOrderId);
      await chrome.tabs.move(openChromeTabId, { windowId, index: moveIndex });
      await chrome.tabs.ungroup(openChromeTabId);
      return;
    }

    if (bookmarkId) {
      // docs/page-model.md: Pinned Page 在 Workspace 内和跨 Workspace 都可以自由排序；
      // Bookmark 只同步 Pinned Page 彼此之间的长期相对顺序。
      await chrome.bookmarks.move(bookmarkId, {
        parentId: workspaceId,
        index: await this.pinnedBookmarkIndexForDisplayIndex(workspaceId, bookmarkId, pageOrderId, index),
      });
    }

    this.moveWorkspacePageOrder(workspaceId, pageOrderId, index);

    if (!openChromeTabId) return;

    const groupId = await this.ensureWorkspaceGroup(workspaceId, openChromeTabId);

    // docs/product-logic.md: Mooring managed Page 顺序与 Chrome Tab index 脱钩；
    // 这里只确保 Chrome Tab 进入目标 Workspace 的 Chrome Group。
    await chrome.tabs.group({ tabIds: openChromeTabId, groupId });

    void this.persistRuntimeBindings();
  }

  async moveWorkspace(sourceWorkspaceId: string, index: number) {
    await this.ensureRuntimeBindingsLoaded();

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

  private async ensureRuntimeBindingsLoaded() {
    if (this.runtimeBindingsLoaded) return;

    // docs/product-logic.md: Runtime Binding 可以用 chrome.storage.session
    // 跨 service worker 唤醒恢复，但读取后仍需在扫描时验证是否有效。
    const stored = await chrome.storage.session.get(RUNTIME_BINDINGS_STORAGE_KEY);
    const bindings = stored[RUNTIME_BINDINGS_STORAGE_KEY] as RuntimeBindingsStorage | undefined;

    this.workspaceGroupIds = new Map(bindings?.workspaceGroupIds || []);
    this.groupWorkspaceIds = new Map(
      [...this.workspaceGroupIds.entries()].map(([workspaceId, groupId]) => [groupId, workspaceId]),
    );
    this.chromeTabBookmarkIds = new Map(bindings?.chromeTabBookmarkIds || []);
    const pageOrders = bindings?.workspacePageOrders
      || bindings?.workspaceTempPageOrders?.map(
        ([workspaceId, tabIds]) => [workspaceId, tabIds.map((tabId) => `chrome-tab:${tabId}`)] as [string, string[]],
      )
      || [];
    this.workspacePageOrders = new Map(pageOrders);
    this.runtimeBindingsLoaded = true;
  }

  private async persistRuntimeBindings() {
    if (!this.runtimeBindingsLoaded) return;

    const bindings: RuntimeBindingsStorage = {
      workspaceGroupIds: [...this.workspaceGroupIds.entries()],
      chromeTabBookmarkIds: [...this.chromeTabBookmarkIds.entries()],
      workspacePageOrders: [...this.workspacePageOrders.entries()],
    };

    await chrome.storage.session.set({
      [RUNTIME_BINDINGS_STORAGE_KEY]: bindings,
    });
  }

  private clearRuntimeBindingsWithoutCleanup() {
    this.workspaceGroupIds.clear();
    this.groupWorkspaceIds.clear();
    this.chromeTabBookmarkIds.clear();
    this.workspacePageOrders.clear();
    void this.persistRuntimeBindings();
  }

  private bindKnownGroups(folders: WorkspaceFolder[], groups: chrome.tabGroups.TabGroup[]) {
    const groupedByTitle = new Map<string, chrome.tabGroups.TabGroup[]>();

    groups.forEach((group) => {
      const key = this.workspaceMatchKey(group.title || "", group.color);
      groupedByTitle.set(key, [...(groupedByTitle.get(key) || []), group]);
    });

    folders.forEach((folder) => {
      const boundGroupId = this.workspaceGroupIds.get(folder.id);
      if (boundGroupId !== undefined && groups.some((group) => group.id === boundGroupId)) return;

      const matches = groupedByTitle.get(this.workspaceMatchKey(folder.name, folder.color));
      const group = matches?.shift();
      if (group) {
        this.bindWorkspace(folder.id, group.id);
      }
    });
  }

  private async mergeDuplicateMatchedGroups(
    folders: WorkspaceFolder[],
    groups: chrome.tabGroups.TabGroup[],
  ) {
    for (const folder of folders) {
      const boundGroupId = this.workspaceGroupIds.get(folder.id);
      if (boundGroupId === undefined) continue;

      const duplicateGroups = groups.filter((group) => {
        if (group.id === boundGroupId) return false;
        if (this.groupWorkspaceIds.has(group.id)) return false;
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

  private pruneBindings(groups: chrome.tabGroups.TabGroup[]) {
    const validGroupIds = new Set(groups.map((group) => group.id));
    let changed = false;

    for (const [workspaceId, groupId] of this.workspaceGroupIds.entries()) {
      if (validGroupIds.has(groupId)) continue;

      this.workspaceGroupIds.delete(workspaceId);
      this.groupWorkspaceIds.delete(groupId);
      changed = true;
    }

    if (changed) {
      void this.persistRuntimeBindings();
    }
  }

  private workspaceMatchKey(name: string, color: TabGroupColor) {
    return `${color}:${name}`;
  }

  private bindWorkspace(workspaceId: string, groupId: number) {
    const previousGroupId = this.workspaceGroupIds.get(workspaceId);
    if (previousGroupId !== undefined && previousGroupId !== groupId) {
      this.groupWorkspaceIds.delete(previousGroupId);
    }

    const previousWorkspaceId = this.groupWorkspaceIds.get(groupId);
    if (previousWorkspaceId !== undefined && previousWorkspaceId !== workspaceId) {
      this.workspaceGroupIds.delete(previousWorkspaceId);
    }

    this.workspaceGroupIds.set(workspaceId, groupId);
    this.groupWorkspaceIds.set(groupId, workspaceId);
    void this.persistRuntimeBindings();
  }

  private buildWorkspacePages(
    workspaceId: string,
    bookmarks: chrome.bookmarks.BookmarkTreeNode[],
    openTabs: chrome.tabs.Tab[],
  ): PageModel[] {
    const tabsByBookmarkId = new Map<string, chrome.tabs.Tab>();
    const usedTabIds = new Set<number>();
    let bindingsChanged = false;

    openTabs.forEach((tab) => {
      if (!tab.id) return;

      const bookmarkId = this.chromeTabBookmarkIds.get(tab.id);
      if (bookmarkId) {
        tabsByBookmarkId.set(bookmarkId, tab);
        return;
      }

      const matchingBookmark = bookmarks.find((bookmark) => bookmarkKey(bookmark) === chromeTabUrl(tab));
      if (matchingBookmark) {
        this.chromeTabBookmarkIds.set(tab.id, matchingBookmark.id);
        tabsByBookmarkId.set(matchingBookmark.id, tab);
        bindingsChanged = true;
      }
    });

    if (bindingsChanged) {
      void this.persistRuntimeBindings();
    }

    const pinnedTabs = bookmarks.map((bookmark, index) => {
      const tab = tabsByBookmarkId.get(bookmark.id);
      if (tab?.id) usedTabIds.add(tab.id);

      return pinnedPageModel(bookmark, tab, index);
    });

    const tempPages = openTabs
      .filter((tab) => tab.id && !usedTabIds.has(tab.id))
      .map((tab) => tempPageModel(tab, false));
    const pages = [...pinnedTabs, ...tempPages];
    const order = this.reconcileWorkspacePageOrder(workspaceId, pages.map((page) => page.id));

    // docs/page-model.md: Workspace 内 Page 可以自由混排；
    // Mooring managed 顺序来自自己的 runtime order，不跟 Chrome Tab index 绑定。
    return pages
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((page, index) => ({
        ...page,
        order: index,
      }));
  }

  private async chromeTabExists(tabId: number) {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private async findOpenChromeTabIdByBookmarkId(bookmarkId: string) {
    let bindingsChanged = false;

    for (const [tabId, boundBookmarkId] of this.chromeTabBookmarkIds.entries()) {
      if (boundBookmarkId !== bookmarkId) continue;
      if (await this.chromeTabExists(tabId)) return tabId;

      this.chromeTabBookmarkIds.delete(tabId);
      bindingsChanged = true;
    }

    if (bindingsChanged) {
      void this.persistRuntimeBindings();
    }

    return undefined;
  }

  private async ensureWorkspaceGroup(workspaceId: string, seedTabId: number) {
    const existingGroupId = await this.validWorkspaceGroupId(workspaceId);
    if (existingGroupId !== undefined) {
      return existingGroupId;
    }

    const folder = await getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const groupId = await chrome.tabs.group({ tabIds: seedTabId });
    await chrome.tabGroups.update(groupId, {
      title: parsed.name,
      color: parsed.color,
      collapsed: parsed.collapsed,
    });
    this.bindWorkspace(workspaceId, groupId);
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
    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId === undefined) return undefined;

    if (await this.groupExists(groupId)) return groupId;

    this.workspaceGroupIds.delete(workspaceId);
    this.groupWorkspaceIds.delete(groupId);
    void this.persistRuntimeBindings();
    return undefined;
  }

  private async ungroupedChromeIndex(windowId: number, movingTabId: number, displayIndex: number) {
    if (displayIndex < 0) return -1;

    const tabs = await chrome.tabs.query({ windowId });
    const unmanagedChromeTabs = tabs
      .filter((tab) => tab.groupId === NO_GROUP && tab.id !== movingTabId)
      .sort((a, b) => a.index - b.index);

    return unmanagedChromeTabs[displayIndex]?.index ?? -1;
  }

  private async unmanagedOrderItems(
    windowId: number,
    movingType: "page" | "group",
    movingId: string | number,
  ) {
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    const managedGroupIds = new Set(this.workspaceGroupIds.values());
    const movingTabId = movingType === "page"
      ? parsePageId(String(movingId)).chromeTabId
      : undefined;
    const movingGroupId = movingType === "group" ? Number(movingId) : undefined;

    const unmanagedGroups = groups
      .filter((group) => !managedGroupIds.has(group.id) && group.id !== movingGroupId)
      .map((group) => {
        const groupTabs = tabs
          .filter((tab) => tab.groupId === group.id)
          .sort((a, b) => a.index - b.index);
        const firstTab = groupTabs[0];
        const lastTab = groupTabs.at(-1);

        return {
          type: "group" as const,
          id: group.id,
          index: firstTab?.index ?? Number.MAX_SAFE_INTEGER,
          endIndex: lastTab ? lastTab.index + 1 : Number.MAX_SAFE_INTEGER,
        };
      });
    const unmanagedPages = tabs
      .filter((tab) => tab.groupId === NO_GROUP && tab.id !== movingTabId)
      .map((tab) => ({
        type: "page" as const,
        id: tab.id,
        index: tab.index,
        endIndex: tab.index + 1,
      }));

    return [...unmanagedGroups, ...unmanagedPages]
      .sort((a, b) => a.index - b.index);
  }

  private chromeInsertionIndex(
    items: Array<{ index: number; endIndex: number }>,
    targetIndex: number,
  ) {
    if (targetIndex < items.length) return items[targetIndex].index;

    const lastItem = items.at(-1);
    return lastItem ? lastItem.endIndex : 0;
  }

  private async pinnedBookmarkIndexForDisplayIndex(
    workspaceId: string,
    movingBookmarkId: string,
    movingPageId: string,
    displayIndex: number,
  ) {
    const bookmarks = (await chrome.bookmarks.getChildren(workspaceId))
      .filter((node) => node.url);

    const filteredBookmarks = bookmarks.filter((node) => node.id !== movingBookmarkId);
    if (displayIndex < 0) return filteredBookmarks.length;

    const currentOrder = this.workspacePageOrders.get(workspaceId) || bookmarks.map((node) => `bookmark:${node.id}`);
    const nextOrder = currentOrder.filter((id) => id !== movingPageId);
    const previousIndex = currentOrder.indexOf(movingPageId);
    const adjustedDisplayIndex = previousIndex >= 0 && previousIndex < displayIndex
      ? displayIndex - 1
      : displayIndex;
    nextOrder.splice(Math.min(adjustedDisplayIndex, nextOrder.length), 0, movingPageId);

    const bookmarkIdsBeforeTarget = nextOrder
      .slice(0, nextOrder.indexOf(movingPageId))
      .filter((id) => id.startsWith("bookmark:"))
      .length;
    return Math.min(bookmarkIdsBeforeTarget, filteredBookmarks.length);
  }

  private reconcileWorkspacePageOrder(
    workspaceId: string,
    pageIds: string[],
  ) {
    const validIds = new Set(pageIds);
    const previousOrder = this.workspacePageOrders.get(workspaceId) || [];
    const nextOrder = previousOrder.filter((id) => validIds.has(id));

    pageIds.forEach((id) => {
      if (!nextOrder.includes(id)) {
        nextOrder.push(id);
      }
    });

    const changed = previousOrder.length !== nextOrder.length
      || previousOrder.some((id, index) => id !== nextOrder[index]);
    if (changed) {
      this.workspacePageOrders.set(workspaceId, nextOrder);
      void this.persistRuntimeBindings();
    }
    return nextOrder;
  }

  private moveWorkspacePageOrder(workspaceId: string, pageId: string, displayIndex: number) {
    const currentOrder = this.workspacePageOrders.get(workspaceId) || [];
    const previousIndex = currentOrder.indexOf(pageId);
    const adjustedDisplayIndex = previousIndex >= 0 && previousIndex < displayIndex
      ? displayIndex - 1
      : displayIndex;

    this.removeWorkspacePageOrder(pageId, false);

    const order = (this.workspacePageOrders.get(workspaceId) || []).filter((id) => id !== pageId);
    order.splice(
      adjustedDisplayIndex < 0 ? order.length : Math.min(adjustedDisplayIndex, order.length),
      0,
      pageId,
    );
    this.workspacePageOrders.set(workspaceId, order);
    void this.persistRuntimeBindings();
  }

  private replaceWorkspacePageOrder(workspaceId: string, previousPageId: string, nextPageId: string) {
    const order = this.workspacePageOrders.get(workspaceId) || [];
    const previousIndex = order.indexOf(previousPageId);
    const nextOrder = order.filter((id) => id !== previousPageId && id !== nextPageId);
    nextOrder.splice(previousIndex >= 0 ? previousIndex : nextOrder.length, 0, nextPageId);
    this.workspacePageOrders.set(workspaceId, nextOrder);
    void this.persistRuntimeBindings();
  }

  private async appendTempPageOrderForTab(chromeTabId: number, previousPageId?: string) {
    // docs/page-model.md: Pinned Page 取消固定后，如果 Chrome Tab 仍打开，
    // 它变成 Temp Page；Page 顺序进入 Workspace runtime 顺序末尾。
    const tab = await chrome.tabs.get(chromeTabId).catch(() => undefined);
    if (!tab) return;

    const workspaceId = this.groupWorkspaceIds.get(tab.groupId);
    if (!workspaceId) return;

    const pageId = `chrome-tab:${chromeTabId}`;
    if (previousPageId) {
      this.replaceWorkspacePageOrder(workspaceId, previousPageId, pageId);
      return;
    }

    const order = this.workspacePageOrders.get(workspaceId) || [];
    if (!order.includes(pageId)) {
      this.workspacePageOrders.set(workspaceId, [...order, pageId]);
      void this.persistRuntimeBindings();
    }
  }

  private removeWorkspacePageOrder(pageId: string, persist = true) {
    let changed = false;

    for (const [workspaceId, order] of this.workspacePageOrders.entries()) {
      const nextOrder = order.filter((id) => id !== pageId);
      if (nextOrder.length !== order.length) {
        changed = true;
      }
      this.workspacePageOrders.set(workspaceId, nextOrder);
    }

    if (changed && persist) {
      void this.persistRuntimeBindings();
    }
  }
}
