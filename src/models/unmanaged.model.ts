import { NO_GROUP } from "./workspace.constants";
import { parsePageId, tempPageModel } from "./workspace.page-factory";
import { WorkspaceRuntimeStore } from "./workspace.runtime";
import type { TabGroupColor } from "./workspace.types";

// docs/product-logic.md: UnmanagedModel 只管理不属于 Workspace 的
// Chrome Tab / Chrome Group。这里不写 Bookmark，也不创建 Workspace。
export class UnmanagedModel {
  constructor(private runtime: WorkspaceRuntimeStore) {}

  async getState(windowId: number) {
    await this.runtime.ensureLoaded();

    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    const managedGroupIds = new Set(this.runtime.workspaceGroupIds.values());

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
      unmanagedPages,
      unmanagedGroups,
    };
  }

  async createPage(windowId: number) {
    await this.runtime.ensureLoaded();

    // docs/product-logic.md: Temp Page 是当前打开 Chrome Tab 的临时表达；
    // 新建 Page 默认不写 bookmark，也不主动加入 Workspace Chrome Group。
    await chrome.tabs.create({
      windowId,
      active: true,
    });
  }

  async renameGroup(groupId: number, title: string) {
    await this.runtime.ensureLoaded();

    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.update(groupId, {
      title: title.trim(),
    });
  }

  async ungroupGroup(groupId: number) {
    await this.runtime.ensureLoaded();

    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

    const tabIds = (await chrome.tabs.query({ groupId }))
      .flatMap((tab) => (tab.id ? [tab.id] : []));
    if (tabIds.length === 0) return;

    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
  }

  async updateGroupColor(groupId: number, color: TabGroupColor) {
    await this.runtime.ensureLoaded();

    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.update(groupId, { color });
  }

  async moveItem(
    itemType: "page" | "group",
    itemId: string | number,
    index: number,
    windowId: number,
  ) {
    await this.runtime.ensureLoaded();

    const items = await this.orderItems(windowId, itemType, itemId);
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
    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

    await chrome.tabGroups.move(groupId, { windowId, index: chromeIndex });
  }

  async movePageToGroup(pageId: string, groupId: number, index: number) {
    await this.runtime.ensureLoaded();

    if (this.runtime.groupWorkspaceIds.has(groupId)) return;

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

  private async orderItems(
    windowId: number,
    movingType: "page" | "group",
    movingId: string | number,
  ) {
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    const managedGroupIds = new Set(this.runtime.workspaceGroupIds.values());
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
}
