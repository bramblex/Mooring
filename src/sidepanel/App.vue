<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
const windowContext = ref<WindowContext | null>(null);

const isPrimaryWindow = computed(() => windowContext.value?.role === "primary");
const isWindowContextReady = computed(() => Boolean(windowContext.value));

function tabTitle(tab: chrome.tabs.Tab) {
  return tab.title || tab.url || "Untitled tab";
}

function groupTitle(group: chrome.tabGroups.TabGroup) {
  return group.title || "Untitled group";
}

function groupColorStyle(color: TabGroupColor) {
  return GROUP_COLOR_STYLES[color];
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
  await chrome.tabGroups.update(groupId, { title: "New group" });
  await refreshTabs();
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
    title: target.value.trim() || "Untitled group",
  });
  await refreshTabs();
}

async function updateGroupColor(group: chrome.tabGroups.TabGroup, event: Event) {
  const target = event.target as HTMLSelectElement;

  await chrome.tabGroups.update(group.id, {
    color: target.value as TabGroupColor,
  });
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

onMounted(async () => {
  await refreshWindowContext();
  await refreshTabs();

  chrome.tabs.onCreated.addListener(refreshTabs);
  chrome.tabs.onUpdated.addListener(refreshTabs);
  chrome.tabs.onMoved.addListener(refreshTabs);
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
      <h1>Tabs</h1>
    </header>
  </main>

  <main v-else-if="!isPrimaryWindow" class="panel temporary-panel">
    <header>
      <h1>Temporary window</h1>
    </header>

    <section class="temporary-actions" aria-label="Temporary window actions">
      <p>
        Workspace lives in the main window. Send tabs there or open it.
      </p>
      <button type="button" @click="openMainWindowFromPanel">Open main window</button>
      <button type="button" @click="sendCurrentTabFromPanel">
        Send current tab to main window
      </button>
      <button type="button" @click="sendAllTabsFromPanel">
        Send all tabs to main window
      </button>
    </section>
  </main>

  <main v-else class="panel">
    <header>
      <h1>Tabs</h1>
      <div class="toolbar">
        <button type="button" @click="groupActiveTab">Group active</button>
        <button type="button" title="Refresh" @click="refreshTabs">Refresh</button>
      </div>
    </header>

    <section class="groups" aria-label="Open tabs">
      <section
        class="group-section ungrouped"
        :class="{ 'drag-over': dragOverKey === 'group-ungrouped' }"
        @dragover="onDragOver('group-ungrouped', $event)"
        @dragleave="onDragLeave('group-ungrouped')"
        @drop="onDrop(NO_GROUP, -1, $event)"
      >
        <div class="group-header">
          <h2>Ungrouped</h2>
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
            <span class="drag-handle" aria-hidden="true">:::</span>
            <button
              class="tab-title"
              type="button"
              :title="tabTitle(tab)"
              @click="activateTab(tab.id)"
            >
              {{ tabTitle(tab) }}
            </button>
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
            title="Drag group"
            aria-label="Drag group"
            @dragstart="onGroupDragStart(group, $event)"
            @dragend="onDragEnd"
          >
            :::
          </span>
          <input
            class="group-title"
            :value="groupTitle(group)"
            aria-label="Group title"
            @blur="updateGroupTitle(group, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <select
            class="group-color"
            title="Group color"
            :value="group.color"
            :style="groupColorStyle(group.color)"
            @change="updateGroupColor(group, $event)"
          >
            <option
              v-for="color in GROUP_COLORS"
              :key="color"
              :value="color"
            >
              {{ color }}
            </option>
          </select>
          <button type="button" @click="toggleGroup(group)">
            {{ group.collapsed ? "Show" : "Hide" }}
          </button>
          <button type="button" @click="ungroupTabs(group)">Ungroup</button>
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
            <span class="drag-handle" aria-hidden="true">:::</span>
            <button
              class="tab-title"
              type="button"
              :title="tabTitle(tab)"
              @click="activateTab(tab.id)"
            >
              {{ tabTitle(tab) }}
            </button>
          </li>
        </ol>
      </section>
    </section>
  </main>
</template>
