import {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_NAME_RE,
  WORKSPACE_TITLE_RE,
} from "./workspace.constants";
import type { ParsedWorkspaceTitle, TabGroupColor, WorkspaceFolder } from "./workspace.types";

export function parseWorkspaceTitle(title: string): ParsedWorkspaceTitle {
  const match = title.match(WORKSPACE_TITLE_RE);

  if (!match) {
    return {
      name: title || DEFAULT_WORKSPACE_NAME,
      color: DEFAULT_WORKSPACE_COLOR,
      collapsed: false,
    };
  }

  return {
    color: match[1] as TabGroupColor,
    collapsed: match[2] === "hidden",
    name: match[3] || DEFAULT_WORKSPACE_NAME,
  };
}

export function formatWorkspaceTitle(name: string, color: TabGroupColor, collapsed = false) {
  const state = collapsed ? ":hidden" : "";
  return `[${color}${state}] ${name.trim() || DEFAULT_WORKSPACE_NAME}`;
}

export function chromeTabTitle(tab: chrome.tabs.Tab) {
  return tab.title || tab.url || "Untitled page";
}

export function bookmarkTitle(bookmark: chrome.bookmarks.BookmarkTreeNode) {
  return bookmark.title || bookmark.url || "Untitled page";
}

export function chromeTabUrl(tab: chrome.tabs.Tab) {
  return tab.url || tab.pendingUrl || "";
}

export function bookmarkKey(bookmark: chrome.bookmarks.BookmarkTreeNode) {
  return bookmark.url || "";
}

export function canBookmarkTab(tab: chrome.tabs.Tab) {
  const url = chromeTabUrl(tab);
  return Boolean(url && !url.startsWith("chrome://") && !url.startsWith("chrome-extension://"));
}

export function nextWorkspaceName(folders: WorkspaceFolder[]) {
  const usedNumbers = new Set(
    folders
      .map((folder) => folder.name.match(WORKSPACE_NAME_RE)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value)),
  );

  let index = 1;
  while (usedNumbers.has(index)) index += 1;

  return `Workspace ${index}`;
}
