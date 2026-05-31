import type { PageModel } from "./page.model";
import type { WorkspaceState } from "./workspace.types";

type PageMatch = {
  page: PageModel;
};

export type AiClassificationPlan = {
  suggestions: AiClassificationSuggestion[];
};

export type AiClassificationSuggestion = {
  pageId: string;
  workspaceId: string;
  reason?: string;
};

export type AiClassificationPreview = {
  pageId: string;
  pageTitle: string;
  workspaceId: string;
  workspaceName: string;
  reason: string;
};

export type AiClassificationValidationResult =
  | { ok: true; suggestions: AiClassificationPreview[] }
  | { ok: false; error: string };

export function buildAiClassificationInput(state: WorkspaceState) {
  return {
    unmanagedPages: visibleUnmanagedPages(state).map(compactPage),
    workspaces: state.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      color: workspace.color,
      pages: workspace.pages.filter(isAiVisiblePage).map(compactPage),
    })),
    schema: {
      returnShape: {
        suggestions: [
          {
            pageId: "unmanaged page id",
            workspaceId: "existing workspace id",
            reason: "short reason",
          },
        ],
      },
      rules: [
        "Only classify unmanagedPages.",
        "Only use existing workspace ids.",
        "Never create, rename, pin, unpin, close, or delete anything.",
        "Omit pages when there is no clear matching workspace.",
      ],
    },
  };
}

export function validateAiClassificationPlan(
  plan: unknown,
  state: WorkspaceState,
  maxSuggestions = 80,
): AiClassificationValidationResult {
  if (!isRecord(plan)) {
    return { ok: false, error: "AI response must be a JSON object." };
  }

  const rawSuggestions = Array.isArray(plan.suggestions) ? plan.suggestions : undefined;
  if (!rawSuggestions) {
    return { ok: false, error: "AI response must include a suggestions array." };
  }
  if (rawSuggestions.length > maxSuggestions) {
    return { ok: false, error: `AI returned too many suggestions. Limit is ${maxSuggestions}.` };
  }

  const unmanagedPages = new Map<string, PageMatch>(
    visibleUnmanagedPages(state).map((page) => [page.id, { page }]),
  );
  const workspaces = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
  const usedPages = new Set<string>();
  const suggestions: AiClassificationPreview[] = [];

  for (const rawSuggestion of rawSuggestions) {
    if (!isRecord(rawSuggestion)) continue;
    if (typeof rawSuggestion.pageId !== "string" || typeof rawSuggestion.workspaceId !== "string") continue;
    if (usedPages.has(rawSuggestion.pageId)) continue;

    const pageMatch = unmanagedPages.get(rawSuggestion.pageId);
    const workspace = workspaces.get(rawSuggestion.workspaceId);
    if (!pageMatch || !workspace) continue;

    usedPages.add(rawSuggestion.pageId);
    suggestions.push({
      pageId: pageMatch.page.id,
      pageTitle: pageMatch.page.title || "Untitled page",
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      reason: typeof rawSuggestion.reason === "string" ? rawSuggestion.reason.trim() : "",
    });
  }

  return { ok: true, suggestions };
}

export function visibleUnmanagedPages(state: WorkspaceState) {
  return [
    ...state.unmanagedPages,
    ...state.unmanagedGroups.flatMap((group) => group.pages),
  ].filter((page) => page.chromeTabId && isAiVisiblePage(page));
}

function compactPage(page: PageModel) {
  return {
    id: page.id,
    title: page.title,
    url: page.url,
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
