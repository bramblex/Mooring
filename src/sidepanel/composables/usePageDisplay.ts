import type { PageModel } from "../../models/page.model";

export function usePageDisplay(t: (key: "untitledPage") => string) {
  function pageTitle(page: PageModel) {
    return page.title || page.url || t("untitledPage");
  }

  function pageSubtitle(page: PageModel) {
    return page.dirty ? page.currentTitle || page.url || "" : "";
  }

  function pageFavicon(page: PageModel) {
    return page.favIconUrl || "";
  }

  return {
    pageTitle,
    pageSubtitle,
    pageFavicon,
  };
}
