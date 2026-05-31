<script setup lang="ts">
import { FilePlus, FolderPlus } from "@lucide/vue";

defineProps<{
  newPageLabel: string;
  newWorkspaceLabel: string;
}>();

defineEmits<{
  createPage: [];
  createWorkspace: [];
}>();
</script>

<template>
  <div class="floating-actions" :aria-label="newWorkspaceLabel">
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
