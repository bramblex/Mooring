import { buildAiPromptInput, type AiActionPlan } from "../../models/ai-action.model";
import type { WorkspaceState } from "../../models/workspace.model";

type LanguageModelPrompt = {
  role: "system" | "user" | "assistant";
  content: string;
  prefix?: boolean;
};

type LanguageModelSession = {
  prompt(input: string | LanguageModelPrompt[]): Promise<string>;
  destroy?: () => void;
};

type LanguageModelApi = {
  availability(options?: unknown): Promise<string> | string;
  create(options?: {
    initialPrompts?: LanguageModelPrompt[];
    temperature?: number;
    topK?: number;
  }): Promise<LanguageModelSession>;
};

export const AI_PROMPT_HISTORY_STORAGE_KEY = "mooringAiPromptHistory";
const AI_PROMPT_HISTORY_LIMIT = 20;

export type BuiltInAiStatus = {
  supported: boolean;
  availability: string;
  enabled: boolean;
  error?: string;
  checkedAt: string;
};

export async function getBuiltInAiStatus(): Promise<BuiltInAiStatus> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    return {
      supported: false,
      availability: "missing",
      enabled: false,
      checkedAt: new Date().toLocaleTimeString(),
    };
  }

  try {
    const availability = await languageModel.availability();
    const enabled = availability === "available"
      || availability === "downloadable"
      || availability === "downloading";

    return {
      supported: true,
      availability,
      enabled,
      checkedAt: new Date().toLocaleTimeString(),
    };
  } catch (error) {
    return {
      supported: true,
      availability: "error",
      enabled: false,
      error: error instanceof Error ? error.message : "LanguageModel.availability() failed.",
      checkedAt: new Date().toLocaleTimeString(),
    };
  }
}

export async function loadAiPromptHistory(): Promise<string[]> {
  const stored = await chrome.storage.local.get(AI_PROMPT_HISTORY_STORAGE_KEY);
  const history = stored[AI_PROMPT_HISTORY_STORAGE_KEY];
  return Array.isArray(history)
    ? history.filter((item): item is string => typeof item === "string")
    : [];
}

export async function saveAiPromptHistory(prompt: string) {
  const value = prompt.trim();
  if (!value) return [];

  const previous = await loadAiPromptHistory();
  const next = [
    value,
    ...previous.filter((item) => item !== value),
  ].slice(0, AI_PROMPT_HISTORY_LIMIT);

  await chrome.storage.local.set({
    [AI_PROMPT_HISTORY_STORAGE_KEY]: next,
  });
  return next;
}

export async function generateAiActionPlan(
  state: WorkspaceState,
  prompt: string,
): Promise<AiActionPlan> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    throw new Error("Chrome built-in AI is not available.");
  }

  const session = await languageModel.create({
    initialPrompts: [
      { role: "system", content: buildAiSystemPrompt() },
    ],
  });

  try {
    const content = await session.prompt([
      {
        role: "user",
        content: JSON.stringify(buildAiPromptInput(state, prompt)),
      },
      {
        role: "assistant",
        content: "{\"actions\":",
        prefix: true,
      },
    ]);

    return parseAiPlanResponse(content);
  } finally {
    session.destroy?.();
  }
}

export function buildAiRequestPreview(state: WorkspaceState, prompt: string) {
  return {
    provider: "chrome-built-in-ai",
    system: buildAiSystemPrompt(),
    input: buildAiPromptInput(state, prompt),
  };
}

function getLanguageModel(): LanguageModelApi | null {
  const value = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  if (!isObjectLike(value)) return null;
  if (typeof value["availability"] !== "function" || typeof value["create"] !== "function") return null;
  return value as LanguageModelApi;
}

function buildAiSystemPrompt() {
  return [
    "You create safe Mooring workspace action plans.",
    "Glossary: Workspace / 工作区 / workspace means a Mooring workspace backed by a Chrome bookmark folder.",
    "Glossary: Page / 页面 / page means a Mooring page item, not a browser tab UI label.",
    "Glossary: Temp Page / 临时页面 means an open Chrome tab that is not saved as a bookmark.",
    "Glossary: Pinned Page / 固定页面 means a page saved as a bookmark inside a workspace.",
    "Glossary: Unmanaged Page / 未管理页面 means a page from unmanagedPages or unmanagedGroups, not a workspace name.",
    "Glossary: all unmanaged pages / 所有未管理页面 means every page in unmanagedPages and unmanagedGroups.",
    "Glossary: all pages / 所有页面 means every page in workspaces, unmanagedPages, and unmanagedGroups.",
    "Glossary: move / 移动 / 放到 / 归到 / 整理到 means use move_page for each matched page.",
    "Glossary: organize / 整理 means move matched pages into the requested existing or newly created workspace.",
    "Glossary: pin / fixed / 固定 / 保存 / 加入书签 means create a bookmark-backed Pinned Page with pin_page, not merely move a page.",
    "Glossary: Unmanaged / 未管理 means open Chrome tabs or groups that are not currently in a Mooring workspace.",
    "Glossary: Chrome Group / 标签组 is only the runtime projection of a workspace, not the source of truth.",
    "Return JSON only.",
    "Do not include markdown.",
    "Return exactly this shape: {\"actions\":[...]}",
    "rename_workspace uses {\"type\":\"rename_workspace\",\"workspaceId\":\"...\",\"name\":\"...\"}.",
    "create_workspace uses {\"type\":\"create_workspace\",\"name\":\"...\",\"color\":\"grey\",\"workspaceRef\":\"new-workspace-slug\"}.",
    "move_page uses {\"type\":\"move_page\",\"pageId\":\"...\",\"toWorkspaceId\":\"...\",\"index\":0}.",
    "pin_page uses {\"type\":\"pin_page\",\"pageId\":\"chrome-tab:...\",\"workspaceId\":\"...\"}.",
    "There is no single pin-to-workspace action. For pin to / 固定到 / 保存到 a workspace, return move_page first, then pin_page for the same page and workspace.",
    "unpin_page uses {\"type\":\"unpin_page\",\"pageId\":\"bookmark:...\"}.",
    "close_page uses {\"type\":\"close_page\",\"pageId\":\"...\"} and only closes open pages.",
    "delete_workspace uses {\"type\":\"delete_workspace\",\"workspaceId\":\"...\"}.",
    "close_workspace_pages uses {\"type\":\"close_workspace_pages\",\"workspaceId\":\"...\"}.",
    "For 关闭 or close page requests, use close_page. Never create substitute workspaces such as Closed or 已关闭.",
    "For 删除 or delete workspace requests, use delete_workspace.",
    "For 取消固定 or unpin requests, use unpin_page.",
    "If the user asks to move pages into a workspace that does not exist, create that workspace first with workspaceRef, then move every requested page to that same workspaceRef.",
    "Do not create a workspace named after a page selection phrase such as 所有未管理页面, all unmanaged pages, 所有页面, or all pages.",
    "When a request includes both a page selection phrase and a target workspace name, the selection phrase chooses pages and the target workspace name chooses the destination.",
    "If the user asks to pin, save, bookmark, make pages persistent, 固定, 保存, or 加入书签, move temp pages to the target workspace first if needed, then add pin_page actions for those temp page ids.",
    "Example order for a new target workspace: create_workspace with workspaceRef, move_page to that workspaceRef, then pin_page with the same workspaceRef.",
    "When the user says all pages, include every page from workspaces, unmanagedPages, and unmanagedGroups.",
    "All pages includes pages that are already inside another workspace; move them too unless the user explicitly excludes them.",
    "Example: 用户说 把所有未管理页面移动到 Research. If Research exists, return move_page for every unmanaged page to Research. If Research does not exist, first create_workspace Research, then move_page for every unmanaged page to that workspaceRef.",
    "Example: 用户说 把所有页面移动到 Google. Return move_page for every page from workspaces, unmanagedPages, and unmanagedGroups to Google; do not create a workspace called 所有页面.",
    "Example: 用户说 整理所有未管理页面到一个工作区. Create a useful destination workspace such as Inbox only if no destination is named, then move every unmanaged page into it.",
    "rename_page uses {\"type\":\"rename_page\",\"pageId\":\"...\",\"title\":\"...\"}.",
    "Do not invent ids.",
    "Only rename pinned pages.",
  ].join(" ");
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function parseAiPlanResponse(content: string): AiActionPlan {
  const stripped = stripJsonFence(content);
  try {
    return JSON.parse(stripped) as AiActionPlan;
  } catch {
    const continuation = stripped.endsWith("}") ? stripped : `${stripped}}`;
    return JSON.parse(`{"actions":${continuation}`) as AiActionPlan;
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && (typeof value === "object" || typeof value === "function"));
}
