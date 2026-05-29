<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { AiAction } from "../models/ai-action.model";
import type { AiActionPreview } from "../models/ai-action.model";
import { enrichAiActionsForPrompt, validateAiActionPlan } from "../models/ai-action.model";
import { useI18n } from "../i18n";
import type { PageModel } from "../models/page.model";
import type { WindowContext } from "../models/window.model";
import type {
  TabGroupColor,
  WorkspaceState,
  WorkspaceView,
} from "../models/workspace.model";
import { useConfirmDialog } from "./composables/useConfirmDialog";
import { usePageDisplay } from "./composables/usePageDisplay";
import { useSidepanelDrag } from "./composables/useSidepanelDrag";
import { useUnmanagedPanel } from "./composables/useUnmanagedPanel";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import FloatingActions from "./components/FloatingActions.vue";
import UnmanagedSection from "./components/UnmanagedSection.vue";
import WorkspaceSection from "./components/WorkspaceSection.vue";
import WorkspaceNavigator from "./components/WorkspaceNavigator.vue";
import { GROUP_COLORS, groupColorStyle } from "./groupColors";
import {
  buildAiRequestPreview,
  DEFAULT_AI_CONFIG,
  generateAiActionPlan,
  loadAiPromptHistory,
  loadAiProviderConfig,
  saveAiPromptHistory,
  saveAiProviderConfig,
  type AiProviderConfig,
} from "./ai/deepseek";
import {
  createAiPromptShortcut,
  loadAiPromptShortcuts,
  saveCustomAiPromptShortcuts,
  type AiPromptShortcut,
} from "./ai/prompt-shortcuts";
import AiActionDock from "./components/AiActionDock.vue";

const workspaceState = ref<WorkspaceState>({
  workspaces: [],
  unmanagedPages: [],
  unmanagedGroups: [],
});
const openColorPickerGroupId = ref<string | null>(null);
const editingBookmarkId = ref<string | null>(null);
const editingWorkspaceId = ref<string | null>(null);
const workspaceTitleInputs = ref<Record<string, HTMLInputElement | null>>({});
const pageTitleInputs = ref<Record<string, HTMLInputElement | null>>({});
const workspaceSectionElements = ref<Record<string, HTMLElement | null>>({});
const windowContext = ref<WindowContext | null>(null);
const currentWindowId = ref<number | undefined>();
const isAiDockOpen = ref(false);
const aiPrompt = ref("");
const aiConfig = ref<AiProviderConfig>({ ...DEFAULT_AI_CONFIG });
const aiPreview = ref<AiActionPreview[]>([]);
const aiActions = ref<AiAction[]>([]);
const aiError = ref("");
const aiLoading = ref(false);
const aiPromptHistory = ref<string[]>([]);
const aiPromptHistoryIndex = ref(-1);
const aiShortcuts = ref<AiPromptShortcut[]>([]);
const { t, locale } = useI18n();
const { confirmDialog, requestConfirm, closeConfirmDialog } = useConfirmDialog();
const { pageTitle, pageSubtitle, pageFavicon } = usePageDisplay(t);
let refreshRequestId = 0;
let scheduledRefreshId: number | undefined;

const isPrimaryWindow = computed(() => windowContext.value?.role === "primary");
const isWindowContextReady = computed(() => Boolean(windowContext.value));
const aiPromptPreview = computed(() => JSON.stringify(
  buildAiRequestPreview(aiConfig.value, workspaceState.value, aiPrompt.value.trim()),
  null,
  2,
));
const localizedAiPreview = computed(() =>
  aiPreview.value.map((item) => ({
    text: aiPreviewText(item),
    risk: item.risk,
  })),
);
const workspaces = computed(() =>
  [...workspaceState.value.workspaces].sort((a, b) => a.order - b.order),
);
const allPages = computed(() => [
  ...workspaceState.value.unmanagedPages,
  ...workspaceState.value.unmanagedGroups.flatMap((group) => group.pages),
  ...workspaceState.value.workspaces.flatMap((workspace) => workspace.pages),
]);

function findPage(pageId: string | null) {
  if (!pageId) return undefined;

  return allPages.value.find((page) => page.id === pageId);
}

function setWorkspaceSectionElement(workspaceId: string, element: unknown) {
  workspaceSectionElements.value[workspaceId] = element instanceof HTMLElement ? element : null;
}

function setWorkspaceTitleInput(workspaceId: string, element: unknown) {
  workspaceTitleInputs.value[workspaceId] = element instanceof HTMLInputElement ? element : null;
}

function setPageTitleInput(bookmarkId: string, element: unknown) {
  pageTitleInputs.value[bookmarkId] = element instanceof HTMLInputElement ? element : null;
}

function scrollToWorkspace(workspaceId: string) {
  workspaceSectionElements.value[workspaceId]?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function workspaceOpenPageCount(workspace: WorkspaceView) {
  return workspace.pages.filter((page) => page.open).length;
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

async function createPage() {
  if (currentWindowId.value === undefined) return;

  await sendMessage({ type: "CREATE_PAGE", windowId: currentWindowId.value });
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

function isEditingWorkspace(workspace: WorkspaceView) {
  return editingWorkspaceId.value === workspace.id;
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

const {
  editingUnmanagedGroupId,
  unmanagedItems,
  unmanagedGroupColorPickerId,
  setUnmanagedSectionElement,
  scrollToUnmanaged,
  unmanagedOpenPageCount,
  updateUnmanagedGroupTitle,
  editUnmanagedGroupTitle,
  updateUnmanagedGroupColor,
  ungroupUnmanagedGroup,
} = useUnmanagedPanel({
  workspaceState,
  openColorPickerGroupId,
  sendMessage,
  refreshTabs,
});

const {
  draggedPageId,
  draggedWorkspaceId,
  draggedUnmanagedGroupId,
  dragOverKey,
  pageGapKey,
  unmanagedTopGapKey,
  unmanagedGroupPageGapKey,
  workspaceNavKey,
  workspaceNavGapKey,
  tempNavKey,
  workspaceGapKey,
  onPageDragStart,
  onWorkspaceDragStart,
  onUnmanagedGroupDragStart,
  onWorkspaceGapDragOver,
  onWorkspaceSectionDragOver,
  onWorkspaceSectionDrop,
  onPageGapDragOver,
  onPageItemDragOver,
  onPageItemDrop,
  onDragLeave,
  onPageGapDrop,
  onWorkspaceNavDragOver,
  onWorkspaceNavDrop,
  onWorkspaceNavGapDragOver,
  onWorkspaceNavGapDrop,
  onWorkspaceNavItemDragOver,
  onWorkspaceNavItemDrop,
  onTempNavDragOver,
  onTempNavDrop,
  onUnmanagedTopGapDragOver,
  onUnmanagedTopItemDragOver,
  onUnmanagedTopItemDrop,
  onUnmanagedTopDrop,
  onUnmanagedGroupPageGapDragOver,
  onUnmanagedGroupPageItemDragOver,
  onUnmanagedGroupPageItemDrop,
  onUnmanagedGroupPageDrop,
  onWorkspaceDrop,
  onDragEnd,
} = useSidepanelDrag({
  workspaceState,
  workspaces,
  unmanagedItems,
  currentWindowId,
  isEditableElement,
  findPage,
  sendMessage,
  refreshTabs,
  scrollToWorkspace,
  scrollToUnmanaged,
  isEditingWorkspace,
});

async function toggleAiDock() {
  if (isAiDockOpen.value) {
    closeAiDock();
    return;
  }

  await openAiDock();
}

async function openAiDock() {
  aiConfig.value = await loadAiProviderConfig();
  aiPromptHistory.value = await loadAiPromptHistory();
  aiShortcuts.value = await loadAiPromptShortcuts(locale);
  aiPromptHistoryIndex.value = -1;
  aiError.value = "";
  aiPreview.value = [];
  aiActions.value = [];
  isAiDockOpen.value = true;
}

function closeAiDock() {
  isAiDockOpen.value = false;
  aiError.value = "";
  aiLoading.value = false;
}

function clearAiPlan() {
  aiError.value = "";
  aiPreview.value = [];
  aiActions.value = [];
}

async function saveAiSettings() {
  await saveAiProviderConfig(aiConfig.value);
  await saveCustomAiPromptShortcuts(aiShortcuts.value, locale);
  aiShortcuts.value = await loadAiPromptShortcuts(locale);
}

async function generateAiPlan() {
  await runAiPrompt(aiPrompt.value.trim());
}

async function runAiShortcut(prompt: string) {
  await openAiDock();
  await runAiPrompt(prompt);
}

async function runAiPrompt(prompt: string) {
  if (!prompt) {
    aiError.value = t("aiPromptRequired");
    return;
  }
  if (!aiConfig.value.apiKey.trim()) {
    aiError.value = t("aiApiKeyRequired");
    return;
  }

  aiLoading.value = true;
  aiError.value = "";
  aiPreview.value = [];
  aiActions.value = [];

  try {
    await saveAiProviderConfig(aiConfig.value);
    aiPromptHistory.value = await saveAiPromptHistory(prompt);
    aiPromptHistoryIndex.value = -1;
    const plan = await generateAiActionPlan(aiConfig.value, workspaceState.value, prompt);
    const validation = validateAiActionPlan(plan, workspaceState.value);
    if (!validation.ok) {
      aiError.value = validation.error;
      return;
    }

    const enriched = enrichAiActionsForPrompt(
      validation.actions,
      workspaceState.value,
      prompt,
    );

    aiActions.value = enriched.actions;
    aiPreview.value = [...validation.preview, ...enriched.preview].length
      ? [...validation.preview, ...enriched.preview]
      : [{ type: "no_actions", risk: "normal" }];
    aiPrompt.value = "";
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : t("aiRequestFailed");
  } finally {
    aiLoading.value = false;
  }
}

function updateAiShortcuts(shortcuts: AiPromptShortcut[]) {
  aiShortcuts.value = shortcuts;
}

function addAiShortcut() {
  aiShortcuts.value = [...aiShortcuts.value, createAiPromptShortcut()];
}

function deleteAiShortcut(shortcutId: string) {
  aiShortcuts.value = aiShortcuts.value.filter((shortcut) => shortcut.id !== shortcutId);
}

function aiPreviewText(item: AiActionPreview) {
  switch (item.type) {
    case "rename_workspace":
      return t("aiPreviewRenameWorkspace", item.values);
    case "create_workspace":
      return t("aiPreviewCreateWorkspace", item.values);
    case "move_page":
      return t("aiPreviewMovePage", item.values);
    case "pin_page":
      return item.values?.workspace
        ? t("aiPreviewPinPage", item.values)
        : t("aiPreviewPinPageNoWorkspace", item.values);
    case "unpin_page":
      return t("aiPreviewUnpinPage", item.values);
    case "close_page":
      return t("aiPreviewClosePage", item.values);
    case "delete_workspace":
      return t("aiPreviewDeleteWorkspace", item.values);
    case "close_workspace_pages":
      return t("aiPreviewCloseWorkspacePages", item.values);
    case "rename_page":
      return t("aiPreviewRenamePage", item.values);
    case "no_actions":
      return t("aiNoActions");
  }
}

function selectAiPromptHistory(offset: number) {
  if (aiPromptHistory.value.length === 0) return;

  const nextIndex = Math.max(
    -1,
    Math.min(aiPromptHistoryIndex.value + offset, aiPromptHistory.value.length - 1),
  );
  aiPromptHistoryIndex.value = nextIndex;
  aiPrompt.value = nextIndex === -1 ? "" : aiPromptHistory.value[nextIndex];
}

async function applyAiPlan() {
  if (currentWindowId.value === undefined || aiActions.value.length === 0) return;

  aiLoading.value = true;
  aiError.value = "";
  try {
    const response = await sendMessage<{ ok?: boolean; error?: string }>({
      type: "APPLY_AI_ACTIONS",
      windowId: currentWindowId.value,
      actions: aiActions.value,
    });
    if (response?.ok === false) {
      aiError.value = response.error || t("aiApplyFailed");
      return;
    }
    aiPreview.value = [];
    aiActions.value = [];
    await refreshTabs();
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : t("aiApplyFailed");
  } finally {
    aiLoading.value = false;
  }
}

onMounted(async () => {
  await refreshAll();
  aiShortcuts.value = await loadAiPromptShortcuts(locale);

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
      :workspace-nav-gap-key="workspaceNavGapKey"
      :temp-nav-key="tempNavKey"
      :workspace-open-page-count="workspaceOpenPageCount"
      @workspace-click="scrollToWorkspace"
      @workspace-dragstart="onWorkspaceDragStart"
      @dragend="onDragEnd"
      @workspace-nav-gap-dragover="onWorkspaceNavGapDragOver"
      @workspace-nav-gap-dragleave="onDragLeave"
      @workspace-nav-gap-drop="onWorkspaceNavGapDrop"
      @workspace-dragover="onWorkspaceNavItemDragOver"
      @workspace-dragleave="onDragLeave"
      @workspace-drop="onWorkspaceNavItemDrop"
      @temp-click="scrollToUnmanaged"
      @temp-dragover="onTempNavDragOver"
      @temp-dragleave="onDragLeave"
      @temp-drop="onTempNavDrop"
    />

    <section class="groups" :aria-label="t('openTabs')">
      <!-- docs/product-logic.md: Mooring 管理的 Workspace 区域排在 Unmanaged 区域前面。 -->
      <WorkspaceSection
        v-for="(workspace, workspaceIndex) in workspaces"
        :key="workspace.id"
        :workspace="workspace"
        :workspace-index="workspaceIndex"
        :group-colors="GROUP_COLORS"
        :drag-over-key="dragOverKey"
        :dragged-workspace-id="draggedWorkspaceId"
        :dragged-page-id="draggedPageId"
        :editing-workspace-id="editingWorkspaceId"
        :editing-bookmark-id="editingBookmarkId"
        :open-color-picker-group-id="openColorPickerGroupId"
        :labels="{
          doubleClickToggleWorkspace: t('doubleClickToggleWorkspace'),
          groupColor: t('groupColor'),
          groupTitle: t('groupTitle'),
          showWorkspace: t('showWorkspace'),
          hideWorkspace: t('hideWorkspace'),
          deleteWorkspace: t('deleteWorkspace'),
          closeWorkspacePages: t('closeWorkspacePages'),
          emptyWorkspaceDrop: t('emptyWorkspaceDrop'),
          bookmarkTitle: t('bookmarkTitle'),
          restorePinnedPage: t('restorePinnedPage'),
          unpinPage: t('unpinPage'),
          pinPage: t('pinPage'),
          closePage: t('closePage'),
        }"
        :group-color-style="groupColorStyle"
        :workspace-gap-key="workspaceGapKey"
        :page-gap-key="pageGapKey"
        :page-title="pageTitle"
        :page-subtitle="pageSubtitle"
        :page-favicon="pageFavicon"
        :is-editing-workspace="isEditingWorkspace"
        :is-editing-page="isEditingPage"
        @workspace-gap-dragover="onWorkspaceGapDragOver"
        @workspace-gap-dragleave="onDragLeave"
        @workspace-gap-drop="onWorkspaceDrop"
        @set-workspace-element="setWorkspaceSectionElement"
        @workspace-section-dragover="onWorkspaceSectionDragOver"
        @workspace-section-drop="onWorkspaceSectionDrop"
        @workspace-dragstart="onWorkspaceDragStart"
        @dragend="onDragEnd"
        @toggle-workspace-from-header="toggleWorkspaceFromHeader"
        @toggle-color-picker="toggleColorPicker"
        @update-workspace-color="updateWorkspaceColor"
        @set-workspace-title-input="setWorkspaceTitleInput"
        @update-workspace-title="updateWorkspaceTitle"
        @edit-workspace-title="editWorkspaceTitle"
        @toggle-workspace="toggleWorkspace"
        @delete-workspace="deleteWorkspace"
        @close-workspace-pages="closeWorkspacePages"
        @page-gap-dragover="onPageGapDragOver"
        @page-gap-dragleave="onDragLeave"
        @page-gap-drop="onPageGapDrop"
        @page-item-dragover="onPageItemDragOver"
        @page-item-drop="onPageItemDrop"
        @page-dragstart="onPageDragStart"
        @open-workspace-page="openWorkspacePage"
        @set-page-title-input="setPageTitleInput"
        @update-pinned-page-title="updatePinnedPageTitle"
        @stop-input-drag="stopInputDrag"
        @restore-pinned-page="restorePinnedPage"
        @edit-pinned-page-title="editPinnedPageTitle"
        @toggle-pinned-page="togglePinnedPage"
        @close-workspace-page="closeWorkspacePage"
      />
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

    <FloatingActions
      :new-page-label="t('newPage')"
      :new-workspace-label="t('newWorkspace')"
      @create-page="createPage"
      @create-workspace="createWorkspace"
    />

    <AiActionDock
      v-model:config="aiConfig"
      v-model:prompt="aiPrompt"
      :open="isAiDockOpen"
      :preview="localizedAiPreview"
      :error="aiError"
      :loading="aiLoading"
      :has-plan="aiActions.length > 0"
      :prompt-preview="aiPromptPreview"
      :shortcuts="aiShortcuts"
      :labels="{
        title: t('aiAction'),
        prompt: t('aiPromptPlaceholder'),
        apiStyle: t('aiApiStyle'),
        openAiStyle: t('aiApiStyleOpenAi'),
        anthropicStyle: t('aiApiStyleAnthropic'),
        baseUrl: t('aiBaseUrl'),
        apiKey: t('aiApiKey'),
        model: t('aiModel'),
        save: t('save'),
        apply: aiLoading ? t('aiApplying') : t('aiApply'),
        cancel: t('cancel'),
        confirm: t('confirm'),
        settings: t('settings'),
        promptInfo: t('aiPromptInfo'),
        shortcuts: t('aiShortcuts'),
        addShortcut: t('aiAddShortcut'),
        shortcutTitle: t('aiShortcutTitle'),
        shortcutPrompt: t('aiShortcutPrompt'),
        builtInShortcut: t('aiBuiltInShortcut'),
        deleteShortcut: t('aiDeleteShortcut'),
      }"
      @update:shortcuts="updateAiShortcuts"
      @toggle="toggleAiDock"
      @generate="generateAiPlan"
      @run-shortcut="runAiShortcut"
      @apply="applyAiPlan"
      @clear-plan="clearAiPlan"
      @cancel="closeAiDock"
      @save-settings="saveAiSettings"
      @add-shortcut="addAiShortcut"
      @delete-shortcut="deleteAiShortcut"
      @history-prev="selectAiPromptHistory(1)"
      @history-next="selectAiPromptHistory(-1)"
    />

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
