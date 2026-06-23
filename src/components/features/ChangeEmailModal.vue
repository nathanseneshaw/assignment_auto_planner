<script setup>
/**
 * Change-email modal.
 *
 * The user types the new address; on Save, Supabase sends a verification link
 * to that address (delivered through the configured SMTP provider, Resend).
 * Clicking the link lands on /auth/verify-email and applies the change. We keep
 * the modal open and switch to a "check your inbox" confirmation — the actual
 * swap only happens once the user confirms from the new mailbox.
 */
import { ref, computed, watch } from 'vue'
import { Modal, Input, Button } from '../ui'
import { useAuthStore } from '../../stores/auth'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const authStore = useAuthStore()

const currentEmail = computed(() => authStore.user?.email || '')

const newEmail = ref('')
const errorMessage = ref('')
// Holds the address we sent the link to once a request succeeds; presence of
// this value flips the modal into its "check your inbox" confirmation state.
const sentTo = ref('')
const loading = ref(false)

function reset() {
  newEmail.value = ''
  errorMessage.value = ''
  sentTo.value = ''
  loading.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  }
)

function close() {
  emit('update:modelValue', false)
}

// Pragmatic format check — server/Supabase is the real authority.
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function onSave() {
  errorMessage.value = ''
  const value = newEmail.value.trim()

  if (!value) {
    errorMessage.value = 'Please enter your new email address.'
    return
  }
  if (!isValidEmail(value)) {
    errorMessage.value = 'That doesn’t look like a valid email address.'
    return
  }
  if (value.toLowerCase() === currentEmail.value.toLowerCase()) {
    errorMessage.value = 'That’s already your current email address.'
    return
  }

  loading.value = true
  try {
    const { error } = await authStore.updateEmail(value)
    if (error) {
      errorMessage.value = error.message || 'Could not start the email change.'
      return
    }
    sentTo.value = value
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    size="md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <h3 class="display text-xl text-gray-900 dark:text-gray-100">Change email</h3>
    </template>

    <!-- Confirmation state: link sent, waiting on the new inbox. -->
    <div v-if="sentTo" class="text-center py-2">
      <div
        class="mx-auto mb-4 w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center"
      >
        <svg class="w-6 h-6 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>
      <p class="text-sm text-gray-700 dark:text-gray-300">
        We sent a verification link to
        <strong class="text-gray-900 dark:text-gray-100">{{ sentTo }}</strong>.
      </p>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
        Open it and confirm to finish changing your email. The change applies once you
        click the link, so you can close this window.
      </p>
    </div>

    <!-- Entry state. -->
    <form v-else class="space-y-4" @submit.prevent="onSave">
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">New email</label>
        <Input
          v-model="newEmail"
          type="email"
          placeholder="you@school.edu"
          autocomplete="email"
        />
        <p v-if="currentEmail" class="font-mono text-[11px] text-gray-400 dark:text-gray-500">
          Current: {{ currentEmail }}
        </p>
      </div>

      <p
        v-if="errorMessage"
        class="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 border border-danger-200/80 dark:border-danger-700/50 rounded-lg px-3 py-2"
      >
        {{ errorMessage }}
      </p>

      <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
    </form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <template v-if="sentTo">
          <Button @click="close">Done</Button>
        </template>
        <template v-else>
          <Button variant="secondary" :disabled="loading" @click="close">Cancel</Button>
          <Button :loading="loading" :disabled="loading" @click="onSave">Send verification</Button>
        </template>
      </div>
    </template>
  </Modal>
</template>
