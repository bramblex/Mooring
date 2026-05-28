import { ref, type ComputedRef, type Ref } from "vue";
import type { PageModel } from "../../models/page.model";
import type { UnmanagedGroupView, WorkspaceState, WorkspaceView } from "../../models/workspace.model";

type UnmanagedItem = {
  type: "page" | "group";
  id: string | number;
  order: number;
};

type SendMessage = <T>(message: Record<string, unknown>) => Promise<T>;

type UseSidepanelDragOptions = {
  workspaceState: Ref<WorkspaceState>;
  workspaces: ComputedRef<WorkspaceView[]>;
  unmanagedItems: ComputedRef<UnmanagedItem[]>;
  currentWindowId: Ref<number | undefined>;
  isEditableElement: (target: EventTarget | null) => boolean;
  findPage: (pageId: string | null) => PageModel | undefined;
  sendMessage: SendMessage;
  refreshTabs: () => Promise<void>;
  scrollToWorkspace: (workspaceId: string) => void;
  scrollToUnmanaged: () => void;
  isEditingWorkspace: (workspace: WorkspaceView) => boolean;
};

export function useSidepanelDrag({
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
}: UseSidepanelDragOptions) {
  const draggedPageId = ref<string | null>(null);
  const draggedPagePinned = ref(false);
  const draggedWorkspaceId = ref<string | null>(null);
  const draggedUnmanagedGroupId = ref<number | null>(null);
  const dragOverKey = ref("");

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

  return {
    draggedPageId,
    draggedPagePinned,
    draggedWorkspaceId,
    draggedUnmanagedGroupId,
    dragOverKey,
    pageGapKey,
    unmanagedTopGapKey,
    unmanagedGroupPageGapKey,
    workspaceNavKey,
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
  };
}
