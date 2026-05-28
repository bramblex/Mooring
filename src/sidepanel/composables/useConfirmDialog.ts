import { ref } from "vue";

export type ConfirmDialogState = {
  message: string;
  resolve: (confirmed: boolean) => void;
};

export function useConfirmDialog() {
  const confirmDialog = ref<ConfirmDialogState | null>(null);

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

  return {
    confirmDialog,
    requestConfirm,
    closeConfirmDialog,
  };
}
