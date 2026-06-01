import {
  buildAiClassificationInput,
  type AiClassificationPlan,
} from "../../models/ai-classification.model";
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
  }): Promise<LanguageModelSession>;
};

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
    const enabled = availability === "available" || availability === "downloadable";

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

export async function generateAiClassificationPlan(
  state: WorkspaceState,
): Promise<AiClassificationPlan> {
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
        content: JSON.stringify(buildAiClassificationInput(state)),
      },
    ]);

    return parseAiPlanResponse(content);
  } finally {
    session.destroy?.();
  }
}

function getLanguageModel(): LanguageModelApi | null {
  const value = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  if (!isObjectLike(value)) return null;
  if (typeof value["availability"] !== "function" || typeof value["create"] !== "function") return null;
  return value as LanguageModelApi;
}

function buildAiSystemPrompt() {
  return [
    "You classify unmanaged Chrome pages into existing Mooring workspaces.",
    "Return JSON only. Do not include markdown.",
    "Return exactly this shape: {\"suggestions\":[{\"pageId\":\"...\",\"workspaceId\":\"...\",\"reason\":\"...\"}]}",
    "Mooring glossary:",
    "Workspace / 工作区 means an existing Mooring workspace.",
    "Page / 页面 means a browser page item.",
    "Unmanaged page / 未管理页面 means a currently open page that is not already in a Mooring workspace.",
    "Your only job is classification: suggest moving unmanaged pages into the best existing workspace.",
    "Never create a workspace.",
    "Never rename a workspace.",
    "Never pin, unpin, close, delete, or bookmark pages.",
    "Only use pageId values from unmanagedPages.",
    "Only use workspaceId values from workspaces.",
    "Use each unmanaged page at most once.",
    "Omit a page when no workspace clearly fits.",
    "Use workspace names, existing workspace pages, page titles, URLs, and domains to infer the best match.",
    "Prefer precise matches over broad guesses.",
    "The reason should be short and user-facing.",
  ].join(" ");
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function parseAiPlanResponse(content: string): AiClassificationPlan {
  const stripped = stripJsonFence(content);
  return JSON.parse(stripped) as AiClassificationPlan;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && (typeof value === "object" || typeof value === "function"));
}
