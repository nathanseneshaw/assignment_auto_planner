<script setup>
import { ref } from 'vue'

defineProps({
  text: {
    type: String,
    required: true
  },
  position: {
    type: String,
    default: 'top',
    validator: (v) => ['top', 'bottom', 'left', 'right'].includes(v)
  }
})

const show = ref(false)

const positionClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2'
}

const arrowClasses = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900',
  right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900'
}
</script>

<template>
  <div 
    class="relative inline-block"
    @mouseenter="show = true"
    @mouseleave="show = false"
  >
    <slot />
    
    <Transition name="tooltip">
      <div 
        v-if="show"
        class="absolute z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded-lg whitespace-nowrap"
        :class="positionClasses[position]"
      >
        {{ text }}
        <div 
          class="absolute w-0 h-0 border-4 border-transparent"
          :class="arrowClasses[position]"
        ></div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.15s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
