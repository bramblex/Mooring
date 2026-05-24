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
import type { TabModel } from "../models/tab.model";
import type { WindowContext } from "../models/window.model";
import type { TabGroupColor, WorkspaceState, WorkspaceView } from "../models/workspace.model";

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
  ungroupedTabs: [],
});
const draggedTabId = ref<string | null>(null);
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

function tabTitle(tab: TabModel) {
  return tab.title || tab.url || t("untitledTab");
}

function tabSubtitle(tab: TabModel) {
  return tab.dirty ? tab.currentTitle || tab.url || "" : "";
}

function tabFavicon(tab: TabModel) {
  return tab.favIconUrl || "";
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

async function openWorkspaceTab(workspace: WorkspaceView | null, tab: TabModel) {
  if (!workspace || currentWindowId.value === undefined) {
    if (tab.tabId) await chrome.tabs.update(tab.tabId, { active: true });
    return;
  }

  await sendMessage({
    type: "OPEN_WORKSPACE_TAB",
    workspaceId: workspace.id,
    tabId: tab.id,
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

async function togglePinnedTab(workspace: WorkspaceView | null, tab: TabModel) {
  if (tab.pinned) {
    if (!window.confirm(t("unpinTabConfirm"))) return;

    await sendMessage({
      type: "UNPIN_TAB",
      tabId: tab.tabId,
      bookmarkId: tab.bookmarkId,
    });
    await refreshTabs();
    return;
  }

  if (!workspace || !tab.tabId) return;

  await sendMessage({
    type: "PIN_TAB",
    workspaceId: workspace.id,
    tabId: tab.tabId,
  });
  await refreshTabs();
}

async function updatePinnedTabTitle(tab: TabModel, event: Event) {
  if (!tab.bookmarkId) return;

  const target = event.target as HTMLInputElement;
  await sendMessage({
    type: "UPDATE_PINNED_TAB_TITLE",
    bookmarkId: tab.bookmarkId,
    title: target.value.trim() || t("untitledTab"),
  });
  editingBookmarkId.value = null;
  await refreshTabs();
}

function editPinnedTabTitle(tab: TabModel) {
  if (!tab.bookmarkId) return;

  editingBookmarkId.value = tab.bookmarkId;
}

async function closeWorkspaceTab(tab: TabModel) {
  if (!tab.tabId) return;

  await sendMessage({
    type: "CLOSE_WORKSPACE_TAB",
    tabId: tab.tabId,
  });
  await refreshTabs();
}

function onTabDragStart(tab: TabModel, event: DragEvent) {
  if (isEditableElement(event.target)) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedTabId.value = tab.id;
  draggedWorkspaceId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tab.id);
}

function onWorkspaceDragStart(workspace: WorkspaceView, event: DragEvent) {
  if (!event.dataTransfer) return;

  draggedWorkspaceId.value = workspace.id;
  draggedTabId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `workspace:${workspace.id}`);
}

function onDragOver(key: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOverKey.value = key;
}

function onTabDragOver(key: string, event: DragEvent) {
  if (draggedWorkspaceId.value !== null) return;

  onDragOver(key, event);
}

function onDragLeave(key: string) {
  if (dragOverKey.value === key) {
    dragOverKey.value = "";
  }
}

async function onDrop(workspaceId: string | null, index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedTabId.value === null || currentWindowId.value === undefined) return;

  await sendMessage({
    type: "MOVE_WORKSPACE_TAB",
    tabId: draggedTabId.value,
    workspaceId,
    index,
    windowId: currentWindowId.value,
  });
  onDragEnd();
  await refreshTabs();
}

function getTabDropIndex(targetIndex: number, event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;

  return shouldInsertAfter ? targetIndex + 1 : targetIndex;
}

async function onTabDrop(workspaceId: string | null, targetIndex: number, event: DragEvent) {
  if (draggedWorkspaceId.value !== null) return;

  await onDrop(workspaceId, getTabDropIndex(targetIndex, event), event);
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

function onDragEnd() {
  draggedTabId.value = null;
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
      <button type="button" @click="openMainWindowFromPanel">
        {{ t("openMainWindow") }}
      </button>
      <button type="button" @click="sendCurrentTabFromPanel">
        {{ t("sendCurrentTabToMainWindow") }}
      </button>
      <button type="button" @click="sendAllTabsFromPanel">
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
      <section
        class="group-section ungrouped"
        :class="{ 'drag-over': dragOverKey === 'workspace-ungrouped' }"
        @dragover="onDragOver('workspace-ungrouped', $event)"
        @dragleave="onDragLeave('workspace-ungrouped')"
        @drop="onDrop(null, -1, $event)"
      >
        <div class="group-header">
          <h2>{{ t("ungrouped") }}</h2>
        </div>
        <ol class="tabs">
          <li
            v-for="(tab, tabIndex) in workspaceState.ungroupedTabs"
            :key="tab.id"
            class="tab"
            :class="{
              active: tab.active,
              dragging: draggedTabId === tab.id,
              'drag-over': dragOverKey === `tab-${tab.id}`,
            }"
            @dragover="onTabDragOver(`tab-${tab.id}`, $event)"
            @dragleave="onDragLeave(`tab-${tab.id}`)"
            @drop="onTabDrop(null, tabIndex, $event)"
            @dragend="onDragEnd"
          >
            <span
              class="drag-handle"
              draggable="true"
              :title="t('dragGroup')"
              :aria-label="t('dragGroup')"
              @dragstart="onTabDragStart(tab, $event)"
              @dragend="onDragEnd"
            >
              <GripVertical :size="16" />
            </span>
            <span class="tab-favicon" aria-hidden="true">
              <img v-if="tabFavicon(tab)" :src="tabFavicon(tab)" alt="">
              <File v-else :size="16" />
            </span>
            <button
              class="tab-title-button"
              type="button"
              :title="tabTitle(tab)"
              @click="openWorkspaceTab(null, tab)"
            >
              <span class="tab-title">{{ tabTitle(tab) }}</span>
            </button>
            <div class="tab-actions">
              <button
                class="icon-button subtle"
                type="button"
                :title="t('closeTab')"
                :aria-label="t('closeTab')"
                @click.stop="closeWorkspaceTab(tab)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
          </li>
        </ol>
      </section>

      <section
        v-for="workspace in workspaces"
        :key="workspace.id"
        class="group-section"
        :class="{
          dragging: draggedWorkspaceId === workspace.id,
          'drag-over': dragOverKey === `workspace-${workspace.id}`,
        }"
        :style="groupColorStyle(workspace.color)"
        @dragover="onDragOver(`workspace-${workspace.id}`, $event)"
        @dragleave="onDragLeave(`workspace-${workspace.id}`)"
        @drop="draggedWorkspaceId === null ? onDrop(workspace.id, -1, $event) : onWorkspaceDrop(workspace, $event)"
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
          <li
            v-for="(tab, tabIndex) in workspace.tabs"
            :key="tab.id"
            class="tab"
            :class="{
              active: tab.active,
              dragging: draggedTabId === tab.id,
              'drag-over': dragOverKey === `tab-${tab.id}`,
              'closed-tab': !tab.open,
            }"
            @dragover="onTabDragOver(`tab-${tab.id}`, $event)"
            @dragleave="onDragLeave(`tab-${tab.id}`)"
            @drop="onTabDrop(workspace.id, tabIndex, $event)"
            @dragend="onDragEnd"
          >
            <span
              class="drag-handle"
              draggable="true"
              :title="t('dragGroup')"
              :aria-label="t('dragGroup')"
              @dragstart="onTabDragStart(tab, $event)"
              @dragend="onDragEnd"
            >
              <GripVertical :size="16" />
            </span>
            <button
              class="tab-favicon"
              type="button"
              :title="tabTitle(tab)"
              :aria-label="tabTitle(tab)"
              @click="openWorkspaceTab(workspace, tab)"
            >
              <img v-if="tabFavicon(tab)" :src="tabFavicon(tab)" alt="">
              <File v-else :size="16" />
            </button>
            <input
              v-if="tab.pinned && editingBookmarkId === tab.bookmarkId"
              class="tab-title-input"
              :value="tabTitle(tab)"
              :title="tabTitle(tab)"
              :aria-label="t('bookmarkTitle')"
              draggable="false"
              @blur="updatePinnedTabTitle(tab, $event)"
              @dragstart="stopInputDrag"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <button
              v-else-if="!tab.pinned"
              class="tab-title-button"
              type="button"
              :title="tabTitle(tab)"
              @click="openWorkspaceTab(workspace, tab)"
            >
              <span class="tab-title">
                {{ tabTitle(tab) }}
                <span v-if="tabSubtitle(tab)" class="tab-subtitle">
                  · {{ tabSubtitle(tab) }}
                </span>
              </span>
            </button>
            <div v-else class="tab-title-static" :title="tabTitle(tab)">
              <button
                class="tab-title-button"
                type="button"
                :title="tabTitle(tab)"
                @click="openWorkspaceTab(workspace, tab)"
              >
                <span class="tab-title">
                  {{ tabTitle(tab) }}
                  <span v-if="tabSubtitle(tab)" class="tab-subtitle">
                    · {{ tabSubtitle(tab) }}
                  </span>
                </span>
              </button>
              <button
                class="inline-icon-button"
                type="button"
                :title="t('bookmarkTitle')"
                :aria-label="t('bookmarkTitle')"
                @click.stop="editPinnedTabTitle(tab)"
              >
                <Pencil :size="13" aria-hidden="true" />
              </button>
            </div>
            <div class="tab-actions">
              <Circle
                v-if="tab.dirty"
                class="dirty-dot"
                :size="9"
                :title="t('pinnedTabDirty')"
                :aria-label="t('pinnedTabDirty')"
              />
              <button
                class="icon-button subtle"
                type="button"
                :class="{ active: tab.pinned }"
                :title="tab.pinned ? t('unpinTab') : t('pinTab')"
                :aria-label="tab.pinned ? t('unpinTab') : t('pinTab')"
                @click.stop="togglePinnedTab(workspace, tab)"
              >
                <Star :size="16" aria-hidden="true" />
              </button>
              <button
                v-if="tab.open"
                class="icon-button subtle"
                type="button"
                :title="t('closeTab')"
                :aria-label="t('closeTab')"
                @click.stop="closeWorkspaceTab(tab)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
          </li>
        </ol>
      </section>
    </section>
  </main>
</template>
