<script setup>
defineProps({
  icon: {
    type: String,
    default: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2'
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  actionLabel: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['action'])
</script>

<template>
  <div class="text-center py-12 px-2">
    <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100/90 ring-1 ring-gray-200/60 flex items-center justify-center">
      <svg class="w-7 h-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" :d="icon" />
      </svg>
    </div>
    
    <h3 class="text-[17px] font-semibold text-gray-900 tracking-tight">{{ title }}</h3>
    <p v-if="description" class="mt-2 text-[15px] text-gray-500 max-w-sm mx-auto leading-relaxed">{{ description }}</p>
    
    <button 
      v-if="actionLabel"
      type="button"
      @click="emit('action')"
      class="mt-5 inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary-900 text-white hover:bg-primary-800 transition-colors shadow-sm shadow-primary-900/15"
    >
      {{ actionLabel }}
    </button>
    
    <slot />
  </div>
</template>
