<script setup lang="ts">
import { File, Pencil, Ungroup, X } from "@lucide/vue";
import type { PageModel } from "../../models/page.model";
import type { TabGroupColor, UnmanagedGroupView } from "../../models/workspace.model";

type UnmanagedItem =
  | {
      type: "page";
      id: string;
      order: number;
      page: PageModel;
    }
  | {
      type: "group";
      id: number;
      order: number;
      group: UnmanagedGroupView;
    };

defineProps<{
  items: UnmanagedItem[];
  dragOverKey: string;
  draggedPageId: string | null;
  draggedUnmanagedGroupId: number | null;
  editingGroupId: number | null;
  openColorPickerGroupId: string | null;
  groupColors: TabGroupColor[];
  labels: {
    empty: string;
    closePage: string;
    groupColor: string;
    groupTitle: string;
    ungroup: string;
  };
  groupColorStyle: (color: TabGroupColor) => Record<string, string>;
  pageTitle: (page: PageModel) => string;
  pageFavicon: (page: PageModel) => string;
  unmanagedTopGapKey: (index: number) => string;
  unmanagedGroupPageGapKey: (groupId: number, index: number) => string;
  unmanagedGroupColorPickerId: (groupId: number) => string;
}>();

defineEmits<{
  setSectionElement: [element: unknown];
  topGapDragover: [index: number, event: DragEvent];
  topGapDragleave: [key: string];
  topGapDrop: [index: number, event: DragEvent];
  topItemDragover: [index: number, event: DragEvent];
  topItemDrop: [index: number, event: DragEvent];
  pageDragstart: [page: PageModel, event: DragEvent];
  groupDragstart: [group: UnmanagedGroupView, event: DragEvent];
  dragend: [];
  openPage: [page: PageModel];
  closePage: [page: PageModel];
  toggleColorPicker: [pickerId: string];
  updateGroupColor: [group: UnmanagedGroupView, color: TabGroupColor];
  updateGroupTitle: [group: UnmanagedGroupView, event: Event];
  editGroupTitle: [group: UnmanagedGroupView];
  ungroupGroup: [group: UnmanagedGroupView];
  groupPageGapDragover: [group: UnmanagedGroupView, index: number, event: DragEvent];
  groupPageGapDragleave: [key: string];
  groupPageGapDrop: [group: UnmanagedGroupView, index: number, event: DragEvent];
  groupPageItemDragover: [group: UnmanagedGroupView, index: number, event: DragEvent];
  groupPageItemDrop: [group: UnmanagedGroupView, index: number, event: DragEvent];
}>();
</script>

<template>
  <section
    class="unmanaged-section"
    :ref="(element) => $emit('setSectionElement', element)"
  >
    <ol class="tabs">
      <li
        v-if="items.length === 0"
        class="empty-workspace-drop unmanaged-empty-drop"
        :class="{ active: dragOverKey === unmanagedTopGapKey(0) }"
        @dragover="$emit('topGapDragover', 0, $event)"
        @dragleave="$emit('topGapDragleave', unmanagedTopGapKey(0))"
        @drop="$emit('topGapDrop', 0, $event)"
      >
        {{ labels.empty }}
      </li>
      <template v-for="(item, itemIndex) in items" :key="`${item.type}:${item.id}`">
        <li
          class="tab-drop-gap"
          :class="{ active: dragOverKey === unmanagedTopGapKey(itemIndex) }"
          @dragover="$emit('topGapDragover', itemIndex, $event)"
          @dragleave="$emit('topGapDragleave', unmanagedTopGapKey(itemIndex))"
          @drop="$emit('topGapDrop', itemIndex, $event)"
        ></li>
        <li
          v-if="item.type === 'page'"
          class="tab"
          :class="{
            active: item.page.active,
            dragging: draggedPageId === item.page.id,
          }"
          draggable="true"
          @dragover="$emit('topItemDragover', itemIndex, $event)"
          @drop="$emit('topItemDrop', itemIndex, $event)"
          @dragstart="$emit('pageDragstart', item.page, $event)"
          @dragend="$emit('dragend')"
        >
          <span class="tab-favicon" aria-hidden="true">
            <img v-if="pageFavicon(item.page)" :src="pageFavicon(item.page)" alt="">
            <File v-else :size="16" />
          </span>
          <button
            class="tab-title-button"
            type="button"
            :title="pageTitle(item.page)"
            @click="$emit('openPage', item.page)"
          >
            <span class="tab-title">{{ pageTitle(item.page) }}</span>
          </button>
          <div class="tab-actions">
            <button
              class="icon-button subtle"
              type="button"
              :title="labels.closePage"
              :aria-label="labels.closePage"
              @click.stop="$emit('closePage', item.page)"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
        </li>

        <li
          v-else
          class="unmanaged-group"
          :class="{ dragging: draggedUnmanagedGroupId === item.group.id }"
          :style="groupColorStyle(item.group.color)"
          draggable="true"
          @dragover="$emit('topItemDragover', itemIndex, $event)"
          @drop="$emit('topItemDrop', itemIndex, $event)"
          @dragstart="$emit('groupDragstart', item.group, $event)"
          @dragend="$emit('dragend')"
        >
          <div class="unmanaged-group-title">
            <div class="group-color-picker" :style="groupColorStyle(item.group.color)">
              <button
                class="color-picker-trigger"
                type="button"
                :title="labels.groupColor"
                :aria-label="labels.groupColor"
                :aria-expanded="openColorPickerGroupId === unmanagedGroupColorPickerId(item.group.id)"
                @click.stop="$emit('toggleColorPicker', unmanagedGroupColorPickerId(item.group.id))"
              >
                <span class="color-dot" aria-hidden="true"></span>
              </button>
              <div
                v-if="openColorPickerGroupId === unmanagedGroupColorPickerId(item.group.id)"
                class="color-picker-popover"
                role="menu"
                :aria-label="labels.groupColor"
                @click.stop
              >
                <button
                  v-for="color in groupColors"
                  :key="color"
                  class="color-option"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="item.group.color === color"
                  :title="color"
                  :style="groupColorStyle(color)"
                  @click="$emit('updateGroupColor', item.group, color)"
                >
                  <span class="color-dot" aria-hidden="true"></span>
                </button>
              </div>
            </div>
            <input
              v-if="editingGroupId === item.group.id"
              class="unmanaged-group-title-input"
              :value="item.group.title"
              :aria-label="labels.groupTitle"
              autofocus
              @blur="$emit('updateGroupTitle', item.group, $event)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <div v-else class="editable-title-wrap unmanaged-group-title-wrap">
              <h2 class="unmanaged-group-title-text">{{ item.group.title }}</h2>
              <button
                class="inline-icon-button edit-inline-button"
                type="button"
                :title="labels.groupTitle"
                :aria-label="labels.groupTitle"
                @click.stop="$emit('editGroupTitle', item.group)"
              >
                <Pencil :size="13" aria-hidden="true" />
              </button>
              <button
                class="inline-icon-button edit-inline-button"
                type="button"
                :title="labels.ungroup"
                :aria-label="labels.ungroup"
                @click.stop="$emit('ungroupGroup', item.group)"
              >
                <Ungroup :size="13" aria-hidden="true" />
              </button>
            </div>
          </div>
          <ol class="tabs">
            <li
              class="tab-drop-gap"
              :class="{ active: dragOverKey === unmanagedGroupPageGapKey(item.group.id, 0) }"
              @dragover="$emit('groupPageGapDragover', item.group, 0, $event)"
              @dragleave="$emit('groupPageGapDragleave', unmanagedGroupPageGapKey(item.group.id, 0))"
              @drop="$emit('groupPageGapDrop', item.group, 0, $event)"
            ></li>
            <template v-for="(page, pageIndex) in item.group.pages" :key="page.id">
              <li
                v-if="pageIndex > 0"
                class="tab-drop-gap"
                :class="{ active: dragOverKey === unmanagedGroupPageGapKey(item.group.id, pageIndex) }"
                @dragover="$emit('groupPageGapDragover', item.group, pageIndex, $event)"
                @dragleave="$emit('groupPageGapDragleave', unmanagedGroupPageGapKey(item.group.id, pageIndex))"
                @drop="$emit('groupPageGapDrop', item.group, pageIndex, $event)"
              ></li>
              <li
                class="tab"
                :class="{
                  active: page.active,
                  dragging: draggedPageId === page.id,
                }"
                draggable="true"
                @dragover="$emit('groupPageItemDragover', item.group, pageIndex, $event)"
                @drop="$emit('groupPageItemDrop', item.group, pageIndex, $event)"
                @dragstart="$emit('pageDragstart', page, $event)"
                @dragend="$emit('dragend')"
              >
                <span class="tab-favicon" aria-hidden="true">
                  <img v-if="pageFavicon(page)" :src="pageFavicon(page)" alt="">
                  <File v-else :size="16" />
                </span>
                <button
                  class="tab-title-button"
                  type="button"
                  :title="pageTitle(page)"
                  @click="$emit('openPage', page)"
                >
                  <span class="tab-title">{{ pageTitle(page) }}</span>
                </button>
                <div class="tab-actions">
                  <button
                    class="icon-button subtle"
                    type="button"
                    :title="labels.closePage"
                    :aria-label="labels.closePage"
                    @click.stop="$emit('closePage', page)"
                  >
                    <X :size="16" aria-hidden="true" />
                  </button>
                </div>
              </li>
            </template>
            <li
              class="tab-drop-gap"
              :class="{ active: dragOverKey === unmanagedGroupPageGapKey(item.group.id, item.group.pages.length) }"
              @dragover="$emit('groupPageGapDragover', item.group, item.group.pages.length, $event)"
              @dragleave="$emit('groupPageGapDragleave', unmanagedGroupPageGapKey(item.group.id, item.group.pages.length))"
              @drop="$emit('groupPageGapDrop', item.group, item.group.pages.length, $event)"
            ></li>
          </ol>
        </li>
      </template>
      <li
        class="tab-drop-gap"
        :class="{ active: dragOverKey === unmanagedTopGapKey(items.length) }"
        @dragover="$emit('topGapDragover', items.length, $event)"
        @dragleave="$emit('topGapDragleave', unmanagedTopGapKey(items.length))"
        @drop="$emit('topGapDrop', items.length, $event)"
      ></li>
    </ol>
  </section>
</template>
