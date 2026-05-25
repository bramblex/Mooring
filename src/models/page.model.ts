export type PageKind = "temp" | "pinned";

export type PageModel = {
  id: string;
  kind: PageKind;
  title: string;
  currentTitle?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
  order: number;
  pinned: boolean;
  dirty: boolean;
  open: boolean;
  chromeTabId?: number;
  bookmarkId?: string;
};
