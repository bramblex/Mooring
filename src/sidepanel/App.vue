<script setup lang="ts">
import {
  Circle,
  Eye,
  EyeOff,
  File,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "../i18n";
import type { PageModel } from "../models/page.model";
import type { WindowContext } from "../models/window.model";
import type {
  TabGroupColor,
  UnmanagedGroupView,
  WorkspaceState,
  WorkspaceView,
} from "../models/workspace.model";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import UnmanagedSection from "./components/UnmanagedSection.vue";
import WorkspaceNavigator from "./components/WorkspaceNavigator.vue";

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

type ConfirmDialog = {
  message: string;
  resolve: (confirmed: boolean) => void;
};

const workspaceState = ref<WorkspaceState>({
  workspaces: [],
  unmanagedPages: [],
  unmanagedGroups: [],
});
const draggedPageId = ref<string | null>(null);
const draggedPagePinned = ref(false);
const draggedWorkspaceId = ref<string | null>(null);
const draggedUnmanagedGroupId = ref<number | null>(null);
const dragOverKey = ref("");
const openColorPickerGroupId = ref<string | null>(null);
const editingBookmarkId = ref<string | null>(null);
const editingWorkspaceId = ref<string | null>(null);
const editingUnmanagedGroupId = ref<number | null>(null);
const workspaceTitleInputs = ref<Record<string, HTMLInputElement | null>>({});
const pageTitleInputs = ref<Record<string, HTMLInputElement | null>>({});
const workspaceSectionElements = ref<Record<string, HTMLElement | null>>({});
const unmanagedSectionElement = ref<HTMLElement | null>(null);
const confirmDialog = ref<ConfirmDialog | null>(null);
const windowContext = ref<WindowContext | null>(null);
const currentWindowId = ref<number | undefined>();
const { t } = useI18n();
let refreshRequestId = 0;
let scheduledRefreshId: number | undefined;

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
const unmanagedItems = computed(() => [
  ...workspaceState.value.unmanagedPages.map((page) => ({
    type: "page" as const,
    id: page.id,
    order: page.order,
    page,
  })),
  ...workspaceState.value.unmanagedGroups.map((group) => ({
    type: "group" as const,
    id: group.id,
    order: group.order,
    group,
  })),
].sort((a, b) => a.order - b.order));

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

function unmanagedGroupColorPickerId(groupId: number) {
  return `chrome-group:${groupId}`;
}

function setWorkspaceSectionElement(workspaceId: string, element: unknown) {
  workspaceSectionElements.value[workspaceId] = element instanceof HTMLElement ? element : null;
}

function setUnmanagedSectionElement(element: unknown) {
  unmanagedSectionElement.value = element instanceof HTMLElement ? element : null;
}

function scrollToWorkspace(workspaceId: string) {
  workspaceSectionElements.value[workspaceId]?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function scrollToUnmanaged() {
  unmanagedSectionElement.value?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function workspaceOpenPageCount(workspace: WorkspaceView) {
  return workspace.pages.filter((page) => page.open).length;
}

function unmanagedOpenPageCount() {
  const unmanagedGroupPages = workspaceState.value.unmanagedGroups.flatMap((group) => group.pages);

  return [...workspaceState.value.unmanagedPages, ...unmanagedGroupPages]
    .filter((page) => page.open).length;
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function requestConfirm(message: string) {
  return new Promise<boolean>((resolve) => {
    confirmDialog.value = { message, resolve };
  });
}

function closeConfirmDialog(confirmed: boolean) {
  if (!confirmDialog.value) return;

  confirmDialog.value.resolve(confirmed);
  confirmDialog.value = null;
}

async function sendMessage<T>(message: Record<string, unknown>) {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function refreshTabs() {
  if (!isPrimaryWindow.value || currentWindowId.value === undefined) return;

  const requestId = ++refreshRequestId;
  const nextState = await sendMessage<WorkspaceState>({
    type: "GET_WORKSPACE_STATE",
    windowId: currentWindowId.value,
  });
  if (requestId === refreshRequestId) {
    workspaceState.value = nextState;
  }
}

function scheduleRefreshTabs() {
  if (scheduledRefreshId !== undefined) {
    window.clearTimeout(scheduledRefreshId);
  }

  scheduledRefreshId = window.setTimeout(() => {
    scheduledRefreshId = undefined;
    void refreshTabs();
  }, 80);
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
    name: target.value,
  });
  editingWorkspaceId.value = null;
  await refreshTabs();
}

function editWorkspaceTitle(workspace: WorkspaceView) {
  editingWorkspaceId.value = workspace.id;
  void focusWorkspaceTitleInput(workspace.id);
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

async function updateUnmanagedGroupTitle(group: UnmanagedGroupView, event: Event) {
  const target = event.target as HTMLInputElement;

  await sendMessage({
    type: "RENAME_UNMANAGED_GROUP",
    groupId: group.id,
    title: target.value,
  });
  editingUnmanagedGroupId.value = null;
  await refreshTabs();
}

function editUnmanagedGroupTitle(group: UnmanagedGroupView) {
  editingUnmanagedGroupId.value = group.id;
}

async function updateUnmanagedGroupColor(group: UnmanagedGroupView, color: TabGroupColor) {
  await sendMessage({
    type: "UPDATE_UNMANAGED_GROUP_COLOR",
    groupId: group.id,
    color,
  });
  openColorPickerGroupId.value = null;
  await refreshTabs();
}

async function ungroupUnmanagedGroup(group: UnmanagedGroupView) {
  await sendMessage({
    type: "UNGROUP_UNMANAGED_GROUP",
    groupId: group.id,
  });
  await refreshTabs();
}

async function toggleWorkspace(workspace: WorkspaceView) {
  await sendMessage({
    type: "TOGGLE_WORKSPACE",
    workspaceId: workspace.id,
  });
  await refreshTabs();
}

async function toggleWorkspaceFromHeader(workspace: WorkspaceView, event: MouseEvent) {
  const target = event.target;
  if (isEditableElement(target)) return;
  if (target instanceof HTMLElement && target.closest("button, .group-color-picker")) return;

  await toggleWorkspace(workspace);
}

async function deleteWorkspace(workspace: WorkspaceView) {
  if (!await requestConfirm(t("deleteWorkspaceConfirm"))) return;

  await sendMessage({
    type: "DELETE_WORKSPACE",
    workspaceId: workspace.id,
  });
  await refreshTabs();
}

async function closeWorkspacePages(workspace: WorkspaceView) {
  await sendMessage({
    type: "CLOSE_WORKSPACE_PAGES",
    workspaceId: workspace.id,
  });
  await refreshTabs();
}

async function togglePinnedPage(workspace: WorkspaceView | null, page: PageModel) {
  if (page.pinned) {
    if (!await requestConfirm(t("unpinPageConfirm"))) return;

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
  void focusPageTitleInput(page.bookmarkId);
}

async function focusWorkspaceTitleInput(workspaceId: string) {
  await nextTick();
  focusEditableInput(workspaceTitleInputs.value[workspaceId]);
}

async function focusPageTitleInput(bookmarkId: string) {
  await nextTick();
  focusEditableInput(pageTitleInputs.value[bookmarkId]);
}

function focusEditableInput(input: HTMLInputElement | null | undefined) {
  input?.focus();
  input?.select();
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

function onPageDragStart(page: PageModel, event: DragEvent) {
  if (isEditableElement(event.target)) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedPageId.value = page.id;
  draggedPagePinned.value = page.pinned;
  draggedWorkspaceId.value = null;
  draggedUnmanagedGroupId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", page.id);
}

function onWorkspaceDragStart(workspace: WorkspaceView, event: DragEvent) {
  if (isEditingWorkspace(workspace) || isEditableElement(event.target)) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedWorkspaceId.value = workspace.id;
  draggedPageId.value = null;
  draggedUnmanagedGroupId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `workspace:${workspace.id}`);
}

function onUnmanagedGroupDragStart(group: UnmanagedGroupView, event: DragEvent) {
  if (event.target instanceof HTMLElement && event.target.closest(".tab")) {
    return;
  }

  if (isEditableElement(event.target) || (event.target instanceof HTMLElement && event.target.closest("button"))) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedUnmanagedGroupId.value = group.id;
  draggedWorkspaceId.value = null;
  draggedPageId.value = null;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `chrome-group:${group.id}`);
}

function onDragOver(key: string, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOverKey.value = key;
}

function pageGapKey(workspaceId: string | null, index: number) {
  return `page-gap-${workspaceId || "unmanaged"}-${index}`;
}

function unmanagedTopGapKey(index: number) {
  return `unmanaged-top-gap-${index}`;
}

function unmanagedGroupPageGapKey(groupId: number, index: number) {
  return `unmanaged-group-page-gap-${groupId}-${index}`;
}

function workspaceNavKey(workspaceId: string) {
  return `workspace-nav-${workspaceId}`;
}

function tempNavKey() {
  return "workspace-nav-temp";
}

function workspaceGapKey(index: number) {
  return `workspace-gap-${index}`;
}

function isEditingWorkspace(workspace: WorkspaceView) {
  return editingWorkspaceId.value === workspace.id;
}

function findWorkspaceIndex(workspaceId: string | null) {
  if (!workspaceId) return -1;

  return workspaces.value.findIndex((workspace) => workspace.id === workspaceId);
}

function isNoopWorkspaceDrop(index: number) {
  const currentIndex = findWorkspaceIndex(draggedWorkspaceId.value);
  return currentIndex >= 0 && (index === currentIndex || index === currentIndex + 1);
}

function canDropWorkspaceAt(index: number) {
  return draggedWorkspaceId.value !== null
    && draggedPageId.value === null
    && draggedUnmanagedGroupId.value === null
    && !isNoopWorkspaceDrop(index);
}

function onWorkspaceGapDragOver(index: number, event: DragEvent) {
  if (!canDropWorkspaceAt(index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(workspaceGapKey(index), event);
}

function workspaceDropIndexFromEvent(targetIndex: number, event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;

  return shouldInsertAfter ? targetIndex + 1 : targetIndex;
}

function onWorkspaceSectionDragOver(targetIndex: number, event: DragEvent) {
  if (draggedWorkspaceId.value === null || draggedPageId.value !== null) return;

  const index = workspaceDropIndexFromEvent(targetIndex, event);
  if (!canDropWorkspaceAt(index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(workspaceGapKey(index), event);
}

async function onWorkspaceSectionDrop(targetIndex: number, event: DragEvent) {
  if (draggedWorkspaceId.value === null || draggedPageId.value !== null) return;

  const index = workspaceDropIndexFromEvent(targetIndex, event);
  if (!canDropWorkspaceAt(index)) return;

  await onWorkspaceDrop(index, event);
}

function canDropPageInto(workspaceId: string | null) {
  if (draggedPageId.value === null || draggedWorkspaceId.value !== null || draggedUnmanagedGroupId.value !== null) {
    return false;
  }

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

function canDropUnmanagedGroupIntoWorkspace(workspaceId: string | null) {
  return Boolean(workspaceId && draggedUnmanagedGroupId.value !== null && draggedWorkspaceId.value === null);
}

function canDropIntoWorkspaceAt(workspaceId: string | null, index: number) {
  return canDropPageAt(workspaceId, index) || canDropUnmanagedGroupIntoWorkspace(workspaceId);
}

function onPageGapDragOver(workspaceId: string | null, index: number, event: DragEvent) {
  if (!canDropIntoWorkspaceAt(workspaceId, index)) {
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
  if (!canDropIntoWorkspaceAt(workspaceId, index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(pageGapKey(workspaceId, index), event);
}

async function onPageItemDrop(workspaceId: string | null, targetIndex: number, event: DragEvent) {
  const index = pageDropIndexFromEvent(targetIndex, event);
  if (!canDropIntoWorkspaceAt(workspaceId, index)) return;

  await onDropIntoWorkspace(workspaceId, index, event);
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
  if (!canDropIntoWorkspaceAt(workspaceId, index)) return;

  await onDropIntoWorkspace(workspaceId, index, event);
}

async function onDropIntoWorkspace(workspaceId: string | null, index: number, event: DragEvent) {
  if (draggedUnmanagedGroupId.value !== null && workspaceId !== null) {
    await moveUnmanagedGroupToWorkspace(workspaceId, index, event);
    return;
  }

  await onDrop(workspaceId, index, event);
}

function onWorkspaceNavDragOver(workspace: WorkspaceView, event: DragEvent) {
  if (!canDropPageInto(workspace.id) && !canDropUnmanagedGroupIntoWorkspace(workspace.id)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(workspaceNavKey(workspace.id), event);
}

async function onWorkspaceNavDrop(workspace: WorkspaceView, event: DragEvent) {
  if (!canDropPageInto(workspace.id) && !canDropUnmanagedGroupIntoWorkspace(workspace.id)) return;

  if (draggedUnmanagedGroupId.value !== null) {
    await moveUnmanagedGroupToWorkspace(workspace.id, workspace.pages.length, event);
    scrollToWorkspace(workspace.id);
    return;
  }

  await onDrop(workspace.id, workspace.pages.length, event);
  scrollToWorkspace(workspace.id);
}

async function moveUnmanagedGroupToWorkspace(workspaceId: string, index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (draggedUnmanagedGroupId.value === null) return;

  await sendMessage({
    type: "MOVE_UNMANAGED_GROUP_TO_WORKSPACE",
    groupId: draggedUnmanagedGroupId.value,
    workspaceId,
    index,
  });
  onDragEnd();
  await refreshTabs();
}

function onTempNavDragOver(event: DragEvent) {
  if (!canDropPageInto(null)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(tempNavKey(), event);
}

async function onTempNavDrop(event: DragEvent) {
  if (!canDropPageInto(null)) return;

  await onDrop(null, workspaceState.value.unmanagedPages.length, event);
  scrollToUnmanaged();
}

function findUnmanagedTopIndex() {
  if (draggedUnmanagedGroupId.value !== null) {
    return unmanagedItems.value.findIndex((item) => item.type === "group" && item.id === draggedUnmanagedGroupId.value);
  }

  if (draggedPageId.value !== null && !draggedPagePinned.value) {
    return unmanagedItems.value.findIndex((item) => item.type === "page" && item.id === draggedPageId.value);
  }

  return -1;
}

function isNoopUnmanagedTopDrop(index: number) {
  const currentIndex = findUnmanagedTopIndex();
  return currentIndex >= 0 && (index === currentIndex || index === currentIndex + 1);
}

function canDropUnmanagedTopAt(index: number) {
  if (draggedWorkspaceId.value !== null) return false;
  if (draggedUnmanagedGroupId.value === null && (draggedPageId.value === null || draggedPagePinned.value)) return false;

  return !isNoopUnmanagedTopDrop(index);
}

function onUnmanagedTopGapDragOver(index: number, event: DragEvent) {
  if (!canDropUnmanagedTopAt(index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(unmanagedTopGapKey(index), event);
}

function unmanagedTopDropIndexFromEvent(targetIndex: number, event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
}

function onUnmanagedTopItemDragOver(targetIndex: number, event: DragEvent) {
  const index = unmanagedTopDropIndexFromEvent(targetIndex, event);
  if (!canDropUnmanagedTopAt(index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(unmanagedTopGapKey(index), event);
}

async function onUnmanagedTopItemDrop(targetIndex: number, event: DragEvent) {
  const index = unmanagedTopDropIndexFromEvent(targetIndex, event);
  if (!canDropUnmanagedTopAt(index)) return;

  await onUnmanagedTopDrop(index, event);
}

async function onUnmanagedTopDrop(index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (!canDropUnmanagedTopAt(index) || currentWindowId.value === undefined) return;

  const itemType = draggedUnmanagedGroupId.value !== null ? "group" : "page";
  const itemId = draggedUnmanagedGroupId.value !== null ? draggedUnmanagedGroupId.value : draggedPageId.value;
  if (itemId === null) return;

  await sendMessage({
    type: "MOVE_UNMANAGED_ITEM",
    itemType,
    itemId,
    index,
    windowId: currentWindowId.value,
  });
  onDragEnd();
  await refreshTabs();
}

function isNoopUnmanagedGroupPageDrop(group: UnmanagedGroupView, index: number) {
  if (draggedPageId.value === null) return false;

  const currentIndex = group.pages.findIndex((page) => page.id === draggedPageId.value);
  return currentIndex >= 0 && (index === currentIndex || index === currentIndex + 1);
}

function canDropPageIntoUnmanagedGroup(group: UnmanagedGroupView, index: number) {
  if (draggedPageId.value === null || draggedPagePinned.value || draggedWorkspaceId.value !== null) return false;
  if (draggedUnmanagedGroupId.value !== null) return false;

  return !isNoopUnmanagedGroupPageDrop(group, index);
}

function onUnmanagedGroupPageGapDragOver(group: UnmanagedGroupView, index: number, event: DragEvent) {
  if (!canDropPageIntoUnmanagedGroup(group, index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(unmanagedGroupPageGapKey(group.id, index), event);
}

function onUnmanagedGroupPageItemDragOver(group: UnmanagedGroupView, targetIndex: number, event: DragEvent) {
  const index = pageDropIndexFromEvent(targetIndex, event);
  if (!canDropPageIntoUnmanagedGroup(group, index)) {
    dragOverKey.value = "";
    return;
  }

  onDragOver(unmanagedGroupPageGapKey(group.id, index), event);
}

async function onUnmanagedGroupPageItemDrop(group: UnmanagedGroupView, targetIndex: number, event: DragEvent) {
  const index = pageDropIndexFromEvent(targetIndex, event);
  if (!canDropPageIntoUnmanagedGroup(group, index)) return;

  await onUnmanagedGroupPageDrop(group, index, event);
}

async function onUnmanagedGroupPageDrop(group: UnmanagedGroupView, index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (!canDropPageIntoUnmanagedGroup(group, index) || draggedPageId.value === null) return;

  await sendMessage({
    type: "MOVE_UNMANAGED_PAGE_TO_GROUP",
    pageId: draggedPageId.value,
    groupId: group.id,
    index,
  });
  onDragEnd();
  await refreshTabs();
}

async function onWorkspaceDrop(index: number, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (!canDropWorkspaceAt(index) || draggedWorkspaceId.value === null) return;

  await sendMessage({
    type: "MOVE_WORKSPACE",
    sourceWorkspaceId: draggedWorkspaceId.value,
    index,
  });
  onDragEnd();
  await refreshTabs();
}

function onDragEnd() {
  draggedPageId.value = null;
  draggedPagePinned.value = false;
  draggedWorkspaceId.value = null;
  draggedUnmanagedGroupId.value = null;
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

  chrome.tabs.onCreated.addListener(scheduleRefreshTabs);
  chrome.tabs.onUpdated.addListener(scheduleRefreshTabs);
  chrome.tabs.onMoved.addListener(scheduleRefreshTabs);
  chrome.tabs.onAttached.addListener(scheduleRefreshTabs);
  chrome.tabs.onDetached.addListener(scheduleRefreshTabs);
  chrome.tabs.onRemoved.addListener(scheduleRefreshTabs);
  chrome.tabs.onActivated.addListener(scheduleRefreshTabs);
  chrome.tabGroups.onCreated.addListener(scheduleRefreshTabs);
  chrome.tabGroups.onUpdated.addListener(scheduleRefreshTabs);
  chrome.tabGroups.onMoved.addListener(scheduleRefreshTabs);
  chrome.tabGroups.onRemoved.addListener(scheduleRefreshTabs);
  chrome.bookmarks.onCreated.addListener(scheduleRefreshTabs);
  chrome.bookmarks.onChanged.addListener(scheduleRefreshTabs);
  chrome.bookmarks.onMoved.addListener(scheduleRefreshTabs);
  chrome.bookmarks.onRemoved.addListener(scheduleRefreshTabs);
  chrome.bookmarks.onChildrenReordered.addListener(scheduleRefreshTabs);
});

onUnmounted(() => {
  if (scheduledRefreshId !== undefined) {
    window.clearTimeout(scheduledRefreshId);
    scheduledRefreshId = undefined;
  }

  chrome.tabs.onCreated.removeListener(scheduleRefreshTabs);
  chrome.tabs.onUpdated.removeListener(scheduleRefreshTabs);
  chrome.tabs.onMoved.removeListener(scheduleRefreshTabs);
  chrome.tabs.onAttached.removeListener(scheduleRefreshTabs);
  chrome.tabs.onDetached.removeListener(scheduleRefreshTabs);
  chrome.tabs.onRemoved.removeListener(scheduleRefreshTabs);
  chrome.tabs.onActivated.removeListener(scheduleRefreshTabs);
  chrome.tabGroups.onCreated.removeListener(scheduleRefreshTabs);
  chrome.tabGroups.onUpdated.removeListener(scheduleRefreshTabs);
  chrome.tabGroups.onMoved.removeListener(scheduleRefreshTabs);
  chrome.tabGroups.onRemoved.removeListener(scheduleRefreshTabs);
  chrome.bookmarks.onCreated.removeListener(scheduleRefreshTabs);
  chrome.bookmarks.onChanged.removeListener(scheduleRefreshTabs);
  chrome.bookmarks.onMoved.removeListener(scheduleRefreshTabs);
  chrome.bookmarks.onRemoved.removeListener(scheduleRefreshTabs);
  chrome.bookmarks.onChildrenReordered.removeListener(scheduleRefreshTabs);
});
</script>

<template>
  <main v-if="!isWindowContextReady" class="panel"></main>

  <main v-else-if="!isPrimaryWindow" class="panel temporary-panel">
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

  <main v-else class="panel primary-panel">
    <WorkspaceNavigator
      :workspaces="workspaces"
      :nav-label="t('openTabs')"
      :drag-over-key="dragOverKey"
      :temp-label="t('tempPages')"
      :temp-count="unmanagedOpenPageCount()"
      :group-color-style="groupColorStyle"
      :workspace-nav-key="workspaceNavKey"
      :temp-nav-key="tempNavKey"
      :workspace-open-page-count="workspaceOpenPageCount"
      @workspace-click="scrollToWorkspace"
      @workspace-dragover="onWorkspaceNavDragOver"
      @workspace-dragleave="onDragLeave"
      @workspace-drop="onWorkspaceNavDrop"
      @temp-click="scrollToUnmanaged"
      @temp-dragover="onTempNavDragOver"
      @temp-dragleave="onDragLeave"
      @temp-drop="onTempNavDrop"
    />

    <section class="groups" :aria-label="t('openTabs')">
      <!-- docs/product-logic.md: Mooring 管理的 Workspace 区域排在 Unmanaged 区域前面。 -->
      <template v-for="(workspace, workspaceIndex) in workspaces" :key="workspace.id">
        <div
          class="workspace-drop-gap"
          :class="{ active: dragOverKey === workspaceGapKey(workspaceIndex) }"
          @dragover="onWorkspaceGapDragOver(workspaceIndex, $event)"
          @dragleave="onDragLeave(workspaceGapKey(workspaceIndex))"
          @drop="onWorkspaceDrop(workspaceIndex, $event)"
        ></div>
        <section
          class="group-section"
          :ref="(element) => setWorkspaceSectionElement(workspace.id, element)"
          :class="{ dragging: draggedWorkspaceId === workspace.id }"
          :style="groupColorStyle(workspace.color)"
          @dragover="onWorkspaceSectionDragOver(workspaceIndex, $event)"
          @drop="onWorkspaceSectionDrop(workspaceIndex, $event)"
        >
        <div
          class="group-header"
          :title="t('doubleClickToggleWorkspace')"
          :draggable="!isEditingWorkspace(workspace)"
          @dragstart="onWorkspaceDragStart(workspace, $event)"
          @dragend="onDragEnd"
          @dblclick="toggleWorkspaceFromHeader(workspace, $event)"
        >
          <div class="group-main">
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
            <input
              v-if="editingWorkspaceId === workspace.id"
              :ref="(element) => { workspaceTitleInputs[workspace.id] = element as HTMLInputElement | null; }"
              class="group-title"
              :value="workspace.name"
              :aria-label="t('groupTitle')"
              @blur="updateWorkspaceTitle(workspace, $event)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <div v-else class="editable-title-wrap">
              <h2 class="group-title-text">{{ workspace.name }}</h2>
              <button
                class="inline-icon-button edit-inline-button"
                type="button"
                :title="t('groupTitle')"
                :aria-label="t('groupTitle')"
                @click.stop="editWorkspaceTitle(workspace)"
              >
                <Pencil :size="13" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class="group-actions">
            <button
              class="icon-button ghost"
              type="button"
              :title="workspace.collapsed ? t('showWorkspace') : t('hideWorkspace')"
              :aria-label="workspace.collapsed ? t('showWorkspace') : t('hideWorkspace')"
              @click="toggleWorkspace(workspace)"
            >
              <Eye v-if="workspace.collapsed" :size="17" aria-hidden="true" />
              <EyeOff v-else :size="17" aria-hidden="true" />
            </button>
            <button
              class="icon-button ghost danger"
              type="button"
              :title="t('deleteWorkspace')"
              :aria-label="t('deleteWorkspace')"
              @click="deleteWorkspace(workspace)"
            >
              <Trash2 :size="17" aria-hidden="true" />
            </button>
            <button
              class="icon-button ghost"
              type="button"
              :title="t('closeWorkspacePages')"
              :aria-label="t('closeWorkspacePages')"
              @click="closeWorkspacePages(workspace)"
            >
              <X :size="17" aria-hidden="true" />
            </button>
          </div>
        </div>

        <ol v-if="!workspace.collapsed" class="tabs">
          <li
            v-if="workspace.pages.length === 0"
            class="empty-workspace-drop"
            :class="{ active: dragOverKey === pageGapKey(workspace.id, 0) }"
            @dragover="onPageGapDragOver(workspace.id, 0, $event)"
            @dragleave="onDragLeave(pageGapKey(workspace.id, 0))"
            @drop="onPageGapDrop(workspace.id, 0, $event)"
          >
            {{ t("emptyWorkspaceDrop") }}
          </li>
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
              :ref="(element) => { if (page.bookmarkId) pageTitleInputs[page.bookmarkId] = element as HTMLInputElement | null; }"
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
            <div
              v-else
              class="tab-title-static"
              :title="pageTitle(page)"
              @click="openWorkspacePage(workspace, page)"
            >
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
              >
                <span class="tab-title">
                  {{ pageTitle(page) }}
                  <span v-if="pageSubtitle(page)" class="tab-subtitle">
                    · {{ pageSubtitle(page) }}
                  </span>
                </span>
              </button>
              <button
                class="inline-icon-button edit-inline-button"
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
      </template>
      <div
        class="workspace-drop-gap"
        :class="{ active: dragOverKey === workspaceGapKey(workspaces.length) }"
        @dragover="onWorkspaceGapDragOver(workspaces.length, $event)"
        @dragleave="onDragLeave(workspaceGapKey(workspaces.length))"
        @drop="onWorkspaceDrop(workspaces.length, $event)"
      ></div>

      <!-- docs/product-logic.md: Unmanaged 区域显示未被 Mooring 管理的 Chrome Tab 或 Chrome Group。 -->
      <UnmanagedSection
        :items="unmanagedItems"
        :drag-over-key="dragOverKey"
        :dragged-page-id="draggedPageId"
        :dragged-unmanaged-group-id="draggedUnmanagedGroupId"
        :editing-group-id="editingUnmanagedGroupId"
        :open-color-picker-group-id="openColorPickerGroupId"
        :group-colors="GROUP_COLORS"
        :labels="{
          empty: t('emptyUnmanagedDrop'),
          closePage: t('closePage'),
          groupColor: t('groupColor'),
          groupTitle: t('groupTitle'),
          ungroup: t('ungroup'),
        }"
        :group-color-style="groupColorStyle"
        :page-title="pageTitle"
        :page-favicon="pageFavicon"
        :unmanaged-top-gap-key="unmanagedTopGapKey"
        :unmanaged-group-page-gap-key="unmanagedGroupPageGapKey"
        :unmanaged-group-color-picker-id="unmanagedGroupColorPickerId"
        @set-section-element="setUnmanagedSectionElement"
        @top-gap-dragover="onUnmanagedTopGapDragOver"
        @top-gap-dragleave="onDragLeave"
        @top-gap-drop="onUnmanagedTopDrop"
        @top-item-dragover="onUnmanagedTopItemDragOver"
        @top-item-drop="onUnmanagedTopItemDrop"
        @page-dragstart="onPageDragStart"
        @group-dragstart="onUnmanagedGroupDragStart"
        @dragend="onDragEnd"
        @open-page="(page) => openWorkspacePage(null, page)"
        @close-page="closeWorkspacePage"
        @toggle-color-picker="toggleColorPicker"
        @update-group-color="updateUnmanagedGroupColor"
        @update-group-title="updateUnmanagedGroupTitle"
        @edit-group-title="editUnmanagedGroupTitle"
        @ungroup-group="ungroupUnmanagedGroup"
        @group-page-gap-dragover="onUnmanagedGroupPageGapDragOver"
        @group-page-gap-dragleave="onDragLeave"
        @group-page-gap-drop="onUnmanagedGroupPageDrop"
        @group-page-item-dragover="onUnmanagedGroupPageItemDragOver"
        @group-page-item-drop="onUnmanagedGroupPageItemDrop"
      />
    </section>

    <button
      class="icon-button floating-create-button"
      type="button"
      :title="t('newWorkspace')"
      :aria-label="t('newWorkspace')"
      @click="createWorkspace"
    >
      <Plus :size="22" aria-hidden="true" />
    </button>

    <ConfirmDialog
      v-if="confirmDialog"
      :message="confirmDialog.message"
      :confirm-label="t('confirm')"
      :cancel-label="t('cancel')"
      @cancel="closeConfirmDialog(false)"
      @confirm="closeConfirmDialog(true)"
    />
  </main>
</template>
