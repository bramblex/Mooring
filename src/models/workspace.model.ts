import type { TabModel } from "./tab.model";

export type TabGroupColor = chrome.tabGroups.TabGroup["color"];

export type WorkspaceView = {
  id: string;
  name: string;
  color: TabGroupColor;
  order: number;
  collapsed: boolean;
  groupId?: number;
  tabs: TabModel[];
};

export type WorkspaceState = {
  workspaces: WorkspaceView[];
  ungroupedTabs: TabModel[];
};

type ParsedWorkspaceTitle = {
  name: string;
  color: TabGroupColor;
};

type WorkspaceFolder = ParsedWorkspaceTitle & {
  id: string;
  index: number;
};

const ROOT_FOLDER_TITLE = "Harbor Workspace";
const DEFAULT_WORKSPACE_NAME = "Untitled workspace";
const DEFAULT_WORKSPACE_COLOR: TabGroupColor = "grey";
const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
const WORKSPACE_TITLE_RE = /^\[(grey|blue|red|yellow|green|pink|purple|cyan|orange)\]\s*(.*)$/;

const BOOKMARK_BAR_ID = "1";

function parseWorkspaceTitle(title: string): ParsedWorkspaceTitle {
  const match = title.match(WORKSPACE_TITLE_RE);

  if (!match) {
    return {
      name: title || DEFAULT_WORKSPACE_NAME,
      color: DEFAULT_WORKSPACE_COLOR,
    };
  }

  return {
    color: match[1] as TabGroupColor,
    name: match[2] || DEFAULT_WORKSPACE_NAME,
  };
}

function formatWorkspaceTitle(name: string, color: TabGroupColor) {
  return `[${color}] ${name.trim() || DEFAULT_WORKSPACE_NAME}`;
}

function tabTitle(tab: chrome.tabs.Tab) {
  return tab.title || tab.url || "Untitled tab";
}

function bookmarkTitle(bookmark: chrome.bookmarks.BookmarkTreeNode) {
  return bookmark.title || bookmark.url || "Untitled tab";
}

function tabUrl(tab: chrome.tabs.Tab) {
  return tab.url || tab.pendingUrl || "";
}

function bookmarkKey(bookmark: chrome.bookmarks.BookmarkTreeNode) {
  return bookmark.url || "";
}

function canBookmarkTab(tab: chrome.tabs.Tab) {
  const url = tabUrl(tab);
  return Boolean(url && !url.startsWith("chrome://") && !url.startsWith("chrome-extension://"));
}

export class WorkspaceModel {
  private workspaceGroupIds = new Map<string, number>();
  private groupWorkspaceIds = new Map<number, string>();
  private tabBookmarkIds = new Map<number, string>();

  async getState(windowId: number): Promise<WorkspaceState> {
    const root = await this.ensureRootFolder();
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    await this.ensureFoldersForGroups(root.id, groups);
    const freshFolders = await this.listWorkspaceFolders(root.id);

    this.pruneBindings(groups);
    this.bindKnownGroups(freshFolders, groups);

    const workspaces = await Promise.all(
      freshFolders.map(async (folder) => {
        const groupId = this.workspaceGroupIds.get(folder.id);

        const group = groupId === undefined ? undefined : groups.find((item) => item.id === groupId);
        const groupTabs = groupId === undefined
          ? []
          : tabs.filter((tab) => tab.groupId === groupId).sort((a, b) => a.index - b.index);
        const bookmarks = (await chrome.bookmarks.getChildren(folder.id)).filter((node) => node.url);

        return {
          id: folder.id,
          name: folder.name,
          color: folder.color,
          order: folder.index,
          collapsed: Boolean(group?.collapsed),
          groupId,
          tabs: this.buildWorkspaceTabs(bookmarks, groupTabs),
        };
      }),
    );

    const ungroupedTabs = tabs
      .filter((tab) => tab.groupId === NO_GROUP)
      .sort((a, b) => a.index - b.index)
      .map((tab) => this.liveTabModel(tab, false));

    return {
      workspaces,
      ungroupedTabs,
    };
  }

  async createWorkspace(windowId: number) {
    const root = await this.ensureRootFolder();
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: formatWorkspaceTitle(DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_COLOR),
    });
    const tab = await chrome.tabs.create({
      windowId,
      active: true,
    });

    if (!tab.id) return folder.id;

    const groupId = await chrome.tabs.group({ tabIds: tab.id });
    await chrome.tabGroups.update(groupId, {
      title: DEFAULT_WORKSPACE_NAME,
      color: DEFAULT_WORKSPACE_COLOR,
    });
    this.bindWorkspace(folder.id, groupId);
    return folder.id;
  }

  async renameWorkspace(workspaceId: string, name: string) {
    const folder = await this.getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const nextName = name.trim() || DEFAULT_WORKSPACE_NAME;

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(nextName, parsed.color),
    });

    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { title: nextName });
    }
  }

  async updateWorkspaceColor(workspaceId: string, color: TabGroupColor) {
    const folder = await this.getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);

    await chrome.bookmarks.update(workspaceId, {
      title: formatWorkspaceTitle(parsed.name, color),
    });

    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { color });
    }
  }

  async toggleWorkspace(workspaceId: string) {
    const groupId = this.workspaceGroupIds.get(workspaceId);
    if (groupId === undefined) return;

    const group = await chrome.tabGroups.get(groupId);
    await chrome.tabGroups.update(groupId, { collapsed: !group.collapsed });
  }

  async deleteWorkspace(workspaceId: string) {
    const groupId = this.workspaceGroupIds.get(workspaceId);

    await chrome.bookmarks.removeTree(workspaceId);

    if (groupId !== undefined) {
      const tabs = await chrome.tabs.query({ groupId });
      const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
      if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
      }
      this.groupWorkspaceIds.delete(groupId);
    }

    this.workspaceGroupIds.delete(workspaceId);
  }

  async openWorkspaceTab(workspaceId: string, tabId: string, windowId: number) {
    const parsedId = this.parseWorkspaceTabId(tabId);

    if (parsedId.tabId && await this.tabExists(parsedId.tabId)) {
      await chrome.tabs.update(parsedId.tabId, { active: true });
      return;
    }

    const bookmarkId = parsedId.bookmarkId;
    if (!bookmarkId) return;

    const openTabId = await this.findOpenTabIdByBookmarkId(bookmarkId);
    if (openTabId) {
      await chrome.tabs.update(openTabId, { active: true });
      return;
    }

    const [bookmark] = await chrome.bookmarks.get(bookmarkId);
    if (!bookmark?.url) return;

    const existingGroupId = await this.validWorkspaceGroupId(workspaceId);
    const index = existingGroupId === undefined ? undefined : await this.workspaceInsertIndex(existingGroupId, bookmarkId);
    const createProperties: chrome.tabs.CreateProperties = {
      windowId,
      url: bookmark.url,
      active: true,
    };

    if (index !== undefined) {
      createProperties.index = index;
    }

    const tab = await chrome.tabs.create(createProperties);

    if (!tab.id) return;

    const groupId = await this.ensureWorkspaceGroup(workspaceId, tab.id);
    const restoredTab = await chrome.tabs.get(tab.id);
    if (restoredTab.groupId !== groupId) {
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    }
    this.tabBookmarkIds.set(tab.id, bookmarkId);
  }

  async closeWorkspaceTab(tabId: number) {
    await chrome.tabs.remove(tabId);
    this.tabBookmarkIds.delete(tabId);
  }

  async pinTab(workspaceId: string, tabId: number) {
    const tab = await chrome.tabs.get(tabId);
    if (!canBookmarkTab(tab)) return;

    const existingBookmarkId = this.tabBookmarkIds.get(tabId);
    if (existingBookmarkId) return;

    const bookmark = await chrome.bookmarks.create({
      parentId: workspaceId,
      title: tabTitle(tab),
      url: tabUrl(tab),
    });
    this.tabBookmarkIds.set(tabId, bookmark.id);
  }

  async unpinTab(tabId?: number, bookmarkId?: string) {
    const resolvedBookmarkId = bookmarkId || (tabId ? this.tabBookmarkIds.get(tabId) : undefined);
    if (!resolvedBookmarkId) return;

    await chrome.bookmarks.remove(resolvedBookmarkId);

    if (tabId) {
      this.tabBookmarkIds.delete(tabId);
      return;
    }

    for (const [openTabId, openBookmarkId] of this.tabBookmarkIds.entries()) {
      if (openBookmarkId === resolvedBookmarkId) {
        this.tabBookmarkIds.delete(openTabId);
      }
    }
  }

  async moveTabToWorkspace(tabId: number, workspaceId: string | null, index: number, windowId: number) {
    const moveIndex = index < 0 ? -1 : index;

    if (!workspaceId) {
      await chrome.tabs.move(tabId, { windowId, index: moveIndex });
      await chrome.tabs.ungroup(tabId);
      return;
    }

    await chrome.tabs.move(tabId, { windowId, index: moveIndex });
    const groupId = await this.ensureWorkspaceGroup(workspaceId, tabId);
    await chrome.tabs.group({ tabIds: tabId, groupId });

    const bookmarkId = this.tabBookmarkIds.get(tabId);
    if (bookmarkId) {
      await chrome.bookmarks.move(bookmarkId, {
        parentId: workspaceId,
        index: Math.max(index, 0),
      });
    }
  }

  async moveWorkspace(sourceWorkspaceId: string, targetWorkspaceId: string) {
    const root = await this.ensureRootFolder();
    const folders = await this.listWorkspaceFolders(root.id);
    const targetFolder = folders.find((folder) => folder.id === targetWorkspaceId);
    if (!targetFolder) return;

    await chrome.bookmarks.move(sourceWorkspaceId, {
      parentId: root.id,
      index: targetFolder.index,
    });

    const sourceGroupId = this.workspaceGroupIds.get(sourceWorkspaceId);
    const targetGroupId = this.workspaceGroupIds.get(targetWorkspaceId);
    if (sourceGroupId === undefined || targetGroupId === undefined) return;

    const targetTabs = await chrome.tabs.query({ groupId: targetGroupId });
    const targetIndex = targetTabs.sort((a, b) => a.index - b.index)[0]?.index;
    if (targetIndex !== undefined) {
      await chrome.tabGroups.move(sourceGroupId, { index: targetIndex });
    }
  }

  private async ensureRootFolder() {
    const [root] = await chrome.bookmarks.search({ title: ROOT_FOLDER_TITLE });
    if (root && !root.url) return root;

    try {
      return await chrome.bookmarks.create({
        parentId: BOOKMARK_BAR_ID,
        title: ROOT_FOLDER_TITLE,
      });
    } catch {
      return chrome.bookmarks.create({
        title: ROOT_FOLDER_TITLE,
      });
    }
  }

  private async getWorkspaceFolder(workspaceId: string) {
    const [folder] = await chrome.bookmarks.get(workspaceId);
    if (!folder) {
      throw new Error(`Workspace folder not found: ${workspaceId}`);
    }
    return folder;
  }

  private async listWorkspaceFolders(rootId: string): Promise<WorkspaceFolder[]> {
    const children = await chrome.bookmarks.getChildren(rootId);

    return children
      .filter((node) => !node.url)
      .map((node, index) => ({
        ...parseWorkspaceTitle(node.title),
        id: node.id,
        index,
      }));
  }

  private async ensureFoldersForGroups(rootId: string, groups: chrome.tabGroups.TabGroup[]) {
    const folders = await this.listWorkspaceFolders(rootId);
    const unmatchedFolders = [...folders];

    for (const group of groups) {
      if (this.groupWorkspaceIds.has(group.id)) continue;

      const title = group.title || DEFAULT_WORKSPACE_NAME;
      const matchedFolderIndex = unmatchedFolders.findIndex(
        (folder) => folder.name === title && folder.color === group.color,
      );

      if (matchedFolderIndex >= 0) {
        const [folder] = unmatchedFolders.splice(matchedFolderIndex, 1);
        this.bindWorkspace(folder.id, group.id);
        continue;
      }

      const folder = await chrome.bookmarks.create({
        parentId: rootId,
        title: formatWorkspaceTitle(title, group.color),
      });
      this.bindWorkspace(folder.id, group.id);
    }

    return this.listWorkspaceFolders(rootId);
  }

  private bindKnownGroups(folders: WorkspaceFolder[], groups: chrome.tabGroups.TabGroup[]) {
    const groupedByTitle = new Map<string, chrome.tabGroups.TabGroup[]>();

    groups.forEach((group) => {
      const key = this.workspaceMatchKey(group.title || DEFAULT_WORKSPACE_NAME, group.color);
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

  private pruneBindings(groups: chrome.tabGroups.TabGroup[]) {
    const validGroupIds = new Set(groups.map((group) => group.id));

    for (const [workspaceId, groupId] of this.workspaceGroupIds.entries()) {
      if (validGroupIds.has(groupId)) continue;

      this.workspaceGroupIds.delete(workspaceId);
      this.groupWorkspaceIds.delete(groupId);
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
  }

  private buildWorkspaceTabs(
    bookmarks: chrome.bookmarks.BookmarkTreeNode[],
    openTabs: chrome.tabs.Tab[],
  ): TabModel[] {
    const tabsByBookmarkId = new Map<string, chrome.tabs.Tab>();
    const usedTabIds = new Set<number>();

    openTabs.forEach((tab) => {
      if (!tab.id) return;

      const bookmarkId = this.tabBookmarkIds.get(tab.id);
      if (bookmarkId) {
        tabsByBookmarkId.set(bookmarkId, tab);
        return;
      }

      const matchingBookmark = bookmarks.find((bookmark) => bookmarkKey(bookmark) === tabUrl(tab));
      if (matchingBookmark) {
        this.tabBookmarkIds.set(tab.id, matchingBookmark.id);
        tabsByBookmarkId.set(matchingBookmark.id, tab);
      }
    });

    const pinnedTabs = bookmarks.map((bookmark, index) => {
      const tab = tabsByBookmarkId.get(bookmark.id);
      if (tab?.id) usedTabIds.add(tab.id);

      return this.pinnedTabModel(bookmark, tab, index);
    });

    const liveTabs = openTabs
      .filter((tab) => tab.id && !usedTabIds.has(tab.id))
      .map((tab) => this.liveTabModel(tab, false));

    return [...pinnedTabs, ...liveTabs].sort((a, b) => a.index - b.index);
  }

  private pinnedTabModel(
    bookmark: chrome.bookmarks.BookmarkTreeNode,
    tab: chrome.tabs.Tab | undefined,
    index: number,
  ): TabModel {
    const openUrl = tab ? tabUrl(tab) : "";
    const dirty = Boolean(tab && bookmark.url && openUrl && bookmark.url !== openUrl);

    return {
      id: `bookmark:${bookmark.id}`,
      kind: "pinned",
      title: bookmarkTitle(bookmark),
      currentTitle: dirty && tab ? tabTitle(tab) : undefined,
      url: bookmark.url,
      favIconUrl: tab?.favIconUrl,
      active: Boolean(tab?.active),
      index: tab?.index ?? index,
      pinned: true,
      dirty,
      open: Boolean(tab),
      tabId: tab?.id,
      bookmarkId: bookmark.id,
    };
  }

  private liveTabModel(tab: chrome.tabs.Tab, pinned: boolean): TabModel {
    return {
      id: `tab:${tab.id}`,
      kind: "live",
      title: tabTitle(tab),
      url: tabUrl(tab),
      favIconUrl: tab.favIconUrl,
      active: Boolean(tab.active),
      index: tab.index,
      pinned,
      dirty: false,
      open: true,
      tabId: tab.id,
    };
  }

  private parseWorkspaceTabId(id: string) {
    if (id.startsWith("tab:")) {
      return {
        tabId: Number(id.replace("tab:", "")),
      };
    }

    if (id.startsWith("bookmark:")) {
      return {
        bookmarkId: id.replace("bookmark:", ""),
      };
    }

    return {};
  }

  private async tabExists(tabId: number) {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private async findOpenTabIdByBookmarkId(bookmarkId: string) {
    for (const [tabId, boundBookmarkId] of this.tabBookmarkIds.entries()) {
      if (boundBookmarkId !== bookmarkId) continue;
      if (await this.tabExists(tabId)) return tabId;

      this.tabBookmarkIds.delete(tabId);
    }

    return undefined;
  }

  private async ensureWorkspaceGroup(workspaceId: string, seedTabId: number) {
    const existingGroupId = await this.validWorkspaceGroupId(workspaceId);
    if (existingGroupId !== undefined) {
      return existingGroupId;
    }

    const folder = await this.getWorkspaceFolder(workspaceId);
    const parsed = parseWorkspaceTitle(folder.title);
    const groupId = await chrome.tabs.group({ tabIds: seedTabId });
    await chrome.tabGroups.update(groupId, {
      title: parsed.name,
      color: parsed.color,
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
    return undefined;
  }

  private async workspaceInsertIndex(groupId: number, bookmarkId: string) {
    const tabs = await chrome.tabs.query({ groupId });
    const sortedTabs = tabs.sort((a, b) => a.index - b.index);
    if (sortedTabs.length === 0) return -1;

    const bookmarks = await this.bookmarksForGroup(groupId);
    const targetOrder = bookmarks.findIndex((bookmark) => bookmark.id === bookmarkId);
    if (targetOrder <= 0) return sortedTabs[0].index;

    return sortedTabs[Math.min(targetOrder, sortedTabs.length - 1)]?.index ?? -1;
  }

  private async bookmarksForGroup(groupId: number) {
    const workspaceId = this.groupWorkspaceIds.get(groupId);
    if (!workspaceId) return [];

    return (await chrome.bookmarks.getChildren(workspaceId)).filter((node) => node.url);
  }
}
