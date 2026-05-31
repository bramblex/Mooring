<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
import type { AiClassificationPreview } from "../../models/ai-classification.model";

defineProps<{
  available: boolean;
  loading: boolean;
  open: boolean;
  error: string;
  suggestions: AiClassificationPreview[];
  selectedPageIds: string[];
  labels: {
    title: string;
    unavailable: string;
    loading: string;
    empty: string;
    apply: string;
    cancel: string;
  };
}>();

defineEmits<{
  classify: [];
  apply: [];
  cancel: [];
  toggleSuggestion: [pageId: string];
}>();
</script>

<template>
  <div class="ai-dock">
    <section v-if="open" class="ai-result-panel" :aria-label="labels.title">
      <div class="ai-result-header">
        <div v-if="loading" class="ai-status">
          <span class="ai-spinner" aria-hidden="true"></span>
          <span>{{ labels.loading }}</span>
        </div>
        <span v-else class="ai-status">{{ labels.title }}</span>
      </div>

      <p v-if="error" class="ai-error">{{ error }}</p>
      <p v-else-if="!loading && !available" class="ai-empty">{{ labels.unavailable }}</p>
      <p v-else-if="!loading && suggestions.length === 0" class="ai-empty">{{ labels.empty }}</p>

      <ul v-if="suggestions.length" class="ai-classification-list">
        <li v-for="suggestion in suggestions" :key="suggestion.pageId">
          <label class="ai-classification-option">
            <input
              type="checkbox"
              :checked="selectedPageIds.includes(suggestion.pageId)"
              :disabled="loading"
              @change="$emit('toggleSuggestion', suggestion.pageId)"
            />
            <span class="ai-classification-main">
              <span class="ai-classification-title">{{ suggestion.pageTitle }}</span>
              <span class="ai-classification-target">{{ suggestion.workspaceName }}</span>
              <span v-if="suggestion.reason" class="ai-classification-reason">{{ suggestion.reason }}</span>
            </span>
          </label>
        </li>
      </ul>

      <div class="ai-result-actions">
        <button type="button" class="confirm-button" :disabled="loading" @click="$emit('cancel')">
          {{ labels.cancel }}
        </button>
        <button
          type="button"
          class="confirm-button ai-apply-button"
          :disabled="loading || selectedPageIds.length === 0"
          @click="$emit('apply')"
        >
          {{ labels.apply }}
        </button>
      </div>
    </section>

    <button
      class="icon-button floating-ai-button"
      :class="{ active: open }"
      type="button"
      :title="labels.title"
      :aria-label="labels.title"
      :disabled="loading"
      @click="$emit('classify')"
    >
      <Sparkles :size="19" aria-hidden="true" />
    </button>
  </div>
</template>
