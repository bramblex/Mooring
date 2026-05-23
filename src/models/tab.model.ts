export type WorkspaceTabKind = "live" | "pinned";

export type TabModel = {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  currentTitle?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
  index: number;
  pinned: boolean;
  dirty: boolean;
  open: boolean;
  tabId?: number;
  bookmarkId?: string;
};
