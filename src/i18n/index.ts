export type Locale = "en" | "zh";

const messages = {
  en: {
    appName: "Harbor",
    temporaryWindow: "Temporary window",
    temporaryWindowDescription:
      "Workspace lives in the main window. Send tabs there or open it.",
    openMainWindow: "Open main window",
    sendCurrentTabToMainWindow: "Send current tab to main window",
    sendAllTabsToMainWindow: "Send all tabs to main window",
    groupActive: "Group active",
    refresh: "Refresh",
    openTabs: "Open tabs",
    ungrouped: "Ungrouped",
    untitledTab: "Untitled tab",
    untitledGroup: "Untitled group",
    newGroup: "New group",
    dragGroup: "Drag group",
    groupTitle: "Group title",
    groupColor: "Group color",
    show: "Show",
    hide: "Hide",
    ungroup: "Ungroup",
  },
  zh: {
    appName: "Harbor",
    temporaryWindow: "临时窗口",
    temporaryWindowDescription: "Workspace 位于主窗口。你可以把标签页发送过去，或打开主窗口。",
    openMainWindow: "打开主窗口",
    sendCurrentTabToMainWindow: "发送当前标签页到主窗口",
    sendAllTabsToMainWindow: "发送全部标签页到主窗口",
    groupActive: "分组当前标签页",
    refresh: "刷新",
    openTabs: "打开的标签页",
    ungrouped: "未分组",
    untitledTab: "未命名标签页",
    untitledGroup: "未命名分组",
    newGroup: "新建分组",
    dragGroup: "拖动分组",
    groupTitle: "分组标题",
    groupColor: "分组颜色",
    show: "显示",
    hide: "隐藏",
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
