import { buildAiPromptInput, type AiActionPlan } from "../../models/ai-action.model";
import type { WorkspaceState } from "../../models/workspace.model";

export type AiApiStyle = "openai" | "anthropic";

export type AiProviderConfig = {
  apiStyle: AiApiStyle;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type AiProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export const AI_PROVIDER_STYLE_DEFAULTS: Record<AiApiStyle, Pick<AiProviderConfig, "baseUrl" | "model">> = {
  openai: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-4-5-20251001",
  },
};

export const DEFAULT_AI_CONFIG: AiProviderConfig = {
  apiStyle: "openai",
  baseUrl: AI_PROVIDER_STYLE_DEFAULTS.openai.baseUrl,
  apiKey: "",
  model: AI_PROVIDER_STYLE_DEFAULTS.openai.model,
};

export const AI_CONFIG_STORAGE_KEY = "mooringAiProviderConfig";
export const AI_CONFIG_SYNC_STORAGE_KEY = "mooringAiProviderConfigSync";
export const AI_CONFIG_SECRET_STORAGE_KEY = "mooringAiProviderSecrets";
export const AI_PROMPT_HISTORY_STORAGE_KEY = "mooringAiPromptHistory";
const AI_PROMPT_HISTORY_LIMIT = 20;

export async function loadAiProviderConfig(): Promise<AiProviderConfig> {
  const [synced, local] = await Promise.all([
    getSyncStorage(AI_CONFIG_SYNC_STORAGE_KEY),
    chrome.storage.local.get([AI_CONFIG_STORAGE_KEY, AI_CONFIG_SECRET_STORAGE_KEY]),
  ]);
  const legacyValue = isRecord(local[AI_CONFIG_STORAGE_KEY]) ? local[AI_CONFIG_STORAGE_KEY] : {};
  const syncedValue = isRecord(synced[AI_CONFIG_SYNC_STORAGE_KEY]) ? synced[AI_CONFIG_SYNC_STORAGE_KEY] : {};
  const secretValue = isRecord(local[AI_CONFIG_SECRET_STORAGE_KEY]) ? local[AI_CONFIG_SECRET_STORAGE_KEY] : {};
  const value = { ...legacyValue, ...syncedValue };
  const apiStyle = value.apiStyle === "anthropic" ? "anthropic" : "openai";

  return {
    ...DEFAULT_AI_CONFIG,
    ...value,
    apiKey: typeof secretValue.apiKey === "string"
      ? secretValue.apiKey
      : typeof legacyValue.apiKey === "string"
        ? legacyValue.apiKey
        : "",
    apiStyle,
  };
}

export async function saveAiProviderConfig(config: AiProviderConfig) {
  const apiStyle = config.apiStyle === "anthropic" ? "anthropic" : "openai";
  const defaults = AI_PROVIDER_STYLE_DEFAULTS[apiStyle];

  await Promise.all([
    setSyncStorage({
      [AI_CONFIG_SYNC_STORAGE_KEY]: {
        apiStyle,
        baseUrl: normalizeBaseUrl(config.baseUrl || defaults.baseUrl),
        model: config.model.trim() || defaults.model,
      },
    }),
    chrome.storage.local.set({
      [AI_CONFIG_SECRET_STORAGE_KEY]: {
        apiKey: config.apiKey.trim(),
      },
    }),
    chrome.storage.local.remove(AI_CONFIG_STORAGE_KEY),
  ]);
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
  config: AiProviderConfig,
  state: WorkspaceState,
  prompt: string,
): Promise<AiActionPlan> {
  const request = buildAiProviderRequest(config, state, prompt);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `AI request failed with status ${response.status}.`);
  }

  const responsePayload = await response.json();
  const content = extractAiResponseText(config.apiStyle, responsePayload);
  if (typeof content !== "string") {
    throw new Error("AI response did not include a JSON message.");
  }

  return JSON.parse(stripJsonFence(content)) as AiActionPlan;
}

export function buildAiRequestPreview(
  config: Pick<AiProviderConfig, "apiStyle" | "baseUrl" | "model">,
  state: WorkspaceState,
  prompt: string,
) {
  const request = buildAiProviderRequest({ ...config, apiKey: "" }, state, prompt);
  const redactedHeaders = { ...request.headers };
  delete redactedHeaders.Authorization;
  delete redactedHeaders["x-api-key"];

  return {
    apiStyle: config.apiStyle,
    url: request.url,
    headers: redactedHeaders,
    body: request.body,
  };
}

function buildAiProviderRequest(
  config: Pick<AiProviderConfig, "apiStyle" | "baseUrl" | "apiKey" | "model">,
  state: WorkspaceState,
  prompt: string,
): AiProviderRequest {
  if (config.apiStyle === "anthropic") {
    return {
      url: providerEndpoint(config.baseUrl, "/v1/messages"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: buildAnthropicMessagesPayload(config, state, prompt),
    };
  }

  return {
    url: providerEndpoint(config.baseUrl, "/chat/completions"),
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: buildOpenAiChatCompletionPayload(config, state, prompt),
  };
}

function buildOpenAiChatCompletionPayload(
  config: Pick<AiProviderConfig, "model">,
  state: WorkspaceState,
  prompt: string,
) {
  return {
    model: config.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildAiSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify(buildAiPromptInput(state, prompt)),
      },
    ],
  };
}

function buildAnthropicMessagesPayload(
  config: Pick<AiProviderConfig, "model">,
  state: WorkspaceState,
  prompt: string,
) {
  return {
    model: config.model,
    max_tokens: 2048,
    temperature: 0.1,
    system: buildAiSystemPrompt(),
    messages: [
      {
        role: "user",
        content: JSON.stringify(buildAiPromptInput(state, prompt)),
      },
    ],
  };
}

function buildAiSystemPrompt() {
  return [
    "You create safe Mooring workspace action plans.",
    "Glossary: Workspace / 工作区 / workspace means a Mooring workspace backed by a Chrome bookmark folder.",
    "Glossary: Page / 页面 / page means a Mooring page item, not a browser tab UI label.",
    "Glossary: Temp Page / 临时页面 means an open Chrome tab that is not saved as a bookmark.",
    "Glossary: Pinned Page / 固定页面 means a page saved as a bookmark inside a workspace.",
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
    "If the user asks to pin, save, bookmark, make pages persistent, 固定, 保存, or 加入书签, move temp pages to the target workspace first if needed, then add pin_page actions for those temp page ids.",
    "Example order for a new target workspace: create_workspace with workspaceRef, move_page to that workspaceRef, then pin_page with the same workspaceRef.",
    "When the user says all pages, include every page from workspaces, unmanagedPages, and unmanagedGroups.",
    "All pages includes pages that are already inside another workspace; move them too unless the user explicitly excludes them.",
    "rename_page uses {\"type\":\"rename_page\",\"pageId\":\"...\",\"title\":\"...\"}.",
    "Do not invent ids.",
    "Only rename pinned pages.",
  ].join(" ");
}

function extractAiResponseText(apiStyle: AiApiStyle, responsePayload: unknown) {
  if (!isRecord(responsePayload)) return undefined;

  if (apiStyle === "anthropic") {
    const content = responsePayload.content;
    if (!Array.isArray(content)) return undefined;

    const text = content
      .filter((block): block is { type: string; text: string } => (
        isRecord(block) && block.type === "text" && typeof block.text === "string"
      ))
      .map((block) => block.text)
      .join("");

    return text || undefined;
  }

  const choices = responsePayload.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  return typeof first.message.content === "string" ? first.message.content : undefined;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function providerEndpoint(baseUrl: string, endpoint: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl.endsWith("/v1") && endpoint.startsWith("/v1/")) {
    return `${normalizedBaseUrl}${endpoint.slice(3)}`;
  }

  return `${normalizedBaseUrl}${endpoint}`;
}

async function getSyncStorage(key: string) {
  try {
    return await chrome.storage.sync.get(key);
  } catch {
    return chrome.storage.local.get(key);
  }
}

async function setSyncStorage(value: Record<string, unknown>) {
  try {
    await chrome.storage.sync.set(value);
  } catch {
    await chrome.storage.local.set(value);
  }
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
