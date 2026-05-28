import type { PageModel } from "./page.model";
import { bookmarkTitle, chromeTabTitle, chromeTabUrl } from "./workspace.helpers";

export function pinnedPageModel(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
  tab: chrome.tabs.Tab | undefined,
  index: number,
): PageModel {
  const openUrl = tab ? chromeTabUrl(tab) : "";
  const dirty = Boolean(tab && bookmark.url && openUrl && bookmark.url !== openUrl);

  return {
    id: `bookmark:${bookmark.id}`,
    kind: "pinned",
    title: bookmarkTitle(bookmark),
    currentTitle: dirty && tab ? chromeTabTitle(tab) : undefined,
    url: bookmark.url,
    favIconUrl: tab?.favIconUrl,
    active: Boolean(tab?.active),
    order: index,
    pinned: true,
    dirty,
    open: Boolean(tab),
    chromeTabId: tab?.id,
    bookmarkId: bookmark.id,
  };
}

export function tempPageModel(tab: chrome.tabs.Tab, pinned: boolean): PageModel {
  return {
    id: `chrome-tab:${tab.id}`,
    kind: "temp",
    title: chromeTabTitle(tab),
    url: chromeTabUrl(tab),
    favIconUrl: tab.favIconUrl,
    active: Boolean(tab.active),
    order: tab.index,
    pinned,
    dirty: false,
    open: true,
    chromeTabId: tab.id,
  };
}

export function parsePageId(id: string) {
  if (id.startsWith("chrome-tab:")) {
    return {
      chromeTabId: Number(id.replace("chrome-tab:", "")),
    };
  }

  if (id.startsWith("bookmark:")) {
    return {
      bookmarkId: id.replace("bookmark:", ""),
    };
  }

  return {};
}
