<script setup>
import { ref } from 'vue'
import { Modal, Button } from '../ui'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const authStore = useAuthStore()
const { success, error: toastError } = useToast()

const rating = ref(0)
const hoveredRating = ref(0)
const message = ref('')
const submitting = ref(false)
const submitted = ref(false)

const ratingLabels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent']

function close() {
  emit('update:modelValue', false)
}

function handleClose() {
  close()
  setTimeout(() => {
    rating.value = 0
    hoveredRating.value = 0
    message.value = ''
    submitted.value = false
  }, 300)
}

async function handleSubmit() {
  if (rating.value === 0 || submitting.value) return
  submitting.value = true
  try {
    const { error } = await supabase.from('feedback').insert({
      user_id: authStore.user?.id ?? null,
      rating: rating.value,
      message: message.value.trim() || null,
    })
    if (error) throw error
    submitted.value = true
    success('Thanks for your feedback!')
  } catch {
    toastError('Failed to submit feedback. Please try again.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :modelValue="modelValue" title="Share Feedback" size="sm" @close="handleClose" @update:modelValue="emit('update:modelValue', $event)">
    <!-- Form -->
    <template v-if="!submitted">
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <!-- Star Rating -->
        <div>
          <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2.5">
            How would you rate Plannr? <span class="text-danger-500">*</span>
          </label>
          <div class="flex flex-col items-center gap-2">
            <div class="flex gap-1">
              <button
                v-for="star in 5"
                :key="star"
                type="button"
                class="p-1 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
                @click="rating = star"
                @mouseenter="hoveredRating = star"
                @mouseleave="hoveredRating = 0"
              >
                <svg
                  class="w-9 h-9 transition-all duration-150"
                  :class="star <= (hoveredRating || rating)
                    ? 'text-amber-400 scale-110 drop-shadow-sm'
                    : 'text-gray-200 dark:text-gray-600'"
                  viewBox="0 0 24 24"
                  :fill="star <= (hoveredRating || rating) ? 'currentColor' : 'currentColor'"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            </div>
            <span class="text-sm font-medium h-5 transition-all duration-150"
              :class="(hoveredRating || rating)
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-transparent'"
            >
              {{ ratingLabels[hoveredRating || rating] }}
            </span>
          </div>
        </div>

        <!-- Message -->
        <div>
          <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            Tell us more
            <span class="text-[11px] font-normal text-gray-400 dark:text-gray-500">(optional)</span>
          </label>
          <textarea
            v-model="message"
            rows="3"
            maxlength="1000"
            placeholder="What do you love? What could be better?"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200 resize-none text-sm leading-relaxed"
          />
          <p class="text-right text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            {{ message.length }}/1000
          </p>
        </div>
      </form>
    </template>

    <!-- Success state -->
    <template v-else>
      <div class="flex flex-col items-center py-4 gap-3 text-center">
        <div class="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center ring-1 ring-primary-200/60 dark:ring-primary-800/40">
          <svg class="w-7 h-7 text-primary-700 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p class="text-[15px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
            Thanks for your feedback!
          </p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            It helps us make Plannr better.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-3 justify-end">
        <Button variant="secondary" type="button" @click="handleClose">
          {{ submitted ? 'Close' : 'Cancel' }}
        </Button>
        <Button
          v-if="!submitted"
          variant="primary"
          :loading="submitting"
          :disabled="rating === 0"
          @click="handleSubmit"
        >
          Submit
        </Button>
      </div>
    </template>
  </Modal>
</template>
