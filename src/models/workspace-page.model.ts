import type { PageModel } from "./page.model";
import { NO_GROUP } from "./workspace.constants";
import { bookmarkKey, canBookmarkTab, chromeTabTitle, chromeTabUrl } from "./workspace.helpers";
import { parsePageId, pinnedPageModel, tempPageModel } from "./workspace.page-factory";
import { WorkspaceRuntimeStore } from "./workspace.runtime";

type EnsureWorkspaceGroup = (workspaceId: string, seedTabId: number) => Promise<number>;

// docs/page-model.md: WorkspacePageModel 闭环处理 Workspace 内 Page
// 生命周期和排序。它可以请求 WorkspaceModel 提供 Chrome Group 投影，
// 但不管理 Workspace folder、Workspace 名称、颜色或 Workspace 排序。
export class WorkspacePageModel {
  constructor(
    private runtime: WorkspaceRuntimeStore,
    private ensureWorkspaceGroup: EnsureWorkspaceGroup,
  ) {}

  buildWorkspacePages(
    workspaceId: string,
    bookmarks: chrome.bookmarks.BookmarkTreeNode[],
    openTabs: chrome.tabs.Tab[],
  ): PageModel[] {
    const tabsByBookmarkId = new Map<string, chrome.tabs.Tab>();
    const usedTabIds = new Set<number>();
    let bindingsChanged = false;

    openTabs.forEach((tab) => {
      if (!tab.id) return;

      const bookmarkId = this.runtime.chromeTabBookmarkIds.get(tab.id);
      if (bookmarkId) {
        tabsByBookmarkId.set(bookmarkId, tab);
        return;
      }

      const matchingBookmark = bookmarks.find((bookmark) => bookmarkKey(bookmark) === chromeTabUrl(tab));
      if (matchingBookmark) {
        this.runtime.chromeTabBookmarkIds.set(tab.id, matchingBookmark.id);
        tabsByBookmarkId.set(matchingBookmark.id, tab);
        bindingsChanged = true;
      }
    });

    if (bindingsChanged) {
      void this.runtime.persist();
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
    const order = this.runtime.reconcilePageOrder(workspaceId, pages.map((page) => page.id));

    // docs/page-model.md: Workspace 内 Page 可以自由混排；
    // Mooring managed 顺序来自自己的 runtime order，不跟 Chrome Tab index 绑定。
    return pages
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((page, index) => ({
        ...page,
        order: index,
      }));
  }

  async openWorkspacePage(
    workspaceId: string,
    pageId: string,
    windowId: number,
    preferredChromeTabId?: number,
  ) {
    await this.runtime.ensureLoaded();

    const parsedId = parsePageId(pageId);
    const bookmarkId = parsedId.bookmarkId;

    const existingChromeTabId = preferredChromeTabId || parsedId.chromeTabId;
    if (existingChromeTabId && await this.chromeTabExists(existingChromeTabId)) {
      if (bookmarkId) {
        this.runtime.chromeTabBookmarkIds.set(existingChromeTabId, bookmarkId);
        void this.runtime.persist();
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

    const tab = await chrome.tabs.create({
      windowId,
      url: bookmark.url,
      active: true,
    });

    if (!tab.id) return;

    // docs/page-model.md: 关闭态 Pinned Page 被点击时才创建 Chrome Tab，
    // 并按 Workspace 的运行时投影创建或加入 Chrome Group。
    const groupId = await this.ensureWorkspaceGroup(workspaceId, tab.id);
    const restoredTab = await chrome.tabs.get(tab.id);
    if (restoredTab.groupId !== groupId) {
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    }
    this.runtime.chromeTabBookmarkIds.set(tab.id, bookmarkId);
    void this.runtime.persist();
  }

  async closeWorkspacePage(chromeTabId: number) {
    await this.runtime.ensureLoaded();

    await chrome.tabs.remove(chromeTabId);
    this.runtime.chromeTabBookmarkIds.delete(chromeTabId);
    this.runtime.removePageOrder(`chrome-tab:${chromeTabId}`);
    void this.runtime.persist();
  }

  async closeWorkspacePages(workspaceId: string, groupId?: number) {
    await this.runtime.ensureLoaded();
    if (groupId === undefined) return;

    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));
    if (tabIds.length === 0) return;

    await chrome.tabs.remove(tabIds as [number, ...number[]]);
    tabIds.forEach((tabId) => {
      this.runtime.chromeTabBookmarkIds.delete(tabId);
      this.runtime.removePageOrder(`chrome-tab:${tabId}`, false);
    });
    void this.runtime.persist();
  }

  async restorePinnedPage(bookmarkId: string, chromeTabId?: number) {
    await this.runtime.ensureLoaded();

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
    this.runtime.chromeTabBookmarkIds.set(openChromeTabId, bookmarkId);
    void this.runtime.persist();
  }

  async pinPage(workspaceId: string, chromeTabId: number) {
    await this.runtime.ensureLoaded();

    const tab = await chrome.tabs.get(chromeTabId);
    if (!canBookmarkTab(tab)) return;

    const existingBookmarkId = this.runtime.chromeTabBookmarkIds.get(chromeTabId);
    if (existingBookmarkId) return;

    // docs/page-model.md: Temp Page 固定时创建 Bookmark，并继续绑定当前 Chrome Tab。
    const bookmark = await chrome.bookmarks.create({
      parentId: workspaceId,
      title: chromeTabTitle(tab),
      url: chromeTabUrl(tab),
    });
    this.runtime.chromeTabBookmarkIds.set(chromeTabId, bookmark.id);
    this.runtime.replacePageOrder(workspaceId, `chrome-tab:${chromeTabId}`, `bookmark:${bookmark.id}`);
    void this.runtime.persist();
  }

  async unpinPage(chromeTabId?: number, bookmarkId?: string) {
    await this.runtime.ensureLoaded();

    const resolvedBookmarkId = bookmarkId || (chromeTabId ? this.runtime.chromeTabBookmarkIds.get(chromeTabId) : undefined);
    if (!resolvedBookmarkId) return;

    // docs/page-model.md: 取消固定只删除 Bookmark，不关闭仍然打开的 Chrome Tab。
    await chrome.bookmarks.remove(resolvedBookmarkId);

    if (chromeTabId) {
      this.runtime.chromeTabBookmarkIds.delete(chromeTabId);
      await this.appendTempPageOrderForTab(chromeTabId, `bookmark:${resolvedBookmarkId}`);
      void this.runtime.persist();
      return;
    }

    for (const [openTabId, openBookmarkId] of this.runtime.chromeTabBookmarkIds.entries()) {
      if (openBookmarkId === resolvedBookmarkId) {
        this.runtime.chromeTabBookmarkIds.delete(openTabId);
        await this.appendTempPageOrderForTab(openTabId, `bookmark:${resolvedBookmarkId}`);
      }
    }
    void this.runtime.persist();
  }

  async updatePinnedPageTitle(bookmarkId: string, title: string) {
    await this.runtime.ensureLoaded();

    await chrome.bookmarks.update(bookmarkId, {
      title: title.trim() || "Untitled page",
    });
  }

  async movePageToWorkspace(pageId: string, workspaceId: string | null, index: number, windowId: number) {
    await this.runtime.ensureLoaded();

    const parsedId = parsePageId(pageId);
    const bookmarkId = parsedId.bookmarkId
      || (parsedId.chromeTabId ? this.runtime.chromeTabBookmarkIds.get(parsedId.chromeTabId) : undefined);
    const openChromeTabId = parsedId.chromeTabId
      || (bookmarkId ? await this.findOpenChromeTabIdByBookmarkId(bookmarkId) : undefined);
    const pageOrderId = bookmarkId ? `bookmark:${bookmarkId}` : pageId;

    if (!workspaceId) {
      // docs/page-model.md: Pinned Page 拖到 unmanaged 不删除 bookmark；
      // unmanaged 区域只接收没有 Bookmark 的 Temp Page。
      if (bookmarkId) return;
      if (!openChromeTabId) return;

      const moveIndex = await this.ungroupedChromeIndex(windowId, openChromeTabId, index);
      this.runtime.removePageOrder(pageOrderId);
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

    this.runtime.movePageOrder(workspaceId, pageOrderId, index);

    if (!openChromeTabId) return;

    const groupId = await this.ensureWorkspaceGroup(workspaceId, openChromeTabId);

    // docs/product-logic.md: Mooring managed Page 顺序与 Chrome Tab index 脱钩；
    // 这里只确保 Chrome Tab 进入目标 Workspace 的 Chrome Group。
    await chrome.tabs.group({ tabIds: openChromeTabId, groupId });

    void this.runtime.persist();
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

    for (const [tabId, boundBookmarkId] of this.runtime.chromeTabBookmarkIds.entries()) {
      if (boundBookmarkId !== bookmarkId) continue;
      if (await this.chromeTabExists(tabId)) return tabId;

      this.runtime.chromeTabBookmarkIds.delete(tabId);
      bindingsChanged = true;
    }

    if (bindingsChanged) {
      void this.runtime.persist();
    }

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

    const currentOrder = this.runtime.workspacePageOrders.get(workspaceId) || bookmarks.map((node) => `bookmark:${node.id}`);
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

  private async appendTempPageOrderForTab(chromeTabId: number, previousPageId?: string) {
    // docs/page-model.md: Pinned Page 取消固定后，如果 Chrome Tab 仍打开，
    // 它变成 Temp Page；Page 顺序进入 Workspace runtime 顺序末尾。
    const tab = await chrome.tabs.get(chromeTabId).catch(() => undefined);
    if (!tab) return;

    const workspaceId = this.runtime.groupWorkspaceIds.get(tab.groupId);
    if (!workspaceId) return;

    const pageId = `chrome-tab:${chromeTabId}`;
    if (previousPageId) {
      this.runtime.replacePageOrder(workspaceId, previousPageId, pageId);
      return;
    }

    this.runtime.appendPageOrder(workspaceId, pageId);
  }
}
