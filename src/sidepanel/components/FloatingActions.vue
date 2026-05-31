<script setup lang="ts">
import { FilePlus, FolderPlus, Trash2 } from "@lucide/vue";
import type { DeleteHistoryItem } from "../../models/delete-history.model";

defineProps<{
  newPageLabel: string;
  newWorkspaceLabel: string;
  trashLabel: string;
  restoreLabel: string;
  emptyTrashLabel: string;
  deleteHistory: DeleteHistoryItem[];
  formatDeletedAt: (deletedAt: number) => string;
}>();

defineEmits<{
  createPage: [];
  createWorkspace: [];
  restoreDeleteHistoryItem: [item: DeleteHistoryItem];
}>();
</script>

<template>
  <div class="floating-actions" :aria-label="newWorkspaceLabel">
    <div class="trash-action">
      <button
        class="icon-button floating-create-button"
        type="button"
        :title="trashLabel"
        :aria-label="trashLabel"
      >
        <Trash2 :size="19" aria-hidden="true" />
      </button>
      <section class="delete-history-popover" :aria-label="trashLabel">
        <p v-if="deleteHistory.length === 0" class="delete-history-empty">{{ emptyTrashLabel }}</p>
        <ul v-else class="delete-history-list">
          <li v-for="item in deleteHistory" :key="item.id" class="delete-history-item">
            <span class="delete-history-main">
              <span class="delete-history-title">{{ item.title }}</span>
              <span class="delete-history-meta">{{ item.kind }} · {{ formatDeletedAt(item.deletedAt) }}</span>
            </span>
            <button
              type="button"
              class="confirm-button"
              :title="restoreLabel"
              :aria-label="restoreLabel"
              @click="$emit('restoreDeleteHistoryItem', item)"
            >
              {{ restoreLabel }}
            </button>
          </li>
        </ul>
      </section>
    </div>
    <button
      class="icon-button floating-create-button primary"
      type="button"
      :title="newWorkspaceLabel"
      :aria-label="newWorkspaceLabel"
      @click="$emit('createWorkspace')"
    >
      <FolderPlus :size="20" aria-hidden="true" />
    </button>
    <button
      class="icon-button floating-create-button"
      type="button"
      :title="newPageLabel"
      :aria-label="newPageLabel"
      @click="$emit('createPage')"
    >
      <FilePlus :size="21" aria-hidden="true" />
    </button>
  </div>
</template>
