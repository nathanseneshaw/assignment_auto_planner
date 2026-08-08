<script setup>
/**
 * Window title bar for the Electron build. The min/max/close buttons are
 * native Windows controls drawn by the OS (titleBarOverlay in electron/main.js),
 * so this is just the draggable strip they sit on: grab anywhere to move the
 * window, double-click to maximize. The overlay is re-tinted on theme change
 * from App.vue. Inert in the browser build - App.vue only mounts this when
 * `isElectron` is true.
 */
</script>

<template>
  <div class="app-titlebar" />
</template>
