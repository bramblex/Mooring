<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { AiClassificationPreview } from "../models/ai-classification.model";
import {
  validateAiClassificationPlan,
  visibleUnmanagedPages,
} from "../models/ai-classification.model";
import { useI18n } from "../i18n";
import type { DeleteHistoryItem } from "../models/delete-history.model";
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
  generateAiClassificationPlan,
  getBuiltInAiStatus,
  type BuiltInAiStatus,
} from "./ai/chrome-built-in";
import AiClassifierDock from "./components/AiClassifierDock.vue";

const ONBOARDING_STORAGE_KEY = "mooringOnboardingDismissed";

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
const isAiAvailable = ref(false);
const aiStatus = ref<BuiltInAiStatus>({
  supported: false,
  availability: "checking",
  enabled: false,
  checkedAt: "",
});
const isAiPanelOpen = ref(false);
const aiSuggestions = ref<AiClassificationPreview[]>([]);
const selectedAiPageIds = ref<string[]>([]);
const aiError = ref("");
const aiLoading = ref(false);
const deleteHistory = ref<DeleteHistoryItem[]>([]);
const showOnboarding = ref(false);
const { t } = useI18n();
const { confirmDialog, requestConfirm, closeConfirmDialog } = useConfirmDialog();
const { pageTitle, pageSubtitle, pageFavicon } = usePageDisplay(t);
let refreshRequestId = 0;
let scheduledRefreshId: number | undefined;

const isPrimaryWindow = computed(() => windowContext.value?.role === "primary");
const isWindowContextReady = computed(() => Boolean(windowContext.value));
const showAiEntry = computed(() => (
  aiStatus.value.supported
  && !["missing", "unavailable", "error"].includes(aiStatus.value.availability)
));
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
  const scopedMessage = currentWindowId.value === undefined || "windowId" in message
    ? message
    : { ...message, windowId: currentWindowId.value };
  return chrome.runtime.sendMessage(scopedMessage) as Promise<T>;
}

async function refreshTabs() {
  if (!isPrimaryWindow.value || currentWindowId.value === undefined) {
    workspaceState.value = { workspaces: [], unmanagedPages: [], unmanagedGroups: [] };
    return;
  }

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
  await refreshDeleteHistory();
}

async function refreshDeleteHistory() {
  deleteHistory.value = await sendMessage<DeleteHistoryItem[]>({
    type: "GET_DELETE_HISTORY",
  });
}

async function loadOnboardingState() {
  const stored = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
  showOnboarding.value = !stored[ONBOARDING_STORAGE_KEY];
}

async function dismissOnboarding() {
  showOnboarding.value = false;
  await chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: true });
}

function handleDocumentContextMenu(event: MouseEvent) {
  if (isEditableElement(event.target)) return;

  event.preventDefault();
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target;

  if (target instanceof HTMLElement && target.closest(".group-color-picker")) return;

  openColorPickerGroupId.value = null;
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
  await refreshDeleteHistory();
}

async function closeWorkspacePages(workspace: WorkspaceView) {
  if (!await requestConfirm(t("closeWorkspacePagesConfirm"))) return;

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
    await refreshDeleteHistory();
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

async function refreshAiStatus() {
  aiStatus.value = await getBuiltInAiStatus();
  isAiAvailable.value = aiStatus.value.enabled;
}

async function restoreDeleteHistoryItem(item: DeleteHistoryItem) {
  if (!await requestConfirm(t("restoreDeleteHistoryConfirm"))) return;

  await sendMessage({
    type: "RESTORE_DELETE_HISTORY_ITEM",
    itemId: item.id,
  });
  await refreshTabs();
  await refreshDeleteHistory();
}

function formatDeletedAt(deletedAt: number) {
  if (!deletedAt) return "";
  return new Date(deletedAt).toLocaleString();
}

async function classifyUnmanagedPages() {
  isAiPanelOpen.value = true;
  aiError.value = "";
  aiSuggestions.value = [];
  selectedAiPageIds.value = [];
  await refreshAiStatus();

  if (aiStatus.value.availability === "downloading") {
    aiError.value = t("aiDownloading");
    return;
  }
  if (!isAiAvailable.value) return;
  if (workspaces.value.length === 0) {
    aiError.value = t("aiNoWorkspaces");
    return;
  }
  if (visibleUnmanagedPages(workspaceState.value).length === 0) {
    aiError.value = t("aiNoUnmanagedPages");
    return;
  }

  aiLoading.value = true;
  try {
    const plan = await generateAiClassificationPlan(workspaceState.value);
    const validation = validateAiClassificationPlan(plan, workspaceState.value);
    if (!validation.ok) {
      aiError.value = validation.error;
      return;
    }

    aiSuggestions.value = validation.suggestions;
    selectedAiPageIds.value = validation.suggestions.map((suggestion) => suggestion.pageId);
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : t("aiRequestFailed");
  } finally {
    aiLoading.value = false;
  }
}

function closeAiPanel() {
  isAiPanelOpen.value = false;
  aiError.value = "";
  aiLoading.value = false;
}

function toggleAiSuggestion(pageId: string) {
  selectedAiPageIds.value = selectedAiPageIds.value.includes(pageId)
    ? selectedAiPageIds.value.filter((id) => id !== pageId)
    : [...selectedAiPageIds.value, pageId];
}

async function applyAiClassifications() {
  if (currentWindowId.value === undefined || selectedAiPageIds.value.length === 0) return;

  aiLoading.value = true;
  aiError.value = "";
  try {
    const selectedIds = new Set(selectedAiPageIds.value);
    for (const suggestion of aiSuggestions.value) {
      if (!selectedIds.has(suggestion.pageId)) continue;
      const response = await sendMessage<{ ok?: boolean; error?: string }>({
        type: "MOVE_WORKSPACE_PAGE",
        pageId: suggestion.pageId,
        workspaceId: suggestion.workspaceId,
        index: Number.MAX_SAFE_INTEGER,
        windowId: currentWindowId.value,
      });
      if (response?.ok === false) {
        aiError.value = response.error || t("aiApplyFailed");
        return;
      }
    }
    aiSuggestions.value = [];
    selectedAiPageIds.value = [];
    isAiPanelOpen.value = false;
    await refreshTabs();
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : t("aiApplyFailed");
  } finally {
    aiLoading.value = false;
  }
}

onMounted(async () => {
  await refreshAll();
  await loadOnboardingState();
  await refreshAiStatus();

  document.addEventListener("contextmenu", handleDocumentContextMenu);
  document.addEventListener("click", handleDocumentClick);

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

  document.removeEventListener("contextmenu", handleDocumentContextMenu);
  document.removeEventListener("click", handleDocumentClick);

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

    <section v-if="showOnboarding" class="onboarding-panel" :aria-label="t('onboardingTitle')">
      <div class="onboarding-copy">
        <h1>{{ t("onboardingTitle") }}</h1>
        <p>{{ t("onboardingDescription") }}</p>
        <ul>
          <li>{{ t("onboardingDrag") }}</li>
          <li>{{ t("onboardingPin") }}</li>
          <li>{{ t("onboardingWindow") }}</li>
        </ul>
      </div>
      <button
        type="button"
        class="confirm-button onboarding-dismiss-button"
        :title="t('onboardingDismiss')"
        :aria-label="t('onboardingDismiss')"
        @click="dismissOnboarding"
      >
        {{ t("onboardingDismiss") }}
      </button>
    </section>

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
      :trash-label="t('deleteHistory')"
      :restore-label="t('restore')"
      :empty-trash-label="t('deleteHistoryEmpty')"
      :delete-history="deleteHistory"
      :format-deleted-at="formatDeletedAt"
      @create-page="createPage"
      @create-workspace="createWorkspace"
      @restore-delete-history-item="restoreDeleteHistoryItem"
    />

    <AiClassifierDock
      v-if="showAiEntry"
      :available="isAiAvailable"
      :open="isAiPanelOpen"
      :suggestions="aiSuggestions"
      :selected-page-ids="selectedAiPageIds"
      :error="aiError"
      :loading="aiLoading"
      :labels="{
        title: t('aiAction'),
        unavailable: aiStatus.error || t('aiUnavailable'),
        loading: t('aiClassifying'),
        empty: t('aiNoSuggestions'),
        apply: aiLoading ? t('aiApplying') : t('aiApply'),
        cancel: t('cancel'),
      }"
      @classify="classifyUnmanagedPages"
      @apply="applyAiClassifications"
      @cancel="closeAiPanel"
      @toggle-suggestion="toggleAiSuggestion"
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
