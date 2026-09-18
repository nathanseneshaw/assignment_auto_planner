<script setup>
/**
 * The one loading indicator in the app: a rounded arc sweeping over a faint
 * track ring. It replaces the old quarter-wedge SVG, whose hard opacity split
 * flickered at small sizes and read as a chunky pinwheel next to our type.
 *
 * Colour comes from `currentColor`, so it inherits whatever text colour it
 * sits in (and a `text-*` class on the component overrides that as expected).
 */
defineProps({
  // xs 12px, sm 14px, md 18px, lg 26px. xs/sm sit inline with body copy,
  // sm/md ride next to a button label, lg anchors a block-level loading panel.
  size: {
    type: String,
    default: 'sm',
    validator: (v) => ['xs', 'sm', 'md', 'lg'].includes(v)
  },
  // Announced when the spinner appears. Pass an empty string for decorative
  // spinners that sit beside text (or inside a button) already saying what is
  // happening, so screen readers don't hear "Loading" twice.
  label: {
    type: String,
    default: 'Loading'
  }
})

const pixels = { xs: 12, sm: 14, md: 18, lg: 26 }

// Stroke is in viewBox units, so it has to thin out as the spinner grows or a
// large one reads as a donut instead of a ring.
const strokes = { xs: 3, sm: 2.75, md: 2.5, lg: 2.25 }
</script>

<template>
  <span
    class="plr-spinner"
    :style="{ '--plr-spinner-size': pixels[size] + 'px' }"
    :role="label ? 'status' : undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <svg class="plr-spinner__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle
        class="plr-spinner__track"
        cx="12" cy="12" r="9"
        stroke="currentColor"
        :stroke-width="strokes[size]"
      />
      <circle
        class="plr-spinner__arc"
        cx="12" cy="12" r="9"
        stroke="currentColor"
        :stroke-width="strokes[size]"
        stroke-linecap="round"
        stroke-dasharray="15 42"
      />
    </svg>
    <span v-if="label" class="sr-only">{{ label }}</span>
  </span>
</template>

<style scoped>
/* The wrapper fades/scales in so a spinner never pops into place; the inner
   SVG owns the rotation. Keeping them on separate elements matters: two
   animations on one element would both fight over `transform`. */
.plr-spinner {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--plr-spinner-size);
  height: var(--plr-spinner-size);
  animation: plr-spinner-in 240ms ease-out both;
}

.plr-spinner__svg {
  width: 100%;
  height: 100%;
  animation: plr-spinner-rotate 850ms linear infinite;
}

.plr-spinner__track {
  opacity: 0.2;
}

@keyframes plr-spinner-rotate {
  to { transform: rotate(360deg); }
}

@keyframes plr-spinner-in {
  from { opacity: 0; transform: scale(0.7); }
  to   { opacity: 1; transform: none; }
}

/* Reduced motion still needs *something* moving, or an indeterminate wait
   looks like a frozen app. Drop the entrance and slow the sweep right down. */
@media (prefers-reduced-motion: reduce) {
  .plr-spinner {
    animation: none;
  }

  .plr-spinner__svg {
    animation-duration: 2.4s;
  }
}
</style>
