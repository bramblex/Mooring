<script setup lang="ts">
defineProps<{
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}>();

defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <div
    class="confirm-overlay"
    role="presentation"
    @click.self="$emit('cancel')"
    @keydown.esc="$emit('cancel')"
  >
    <section
      class="confirm-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="message"
    >
      <p>{{ message }}</p>
      <div class="confirm-actions">
        <button
          class="confirm-button"
          type="button"
          autofocus
          @click="$emit('cancel')"
        >
          {{ cancelLabel }}
        </button>
        <button
          class="confirm-button danger"
          type="button"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
