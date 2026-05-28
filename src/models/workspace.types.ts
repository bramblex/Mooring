import type { PageModel } from "./page.model";

export type TabGroupColor = chrome.tabGroups.TabGroup["color"];

export type WorkspaceView = {
  id: string;
  name: string;
  color: TabGroupColor;
  order: number;
  collapsed: boolean;
  groupId?: number;
  pages: PageModel[];
};

export type WorkspaceState = {
  workspaces: WorkspaceView[];
  unmanagedPages: PageModel[];
  unmanagedGroups: UnmanagedGroupView[];
};

export type UnmanagedGroupView = {
  id: number;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
  order: number;
  pages: PageModel[];
};

export type ParsedWorkspaceTitle = {
  name: string;
  color: TabGroupColor;
  collapsed: boolean;
};

export type WorkspaceFolder = ParsedWorkspaceTitle & {
  id: string;
  index: number;
};

export type RuntimeBindingsStorage = {
  workspaceGroupIds?: Array<[string, number]>;
  chromeTabBookmarkIds?: Array<[number, string]>;
  workspacePageOrders?: Array<[string, string[]]>;
  workspaceTempPageOrders?: Array<[string, number[]]>;
};
