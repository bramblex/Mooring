import { BOOKMARK_BAR_ID, LEGACY_ROOT_FOLDER_TITLE, ROOT_FOLDER_TITLE } from "./workspace.constants";
import { parseWorkspaceTitle } from "./workspace.helpers";
import type { WorkspaceFolder } from "./workspace.types";

export async function ensureRootFolder() {
  const [root] = await chrome.bookmarks.search({ title: ROOT_FOLDER_TITLE });
  if (root && !root.url) return root;

  // Product rename: keep reading the old root so existing local users do not
  // lose their bookmark-backed workspaces after upgrading from Harbor.
  const [legacyRoot] = await chrome.bookmarks.search({ title: LEGACY_ROOT_FOLDER_TITLE });
  if (legacyRoot && !legacyRoot.url) return legacyRoot;

  try {
    return await chrome.bookmarks.create({
      parentId: BOOKMARK_BAR_ID,
      title: ROOT_FOLDER_TITLE,
    });
  } catch {
    return chrome.bookmarks.create({
      title: ROOT_FOLDER_TITLE,
    });
  }
}

export async function getWorkspaceFolder(workspaceId: string) {
  const [folder] = await chrome.bookmarks.get(workspaceId);
  if (!folder) {
    throw new Error(`Workspace folder not found: ${workspaceId}`);
  }
  return folder;
}

export async function listWorkspaceFolders(rootId: string): Promise<WorkspaceFolder[]> {
  const children = await chrome.bookmarks.getChildren(rootId);

  return children
    .filter((node) => !node.url)
    .map((node, index) => ({
      ...parseWorkspaceTitle(node.title),
      id: node.id,
      index,
    }));
}
