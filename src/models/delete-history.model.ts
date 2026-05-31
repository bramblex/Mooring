import { ensureRootFolder } from "./workspace.bookmarks";
import { bookmarkTitle, formatWorkspaceTitle, parseWorkspaceTitle } from "./workspace.helpers";
import type { TabGroupColor } from "./workspace.types";

const DELETE_HISTORY_STORAGE_KEY = "mooringDeleteHistory";
const DELETE_HISTORY_LIMIT = 30;

type DeletedBookmarkSnapshot = {
  title: string;
  url: string;
};

export type DeleteHistoryItem =
  | {
      id: string;
      kind: "workspace";
      title: string;
      color: TabGroupColor;
      collapsed: boolean;
      deletedAt: number;
      pages: DeletedBookmarkSnapshot[];
    }
  | {
      id: string;
      kind: "page";
      title: string;
      url: string;
      deletedAt: number;
      workspaceTitle?: string;
      workspaceId?: string;
    };

export class DeleteHistoryModel {
  async recordWorkspace(workspaceId: string) {
    const [folder] = await chrome.bookmarks.get(workspaceId);
    if (!folder || folder.url) return;

    const parsed = parseWorkspaceTitle(folder.title);
    const pages = (await chrome.bookmarks.getChildren(workspaceId))
      .filter((node): node is chrome.bookmarks.BookmarkTreeNode & { url: string } => Boolean(node.url))
      .map((node) => ({
        title: bookmarkTitle(node),
        url: node.url,
      }));

    await this.push({
      id: crypto.randomUUID(),
      kind: "workspace",
      title: parsed.name,
      color: parsed.color,
      collapsed: parsed.collapsed,
      deletedAt: Date.now(),
      pages,
    });
  }

  async recordPage(bookmarkId: string) {
    const [bookmark] = await chrome.bookmarks.get(bookmarkId);
    if (!bookmark?.url) return;

    const workspace = bookmark.parentId ? await this.getFolder(bookmark.parentId) : undefined;
    const workspaceTitle = workspace ? parseWorkspaceTitle(workspace.title).name : undefined;

    await this.push({
      id: crypto.randomUUID(),
      kind: "page",
      title: bookmarkTitle(bookmark),
      url: bookmark.url,
      deletedAt: Date.now(),
      workspaceTitle,
      workspaceId: bookmark.parentId,
    });
  }

  async getItems() {
    return this.load();
  }

  async restoreItem(historyItemId: string) {
    const items = await this.load();
    const item = items.find((candidate) => candidate.id === historyItemId);
    if (!item) return;

    if (item.kind === "workspace") {
      await this.restoreWorkspace(item);
    } else {
      await this.restorePage(item);
    }

    await this.save(items.filter((candidate) => candidate.id !== historyItemId));
  }

  private async restoreWorkspace(item: Extract<DeleteHistoryItem, { kind: "workspace" }>) {
    const root = await ensureRootFolder();
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: formatWorkspaceTitle(item.title, item.color, item.collapsed),
    });

    for (const page of item.pages) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: page.title,
        url: page.url,
      });
    }
  }

  private async restorePage(item: Extract<DeleteHistoryItem, { kind: "page" }>) {
    const parentId = item.workspaceId && await this.folderExists(item.workspaceId)
      ? item.workspaceId
      : await this.ensureRestoreWorkspace(item.workspaceTitle);

    await chrome.bookmarks.create({
      parentId,
      title: item.title,
      url: item.url,
    });
  }

  private async ensureRestoreWorkspace(name = "Restored") {
    const root = await ensureRootFolder();
    const children = await chrome.bookmarks.getChildren(root.id);
    const existing = children.find((node) => !node.url && parseWorkspaceTitle(node.title).name === name);
    if (existing) return existing.id;

    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: formatWorkspaceTitle(name, "grey", false),
    });
    return folder.id;
  }

  private async folderExists(folderId: string) {
    const folder = await this.getFolder(folderId);
    return Boolean(folder);
  }

  private async getFolder(folderId: string) {
    try {
      const [folder] = await chrome.bookmarks.get(folderId);
      return folder && !folder.url ? folder : undefined;
    } catch {
      return undefined;
    }
  }

  private async push(item: DeleteHistoryItem) {
    const items = await this.load();
    await this.save([item, ...items].slice(0, DELETE_HISTORY_LIMIT));
  }

  private async load(): Promise<DeleteHistoryItem[]> {
    const stored = await chrome.storage.local.get(DELETE_HISTORY_STORAGE_KEY);
    const value = stored[DELETE_HISTORY_STORAGE_KEY];
    return Array.isArray(value) ? value.filter(isDeleteHistoryItem) : [];
  }

  private async save(items: DeleteHistoryItem[]) {
    await chrome.storage.local.set({ [DELETE_HISTORY_STORAGE_KEY]: items });
  }
}

function isDeleteHistoryItem(value: unknown): value is DeleteHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DeleteHistoryItem>;
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.deletedAt !== "number") return false;
  if (item.kind === "workspace") return Array.isArray(item.pages);
  return item.kind === "page" && typeof item.url === "string";
}
