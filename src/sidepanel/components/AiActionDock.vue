<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { Info, Plus, Settings, Sparkles, Trash2 } from "@lucide/vue";
import {
  AI_PROVIDER_STYLE_DEFAULTS,
  type AiApiStyle,
  type AiProviderConfig,
} from "../ai/deepseek";
import type { AiPromptShortcut } from "../ai/prompt-shortcuts";

type LocalizedAiActionPreview = {
  text: string;
  risk: "normal" | "warning" | "danger";
};

const props = defineProps<{
  open: boolean;
  config: AiProviderConfig;
  prompt: string;
  preview: LocalizedAiActionPreview[];
  error: string;
  loading: boolean;
  hasPlan: boolean;
  promptPreview: string;
  shortcuts: AiPromptShortcut[];
  labels: {
    title: string;
    prompt: string;
    apiStyle: string;
    openAiStyle: string;
    anthropicStyle: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    save: string;
    apply: string;
    cancel: string;
    confirm: string;
    settings: string;
    promptInfo: string;
    shortcuts: string;
    addShortcut: string;
    shortcutTitle: string;
    shortcutPrompt: string;
    builtInShortcut: string;
    deleteShortcut: string;
  };
}>();

const emit = defineEmits<{
  "update:config": [config: AiProviderConfig];
  "update:prompt": [prompt: string];
  "update:shortcuts": [shortcuts: AiPromptShortcut[]];
  toggle: [];
  generate: [];
  runShortcut: [prompt: string];
  apply: [];
  clearPlan: [];
  cancel: [];
  saveSettings: [];
  addShortcut: [];
  deleteShortcut: [shortcutId: string];
  historyPrev: [];
  historyNext: [];
}>();

const settingsOpen = ref(false);
const promptInfoOpen = ref(false);
const shortcutMenuOpen = ref(false);
const draftShortcuts = ref<AiPromptShortcut[]>([]);
const textarea = ref<HTMLTextAreaElement | null>(null);
let shortcutMenuTimer: number | undefined;

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      settingsOpen.value = false;
      promptInfoOpen.value = false;
      shortcutMenuOpen.value = false;
      return;
    }

    await nextTick();
    resizePrompt();
    textarea.value?.focus();
  },
);

watch(
  () => props.prompt,
  () => {
    void nextTick(resizePrompt);
  },
);

function updatePrompt(event: Event) {
  emit("update:prompt", (event.target as HTMLTextAreaElement).value);
  resizePrompt();
}

function resizePrompt() {
  if (!textarea.value) return;

  textarea.value.style.height = "72px";
}

function handlePromptKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (props.prompt.trim()) {
      emit("update:prompt", "");
      return;
    }

    emit("cancel");
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("generate");
    return;
  }

  if (event.key === "ArrowUp" && isAtTextStart()) {
    event.preventDefault();
    emit("historyPrev");
    return;
  }

  if (event.key === "ArrowDown" && isAtTextEnd()) {
    event.preventDefault();
    emit("historyNext");
  }
}

function isAtTextStart() {
  if (!textarea.value) return true;
  return textarea.value.selectionStart === 0 && textarea.value.selectionEnd === 0;
}

function isAtTextEnd() {
  if (!textarea.value) return true;
  const end = textarea.value.value.length;
  return textarea.value.selectionStart === end && textarea.value.selectionEnd === end;
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value;
  if (settingsOpen.value) {
    draftShortcuts.value = cloneShortcuts(props.shortcuts);
    promptInfoOpen.value = false;
    shortcutMenuOpen.value = false;
  }
}

function togglePromptInfo() {
  promptInfoOpen.value = !promptInfoOpen.value;
  if (promptInfoOpen.value) {
    settingsOpen.value = false;
    shortcutMenuOpen.value = false;
  }
}

function saveSettings() {
  emit("update:shortcuts", cloneShortcuts(draftShortcuts.value));
  emit("saveSettings");
  settingsOpen.value = false;
}

function updateApiStyle(event: Event) {
  const apiStyle = (event.target as HTMLSelectElement).value as AiApiStyle;
  const defaults = AI_PROVIDER_STYLE_DEFAULTS[apiStyle];
  emit("update:config", {
    ...props.config,
    apiStyle,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
  });
}

function showShortcutMenu() {
  window.clearTimeout(shortcutMenuTimer);
  if (props.shortcuts.length === 0 || settingsOpen.value || promptInfoOpen.value) return;

  shortcutMenuOpen.value = true;
}

function scheduleHideShortcutMenu() {
  window.clearTimeout(shortcutMenuTimer);
  shortcutMenuTimer = window.setTimeout(() => {
    shortcutMenuOpen.value = false;
  }, 180);
}

function runShortcut(prompt: string) {
  shortcutMenuOpen.value = false;
  emit("runShortcut", prompt);
}

function updateShortcutTitle(shortcutId: string, event: Event) {
  const title = (event.target as HTMLInputElement).value;
  draftShortcuts.value = draftShortcuts.value.map((shortcut) => (
    shortcut.id === shortcutId ? { ...shortcut, title } : shortcut
  ));
}

function updateShortcutPrompt(shortcutId: string, event: Event) {
  const prompt = (event.target as HTMLTextAreaElement).value;
  draftShortcuts.value = draftShortcuts.value.map((shortcut) => (
    shortcut.id === shortcutId ? { ...shortcut, prompt } : shortcut
  ));
}

function addDraftShortcut() {
  draftShortcuts.value = [...draftShortcuts.value, {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    prompt: "",
    order: Number.MAX_SAFE_INTEGER,
  }];
}

function deleteDraftShortcut(shortcutId: string) {
  draftShortcuts.value = draftShortcuts.value.filter((shortcut) => shortcut.id !== shortcutId);
}

function cloneShortcuts(shortcuts: AiPromptShortcut[]) {
  return shortcuts.map((shortcut) => ({ ...shortcut }));
}
</script>

<template>
  <div
    class="ai-dock"
    :class="{ 'has-settings-button': open }"
  >
    <section v-if="open && (loading || error || preview.length)" class="ai-result-panel" :aria-label="labels.title">
      <div class="ai-result-header">
        <div v-if="loading" class="ai-status">
          <span class="ai-spinner" aria-hidden="true"></span>
          <span>{{ labels.title }}</span>
        </div>
        <span v-else class="ai-status">{{ labels.title }}</span>
        <button
          class="inline-icon-button ai-panel-info-button"
          type="button"
          :title="labels.promptInfo"
          :aria-label="labels.promptInfo"
          @click="togglePromptInfo"
        >
          <Info :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="error" class="ai-error">{{ error }}</p>

      <div v-if="preview.length" class="ai-result">
        <ul class="ai-preview">
          <li
            v-for="item in preview"
            :key="item.text"
            :class="`risk-${item.risk}`"
          >
            {{ item.text }}
          </li>
        </ul>
      </div>

      <div v-if="promptInfoOpen" class="ai-prompt-inline" :aria-label="labels.promptInfo">
        <pre>{{ promptPreview }}</pre>
      </div>

      <div v-if="preview.length" class="ai-result-actions">
        <button type="button" class="confirm-button" :disabled="loading" @click="$emit('clearPlan')">
          {{ labels.cancel }}
        </button>
        <button type="button" class="confirm-button ai-apply-button" :disabled="loading" @click="$emit('apply')">
          {{ labels.apply }}
        </button>
      </div>
    </section>

    <section v-if="open" class="ai-input-panel" :aria-label="labels.title">
      <textarea
        ref="textarea"
        class="ai-prompt"
        :value="prompt"
        :placeholder="labels.prompt"
        rows="1"
        :disabled="loading"
        @input="updatePrompt"
        @keydown="handlePromptKeydown"
      ></textarea>
      <button
        type="button"
        class="confirm-button ai-confirm-button"
        :disabled="loading"
        @click="$emit('generate')"
      >
        {{ labels.confirm }}
      </button>
    </section>

    <section v-if="open && settingsOpen" class="ai-settings-popover" :aria-label="labels.settings">
      <div class="ai-settings-scroll">
        <label>
          <span>{{ labels.apiStyle }}</span>
          <select :value="config.apiStyle" @change="updateApiStyle">
            <option value="openai">{{ labels.openAiStyle }}</option>
            <option value="anthropic">{{ labels.anthropicStyle }}</option>
          </select>
        </label>
        <label>
          <span>{{ labels.baseUrl }}</span>
          <input
            :value="config.baseUrl"
            @input="$emit('update:config', { ...config, baseUrl: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label>
          <span>{{ labels.model }}</span>
          <input
            :value="config.model"
            @input="$emit('update:config', { ...config, model: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label>
          <span>{{ labels.apiKey }}</span>
          <input
            type="password"
            autocomplete="off"
            :value="config.apiKey"
            @input="$emit('update:config', { ...config, apiKey: ($event.target as HTMLInputElement).value })"
          />
        </label>

        <div class="ai-shortcut-settings">
          <div class="ai-settings-section-header">
            <span>{{ labels.shortcuts }}</span>
            <button
              type="button"
              class="inline-icon-button"
              :title="labels.addShortcut"
              :aria-label="labels.addShortcut"
              @click="addDraftShortcut"
            >
              <Plus :size="14" aria-hidden="true" />
            </button>
          </div>

          <div class="ai-shortcut-settings-list">
            <div
              v-for="shortcut in draftShortcuts"
              :key="shortcut.id"
              class="ai-shortcut-editor"
              :class="{ 'is-built-in': shortcut.builtIn }"
            >
              <div class="ai-shortcut-editor-header">
                <input
                  :value="shortcut.title"
                  :placeholder="labels.shortcutTitle"
                  maxlength="12"
                  @input="updateShortcutTitle(shortcut.id, $event)"
                />
                <button
                  type="button"
                  class="inline-icon-button danger"
                  :title="labels.deleteShortcut"
                  :aria-label="labels.deleteShortcut"
                  @click="deleteDraftShortcut(shortcut.id)"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
              <textarea
                :value="shortcut.prompt"
                :placeholder="labels.shortcutPrompt"
                maxlength="200"
                rows="2"
                @input="updateShortcutPrompt(shortcut.id, $event)"
              ></textarea>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="confirm-button ai-settings-save-button" @click="saveSettings">
        {{ labels.save }}
      </button>
    </section>

    <section
      v-if="shortcutMenuOpen"
      class="ai-shortcut-menu"
      :aria-label="labels.shortcuts"
      @mouseenter="showShortcutMenu"
      @mouseleave="scheduleHideShortcutMenu"
    >
      <button
        v-for="shortcut in shortcuts"
        :key="shortcut.id"
        type="button"
        class="ai-shortcut-item"
        :disabled="loading"
        @click="runShortcut(shortcut.prompt)"
      >
        <span>{{ shortcut.title }}</span>
      </button>
    </section>

    <button
      v-if="open"
      class="icon-button floating-ai-settings-button"
      type="button"
      :title="labels.settings"
      :aria-label="labels.settings"
      @click="toggleSettings"
    >
      <Settings :size="18" aria-hidden="true" />
    </button>

    <button
      class="icon-button floating-ai-button"
      :class="{ active: open }"
      type="button"
      :title="labels.title"
      :aria-label="labels.title"
      @mouseenter="showShortcutMenu"
      @mouseleave="scheduleHideShortcutMenu"
      @focus="showShortcutMenu"
      @blur="scheduleHideShortcutMenu"
      @click="$emit('toggle')"
    >
      <Sparkles :size="19" aria-hidden="true" />
    </button>
  </div>
</template>
