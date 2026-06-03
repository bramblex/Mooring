<script setup lang="ts">
import {
  Circle,
  Eye,
  EyeOff,
  File,
  Pencil,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import type { PageModel } from "../../models/page.model";
import type { TabGroupColor, WorkspaceView } from "../../models/workspace.model";

const props = defineProps<{
  workspace: WorkspaceView;
  workspaceIndex: number;
  groupColors: TabGroupColor[];
  dragOverKey: string;
  draggedWorkspaceId: string | null;
  draggedPageId: string | null;
  editingWorkspaceId: string | null;
  editingBookmarkId: string | null;
  openColorPickerGroupId: string | null;
  labels: {
    doubleClickToggleWorkspace: string;
    groupColor: string;
    groupTitle: string;
    showWorkspace: string;
    hideWorkspace: string;
    deleteWorkspace: string;
    closeWorkspacePages: string;
    emptyWorkspaceDrop: string;
    bookmarkTitle: string;
    restorePinnedPage: string;
    unpinPage: string;
    pinPage: string;
    closePage: string;
  };
  groupColorStyle: (color: TabGroupColor) => Record<string, string>;
  workspaceGapKey: (index: number) => string;
  pageGapKey: (workspaceId: string, index: number) => string;
  pageTitle: (page: PageModel) => string;
  pageSubtitle: (page: PageModel) => string;
  pageFavicon: (page: PageModel) => string;
  isEditingWorkspace: (workspace: WorkspaceView) => boolean;
  isEditingPage: (page: PageModel) => boolean;
}>();

defineEmits<{
  workspaceGapDragover: [index: number, event: DragEvent];
  workspaceGapDragleave: [key: string];
  workspaceGapDrop: [index: number, event: DragEvent];
  setWorkspaceElement: [workspaceId: string, element: unknown];
  workspaceSectionDragover: [index: number, event: DragEvent];
  workspaceSectionDrop: [index: number, event: DragEvent];
  workspaceDragstart: [workspace: WorkspaceView, event: DragEvent];
  dragend: [];
  toggleWorkspaceFromHeader: [workspace: WorkspaceView, event: MouseEvent];
  toggleColorPicker: [workspaceId: string];
  updateWorkspaceColor: [workspace: WorkspaceView, color: TabGroupColor];
  setWorkspaceTitleInput: [workspaceId: string, element: unknown];
  updateWorkspaceTitle: [workspace: WorkspaceView, event: Event];
  editWorkspaceTitle: [workspace: WorkspaceView];
  toggleWorkspace: [workspace: WorkspaceView];
  deleteWorkspace: [workspace: WorkspaceView];
  closeWorkspacePages: [workspace: WorkspaceView];
  pageGapDragover: [workspaceId: string, index: number, event: DragEvent];
  pageGapDragleave: [key: string];
  pageGapDrop: [workspaceId: string, index: number, event: DragEvent];
  pageItemDragover: [workspaceId: string, index: number, event: DragEvent];
  pageItemDrop: [workspaceId: string, index: number, event: DragEvent];
  pageDragstart: [page: PageModel, event: DragEvent];
  openWorkspacePage: [workspace: WorkspaceView, page: PageModel];
  setPageTitleInput: [bookmarkId: string, element: unknown];
  updatePinnedPageTitle: [page: PageModel, event: Event];
  stopInputDrag: [event: DragEvent];
  restorePinnedPage: [page: PageModel];
  editPinnedPageTitle: [page: PageModel];
  togglePinnedPage: [workspace: WorkspaceView, page: PageModel];
  closeWorkspacePage: [page: PageModel];
}>();

function workspaceOpenPageCount(workspace: WorkspaceView) {
  return workspace.pages.filter((page) => page.open).length;
}
</script>

<template>
  <div
    class="workspace-drop-gap"
    :class="{ active: props.dragOverKey === props.workspaceGapKey(props.workspaceIndex) }"
    @dragover="$emit('workspaceGapDragover', props.workspaceIndex, $event)"
    @dragleave="$emit('workspaceGapDragleave', props.workspaceGapKey(props.workspaceIndex))"
    @drop="$emit('workspaceGapDrop', props.workspaceIndex, $event)"
  ></div>
  <section
    class="group-section"
    :ref="(element) => $emit('setWorkspaceElement', props.workspace.id, element)"
    :class="{
      collapsed: props.workspace.collapsed,
      dragging: props.draggedWorkspaceId === props.workspace.id,
    }"
    :style="props.groupColorStyle(props.workspace.color)"
    @dragover="$emit('workspaceSectionDragover', props.workspaceIndex, $event)"
    @drop="$emit('workspaceSectionDrop', props.workspaceIndex, $event)"
  >
    <div
      class="group-header"
      :title="props.labels.doubleClickToggleWorkspace"
      :draggable="!props.isEditingWorkspace(props.workspace)"
      @dragstart="$emit('workspaceDragstart', props.workspace, $event)"
      @dragend="$emit('dragend')"
      @dblclick="$emit('toggleWorkspaceFromHeader', props.workspace, $event)"
    >
      <div class="group-main">
        <div class="group-color-picker" :style="props.groupColorStyle(props.workspace.color)">
          <button
            class="color-picker-trigger"
            type="button"
            :title="props.labels.groupColor"
            :aria-label="props.labels.groupColor"
            :aria-expanded="props.openColorPickerGroupId === props.workspace.id"
            @click.stop="$emit('toggleColorPicker', props.workspace.id)"
          >
            <span class="color-dot" aria-hidden="true"></span>
          </button>
          <div
            v-if="props.openColorPickerGroupId === props.workspace.id"
            class="color-picker-popover"
            role="menu"
            :aria-label="props.labels.groupColor"
            @click.stop
          >
            <button
              v-for="color in props.groupColors"
              :key="color"
              class="color-option"
              type="button"
              role="menuitemradio"
              :aria-checked="props.workspace.color === color"
              :title="color"
              :style="props.groupColorStyle(color)"
              @click="$emit('updateWorkspaceColor', props.workspace, color)"
            >
              <span class="color-dot" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <input
          v-if="props.editingWorkspaceId === props.workspace.id"
          :ref="(element) => $emit('setWorkspaceTitleInput', props.workspace.id, element)"
          class="group-title"
          :value="props.workspace.name"
          :aria-label="props.labels.groupTitle"
          @blur="$emit('updateWorkspaceTitle', props.workspace, $event)"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        >
        <div v-else class="editable-title-wrap">
          <h2 class="group-title-text">{{ props.workspace.name }}</h2>
          <span
            v-if="workspaceOpenPageCount(props.workspace) > 0"
            class="group-title-count"
          >
            {{ workspaceOpenPageCount(props.workspace) }}
          </span>
          <button
            class="inline-icon-button edit-inline-button"
            type="button"
            :title="props.labels.groupTitle"
            :aria-label="props.labels.groupTitle"
            @click.stop="$emit('editWorkspaceTitle', props.workspace)"
          >
            <Pencil :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="group-actions">
        <button
          class="icon-button ghost"
          type="button"
          :title="props.workspace.collapsed ? props.labels.showWorkspace : props.labels.hideWorkspace"
          :aria-label="props.workspace.collapsed ? props.labels.showWorkspace : props.labels.hideWorkspace"
          @click="$emit('toggleWorkspace', props.workspace)"
        >
          <Eye v-if="props.workspace.collapsed" :size="17" aria-hidden="true" />
          <EyeOff v-else :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button ghost danger"
          type="button"
          :title="props.labels.deleteWorkspace"
          :aria-label="props.labels.deleteWorkspace"
          @click="$emit('deleteWorkspace', props.workspace)"
        >
          <Trash2 :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button ghost"
          type="button"
          :title="props.labels.closeWorkspacePages"
          :aria-label="props.labels.closeWorkspacePages"
          @click="$emit('closeWorkspacePages', props.workspace)"
        >
          <X :size="17" aria-hidden="true" />
        </button>
      </div>
    </div>

    <ol v-if="!props.workspace.collapsed" class="tabs">
      <li
        v-if="props.workspace.pages.length === 0"
        class="empty-workspace-drop"
        :class="{ active: props.dragOverKey === props.pageGapKey(props.workspace.id, 0) }"
        @dragover="$emit('pageGapDragover', props.workspace.id, 0, $event)"
        @dragleave="$emit('pageGapDragleave', props.pageGapKey(props.workspace.id, 0))"
        @drop="$emit('pageGapDrop', props.workspace.id, 0, $event)"
      >
        {{ props.labels.emptyWorkspaceDrop }}
      </li>
      <template v-for="(page, pageIndex) in props.workspace.pages" :key="page.id">
        <li
          class="tab-drop-gap"
          :class="{ active: props.dragOverKey === props.pageGapKey(props.workspace.id, pageIndex) }"
          @dragover="$emit('pageGapDragover', props.workspace.id, pageIndex, $event)"
          @dragleave="$emit('pageGapDragleave', props.pageGapKey(props.workspace.id, pageIndex))"
          @drop="$emit('pageGapDrop', props.workspace.id, pageIndex, $event)"
        ></li>
        <li
          class="tab"
          :class="{
            active: page.active,
            dragging: props.draggedPageId === page.id,
            'closed-tab': !page.open,
            'pinned-tab': page.pinned,
          }"
          :draggable="!props.isEditingPage(page)"
          @dragover="$emit('pageItemDragover', props.workspace.id, pageIndex, $event)"
          @drop="$emit('pageItemDrop', props.workspace.id, pageIndex, $event)"
          @dragstart="$emit('pageDragstart', page, $event)"
          @dragend="$emit('dragend')"
        >
          <button
            class="tab-favicon"
            type="button"
            :title="props.pageTitle(page)"
            :aria-label="props.pageTitle(page)"
            @click="$emit('openWorkspacePage', props.workspace, page)"
          >
            <img v-if="props.pageFavicon(page)" :src="props.pageFavicon(page)" alt="">
            <File v-else :size="16" />
          </button>
          <input
            v-if="page.pinned && props.editingBookmarkId === page.bookmarkId"
            :ref="(element) => { if (page.bookmarkId) $emit('setPageTitleInput', page.bookmarkId, element); }"
            class="tab-title-input"
            :value="props.pageTitle(page)"
            :title="props.pageTitle(page)"
            :aria-label="props.labels.bookmarkTitle"
            draggable="false"
            @blur="$emit('updatePinnedPageTitle', page, $event)"
            @dragstart="$emit('stopInputDrag', $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <button
            v-else-if="!page.pinned"
            class="tab-title-button"
            type="button"
            :title="props.pageTitle(page)"
            @click="$emit('openWorkspacePage', props.workspace, page)"
          >
            <span class="tab-title">
              {{ props.pageTitle(page) }}
              <span v-if="props.pageSubtitle(page)" class="tab-subtitle">
                · {{ props.pageSubtitle(page) }}
              </span>
            </span>
          </button>
          <div
            v-else
            class="tab-title-static"
            :title="props.pageTitle(page)"
            @click="$emit('openWorkspacePage', props.workspace, page)"
          >
            <button
              v-if="page.dirty"
              class="dirty-button"
              type="button"
              :title="props.labels.restorePinnedPage"
              :aria-label="props.labels.restorePinnedPage"
              @click.stop="$emit('restorePinnedPage', page)"
            >
              <Circle class="dirty-dot" :size="8" aria-hidden="true" />
            </button>
            <button
              class="tab-title-button"
              type="button"
              :title="props.pageTitle(page)"
            >
              <span class="tab-title">
                {{ props.pageTitle(page) }}
                <span v-if="props.pageSubtitle(page)" class="tab-subtitle">
                  · {{ props.pageSubtitle(page) }}
                </span>
              </span>
            </button>
            <button
              class="inline-icon-button edit-inline-button"
              type="button"
              :title="props.labels.bookmarkTitle"
              :aria-label="props.labels.bookmarkTitle"
              @click.stop="$emit('editPinnedPageTitle', page)"
            >
              <Pencil :size="13" aria-hidden="true" />
            </button>
          </div>
          <div class="tab-actions">
            <button
              class="icon-button subtle"
              type="button"
              :class="{ active: page.pinned }"
              :title="page.pinned ? props.labels.unpinPage : props.labels.pinPage"
              :aria-label="page.pinned ? props.labels.unpinPage : props.labels.pinPage"
              @click.stop="$emit('togglePinnedPage', props.workspace, page)"
            >
              <Star :size="16" aria-hidden="true" />
            </button>
            <button
              v-if="page.open"
              class="icon-button subtle"
              type="button"
              :title="props.labels.closePage"
              :aria-label="props.labels.closePage"
              @click.stop="$emit('closeWorkspacePage', page)"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
        </li>
      </template>
      <li
        class="tab-drop-gap"
        :class="{ active: props.dragOverKey === props.pageGapKey(props.workspace.id, props.workspace.pages.length) }"
        @dragover="$emit('pageGapDragover', props.workspace.id, props.workspace.pages.length, $event)"
        @dragleave="$emit('pageGapDragleave', props.pageGapKey(props.workspace.id, props.workspace.pages.length))"
        @drop="$emit('pageGapDrop', props.workspace.id, props.workspace.pages.length, $event)"
      ></li>
    </ol>
  </section>
</template>
