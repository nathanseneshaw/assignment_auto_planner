<script setup>
/**
 * Presentational row for the "Connected integrations" list.
 *
 * Mirrors the mockup: a soft rounded icon tile, a bold title, a muted mono
 * subtitle, and a right-aligned action slot (a "Connected" pill or a
 * "Connect →" button). Purely visual — all behaviour lives in the parent.
 */
defineProps({
  icon: { type: String, default: '' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <div class="group flex items-center gap-3.5 py-4 border-t border-paper-line dark:border-gray-700/50">
    <!-- Icon tile -->
    <div
      class="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg leading-none select-none bg-white/70 dark:bg-gray-800/70 border border-paper-line dark:border-gray-700/60"
      aria-hidden="true"
    >
      <slot name="icon">{{ icon }}</slot>
    </div>

    <!-- Title + subtitle -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug">
        <slot name="title">{{ title }}</slot>
      </p>
      <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>

    <!-- Right-aligned action -->
    <div class="shrink-0 flex items-center gap-1.5">
      <slot name="action" />
    </div>
  </div>
</template>
