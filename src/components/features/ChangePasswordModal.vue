<script setup>
/**
 * Change-password modal.
 *
 * Flow: the user types their current password, a new password, and a re-typed
 * confirmation. On Save we first re-verify the current password (Supabase's
 * updateUser only needs the active session, so this guards against someone
 * changing the password on an unattended, already-signed-in session), then set
 * the new one. The modal stays open and reports success/errors inline.
 */
import { ref, watch } from 'vue'
import { Modal, Input, Button } from '../ui'
import { useAuthStore } from '../../stores/auth'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const authStore = useAuthStore()

// Supabase's default minimum password length. Mirrors the RegisterPage copy.
const MIN_PASSWORD_LENGTH = 6

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const loading = ref(false)

function reset() {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  errorMessage.value = ''
  successMessage.value = ''
  loading.value = false
}

// Start each open with a clean slate so a previous success/error never lingers.
watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  }
)

function close() {
  emit('update:modelValue', false)
}

/** Local validation before we hit the network. Returns an error string or ''. */
function validate() {
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    return 'Please fill in all three fields.'
  }
  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (newPassword.value !== confirmPassword.value) {
    return 'New password and confirmation do not match.'
  }
  if (newPassword.value === currentPassword.value) {
    return 'New password must be different from your current password.'
  }
  return ''
}

async function onSave() {
  errorMessage.value = ''
  successMessage.value = ''

  const validationError = validate()
  if (validationError) {
    errorMessage.value = validationError
    return
  }

  loading.value = true
  try {
    const { error: reauthError } = await authStore.reauthenticatePassword(currentPassword.value)
    if (reauthError) {
      errorMessage.value = 'Your current password is incorrect.'
      return
    }

    const { error: updateError } = await authStore.updatePassword(newPassword.value)
    if (updateError) {
      errorMessage.value = updateError.message || 'Could not update your password.'
      return
    }

    // Success: wipe the fields so the new password isn't left sitting in inputs.
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    successMessage.value = 'Your password has been updated.'
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
      <h3 class="display text-xl text-gray-900 dark:text-gray-100">Change password</h3>
    </template>

    <form class="space-y-4" @submit.prevent="onSave">
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Current password</label>
        <Input
          v-model="currentPassword"
          type="password"
          placeholder="Your current password"
          autocomplete="current-password"
        />
      </div>
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">New password</label>
        <Input
          v-model="newPassword"
          type="password"
          :placeholder="`At least ${MIN_PASSWORD_LENGTH} characters`"
          autocomplete="new-password"
        />
      </div>
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Confirm new password</label>
        <Input
          v-model="confirmPassword"
          type="password"
          placeholder="Re-type your new password"
          autocomplete="new-password"
        />
      </div>

      <p
        v-if="errorMessage"
        class="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 border border-danger-200/80 dark:border-danger-700/50 rounded-lg px-3 py-2"
      >
        {{ errorMessage }}
      </p>
      <p
        v-if="successMessage"
        class="text-sm text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/80 dark:border-emerald-700/50 rounded-lg px-3 py-2"
      >
        {{ successMessage }}
      </p>

      <!-- Submit on Enter without a visible button (the real action is in the footer). -->
      <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
    </form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button variant="secondary" :disabled="loading" @click="close">Cancel</Button>
        <Button :loading="loading" :disabled="loading" @click="onSave">Save</Button>
      </div>
    </template>
  </Modal>
</template>
