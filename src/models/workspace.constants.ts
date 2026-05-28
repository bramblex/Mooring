import type { TabGroupColor } from "./workspace.types";

export const ROOT_FOLDER_TITLE = "Mooring Workspace";
export const LEGACY_ROOT_FOLDER_TITLE = "Harbor Workspace";
export const DEFAULT_WORKSPACE_NAME = "Untitled workspace";
export const DEFAULT_WORKSPACE_COLOR: TabGroupColor = "grey";
export const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
export const WORKSPACE_TITLE_RE = /^\[(grey|blue|red|yellow|green|pink|purple|cyan|orange)(?::(shown|hidden))?\]\s*(.*)$/;

export const BOOKMARK_BAR_ID = "1";
export const RUNTIME_BINDINGS_STORAGE_KEY = "mooringRuntimeBindings";
export const WORKSPACE_NAME_RE = /^Workspace (\d+)$/;
