<script setup>
defineProps({
  variant: {
    type: String,
    default: 'text',
    validator: (v) => ['text', 'circular', 'rectangular', 'card'].includes(v)
  },
  width: {
    type: String,
    default: '100%'
  },
  height: {
    type: String,
    default: null
  },
  lines: {
    type: Number,
    default: 1
  }
})

const variantClasses = {
  text: 'h-4 rounded',
  circular: 'rounded-full',
  rectangular: 'rounded-lg',
  card: 'rounded-xl'
}

const defaultHeights = {
  text: '1rem',
  circular: '40px',
  rectangular: '100px',
  card: '200px'
}
</script>

<template>
  <div v-if="variant === 'text' && lines > 1" class="space-y-2">
    <div 
      v-for="i in lines" 
      :key="i"
      class="animate-pulse bg-gray-200"
      :class="variantClasses[variant]"
      :style="{ 
        width: i === lines ? '70%' : width,
        height: height || defaultHeights[variant]
      }"
    ></div>
  </div>
  
  <div 
    v-else
    class="animate-pulse bg-gray-200"
    :class="variantClasses[variant]"
    :style="{ 
      width: variant === 'circular' ? (height || defaultHeights[variant]) : width,
      height: height || defaultHeights[variant]
    }"
  ></div>
</template>
