export type Locale = "en" | "zh";

const messages = {
  en: {
    appName: "Mooring",
    temporaryWindow: "Temporary window",
    temporaryWindowDescription:
      "Workspace lives in the main window. Send tabs there or open it.",
    openMainWindow: "Open main window",
    sendCurrentTabToMainWindow: "Send current tab to main window",
    sendAllTabsToMainWindow: "Send all tabs to main window",
    groupActive: "Group active",
    newWorkspace: "New workspace",
    newPage: "New page",
    refresh: "Refresh",
    openTabs: "Open tabs",
    ungrouped: "Ungrouped",
    untitledPage: "Untitled page",
    newGroup: "New group",
    dragGroup: "Drag group",
    dragPage: "Drag page",
    groupTitle: "Group title",
    groupColor: "Group color",
    bookmarkTitle: "Bookmark title",
    show: "Show",
    hide: "Hide",
    showWorkspace: "Show workspace",
    hideWorkspace: "Hide workspace",
    doubleClickToggleWorkspace: "Double-click to show or hide",
    deleteWorkspace: "Delete workspace",
    deleteWorkspaceConfirm: "Delete this workspace? Pinned pages will be removed from bookmarks.",
    confirm: "Confirm",
    cancel: "Cancel",
    closeWorkspacePages: "Close all open pages",
    unmanaged: "Unmanaged",
    tempPages: "Temp",
    pinPage: "Pin page",
    unpinPage: "Unpin page",
    unpinPageConfirm: "Unpin this page? It will no longer be restored with this workspace.",
    pinnedPageDirty: "Current page differs from the pinned bookmark",
    restorePinnedPage: "Restore pinned URL",
    emptyWorkspaceDrop: "Empty",
    emptyUnmanagedDrop: "Empty",
    closePage: "Close page",
    ungroup: "Ungroup",
  },
  zh: {
    appName: "Mooring",
    temporaryWindow: "临时窗口",
    temporaryWindowDescription: "Workspace 位于主窗口。你可以把标签页发送过去，或打开主窗口。",
    openMainWindow: "打开主窗口",
    sendCurrentTabToMainWindow: "发送当前标签页到主窗口",
    sendAllTabsToMainWindow: "发送全部标签页到主窗口",
    groupActive: "分组当前标签页",
    newWorkspace: "新建 Workspace",
    newPage: "新建 Page",
    refresh: "刷新",
    openTabs: "打开的标签页",
    ungrouped: "未分组",
    untitledPage: "未命名 Page",
    newGroup: "新建分组",
    dragGroup: "拖动分组",
    dragPage: "拖动 Page",
    groupTitle: "分组标题",
    groupColor: "分组颜色",
    bookmarkTitle: "书签标题",
    show: "显示",
    hide: "隐藏",
    showWorkspace: "显示 Workspace",
    hideWorkspace: "隐藏 Workspace",
    doubleClickToggleWorkspace: "双击显示或隐藏",
    deleteWorkspace: "删除 Workspace",
    deleteWorkspaceConfirm: "确定删除这个 Workspace 吗？固定 Page 会从书签中删除。",
    confirm: "确认",
    cancel: "取消",
    closeWorkspacePages: "关闭全部已打开 Page",
    unmanaged: "未管理",
    tempPages: "临时",
    pinPage: "固定 Page",
    unpinPage: "取消固定 Page",
    unpinPageConfirm: "确定取消固定这个 Page 吗？它将不再跟随 Workspace 恢复。",
    pinnedPageDirty: "当前页面已偏离固定书签",
    restorePinnedPage: "恢复到固定地址",
    emptyWorkspaceDrop: "空",
    emptyUnmanagedDrop: "空",
    closePage: "关闭 Page",
    ungroup: "取消分组",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function getLocale(language = navigator.language): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function useI18n(locale = getLocale()) {
  return {
    locale,
    t(key: MessageKey) {
      return messages[locale][key] || messages.en[key];
    },
  };
}
