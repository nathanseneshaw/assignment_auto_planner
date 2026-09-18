<script setup>
import { computed } from 'vue'
import Spinner from './Spinner.vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'danger', 'ghost', 'outline'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  loading: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  icon: {
    type: Boolean,
    default: false
  },
  block: {
    type: Boolean,
    default: false
  },
  // When set, the button renders as a real <a href> (keeping button styling),
  // so link-like actions get native behaviors: open in new tab, copy address,
  // middle-click. Pair with RouterLink's custom slot: :href="href" @click="navigate".
  href: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['click'])

const variantClasses = {
  primary: 'bg-primary-900 text-white hover:bg-primary-800 focus-visible:ring-primary-500/35 shadow-sm shadow-primary-900/15',
  secondary: 'bg-surface text-gray-800 border border-gray-200/90 hover:bg-gray-50 hover:border-gray-300 focus-visible:ring-gray-400/25 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-700 dark:hover:border-gray-600',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500/35 shadow-sm shadow-danger-600/15',
  ghost: 'bg-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 focus-visible:ring-gray-400/20',
  outline: 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50/90 hover:border-gray-400 focus-visible:ring-gray-400/25'
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base'
}

const iconSizeClasses = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3'
}

// One notch below the label's own size, so the spinner reads as a companion to
// the text rather than competing with it.
const spinnerSizes = { sm: 'xs', md: 'sm', lg: 'md' }
const spinnerWidths = { sm: '12px', md: '14px', lg: '18px' }
const spinnerGaps = { sm: '0.375rem', md: '0.5rem', lg: '0.5rem' }

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-xl font-semibold text-[13px] transition-[color,background-color,box-shadow,border-color,transform] duration-200 ease-out',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  // Disabled: a clean, warm-neutral fill rather than a washed-out tint of the
  // variant color (a 50%-opacity emerald read as muddy sage over white panels).
  // A loading button is disabled too, but it must NOT take this treatment: it
  // is busy, not unavailable, so it keeps its variant color and just shows a
  // wait cursor (no pointer-events-none, or the cursor would never appear).
  props.loading
    ? 'disabled:cursor-progress'
    : 'disabled:cursor-not-allowed disabled:pointer-events-none disabled:bg-gray-100 dark:disabled:bg-gray-700/50 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:border-transparent disabled:shadow-none',
  'active:scale-[0.98]',
  variantClasses[props.variant],
  props.icon ? iconSizeClasses[props.size] : sizeClasses[props.size],
  props.block ? 'w-full' : ''
])

function handleClick(e) {
  if (!props.loading && !props.disabled) {
    emit('click', e)
  }
}
</script>

<template>
  <component
    :is="href ? 'a' : 'button'"
    :class="classes"
    :href="href || undefined"
    :disabled="href ? undefined : (disabled || loading)"
    :aria-busy="loading ? 'true' : undefined"
    @click="handleClick"
  >
    <!-- The spinner grows in beside the label instead of covering it, so the
         button keeps its name for screen readers and for anyone mid-read when
         the click lands. `aria-busy` above carries the state; the spinner
         itself stays decorative so the accessible name never changes.
         Icon-only buttons have no label to sit beside, so there the spinner
         simply takes the icon's place. -->
    <Transition name="btn-spinner">
      <span
        v-if="loading"
        class="btn-spinner"
        :class="{ 'btn-spinner--solo': icon }"
        :style="{ '--btn-spinner-w': spinnerWidths[size], '--btn-spinner-gap': spinnerGaps[size] }"
      >
        <Spinner :size="spinnerSizes[size]" label="" />
      </span>
    </Transition>

    <slot v-if="!icon || !loading" />
  </component>
</template>

<style scoped>
/* Collapsing wrapper: width and gap animate from zero, so starting work slides
   the spinner out of the label's left edge rather than snapping the button to
   a new width. */
.btn-spinner {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  width: var(--btn-spinner-w);
  margin-right: var(--btn-spinner-gap);
}

.btn-spinner--solo {
  margin-right: 0;
}

.btn-spinner-enter-active,
.btn-spinner-leave-active {
  transition:
    width 240ms cubic-bezier(0.22, 1, 0.36, 1),
    margin-right 240ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 170ms ease-out;
}

/* Doubled class so these beat the base rule regardless of source order. */
.btn-spinner.btn-spinner-enter-from,
.btn-spinner.btn-spinner-leave-to {
  width: 0;
  margin-right: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .btn-spinner-enter-active,
  .btn-spinner-leave-active {
    transition: none;
  }
}
</style>
