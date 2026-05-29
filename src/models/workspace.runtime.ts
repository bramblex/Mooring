import { RUNTIME_BINDINGS_STORAGE_KEY } from "./workspace.constants";
import type { RuntimeBindingsStorage } from "./workspace.types";

// docs/product-logic.md: Runtime binding 不是长期状态。
// WorkspaceRuntimeStore 统一管理 chrome.storage.session 缓存和 Page runtime order，
// 避免这些 Map 操作散落在各个领域模型里。
export class WorkspaceRuntimeStore {
  workspaceGroupIds = new Map<string, number>();
  groupWorkspaceIds = new Map<number, string>();
  chromeTabBookmarkIds = new Map<number, string>();
  workspacePageOrders = new Map<string, string[]>();

  private loaded = false;
  private rebuildNeeded = false;

  markRebuildNeeded() {
    this.rebuildNeeded = true;
  }

  consumeRebuildNeeded() {
    const value = this.rebuildNeeded;
    this.rebuildNeeded = false;
    return value;
  }

  async ensureLoaded() {
    if (this.loaded) return;

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
    this.loaded = true;
  }

  async persist() {
    if (!this.loaded) return;

    const bindings: RuntimeBindingsStorage = {
      workspaceGroupIds: [...this.workspaceGroupIds.entries()],
      chromeTabBookmarkIds: [...this.chromeTabBookmarkIds.entries()],
      workspacePageOrders: [...this.workspacePageOrders.entries()],
    };

    await chrome.storage.session.set({
      [RUNTIME_BINDINGS_STORAGE_KEY]: bindings,
    });
  }

  clear() {
    this.loaded = true;
    this.clearWithoutCleanup();
    this.markRebuildNeeded();
  }

  clearWithoutCleanup() {
    this.workspaceGroupIds.clear();
    this.groupWorkspaceIds.clear();
    this.chromeTabBookmarkIds.clear();
    this.workspacePageOrders.clear();
    void this.persist();
  }

  bindWorkspace(workspaceId: string, groupId: number) {
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
    void this.persist();
  }

  pruneGroups(groups: chrome.tabGroups.TabGroup[]) {
    const validGroupIds = new Set(groups.map((group) => group.id));
    let changed = false;

    for (const [workspaceId, groupId] of this.workspaceGroupIds.entries()) {
      if (validGroupIds.has(groupId)) continue;

      this.workspaceGroupIds.delete(workspaceId);
      this.groupWorkspaceIds.delete(groupId);
      changed = true;
    }

    if (changed) {
      void this.persist();
    }
  }

  reconcilePageOrder(workspaceId: string, pageIds: string[]) {
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
      void this.persist();
    }
    return nextOrder;
  }

  movePageOrder(workspaceId: string, pageId: string, displayIndex: number) {
    const currentOrder = this.workspacePageOrders.get(workspaceId) || [];
    const previousIndex = currentOrder.indexOf(pageId);
    const adjustedDisplayIndex = previousIndex >= 0 && previousIndex < displayIndex
      ? displayIndex - 1
      : displayIndex;

    this.removePageOrder(pageId, false);

    const order = (this.workspacePageOrders.get(workspaceId) || []).filter((id) => id !== pageId);
    order.splice(
      adjustedDisplayIndex < 0 ? order.length : Math.min(adjustedDisplayIndex, order.length),
      0,
      pageId,
    );
    this.workspacePageOrders.set(workspaceId, order);
    void this.persist();
  }

  replacePageOrder(workspaceId: string, previousPageId: string, nextPageId: string) {
    const order = this.workspacePageOrders.get(workspaceId) || [];
    const previousIndex = order.indexOf(previousPageId);
    const nextOrder = order.filter((id) => id !== previousPageId && id !== nextPageId);
    nextOrder.splice(previousIndex >= 0 ? previousIndex : nextOrder.length, 0, nextPageId);
    this.workspacePageOrders.set(workspaceId, nextOrder);
    void this.persist();
  }

  appendPageOrder(workspaceId: string, pageId: string) {
    const order = this.workspacePageOrders.get(workspaceId) || [];
    if (order.includes(pageId)) return;

    this.workspacePageOrders.set(workspaceId, [...order, pageId]);
    void this.persist();
  }

  removePageOrder(pageId: string, persist = true) {
    let changed = false;

    for (const [workspaceId, order] of this.workspacePageOrders.entries()) {
      const nextOrder = order.filter((id) => id !== pageId);
      if (nextOrder.length !== order.length) {
        changed = true;
      }
      this.workspacePageOrders.set(workspaceId, nextOrder);
    }

    if (changed && persist) {
      void this.persist();
    }
  }
}
