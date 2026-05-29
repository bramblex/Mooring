<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { Info, Settings, Sparkles } from "@lucide/vue";
import {
  AI_PROVIDER_STYLE_DEFAULTS,
  type AiApiStyle,
  type AiProviderConfig,
} from "../ai/deepseek";

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
  };
}>();

const emit = defineEmits<{
  "update:config": [config: AiProviderConfig];
  "update:prompt": [prompt: string];
  toggle: [];
  generate: [];
  apply: [];
  cancel: [];
  saveSettings: [];
  historyPrev: [];
  historyNext: [];
}>();

const settingsOpen = ref(false);
const promptInfoOpen = ref(false);
const textarea = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      settingsOpen.value = false;
      promptInfoOpen.value = false;
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
  if (settingsOpen.value) promptInfoOpen.value = false;
}

function togglePromptInfo() {
  promptInfoOpen.value = !promptInfoOpen.value;
  if (promptInfoOpen.value) settingsOpen.value = false;
}

function saveSettings() {
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
</script>

<template>
  <div class="ai-dock">
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

      <div v-if="preview.length" class="ai-result-actions">
        <button type="button" class="confirm-button" :disabled="loading" @click="$emit('cancel')">
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

    <section v-if="open && promptInfoOpen" class="ai-prompt-popover" :aria-label="labels.promptInfo">
      <pre>{{ promptPreview }}</pre>
    </section>

    <section v-if="open && settingsOpen" class="ai-settings-popover" :aria-label="labels.settings">
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
      <button type="button" class="confirm-button ai-settings-save-button" @click="saveSettings">
        {{ labels.save }}
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
      @click="$emit('toggle')"
    >
      <Sparkles :size="19" aria-hidden="true" />
    </button>
  </div>
</template>
