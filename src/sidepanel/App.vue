<script setup lang="ts">
import {
  Circle,
  Eye,
  EyeOff,
  File,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "../i18n";
import type { PageModel } from "../models/page.model";
import type { WindowContext } from "../models/window.model";
import type {
  TabGroupColor,
  WorkspaceState,
  WorkspaceView,
} from "../models/workspace.model";

const GROUP_COLORS: TabGroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

const GROUP_COLOR_STYLES: Record<TabGroupColor, Record<string, string>> = {
  grey: {
    "--group-color": "#5f6368",
    "--group-bg": "#f1f3f4",
    "--group-bg-dark": "#2f3337",
  },
  blue: {
    "--group-color": "#1a73e8",
    "--group-bg": "#e8f0fe",
    "--group-bg-dark": "#1f2f46",
  },
  red: {
    "--group-color": "#d93025",
    "--group-bg": "#fce8e6",
    "--group-bg-dark": "#442522",
  },
  yellow: {
    "--group-color": "#f9ab00",
    "--group-bg": "#fef7e0",
    "--group-bg-dark": "#443416",
  },
  green: {
    "--group-color": "#188038",
    "--group-bg": "#e6f4ea",
    "--group-bg-dark": "#1d3b28",
  },
  pink: {
    "--group-color": "#d01884",
    "--group-bg": "#fde7f3",
    "--group-bg-dark": "#46263a",
  },
  purple: {
    "--group-color": "#9334e6",
    "--group-bg": "#f3e8fd",
    "--group-bg-dark": "#362548",
  },
  cyan: {
    "--group-color": "#007b83",
    "--group-bg": "#e4f7fb",
    "--group-bg-dark": "#173d42",
  },
  orange: {
    "--group-color": "#fa7b17",
    "--group-bg": "#feefe3",
    "--group-bg-dark": "#4a2e1a",
  },
};

const workspaceState = ref<WorkspaceState>({
  workspaces: [],
  unmanagedPages: [],
  unmanagedGroups: [],
});
const draggedPageId = ref<string | null>(null);
const draggedPagePinned = ref(false);
const draggedWorkspaceId = ref<string | null>(null);
const dragOverKey = ref("");
const openColorPickerGroupId = ref<string | null>(null);
const editingBookmarkId = ref<string | null>(null);
const windowContext = ref<WindowContext | null>(null);
const currentWindowId = ref<number | undefined>();
const { t } = useI18n();

const isPrimaryWindow = computed(() => windowContext.value?.role === "primary");
const isWindowContextReady = computed(() => Boolean(windowContext.value));
const workspaces = computed(() =>
  [...workspaceState.value.workspaces].sort((a, b) => a.order - b.order),
);
const allPages = computed(() => [
  ...workspaceState.value.unmanagedPages,
  ...workspaceState.value.unmanagedGroups.flatMap((group) => group.pages),
  ...workspaceState.value.workspaces.flatMap((workspace) => workspace.pages),
]);

function pageTitle(page: PageModel) {
  return page.title || page.url || t("untitledPage");
}

function pageSubtitle(page: PageModel) {
  return page.dirty ? page.currentTitle || page.url || "" : "";
}

function findPage(pageId: string | null) {
  if (!pageId) return undefined;

  return allPages.value.find((page) => page.id === pageId);
}

function pageFavicon(page: PageModel) {
  return page.favIconUrl || "";
}

function groupColorStyle(color: TabGroupColor) {
  return GROUP_COLOR_STYLES[color];
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

async function sendMessage<T>(message: Record<string, unknown>) {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function refreshTabs() {
  if (!isPrimaryWindow.value || currentWindowId.value === undefined) return;

  workspaceState.value = await sendMessage<WorkspaceState>({
    type: "GET_WORKSPACE_STATE",
    windowId: currentWindowId.value,
  });
}

async function refreshWindowContext() {
  const currentWindow = await chrome.windows.getCurrent();
  currentWindowId.value = currentWindow.id;
  windowContext.value = await chrome.runtime.sendMessage({
    type: "GET_WINDOW_CONTEXT",
    windowId: currentWindow.id,
  });
}

async function refreshAll() {
  await refreshWindowContext();
  await refreshTabs();
}

async function openMainWindowFromPanel() {
  await chrome.runtime.sendMessage({
    type: "OPEN_MAIN_WINDOW",
  });
  await refreshAll();
}

async function sendCurrentTabFromPanel() {
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage({
    type: "SEND_CURRENT_TAB_TO_MAIN_WINDOW",
    windowId: currentWindow.id,
  });
  await refreshAll();
}

async function sendAllTabsFromPanel() {
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage({
    type: "SEND_ALL_TABS_TO_MAIN_WINDOW",
    windowId: currentWindow.id,
  });
  await refreshAll();
}

async function createWorkspace() {
  if (currentWindowId.value === undefined) return;

  await sendMessage({ type: "CREATE_WORKSPACE", windowId: currentWindowId.value });
  await refreshTabs();
}

async function openWorkspacePage(workspace: WorkspaceView | null, page: PageModel) {
  if (!workspace || currentWindowId.value === undefined) {
    if (page.chromeTabId) await chrome.tabs.update(page.chromeTabId, { active: true });
    return;
  }

  await sendMessage({
    type: "OPEN_WORKSPACE_PAGE",
    workspaceId: workspace.id,
    pageId: page.id,
    chromeTabId: page.chromeTabId,
    windowId: currentWindowId.value,
  });
  await refreshTabs();
}

async function updateWorkspaceTitle(workspace: WorkspaceView, event: Event) {
  const target = event.target as HTMLInputElement;

  await sendMessage({
    type: "RENAME_WORKSPACE",
    workspaceId: workspace.id,
    name: target.value.trim() || t("untitledGroup"),
  });
  await refreshTabs();
}

async function updateWorkspaceColor(workspace: WorkspaceView, color: TabGroupColor) {
  await sendMessage({
    type: "UPDATE_WORKSPACE_COLOR",
    workspaceId: workspace.id,
    color,
  });
  openColorPickerGroupId.value = null;
  await refreshTabs();
}

async function toggleWorkspace(workspace: WorkspaceView) {
  await sendMessage({
    type: "TOGGLE_WORKSPACE",
    workspaceId: workspace.id,
  });
  await refreshTabs();
}

async function deleteWorkspace(workspace: WorkspaceView) {
  if (!window.confirm(t("deleteWorkspaceConfirm"))) return;

  await sendMessage({
    type: "DELETE_WORKSPACE",
    workspaceId: workspace.id,
  });
  await refreshTabs();
}

async function togglePinnedPage(workspace: WorkspaceView | null, page: PageModel) {
  if (page.pinned) {
    if (!window.confirm(t("unpinPageConfirm"))) return;

    await sendMessage({
      type: "UNPIN_PAGE",
      chromeTabId: page.chromeTabId,
      bookmarkId: page.bookmarkId,
    });
    await refreshTabs();
    return;
  }

  if (!workspace || !page.chromeTabId) return;

  await sendMessage({
    type: "PIN_PAGE",
    workspaceId: workspace.id,
    chromeTabId: page.chromeTabId,
  });
  await refreshTabs();
}

async function updatePinnedPageTitle(page: PageModel, event: Event) {
  if (!page.bookmarkId) return;

  const target = event.target as HTMLInputElement;
  await sendMessage({
    type: "UPDATE_PINNED_PAGE_TITLE",
    bookmarkId: page.bookmarkId,
    title: target.value.trim() || t("untitledPage"),
  });
  editingBookmarkId.value = null;
  await refreshTabs();
}

function editPinnedPageTitle(page: PageModel) {
  if (!page.bookmarkId) return;

  editingBookmarkId.value = page.bookmarkId;
}

async function closeWorkspacePage(page: PageModel) {
  if (!page.chromeTabId) return;

  await sendMessage({
    type: "CLOSE_WORKSPACE_PAGE",
    chromeTabId: page.chromeTabId,
  });
  await refreshTabs();
}

async function restorePinnedPage(page: PageModel) {
  if (!page.bookmarkId) return;

  await sendMessage({
    type: "RESTORE_PINNED_PAGE",
    bookmarkId: page.bookmarkId,
    chromeTabId: page.chromeTabId,
  });
  await refreshTabs();
}

async function importUnmanagedGroup(groupId: number) {
  await sendMessage({
    type: "IMPORT_UNMANAGED_GROUP",
    groupId,
  });
  await refreshTabs();
}

function onPageDragStart(page: PageModel, event: DragEvent) {
  if (isEditableElement(event.target)) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedPageId.value = page.id;
  draggedPagePinned.value = page.pinned;
  draggedWorkspaceId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", page.id);
}

function onWorkspaceDragStart(workspace: WorkspaceView, event: DragEvent) {
  if (!event.dataTransfer) return;

  draggedWorkspaceId.value = workspace.id;
  draggedPageId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `workspace:${workspace.id}`);
}

function onDragOver(key: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOverKey.value = key;
}

function pageGapKey(workspaceId: string | null, index: number) {
  return `page-gap-${workspaceId || "unmanaged"}-${index}`;
}

function canDropPageInto(workspaceId: string | null) {
  if (draggedPageId.value === null || draggedWorkspaceId.value !== null) return false;

  // docs/page-model.md: Pinned Page 只能在 Workspace 之间移动；
  // 没有 bookmark 身份的 Temp Page 才能回到 unmanaged。
  return workspaceId !== null || !draggedPagePinned.value;
}

function isNoopPageDrop(workspaceId: string | null, index: number) {
  const draggedPage = findPage(draggedPageId.value);
  if (!draggedPage) return false;

  const currentIndex = workspaceId
    ? workspaceState.value.workspaces.find((workspace) => workspace.id === workspaceId)
      ?.pages.findIndex((page) => page.id === draggedPage.id)
    : workspaceState.value.unmanagedPages.findIndex((page) => page.id === draggedPage.id);

  return currentIndex !== undefined
    && currentIndex >= 0
    && (index === currentIndex || index === currentIndex + 1);
}

function canDropPageAt(workspaceId: string | null, index: number) {
  return canDropPageInto(workspaceId) && !isNoopPageDrop(workspaceId, index);
}

function onPageGapDragOver(workspaceId: string | null, index: number, event: DragEvent) {
  if (!canDropPageAt(workspaceId, index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(pageGapKey(workspaceId, index), event);
}

function pageDropIndexFromEvent(targetIndex: number, event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;

  return shouldInsertAfter ? targetIndex + 1 : targetIndex;
}

function onPageItemDragOver(workspaceId: string | null, targetIndex: number, event: DragEvent) {
  const index = pageDropIndexFromEvent(targetIndex, event);
  if (!canDropPageAt(workspaceId, index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(pageGapKey(workspaceId, index), event);
}

async function onPageItemDrop(workspaceId: string | null, targetIndex: number, event: DragEvent) {
  const index = pageDropIndexFromEvent(targetIndex, event);
  if (!canDropPageAt(workspaceId, index)) return;

  await onDrop(workspaceId, index, event);
}

function onDragLeave(key: string) {
  if (dragOverKey.value === key) {
    dragOverKey.value = "";
  }
}

async function onDrop(workspaceId: string | null, index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedPageId.value === null || currentWindowId.value === undefined) return;

  await sendMessage({
    type: "MOVE_WORKSPACE_PAGE",
    pageId: draggedPageId.value,
    workspaceId,
    index,
    windowId: currentWindowId.value,
  });
  onDragEnd();
  await refreshTabs();
}

async function onPageGapDrop(workspaceId: string | null, index: number, event: DragEvent) {
  if (!canDropPageInto(workspaceId)) return;

  await onDrop(workspaceId, index, event);
}

async function onWorkspaceDrop(targetWorkspace: WorkspaceView, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedWorkspaceId.value === null || draggedWorkspaceId.value === targetWorkspace.id) return;

  await sendMessage({
    type: "MOVE_WORKSPACE",
    sourceWorkspaceId: draggedWorkspaceId.value,
    targetWorkspaceId: targetWorkspace.id,
  });
  onDragEnd();
  await refreshTabs();
}

function onWorkspaceSectionDragOver(workspace: WorkspaceView, event: DragEvent) {
  if (draggedWorkspaceId.value === null) return;

  onDragOver(`workspace-${workspace.id}`, event);
}

async function onWorkspaceSectionDrop(workspace: WorkspaceView, event: DragEvent) {
  if (draggedWorkspaceId.value === null) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  await onWorkspaceDrop(workspace, event);
}

function onDragEnd() {
  draggedPageId.value = null;
  draggedPagePinned.value = false;
  draggedWorkspaceId.value = null;
  dragOverKey.value = "";
}

function toggleColorPicker(groupId: string) {
  openColorPickerGroupId.value = openColorPickerGroupId.value === groupId ? null : groupId;
}

function stopInputDrag(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function isEditingPage(page: PageModel) {
  return Boolean(page.bookmarkId && editingBookmarkId.value === page.bookmarkId);
}

onMounted(async () => {
  await refreshAll();

  document.addEventListener("contextmenu", (event) => {
    if (isEditableElement(event.target)) return;

    event.preventDefault();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (target instanceof HTMLElement && target.closest(".group-color-picker")) return;

    openColorPickerGroupId.value = null;
  });

  chrome.tabs.onCreated.addListener(refreshTabs);
  chrome.tabs.onUpdated.addListener(refreshTabs);
  chrome.tabs.onMoved.addListener(refreshTabs);
  chrome.tabs.onAttached.addListener(refreshTabs);
  chrome.tabs.onDetached.addListener(refreshTabs);
  chrome.tabs.onRemoved.addListener(refreshTabs);
  chrome.tabs.onActivated.addListener(refreshTabs);
  chrome.tabGroups.onCreated.addListener(refreshTabs);
  chrome.tabGroups.onUpdated.addListener(refreshTabs);
  chrome.tabGroups.onMoved.addListener(refreshTabs);
  chrome.tabGroups.onRemoved.addListener(refreshTabs);
  chrome.bookmarks.onCreated.addListener(refreshTabs);
  chrome.bookmarks.onChanged.addListener(refreshTabs);
  chrome.bookmarks.onMoved.addListener(refreshTabs);
  chrome.bookmarks.onRemoved.addListener(refreshTabs);
  chrome.bookmarks.onChildrenReordered.addListener(refreshTabs);
});
</script>

<template>
  <main v-if="!isWindowContextReady" class="panel">
    <header>
      <h1 class="brand-title">
        <img src="/logo.svg" alt="" class="brand-logo">
        {{ t("appName") }}
      </h1>
    </header>
  </main>

  <main v-else-if="!isPrimaryWindow" class="panel temporary-panel">
    <header>
      <h1 class="brand-title">
        <img src="/logo.svg" alt="" class="brand-logo">
        {{ t("appName") }}
      </h1>
    </header>

    <section class="temporary-actions" :aria-label="t('temporaryWindow')">
      <p>
        {{ t("temporaryWindowDescription") }}
      </p>
      <button
        type="button"
        :title="t('openMainWindow')"
        :aria-label="t('openMainWindow')"
        @click="openMainWindowFromPanel"
      >
        {{ t("openMainWindow") }}
      </button>
      <button
        type="button"
        :title="t('sendCurrentTabToMainWindow')"
        :aria-label="t('sendCurrentTabToMainWindow')"
        @click="sendCurrentTabFromPanel"
      >
        {{ t("sendCurrentTabToMainWindow") }}
      </button>
      <button
        type="button"
        :title="t('sendAllTabsToMainWindow')"
        :aria-label="t('sendAllTabsToMainWindow')"
        @click="sendAllTabsFromPanel"
      >
        {{ t("sendAllTabsToMainWindow") }}
      </button>
    </section>
  </main>

  <main v-else class="panel">
    <header>
      <h1 class="brand-title">
        <img src="/logo.svg" alt="" class="brand-logo">
        {{ t("appName") }}
      </h1>
      <div class="toolbar">
        <button
          class="icon-button"
          type="button"
          :title="t('newWorkspace')"
          :aria-label="t('newWorkspace')"
          @click="createWorkspace"
        >
          <Plus :size="18" aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          :title="t('refresh')"
          :aria-label="t('refresh')"
          @click="refreshTabs"
        >
          <RefreshCw :size="18" aria-hidden="true" />
        </button>
      </div>
    </header>

    <section class="groups" :aria-label="t('openTabs')">
      <!-- docs/product-logic.md: Mooring 管理的 Workspace 区域排在 Unmanaged 区域前面。 -->
      <section
        v-for="workspace in workspaces"
        :key="workspace.id"
        class="group-section"
        :class="{
          dragging: draggedWorkspaceId === workspace.id,
          'drag-over': dragOverKey === `workspace-${workspace.id}`,
        }"
        :style="groupColorStyle(workspace.color)"
        @dragover="onWorkspaceSectionDragOver(workspace, $event)"
        @dragleave="onDragLeave(`workspace-${workspace.id}`)"
        @drop="onWorkspaceSectionDrop(workspace, $event)"
      >
        <div class="group-header">
          <span
            class="group-drag-handle"
            draggable="true"
            :title="t('dragGroup')"
            :aria-label="t('dragGroup')"
            @dragstart="onWorkspaceDragStart(workspace, $event)"
            @dragend="onDragEnd"
          >
            <GripVertical :size="16" aria-hidden="true" />
          </span>
          <input
            class="group-title"
            :value="workspace.name"
            :aria-label="t('groupTitle')"
            @blur="updateWorkspaceTitle(workspace, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <div class="group-color-picker" :style="groupColorStyle(workspace.color)">
            <button
              class="color-picker-trigger"
              type="button"
              :title="t('groupColor')"
              :aria-label="t('groupColor')"
              :aria-expanded="openColorPickerGroupId === workspace.id"
              @click.stop="toggleColorPicker(workspace.id)"
            >
              <span class="color-dot" aria-hidden="true"></span>
            </button>
            <div
              v-if="openColorPickerGroupId === workspace.id"
              class="color-picker-popover"
              role="menu"
              :aria-label="t('groupColor')"
              @click.stop
            >
              <button
                v-for="color in GROUP_COLORS"
                :key="color"
                class="color-option"
                type="button"
                role="menuitemradio"
                :aria-checked="workspace.color === color"
                :title="color"
                :style="groupColorStyle(color)"
                @click="updateWorkspaceColor(workspace, color)"
              >
                <span class="color-dot" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <button
            class="icon-button"
            type="button"
            :title="workspace.collapsed ? t('showWorkspace') : t('hideWorkspace')"
            :aria-label="workspace.collapsed ? t('showWorkspace') : t('hideWorkspace')"
            @click="toggleWorkspace(workspace)"
          >
            <Eye v-if="workspace.collapsed" :size="17" aria-hidden="true" />
            <EyeOff v-else :size="17" aria-hidden="true" />
          </button>
          <button
            class="icon-button danger"
            type="button"
            :title="t('deleteWorkspace')"
            :aria-label="t('deleteWorkspace')"
            @click="deleteWorkspace(workspace)"
          >
            <Trash2 :size="17" aria-hidden="true" />
          </button>
        </div>

        <ol v-if="!workspace.collapsed" class="tabs">
          <template v-for="(page, pageIndex) in workspace.pages" :key="page.id">
            <li
              class="tab-drop-gap"
              :class="{ active: dragOverKey === pageGapKey(workspace.id, pageIndex) }"
              @dragover="onPageGapDragOver(workspace.id, pageIndex, $event)"
              @dragleave="onDragLeave(pageGapKey(workspace.id, pageIndex))"
              @drop="onPageGapDrop(workspace.id, pageIndex, $event)"
            ></li>
            <li
              class="tab"
              :class="{
                active: page.active,
                dragging: draggedPageId === page.id,
                'closed-tab': !page.open,
                'pinned-tab': page.pinned,
              }"
              :draggable="!isEditingPage(page)"
              @dragover="onPageItemDragOver(workspace.id, pageIndex, $event)"
              @drop="onPageItemDrop(workspace.id, pageIndex, $event)"
              @dragstart="onPageDragStart(page, $event)"
              @dragend="onDragEnd"
            >
            <button
              class="tab-favicon"
              type="button"
              :title="pageTitle(page)"
              :aria-label="pageTitle(page)"
              @click="openWorkspacePage(workspace, page)"
            >
              <img v-if="pageFavicon(page)" :src="pageFavicon(page)" alt="">
              <File v-else :size="16" />
            </button>
            <input
              v-if="page.pinned && editingBookmarkId === page.bookmarkId"
              class="tab-title-input"
              :value="pageTitle(page)"
              :title="pageTitle(page)"
              :aria-label="t('bookmarkTitle')"
              draggable="false"
              @blur="updatePinnedPageTitle(page, $event)"
              @dragstart="stopInputDrag"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <button
              v-else-if="!page.pinned"
              class="tab-title-button"
              type="button"
              :title="pageTitle(page)"
              @click="openWorkspacePage(workspace, page)"
            >
              <span class="tab-title">
                {{ pageTitle(page) }}
                <span v-if="pageSubtitle(page)" class="tab-subtitle">
                  · {{ pageSubtitle(page) }}
                </span>
              </span>
            </button>
            <div v-else class="tab-title-static" :title="pageTitle(page)">
              <button
                v-if="page.dirty"
                class="dirty-button"
                type="button"
                :title="t('restorePinnedPage')"
                :aria-label="t('restorePinnedPage')"
                @click.stop="restorePinnedPage(page)"
              >
                <Circle class="dirty-dot" :size="8" aria-hidden="true" />
              </button>
              <button
                class="tab-title-button"
                type="button"
                :title="pageTitle(page)"
                @click="openWorkspacePage(workspace, page)"
              >
                <span class="tab-title">
                  {{ pageTitle(page) }}
                  <span v-if="pageSubtitle(page)" class="tab-subtitle">
                    · {{ pageSubtitle(page) }}
                  </span>
                </span>
              </button>
              <button
                class="inline-icon-button"
                type="button"
                :title="t('bookmarkTitle')"
                :aria-label="t('bookmarkTitle')"
                @click.stop="editPinnedPageTitle(page)"
              >
                <Pencil :size="13" aria-hidden="true" />
              </button>
            </div>
            <div class="tab-actions">
              <button
                class="icon-button subtle"
                type="button"
                :class="{ active: page.pinned }"
                :title="page.pinned ? t('unpinPage') : t('pinPage')"
                :aria-label="page.pinned ? t('unpinPage') : t('pinPage')"
                @click.stop="togglePinnedPage(workspace, page)"
              >
                <Star :size="16" aria-hidden="true" />
              </button>
              <button
                v-if="page.open"
                class="icon-button subtle"
                type="button"
                :title="t('closePage')"
                :aria-label="t('closePage')"
                @click.stop="closeWorkspacePage(page)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
            </li>
          </template>
          <li
            class="tab-drop-gap"
            :class="{ active: dragOverKey === pageGapKey(workspace.id, workspace.pages.length) }"
            @dragover="onPageGapDragOver(workspace.id, workspace.pages.length, $event)"
            @dragleave="onDragLeave(pageGapKey(workspace.id, workspace.pages.length))"
            @drop="onPageGapDrop(workspace.id, workspace.pages.length, $event)"
          ></li>
        </ol>
      </section>

      <!-- docs/product-logic.md: Unmanaged 区域显示未被 Mooring 管理的 Chrome Tab 或 Chrome Group。 -->
      <section
        class="group-section ungrouped"
      >
        <div class="group-header">
          <h2>{{ t("unmanaged") }}</h2>
        </div>

        <ol class="tabs">
          <template v-for="(page, pageIndex) in workspaceState.unmanagedPages" :key="page.id">
            <li
              class="tab-drop-gap"
              :class="{ active: dragOverKey === pageGapKey(null, pageIndex) }"
              @dragover="onPageGapDragOver(null, pageIndex, $event)"
              @dragleave="onDragLeave(pageGapKey(null, pageIndex))"
              @drop="onPageGapDrop(null, pageIndex, $event)"
            ></li>
            <li
              class="tab"
              :class="{
                active: page.active,
                dragging: draggedPageId === page.id,
              }"
              draggable="true"
              @dragover="onPageItemDragOver(null, pageIndex, $event)"
              @drop="onPageItemDrop(null, pageIndex, $event)"
              @dragstart="onPageDragStart(page, $event)"
              @dragend="onDragEnd"
            >
            <span class="tab-favicon" aria-hidden="true">
              <img v-if="pageFavicon(page)" :src="pageFavicon(page)" alt="">
              <File v-else :size="16" />
            </span>
            <button
              class="tab-title-button"
              type="button"
              :title="pageTitle(page)"
              @click="openWorkspacePage(null, page)"
            >
              <span class="tab-title">{{ pageTitle(page) }}</span>
            </button>
            <div class="tab-actions">
              <button
                class="icon-button subtle"
                type="button"
                :title="t('closePage')"
                :aria-label="t('closePage')"
                @click.stop="closeWorkspacePage(page)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
            </li>
          </template>
          <li
            class="tab-drop-gap"
            :class="{ active: dragOverKey === pageGapKey(null, workspaceState.unmanagedPages.length) }"
            @dragover="onPageGapDragOver(null, workspaceState.unmanagedPages.length, $event)"
            @dragleave="onDragLeave(pageGapKey(null, workspaceState.unmanagedPages.length))"
            @drop="onPageGapDrop(null, workspaceState.unmanagedPages.length, $event)"
          ></li>
        </ol>

        <section
          v-for="group in workspaceState.unmanagedGroups"
          :key="group.id"
          class="unmanaged-group"
          :style="groupColorStyle(group.color)"
        >
          <div class="unmanaged-group-title">
            <span class="color-dot" aria-hidden="true"></span>
            <span>{{ group.title }}</span>
            <button
              class="inline-icon-button"
              type="button"
              :title="t('importGroup')"
              :aria-label="t('importGroup')"
              @click="importUnmanagedGroup(group.id)"
            >
              <Plus :size="13" aria-hidden="true" />
            </button>
          </div>
          <ol class="tabs">
            <li
              v-for="page in group.pages"
              :key="page.id"
              class="tab"
              :class="{
                active: page.active,
                dragging: draggedPageId === page.id,
              }"
              draggable="true"
              @dragstart="onPageDragStart(page, $event)"
              @dragend="onDragEnd"
            >
              <span class="tab-favicon" aria-hidden="true">
                <img v-if="pageFavicon(page)" :src="pageFavicon(page)" alt="">
                <File v-else :size="16" />
              </span>
              <button
                class="tab-title-button"
                type="button"
                :title="pageTitle(page)"
                @click="openWorkspacePage(null, page)"
              >
                <span class="tab-title">{{ pageTitle(page) }}</span>
              </button>
              <div class="tab-actions">
                <button
                  class="icon-button subtle"
                  type="button"
                  :title="t('closePage')"
                  :aria-label="t('closePage')"
                  @click.stop="closeWorkspacePage(page)"
                >
                  <X :size="16" aria-hidden="true" />
                </button>
              </div>
            </li>
          </ol>
        </section>
      </section>
    </section>
  </main>
</template>
