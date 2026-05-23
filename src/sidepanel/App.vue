<script setup lang="ts">
import {
  Circle,
  Eye,
  EyeOff,
  File,
  GripVertical,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "../i18n";
import type { WindowContext } from "../models/window.model";

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
type TabGroupColor = chrome.tabGroups.TabGroup["color"];

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

const tabs = ref<chrome.tabs.Tab[]>([]);
const groups = ref<chrome.tabGroups.TabGroup[]>([]);
const draggedTabId = ref<number | null>(null);
const draggedGroupId = ref<number | null>(null);
const dragOverKey = ref("");
const openColorPickerGroupId = ref<number | null>(null);
const windowContext = ref<WindowContext | null>(null);
const { t } = useI18n();

const isPrimaryWindow = computed(() => windowContext.value?.role === "primary");
const isWindowContextReady = computed(() => Boolean(windowContext.value));

function tabTitle(tab: chrome.tabs.Tab) {
  return tab.title || tab.url || t("untitledTab");
}

function tabSubtitle(tab: chrome.tabs.Tab) {
  if (!isDirtyPinnedTab(tab)) return "";

  return tab.title || "";
}

function tabFavicon(tab: chrome.tabs.Tab) {
  return tab.favIconUrl || "";
}

function isPinnedTab(_tab: chrome.tabs.Tab) {
  return false;
}

function isDirtyPinnedTab(_tab: chrome.tabs.Tab) {
  return false;
}

function groupTitle(group: chrome.tabGroups.TabGroup) {
  return group.title || t("untitledGroup");
}

function groupColorStyle(color: TabGroupColor) {
  return GROUP_COLOR_STYLES[color];
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function groupTabsByGroupId(openTabs: chrome.tabs.Tab[]) {
  const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();

  openTabs.forEach((tab) => {
    const groupTabs = tabsByGroup.get(tab.groupId) || [];
    groupTabs.push(tab);
    tabsByGroup.set(tab.groupId, groupTabs);
  });

  return tabsByGroup;
}

function groupStartIndex(
  group: chrome.tabGroups.TabGroup,
  tabsByGroup: Map<number, chrome.tabs.Tab[]>,
) {
  return tabsByGroup.get(group.id)?.[0]?.index ?? Number.MAX_SAFE_INTEGER;
}

const tabsByGroup = computed(() => groupTabsByGroupId(tabs.value));

const sortedGroups = computed(() =>
  [...groups.value].sort(
    (a, b) => groupStartIndex(a, tabsByGroup.value) - groupStartIndex(b, tabsByGroup.value),
  ),
);

async function refreshTabs() {
  if (!isPrimaryWindow.value) return;

  tabs.value = await chrome.tabs.query({ currentWindow: true });
  const windowId = tabs.value[0]?.windowId;
  groups.value = windowId ? await chrome.tabGroups.query({ windowId }) : [];
}

async function refreshWindowContext() {
  const currentWindow = await chrome.windows.getCurrent();
  windowContext.value = await chrome.runtime.sendMessage({
    type: "GET_WINDOW_CONTEXT",
    windowId: currentWindow.id,
  });
}

async function openMainWindowFromPanel() {
  await chrome.runtime.sendMessage({
    type: "OPEN_MAIN_WINDOW",
  });
  await refreshWindowContext();
}

async function sendCurrentTabFromPanel() {
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage({
    type: "SEND_CURRENT_TAB_TO_MAIN_WINDOW",
    windowId: currentWindow.id,
  });
  await refreshWindowContext();
}

async function sendAllTabsFromPanel() {
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.runtime.sendMessage({
    type: "SEND_ALL_TABS_TO_MAIN_WINDOW",
    windowId: currentWindow.id,
  });
  await refreshWindowContext();
}

async function activateTab(tabId?: number) {
  if (!tabId) return;

  await chrome.tabs.update(tabId, { active: true });
  await refreshTabs();
}

async function moveTabToGroup(tabId: number, groupId: number, index: number) {
  await chrome.tabs.move(tabId, { index });

  if (groupId === NO_GROUP) {
    await chrome.tabs.ungroup(tabId);
    return;
  }

  await chrome.tabs.group({ tabIds: tabId, groupId });
}

async function moveGroupToIndex(groupId: number, index: number) {
  await chrome.tabGroups.move(groupId, { index });
}

async function groupActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.id) return;

  const groupId = await chrome.tabs.group({ tabIds: activeTab.id });
  await chrome.tabGroups.update(groupId, { title: t("newGroup") });
  await refreshTabs();
}

function createWorkspacePlaceholder() {
  console.info("Creating a bookmark-backed workspace is documented but not implemented yet.");
}

function togglePinnedTabPlaceholder(tab: chrome.tabs.Tab) {
  if (isPinnedTab(tab) && !window.confirm(t("unpinTabConfirm"))) return;

  console.info("Pinning workspace tabs is documented but not implemented yet.", tab.id);
}

function closeTabPlaceholder(tab: chrome.tabs.Tab) {
  console.info("Closing tabs from Harbor is documented but not implemented yet.", tab.id);
}

function deleteWorkspacePlaceholder(group: chrome.tabGroups.TabGroup) {
  if (!window.confirm(t("deleteWorkspaceConfirm"))) return;

  console.info("Deleting bookmark-backed workspaces is documented but not implemented yet.", group.id);
}

function onDragStart(tab: chrome.tabs.Tab, event: DragEvent) {
  if (!tab.id || !event.dataTransfer) return;

  draggedTabId.value = tab.id;
  draggedGroupId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `tab:${tab.id}`);
}

function onGroupDragStart(group: chrome.tabGroups.TabGroup, event: DragEvent) {
  if (!event.dataTransfer) return;

  draggedGroupId.value = group.id;
  draggedTabId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `group:${group.id}`);
}

function onDragOver(key: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOverKey.value = key;
}

function onTabDragOver(key: string, event: DragEvent) {
  if (draggedGroupId.value !== null) return;

  onDragOver(key, event);
}

function onDragLeave(key: string) {
  if (dragOverKey.value === key) {
    dragOverKey.value = "";
  }
}

async function onDrop(groupId: number, index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedTabId.value === null) return;

  await moveTabToGroup(draggedTabId.value, groupId, index);
  draggedTabId.value = null;
  dragOverKey.value = "";
  await refreshTabs();
}

function getTabDropIndex(targetTab: chrome.tabs.Tab, event: DragEvent) {
  const draggedTab = tabs.value.find((tab) => tab.id === draggedTabId.value);
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;

  if (!draggedTab || draggedTab.index === targetTab.index) {
    return targetTab.index;
  }

  if (shouldInsertAfter) {
    return draggedTab.index < targetTab.index ? targetTab.index : targetTab.index + 1;
  }

  return draggedTab.index < targetTab.index ? targetTab.index - 1 : targetTab.index;
}

async function onTabDrop(targetTab: chrome.tabs.Tab, event: DragEvent) {
  if (draggedGroupId.value !== null) return;

  await onDrop(targetTab.groupId, getTabDropIndex(targetTab, event), event);
}

async function onGroupDrop(targetGroup: chrome.tabGroups.TabGroup, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedGroupId.value === null || draggedGroupId.value === targetGroup.id) return;

  const targetIndex = groupStartIndex(targetGroup, tabsByGroup.value);
  await moveGroupToIndex(draggedGroupId.value, targetIndex);
  draggedGroupId.value = null;
  dragOverKey.value = "";
  await refreshTabs();
}

function onDragEnd() {
  draggedTabId.value = null;
  draggedGroupId.value = null;
  dragOverKey.value = "";
}

async function updateGroupTitle(group: chrome.tabGroups.TabGroup, event: Event) {
  const target = event.target as HTMLInputElement;

  await chrome.tabGroups.update(group.id, {
    title: target.value.trim() || t("untitledGroup"),
  });
  await refreshTabs();
}

async function updateGroupColor(group: chrome.tabGroups.TabGroup, color: TabGroupColor) {
  await chrome.tabGroups.update(group.id, {
    color,
  });
  openColorPickerGroupId.value = null;
  await refreshTabs();
}

async function toggleGroup(group: chrome.tabGroups.TabGroup) {
  await chrome.tabGroups.update(group.id, { collapsed: !group.collapsed });
  await refreshTabs();
}

async function ungroupTabs(group: chrome.tabGroups.TabGroup) {
  const groupTabs = await chrome.tabs.query({
    groupId: group.id,
    currentWindow: true,
  });
  const tabIds = groupTabs.flatMap((tab) => (tab.id ? [tab.id] : []));

  if (tabIds.length === 0) return;

  await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
  await refreshTabs();
}

function toggleColorPicker(groupId: number) {
  openColorPickerGroupId.value = openColorPickerGroupId.value === groupId ? null : groupId;
}

onMounted(async () => {
  await refreshWindowContext();
  await refreshTabs();

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
          @click="createWorkspacePlaceholder"
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
        :class="{ 'drag-over': dragOverKey === 'group-ungrouped' }"
        @dragover="onDragOver('group-ungrouped', $event)"
        @dragleave="onDragLeave('group-ungrouped')"
        @drop="onDrop(NO_GROUP, -1, $event)"
      >
        <div class="group-header">
          <h2>{{ t("ungrouped") }}</h2>
        </div>
        <ol class="tabs">
          <li
            v-for="tab in tabsByGroup.get(NO_GROUP) || []"
            :key="tab.id"
            class="tab"
            :class="{
              active: tab.active,
              dragging: draggedTabId === tab.id,
              'drag-over': dragOverKey === `tab-${tab.id}`,
            }"
            draggable="true"
            @dragstart="onDragStart(tab, $event)"
            @dragover="onTabDragOver(`tab-${tab.id}`, $event)"
            @dragleave="onDragLeave(`tab-${tab.id}`)"
            @drop="onTabDrop(tab, $event)"
            @dragend="onDragEnd"
          >
            <span class="drag-handle" aria-hidden="true">
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
              @click="activateTab(tab.id)"
            >
              <span class="tab-title">
                {{ tabTitle(tab) }}
                <span v-if="tabSubtitle(tab)" class="tab-subtitle">
                  · {{ tabSubtitle(tab) }}
                </span>
              </span>
            </button>
            <div class="tab-actions">
              <Circle
                v-if="isDirtyPinnedTab(tab)"
                class="dirty-dot"
                :size="9"
                :title="t('pinnedTabDirty')"
                :aria-label="t('pinnedTabDirty')"
              />
              <button
                class="icon-button subtle"
                type="button"
                :class="{ active: isPinnedTab(tab) }"
                :title="isPinnedTab(tab) ? t('unpinTab') : t('pinTab')"
                :aria-label="isPinnedTab(tab) ? t('unpinTab') : t('pinTab')"
                @click.stop="togglePinnedTabPlaceholder(tab)"
              >
                <Star :size="16" aria-hidden="true" />
              </button>
              <button
                class="icon-button subtle"
                type="button"
                :title="t('closeTab')"
                :aria-label="t('closeTab')"
                @click.stop="closeTabPlaceholder(tab)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
          </li>
        </ol>
      </section>

      <section
        v-for="group in sortedGroups"
        :key="group.id"
        class="group-section"
        :class="{
          dragging: draggedGroupId === group.id,
          'drag-over': dragOverKey === `group-${group.id}`,
        }"
        :style="groupColorStyle(group.color)"
        @dragover="onDragOver(`group-${group.id}`, $event)"
        @dragleave="onDragLeave(`group-${group.id}`)"
        @drop="draggedGroupId === null ? onDrop(group.id, -1, $event) : onGroupDrop(group, $event)"
      >
        <div class="group-header">
          <span
            class="group-drag-handle"
            draggable="true"
            :title="t('dragGroup')"
            :aria-label="t('dragGroup')"
            @dragstart="onGroupDragStart(group, $event)"
            @dragend="onDragEnd"
          >
            <GripVertical :size="16" aria-hidden="true" />
          </span>
          <input
            class="group-title"
            :value="groupTitle(group)"
            :aria-label="t('groupTitle')"
            @blur="updateGroupTitle(group, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <div class="group-color-picker" :style="groupColorStyle(group.color)">
            <button
              class="color-picker-trigger"
              type="button"
              :title="t('groupColor')"
              :aria-label="t('groupColor')"
              :aria-expanded="openColorPickerGroupId === group.id"
              @click.stop="toggleColorPicker(group.id)"
            >
              <span class="color-dot" aria-hidden="true"></span>
            </button>
            <div
              v-if="openColorPickerGroupId === group.id"
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
                :aria-checked="group.color === color"
                :title="color"
                :style="groupColorStyle(color)"
                @click="updateGroupColor(group, color)"
              >
                <span class="color-dot" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <button
            class="icon-button"
            type="button"
            :title="group.collapsed ? t('showWorkspace') : t('hideWorkspace')"
            :aria-label="group.collapsed ? t('showWorkspace') : t('hideWorkspace')"
            @click="toggleGroup(group)"
          >
            <Eye v-if="group.collapsed" :size="17" aria-hidden="true" />
            <EyeOff v-else :size="17" aria-hidden="true" />
          </button>
          <button
            class="icon-button danger"
            type="button"
            :title="t('deleteWorkspace')"
            :aria-label="t('deleteWorkspace')"
            @click="deleteWorkspacePlaceholder(group)"
          >
            <Trash2 :size="17" aria-hidden="true" />
          </button>
        </div>

        <ol v-if="!group.collapsed" class="tabs">
          <li
            v-for="tab in tabsByGroup.get(group.id) || []"
            :key="tab.id"
            class="tab"
            :class="{
              active: tab.active,
              dragging: draggedTabId === tab.id,
              'drag-over': dragOverKey === `tab-${tab.id}`,
            }"
            draggable="true"
            @dragstart="onDragStart(tab, $event)"
            @dragover="onTabDragOver(`tab-${tab.id}`, $event)"
            @dragleave="onDragLeave(`tab-${tab.id}`)"
            @drop="onTabDrop(tab, $event)"
            @dragend="onDragEnd"
          >
            <span class="drag-handle" aria-hidden="true">
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
              @click="activateTab(tab.id)"
            >
              <span class="tab-title">
                {{ tabTitle(tab) }}
                <span v-if="tabSubtitle(tab)" class="tab-subtitle">
                  · {{ tabSubtitle(tab) }}
                </span>
              </span>
            </button>
            <div class="tab-actions">
              <Circle
                v-if="isDirtyPinnedTab(tab)"
                class="dirty-dot"
                :size="9"
                :title="t('pinnedTabDirty')"
                :aria-label="t('pinnedTabDirty')"
              />
              <button
                class="icon-button subtle"
                type="button"
                :class="{ active: isPinnedTab(tab) }"
                :title="isPinnedTab(tab) ? t('unpinTab') : t('pinTab')"
                :aria-label="isPinnedTab(tab) ? t('unpinTab') : t('pinTab')"
                @click.stop="togglePinnedTabPlaceholder(tab)"
              >
                <Star :size="16" aria-hidden="true" />
              </button>
              <button
                class="icon-button subtle"
                type="button"
                :title="t('closeTab')"
                :aria-label="t('closeTab')"
                @click.stop="closeTabPlaceholder(tab)"
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
