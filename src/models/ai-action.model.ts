import type { PageModel } from "./page.model";
import type { TabGroupColor, WorkspaceState, WorkspaceView } from "./workspace.types";

type PageMatch = {
  page: PageModel;
  workspace: WorkspaceView | null;
};

export type AiActionPlan = {
  summary?: string;
  actions: AiAction[];
};

export type AiAction =
  | RenameWorkspaceAction
  | CreateWorkspaceAction
  | MovePageAction
  | PinPageAction
  | UnpinPageAction
  | ClosePageAction
  | DeleteWorkspaceAction
  | CloseWorkspacePagesAction
  | RenamePageAction;

export type RenameWorkspaceAction = {
  type: "rename_workspace";
  workspaceId: string;
  name: string;
};

export type CreateWorkspaceAction = {
  type: "create_workspace";
  name: string;
  color?: TabGroupColor;
  workspaceRef?: string;
};

export type MovePageAction = {
  type: "move_page";
  pageId: string;
  toWorkspaceId: string;
  index?: number;
};

export type PinPageAction = {
  type: "pin_page";
  pageId: string;
  workspaceId: string;
};

export type UnpinPageAction = {
  type: "unpin_page";
  pageId: string;
};

export type ClosePageAction = {
  type: "close_page";
  pageId: string;
};

export type DeleteWorkspaceAction = {
  type: "delete_workspace";
  workspaceId: string;
};

export type CloseWorkspacePagesAction = {
  type: "close_workspace_pages";
  workspaceId: string;
};

export type RenamePageAction = {
  type: "rename_page";
  pageId: string;
  title: string;
};

export type AiActionPreview = {
  type: AiAction["type"] | "no_actions";
  risk: "normal" | "warning" | "danger";
  values?: Record<string, string>;
};

export type AiValidationResult =
  | { ok: true; actions: AiAction[]; preview: AiActionPreview[] }
  | { ok: false; error: string };

export const AI_ACTION_SCHEMA = {
  allowedActions: [
    "rename_workspace",
    "create_workspace",
    "move_page",
    "pin_page",
    "unpin_page",
    "close_page",
    "delete_workspace",
    "close_workspace_pages",
    "rename_page",
  ],
  rules: [
    "Return JSON only.",
    "Return an object with an actions array.",
    "Only use the provided ids.",
    "If a new workspace is needed, create it with workspaceRef and use that same workspaceRef as move_page.toWorkspaceId.",
    "Use pin_page only for open temp pages that have a chrome-tab page id.",
    "Only rename pinned pages.",
    "Use destructive actions only when the user explicitly asks for them.",
  ],
};

export function buildAiPromptInput(state: WorkspaceState, prompt: string) {
  return {
    prompt,
    state: {
      workspaces: state.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        collapsed: workspace.collapsed,
        pages: workspace.pages.filter(isAiVisiblePage).map(compactPage),
      })),
      unmanagedPages: state.unmanagedPages.filter(isAiVisiblePage).map(compactPage),
      unmanagedGroups: state.unmanagedGroups.map((group) => ({
        id: group.id,
        title: group.title,
        color: group.color,
        pages: group.pages.filter(isAiVisiblePage).map(compactPage),
      })),
    },
    schema: AI_ACTION_SCHEMA,
  };
}

export function validateAiActionPlan(
  plan: unknown,
  state: WorkspaceState,
  maxActions = 50,
): AiValidationResult {
  if (!isRecord(plan)) {
    return { ok: false, error: "AI response must be a JSON object." };
  }

  const rawActions = Array.isArray(plan.actions) ? plan.actions : undefined;
  if (!rawActions) {
    return { ok: false, error: "AI response must include an actions array." };
  }
  if (rawActions.length > maxActions) {
    return { ok: false, error: `AI returned too many actions. Limit is ${maxActions}.` };
  }

  const workspaces = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
  const plannedWorkspaceRefs = new Map<string, string>();
  const pages = new Map<string, PageMatch>();
  state.unmanagedPages.forEach((page) => pages.set(page.id, { page, workspace: null }));
  state.unmanagedGroups.forEach((group) => {
    group.pages.forEach((page) => pages.set(page.id, { page, workspace: null }));
  });
  state.workspaces.forEach((workspace) => {
    workspace.pages.forEach((page) => pages.set(page.id, { page, workspace }));
  });

  const actions: AiAction[] = [];
  const preview: AiActionPreview[] = [];
  const plannedPageWorkspaceIds = new Map<string, string>();

  for (const rawAction of rawActions) {
    if (!isRecord(rawAction) || typeof rawAction.type !== "string") {
      return { ok: false, error: "Every AI action must be an object with a type." };
    }

    switch (rawAction.type) {
      case "rename_workspace": {
        const rawName = typeof rawAction.name === "string" ? rawAction.name : rawAction.newName;
        if (typeof rawAction.workspaceId !== "string" || typeof rawName !== "string") {
          return { ok: false, error: "rename_workspace requires workspaceId and name." };
        }
        const workspace = workspaces.get(rawAction.workspaceId);
        const name = rawName.trim();
        if (!workspace) return { ok: false, error: "AI referenced a missing workspace." };
        if (!name) return { ok: false, error: "Workspace name cannot be empty." };

        actions.push({ type: "rename_workspace", workspaceId: workspace.id, name });
        preview.push(normalPreview("rename_workspace", { from: workspace.name, to: name }));
        break;
      }
      case "create_workspace": {
        if (typeof rawAction.name !== "string") {
          return { ok: false, error: "create_workspace requires name." };
        }
        const name = rawAction.name.trim();
        if (!name) return { ok: false, error: "Workspace name cannot be empty." };
        const color = typeof rawAction.color === "string" ? rawAction.color as TabGroupColor : undefined;
        const workspaceRef = typeof rawAction.workspaceRef === "string"
          ? rawAction.workspaceRef.trim()
          : typeof rawAction.clientRef === "string"
            ? rawAction.clientRef.trim()
            : undefined;

        if (workspaceRef) {
          if (workspaces.has(workspaceRef)) {
            return { ok: false, error: "Workspace ref cannot reuse an existing workspace id." };
          }
          plannedWorkspaceRefs.set(workspaceRef, name);
        }

        actions.push({ type: "create_workspace", name, color, workspaceRef });
        preview.push(normalPreview("create_workspace", { name }));
        break;
      }
      case "move_page": {
        if (typeof rawAction.pageId !== "string" || typeof rawAction.toWorkspaceId !== "string") {
          return { ok: false, error: "move_page requires pageId and toWorkspaceId." };
        }
        const pageMatch = pages.get(rawAction.pageId);
        const workspace = workspaces.get(rawAction.toWorkspaceId);
        const plannedWorkspaceName = plannedWorkspaceRefs.get(rawAction.toWorkspaceId);
        if (!pageMatch) return { ok: false, error: "AI referenced a missing page." };
        if (!workspace && !plannedWorkspaceName) {
          return { ok: false, error: "AI referenced a missing target workspace." };
        }
        const index = typeof rawAction.index === "number" && Number.isFinite(rawAction.index)
          ? Math.max(0, Math.floor(rawAction.index))
          : workspace?.pages.length ?? 0;

        actions.push({
          type: "move_page",
          pageId: pageMatch.page.id,
          toWorkspaceId: workspace?.id ?? rawAction.toWorkspaceId,
          index,
        });
        plannedPageWorkspaceIds.set(pageMatch.page.id, workspace?.id ?? rawAction.toWorkspaceId);
        preview.push(normalPreview("move_page", {
          page: pagePreviewTitle(pageMatch),
          workspace: workspace?.name ?? plannedWorkspaceName ?? "",
        }));
        break;
      }
      case "pin_page": {
        if (typeof rawAction.pageId !== "string" || typeof rawAction.workspaceId !== "string") {
          return { ok: false, error: "pin_page requires pageId and workspaceId." };
        }
        const pageMatch = pages.get(rawAction.pageId);
        const workspace = workspaces.get(rawAction.workspaceId);
        const plannedWorkspaceName = plannedWorkspaceRefs.get(rawAction.workspaceId);
        if (!pageMatch) return { ok: false, error: "AI referenced a missing page." };
        if (!workspace && !plannedWorkspaceName) {
          return { ok: false, error: "AI referenced a missing target workspace." };
        }
        if (pageMatch.page.pinned || !pageMatch.page.chromeTabId) {
          return { ok: false, error: "AI can only pin open temp pages." };
        }

        const targetWorkspaceId = workspace?.id ?? rawAction.workspaceId;
        const currentWorkspaceId = plannedPageWorkspaceIds.get(pageMatch.page.id) ?? pageMatch.workspace?.id;
        if (currentWorkspaceId !== targetWorkspaceId) {
          actions.push({
            type: "move_page",
            pageId: pageMatch.page.id,
            toWorkspaceId: targetWorkspaceId,
            index: workspace?.pages.length ?? 0,
          });
          plannedPageWorkspaceIds.set(pageMatch.page.id, targetWorkspaceId);
          preview.push(normalPreview("move_page", {
            page: pagePreviewTitle(pageMatch),
            workspace: workspace?.name ?? plannedWorkspaceName ?? "",
          }));
        }

        actions.push({
          type: "pin_page",
          pageId: pageMatch.page.id,
          workspaceId: targetWorkspaceId,
        });
        preview.push(normalPreview("pin_page", {
          page: pagePreviewTitle(pageMatch),
          workspace: workspace?.name ?? plannedWorkspaceName ?? "",
        }));
        break;
      }
      case "unpin_page": {
        if (typeof rawAction.pageId !== "string") {
          return { ok: false, error: "unpin_page requires pageId." };
        }
        const pageMatch = pages.get(rawAction.pageId);
        if (!pageMatch) return { ok: false, error: "AI referenced a missing page." };
        if (!pageMatch.page.pinned || !pageMatch.page.bookmarkId) {
          return { ok: false, error: "AI can only unpin pinned pages." };
        }

        actions.push({ type: "unpin_page", pageId: pageMatch.page.id });
        preview.push(dangerPreview("unpin_page", { page: pagePreviewTitle(pageMatch) }));
        break;
      }
      case "close_page": {
        if (typeof rawAction.pageId !== "string") {
          return { ok: false, error: "close_page requires pageId." };
        }
        const pageMatch = pages.get(rawAction.pageId);
        if (!pageMatch) return { ok: false, error: "AI referenced a missing page." };
        if (!pageMatch.page.chromeTabId) {
          return { ok: false, error: "AI can only close open pages." };
        }

        actions.push({ type: "close_page", pageId: pageMatch.page.id });
        preview.push(
          pageMatch.page.pinned
            ? normalPreview("close_page", { page: pagePreviewTitle(pageMatch) })
            : warningPreview("close_page", { page: pagePreviewTitle(pageMatch) }),
        );
        break;
      }
      case "delete_workspace": {
        if (typeof rawAction.workspaceId !== "string") {
          return { ok: false, error: "delete_workspace requires workspaceId." };
        }
        const workspace = workspaces.get(rawAction.workspaceId);
        if (!workspace) return { ok: false, error: "AI referenced a missing workspace." };

        actions.push({ type: "delete_workspace", workspaceId: workspace.id });
        preview.push(dangerPreview("delete_workspace", { workspace: workspace.name }));
        break;
      }
      case "close_workspace_pages": {
        if (typeof rawAction.workspaceId !== "string") {
          return { ok: false, error: "close_workspace_pages requires workspaceId." };
        }
        const workspace = workspaces.get(rawAction.workspaceId);
        if (!workspace) return { ok: false, error: "AI referenced a missing workspace." };

        actions.push({ type: "close_workspace_pages", workspaceId: workspace.id });
        preview.push(warningPreview("close_workspace_pages", { workspace: workspace.name }));
        break;
      }
      case "rename_page": {
        const rawTitle = typeof rawAction.title === "string" ? rawAction.title : rawAction.newTitle;
        if (typeof rawAction.pageId !== "string" || typeof rawTitle !== "string") {
          return { ok: false, error: "rename_page requires pageId and title." };
        }
        const pageMatch = pages.get(rawAction.pageId);
        const title = rawTitle.trim();
        if (!pageMatch) return { ok: false, error: "AI referenced a missing page." };
        if (!pageMatch.page.bookmarkId || !pageMatch.page.pinned) {
          return { ok: false, error: "AI can only rename pinned pages." };
        }
        if (!title) return { ok: false, error: "Page title cannot be empty." };

        actions.push({ type: "rename_page", pageId: pageMatch.page.id, title });
        preview.push(normalPreview("rename_page", { from: pagePreviewTitle(pageMatch), to: title }));
        break;
      }
      default:
        return { ok: false, error: `Unsupported AI action: ${rawAction.type}` };
    }
  }

  return { ok: true, actions, preview };
}

export function enrichAiActionsForPrompt(
  actions: AiAction[],
  state: WorkspaceState,
  prompt: string,
) {
  if (!/\b(pin|save|bookmark|persistent)\b|固定|保存|书签/i.test(prompt)) {
    return { actions, preview: [] };
  }

  const pages = new Map<string, PageModel>();
  state.unmanagedPages.forEach((page) => pages.set(page.id, page));
  state.unmanagedGroups.forEach((group) => group.pages.forEach((page) => pages.set(page.id, page)));
  state.workspaces.forEach((workspace) => workspace.pages.forEach((page) => pages.set(page.id, page)));

  const existingPinKeys = new Set(
    actions
      .filter((action): action is PinPageAction => action.type === "pin_page")
      .map((action) => `${action.pageId}:${action.workspaceId}`),
  );
  const nextActions: AiAction[] = [];
  const preview: AiActionPreview[] = [];

  actions.forEach((action) => {
    nextActions.push(action);

    if (action.type !== "move_page") return;
    const page = pages.get(action.pageId);
    if (!page || page.pinned || !page.chromeTabId) return;

    const pinKey = `${page.id}:${action.toWorkspaceId}`;
    if (existingPinKeys.has(pinKey)) return;

    existingPinKeys.add(pinKey);
    nextActions.push({
      type: "pin_page",
      pageId: page.id,
      workspaceId: action.toWorkspaceId,
    });
    preview.push(normalPreview("pin_page", { page: page.title, workspace: "" }));
  });

  return { actions: nextActions, preview };
}

function normalPreview(type: AiActionPreview["type"], values?: Record<string, string>): AiActionPreview {
  return { type, values, risk: "normal" };
}

function warningPreview(type: AiActionPreview["type"], values?: Record<string, string>): AiActionPreview {
  return { type, values, risk: "warning" };
}

function dangerPreview(type: AiActionPreview["type"], values?: Record<string, string>): AiActionPreview {
  return { type, values, risk: "danger" };
}

function pagePreviewTitle(match: PageMatch) {
  return match.workspace ? `${match.workspace.name} / ${match.page.title}` : match.page.title;
}

function compactPage(page: PageModel) {
  return {
    id: page.id,
    kind: page.kind,
    title: page.title,
    url: page.url,
    pinned: page.pinned,
    dirty: page.dirty,
    open: page.open,
  };
}

function isAiVisiblePage(page: PageModel) {
  const url = page.url || "";

  return !url.startsWith("chrome://")
    && !url.startsWith("chrome-extension://")
    && !url.startsWith("edge://")
    && !url.startsWith("about:");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
