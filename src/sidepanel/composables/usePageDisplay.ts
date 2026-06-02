import type { PageModel } from "../../models/page.model";

export function usePageDisplay(t: (key: "untitledPage") => string) {
  function pageTitle(page: PageModel) {
    return page.title || page.url || t("untitledPage");
  }

  function pageSubtitle(page: PageModel) {
    return page.dirty ? page.currentTitle || page.url || "" : "";
  }

  function pageFavicon(page: PageModel) {
    if (page.favIconUrl) return page.favIconUrl;
    if (!page.url) return "";

    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(page.url)}&size=32`);
  }

  return {
    pageTitle,
    pageSubtitle,
    pageFavicon,
  };
}
