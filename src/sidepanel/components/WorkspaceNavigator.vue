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
  workspaceNavGapKey: (index: number) => string;
  tempNavKey: () => string;
  workspaceOpenPageCount: (workspace: WorkspaceView) => number;
}>();

defineEmits<{
  workspaceClick: [workspaceId: string];
  workspaceDragstart: [workspace: WorkspaceView, event: DragEvent];
  dragend: [];
  workspaceNavGapDragover: [index: number, event: DragEvent];
  workspaceNavGapDragleave: [key: string];
  workspaceNavGapDrop: [index: number, event: DragEvent];
  workspaceDragover: [workspace: WorkspaceView, index: number, event: DragEvent];
  workspaceDragleave: [key: string];
  workspaceDrop: [workspace: WorkspaceView, index: number, event: DragEvent];
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
    <template v-for="(workspace, workspaceIndex) in props.workspaces" :key="workspace.id">
      <span
        class="workspace-nav-drop-gap"
        :class="{ active: props.dragOverKey === props.workspaceNavGapKey(workspaceIndex) }"
        aria-hidden="true"
        @dragover="$emit('workspaceNavGapDragover', workspaceIndex, $event)"
        @dragleave="$emit('workspaceNavGapDragleave', props.workspaceNavGapKey(workspaceIndex))"
        @drop="$emit('workspaceNavGapDrop', workspaceIndex, $event)"
      ></span>
      <button
        class="workspace-nav-item"
        :class="{ active: props.dragOverKey === props.workspaceNavKey(workspace.id) }"
        type="button"
        :title="workspace.name"
        :style="props.groupColorStyle(workspace.color)"
        draggable="true"
        @click="$emit('workspaceClick', workspace.id)"
        @dragstart="$emit('workspaceDragstart', workspace, $event)"
        @dragend="$emit('dragend')"
        @dragover="$emit('workspaceDragover', workspace, workspaceIndex, $event)"
        @dragleave="
          $emit('workspaceDragleave', props.workspaceNavKey(workspace.id));
          $emit('workspaceNavGapDragleave', props.workspaceNavGapKey(workspaceIndex));
          $emit('workspaceNavGapDragleave', props.workspaceNavGapKey(workspaceIndex + 1));
        "
        @drop="$emit('workspaceDrop', workspace, workspaceIndex, $event)"
      >
        <span class="color-dot" aria-hidden="true"></span>
        <span>{{ workspace.name }}</span>
        <span class="workspace-nav-count">{{ props.workspaceOpenPageCount(workspace) }}</span>
      </button>
    </template>
    <span
      class="workspace-nav-drop-gap"
      :class="{ active: props.dragOverKey === props.workspaceNavGapKey(props.workspaces.length) }"
      aria-hidden="true"
      @dragover="$emit('workspaceNavGapDragover', props.workspaces.length, $event)"
      @dragleave="$emit('workspaceNavGapDragleave', props.workspaceNavGapKey(props.workspaces.length))"
      @drop="$emit('workspaceNavGapDrop', props.workspaces.length, $event)"
    ></span>
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
