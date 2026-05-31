import type { Locale } from "../../i18n";

export type AiPromptShortcut = {
  id: string;
  title: string;
  prompt: string;
  builtIn?: boolean;
  order: number;
};

type AiPromptShortcutStorage = {
  shortcuts: AiPromptShortcut[];
};

export const AI_PROMPT_SHORTCUTS_STORAGE_KEY = "mooringAiPromptShortcuts";
const AI_PROMPT_SHORTCUT_LIMIT = 12;
const AI_PROMPT_SHORTCUT_TITLE_LIMIT = 12;
const AI_PROMPT_SHORTCUT_PROMPT_LIMIT = 200;

const DEFAULT_SHORTCUTS: Record<Locale, AiPromptShortcut[]> = {
  en: [
    {
      id: "builtin-organize-unmanaged",
      title: "Organize unmanaged pages",
      prompt: "Create a new workspace for unmanaged pages and move all unmanaged pages into it.",
      builtIn: true,
      order: 0,
    },
    {
      id: "builtin-pin-current",
      title: "Pin current page",
      prompt: "Pin the current page into the most relevant workspace. Move it first if needed.",
      builtIn: true,
      order: 1,
    },
    {
      id: "builtin-close-workspace-pages",
      title: "Close active workspace pages",
      prompt: "Close all open pages in the current workspace.",
      builtIn: true,
      order: 2,
    },
    {
      id: "builtin-google-workspace",
      title: "Collect Google pages",
      prompt: "Create or use a Google workspace, then move all Google pages into it.",
      builtIn: true,
      order: 3,
    },
  ],
  zh: [
    {
      id: "builtin-organize-unmanaged",
      title: "整理未管理页面",
      prompt: "创建一个新的 workspace，把所有未管理页面移动进去。",
      builtIn: true,
      order: 0,
    },
    {
      id: "builtin-pin-current",
      title: "固定当前页面",
      prompt: "把当前页面固定到最合适的 workspace。如果不在目标 workspace，先移动再固定。",
      builtIn: true,
      order: 1,
    },
    {
      id: "builtin-close-workspace-pages",
      title: "关闭当前 Workspace 页面",
      prompt: "关闭当前 workspace 里所有已打开的页面。",
      builtIn: true,
      order: 2,
    },
    {
      id: "builtin-google-workspace",
      title: "收集 Google 页面",
      prompt: "创建或使用 Google workspace，把所有 Google 页面移动进去。",
      builtIn: true,
      order: 3,
    },
  ],
};

export async function loadAiPromptShortcuts(locale: Locale): Promise<AiPromptShortcut[]> {
  const stored = await getShortcutStorage();
  const value = stored[AI_PROMPT_SHORTCUTS_STORAGE_KEY];
  if (value === undefined) {
    const defaults = installableDefaultShortcuts(locale);
    await saveCustomAiPromptShortcuts(defaults, locale);
    return defaults;
  }

  return storedShortcuts(value, locale).sort((a, b) => a.order - b.order);
}

export async function saveCustomAiPromptShortcuts(shortcuts: AiPromptShortcut[], locale: Locale) {
  const savedShortcuts = shortcuts
    .slice(0, AI_PROMPT_SHORTCUT_LIMIT)
    .map((shortcut, index) => ({
      id: shortcut.id,
      title: truncate(shortcut.title.trim(), AI_PROMPT_SHORTCUT_TITLE_LIMIT),
      prompt: truncate(shortcut.prompt.trim(), AI_PROMPT_SHORTCUT_PROMPT_LIMIT),
      order: index,
    }))
    .filter((shortcut) => shortcut.title && shortcut.prompt);

  await setShortcutStorage({
    [AI_PROMPT_SHORTCUTS_STORAGE_KEY]: {
      shortcuts: savedShortcuts,
    },
  });

  return savedShortcuts;
}

export function createAiPromptShortcut(): AiPromptShortcut {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    prompt: "",
    order: Number.MAX_SAFE_INTEGER,
  };
}

function isPromptShortcut(value: unknown): value is AiPromptShortcut {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shortcut = value as Record<string, unknown>;

  return typeof shortcut.id === "string"
    && typeof shortcut.title === "string"
    && typeof shortcut.prompt === "string"
    && typeof shortcut.order === "number";
}

function storedShortcuts(value: unknown, locale: Locale) {
  if (Array.isArray(value)) return value.filter(isPromptShortcut).map(stripBuiltIn);
  if (isLegacyShortcutStorage(value)) {
    const hiddenBuiltInIds = value.hiddenBuiltInIds.filter((id): id is string => typeof id === "string");
    return [
      ...DEFAULT_SHORTCUTS[locale].filter((shortcut) => !hiddenBuiltInIds.includes(shortcut.id)),
      ...value.custom.filter(isPromptShortcut),
    ].map(stripBuiltIn);
  }
  if (!isShortcutStorage(value)) return installableDefaultShortcuts(locale);

  return value.shortcuts.filter(isPromptShortcut).map(stripBuiltIn);
}

function isShortcutStorage(value: unknown): value is AiPromptShortcutStorage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const storage = value as Record<string, unknown>;

  return Array.isArray(storage.shortcuts);
}

function isLegacyShortcutStorage(value: unknown): value is { custom: AiPromptShortcut[]; hiddenBuiltInIds: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const storage = value as Record<string, unknown>;

  return Array.isArray(storage.custom) && Array.isArray(storage.hiddenBuiltInIds);
}

function installableDefaultShortcuts(locale: Locale) {
  return DEFAULT_SHORTCUTS[locale].map(stripBuiltIn).slice(0, AI_PROMPT_SHORTCUT_LIMIT);
}

function stripBuiltIn(shortcut: AiPromptShortcut): AiPromptShortcut {
  return {
    id: shortcut.id,
    title: truncate(shortcut.title, AI_PROMPT_SHORTCUT_TITLE_LIMIT),
    prompt: truncate(shortcut.prompt, AI_PROMPT_SHORTCUT_PROMPT_LIMIT),
    order: shortcut.order,
  };
}

async function getShortcutStorage() {
  try {
    return await chrome.storage.sync.get(AI_PROMPT_SHORTCUTS_STORAGE_KEY);
  } catch {
    return chrome.storage.local.get(AI_PROMPT_SHORTCUTS_STORAGE_KEY);
  }
}

async function setShortcutStorage(value: Record<string, unknown>) {
  try {
    await chrome.storage.sync.set(value);
  } catch {
    await chrome.storage.local.set(value);
  }
}

function truncate(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit) : value;
}
