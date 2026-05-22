<script setup>
defineProps({
  padding: {
    type: String,
    default: 'md',
    validator: (v) => ['none', 'sm', 'md', 'lg'].includes(v)
  },
  hover: {
    type: Boolean,
    default: false
  },
  clickable: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8'
}
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_2px_8px_rgba(28,25,23,0.04)] transition-[box-shadow,border-color,transform] duration-200 ease-out"
    :class="[
      paddingClasses[padding],
      hover ? 'hover:shadow-[0_4px_16px_rgba(28,25,23,0.07)] hover:border-gray-300/90 dark:hover:border-gray-600/90' : '',
      clickable ? 'cursor-pointer active:scale-[0.995]' : ''
    ]"
    @click="clickable ? emit('click', $event) : null"
  >
    <slot />
  </div>
</template>
