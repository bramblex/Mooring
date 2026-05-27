<script setup lang="ts">
import type { TabGroupColor, WorkspaceView } from "../../models/workspace.model";

const props = defineProps<{
  workspaces: WorkspaceView[];
  navLabel: string;
  dragOverKey: string;
  tempLabel: string;
  tempCount: number;
  groupColorStyle: (color: TabGroupColor) => Record<string, string>;
  workspaceNavKey: (workspaceId: string) => string;
  tempNavKey: () => string;
  workspaceOpenPageCount: (workspace: WorkspaceView) => number;
}>();

defineEmits<{
  workspaceClick: [workspaceId: string];
  workspaceDragover: [workspace: WorkspaceView, event: DragEvent];
  workspaceDragleave: [key: string];
  workspaceDrop: [workspace: WorkspaceView, event: DragEvent];
  tempClick: [];
  tempDragover: [event: DragEvent];
  tempDragleave: [key: string];
  tempDrop: [event: DragEvent];
}>();
</script>

<template>
  <nav
    v-if="props.workspaces.length > 0 || props.tempCount > 0"
    class="workspace-navigator"
    :aria-label="props.navLabel"
  >
    <button
      v-for="workspace in props.workspaces"
      :key="workspace.id"
      class="workspace-nav-item"
      :class="{ active: props.dragOverKey === props.workspaceNavKey(workspace.id) }"
      type="button"
      :title="workspace.name"
      :style="props.groupColorStyle(workspace.color)"
      @click="$emit('workspaceClick', workspace.id)"
      @dragover="$emit('workspaceDragover', workspace, $event)"
      @dragleave="$emit('workspaceDragleave', props.workspaceNavKey(workspace.id))"
      @drop="$emit('workspaceDrop', workspace, $event)"
    >
      <span class="color-dot" aria-hidden="true"></span>
      <span>{{ workspace.name }}</span>
      <span class="workspace-nav-count">{{ props.workspaceOpenPageCount(workspace) }}</span>
    </button>
    <button
      class="workspace-nav-item temp-nav-item"
      :class="{ active: props.dragOverKey === props.tempNavKey() }"
      type="button"
      :title="props.tempLabel"
      @click="$emit('tempClick')"
      @dragover="$emit('tempDragover', $event)"
      @dragleave="$emit('tempDragleave', props.tempNavKey())"
      @drop="$emit('tempDrop', $event)"
    >
      <span class="color-dot" aria-hidden="true"></span>
      <span>{{ props.tempLabel }}</span>
      <span class="workspace-nav-count">{{ props.tempCount }}</span>
    </button>
  </nav>
</template>
