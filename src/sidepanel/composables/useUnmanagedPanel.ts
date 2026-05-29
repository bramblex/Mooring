import { computed, ref, type Ref } from "vue";
import type { TabGroupColor, UnmanagedGroupView, WorkspaceState } from "../../models/workspace.model";

type SendMessage = <T>(message: Record<string, unknown>) => Promise<T>;

export function useUnmanagedPanel(options: {
  workspaceState: Ref<WorkspaceState>;
  openColorPickerGroupId: Ref<string | null>;
  sendMessage: SendMessage;
  refreshTabs: () => Promise<void>;
}) {
  // docs/product-logic.md: Unmanaged 区域是 Chrome 原生状态的 UI 投影，
  // 不写 Bookmark，也不承担 Workspace 语义。
  const editingUnmanagedGroupId = ref<number | null>(null);
  const unmanagedSectionElement = ref<HTMLElement | null>(null);

  const unmanagedItems = computed(() => [
    ...options.workspaceState.value.unmanagedPages.map((page) => ({
      type: "page" as const,
      id: page.id,
      order: page.order,
      page,
    })),
    ...options.workspaceState.value.unmanagedGroups.map((group) => ({
      type: "group" as const,
      id: group.id,
      order: group.order,
      group,
    })),
  ].sort((a, b) => a.order - b.order));

  function unmanagedGroupColorPickerId(groupId: number) {
    return `chrome-group:${groupId}`;
  }

  function setUnmanagedSectionElement(element: unknown) {
    unmanagedSectionElement.value = element instanceof HTMLElement ? element : null;
  }

  function scrollToUnmanaged() {
    unmanagedSectionElement.value?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function unmanagedOpenPageCount() {
    const unmanagedGroupPages = options.workspaceState.value.unmanagedGroups.flatMap((group) => group.pages);

    return [...options.workspaceState.value.unmanagedPages, ...unmanagedGroupPages]
      .filter((page) => page.open).length;
  }

  async function updateUnmanagedGroupTitle(group: UnmanagedGroupView, event: Event) {
    const target = event.target as HTMLInputElement;

    await options.sendMessage({
      type: "RENAME_UNMANAGED_GROUP",
      groupId: group.id,
      title: target.value,
    });
    editingUnmanagedGroupId.value = null;
    await options.refreshTabs();
  }

  function editUnmanagedGroupTitle(group: UnmanagedGroupView) {
    editingUnmanagedGroupId.value = group.id;
  }

  async function updateUnmanagedGroupColor(group: UnmanagedGroupView, color: TabGroupColor) {
    await options.sendMessage({
      type: "UPDATE_UNMANAGED_GROUP_COLOR",
      groupId: group.id,
      color,
    });
    options.openColorPickerGroupId.value = null;
    await options.refreshTabs();
  }

  async function ungroupUnmanagedGroup(group: UnmanagedGroupView) {
    await options.sendMessage({
      type: "UNGROUP_UNMANAGED_GROUP",
      groupId: group.id,
    });
    await options.refreshTabs();
  }

  return {
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
  };
}
