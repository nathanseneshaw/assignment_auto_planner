<script setup>
import { ref, onUnmounted } from 'vue'
import { useProfileStore } from '../stores/profile'
import { Input } from './ui'
import { useToast } from '../composables/useToast'
import {
  validateCanvasBrowserUrl,
  startCanvasBrowserSession,
  pollCanvasBrowserLogin,
  syncCanvasBrowserSession,
  downloadCanvasModuleFilesZip,
  closeCanvasSession,
} from '../services/canvasBrowserService'

const props = defineProps({
  mergeImport: {
    type: Function,
    required: true,
  },
  onComplete: Function,
})

const profileStore = useProfileStore()
const { success } = useToast()

const canvasUrl = ref(profileStore.lmsConnections.canvas.apiUrl || '')
const sessionId = ref(null)
const stopLoginPoll = ref(null)
const isSyncing = ref(false)
const isCheckingLogin = ref(false)
const syncResults = ref(null)
const currentStep = ref('url')
const error = ref('')
const loginStatus = ref(null)
const isDownloadingZip = ref(false)

function clearLoginPoll() {
  stopLoginPoll.value?.()
  stopLoginPoll.value = null
}

onUnmounted(() => {
  clearLoginPoll()
  if (sessionId.value) {
    closeCanvasSession(sessionId.value).catch(() => {})
  }
})

async function startLogin() {
  error.value = ''
  let normalized
  try {
    normalized = validateCanvasBrowserUrl(canvasUrl.value)
  } catch (e) {
    error.value = e.message
    return
  }

  canvasUrl.value = normalized
  profileStore.lmsConnections.canvas.apiUrl = normalized

  isCheckingLogin.value = true
  clearLoginPoll()

  try {
    const result = await startCanvasBrowserSession(normalized, {})
    sessionId.value = result.sessionId
    if (result.canvasUrl) {
      canvasUrl.value = result.canvasUrl
      profileStore.lmsConnections.canvas.apiUrl = result.canvasUrl
    }
    loginStatus.value = { loggedIn: false }

    success(
      'Complete sign-in in the browser window that opened (including MFA if prompted). This dialog continues when Canvas accepts your session.',
      8000
    )

    stopLoginPoll.value = pollCanvasBrowserLogin(result.sessionId, (status) => {
      loginStatus.value = status
      if (status.loggedIn) {
        clearLoginPoll()
        isCheckingLogin.value = false
        currentStep.value = 'ready'
        profileStore.connectCanvasBrowser(canvasUrl.value)
        success('Signed in to Canvas. You can import courses when ready.', 6000)
      }
    })
  } catch (e) {
    error.value = e.message || 'Failed to start browser session'
    isCheckingLogin.value = false
  }
}

async function downloadModuleZip() {
  if (!sessionId.value) return
  if (isDownloadingZip.value) return
  error.value = ''
  isDownloadingZip.value = true
  try {
    await downloadCanvasModuleFilesZip(sessionId.value, 'all')
    success('Canvas ZIP download started. Large accounts can take several minutes.', 8000)
  } catch (e) {
    error.value = e.message || 'ZIP download failed'
  } finally {
    isDownloadingZip.value = false
  }
}

async function startSync() {
  if (!sessionId.value) return
  if (isSyncing.value) return

  isSyncing.value = true
  currentStep.value = 'syncing'
  error.value = ''

  try {
    const result = await syncCanvasBrowserSession(sessionId.value)
    syncResults.value = result.data
    currentStep.value = 'results'

    const courses = result.data?.courses || []
    const assignments = result.data?.assignments || []
    const errs = result.data?.errors || []

    if (courses.length === 0 && assignments.length === 0) {
      error.value =
        errs[0]?.error ||
        'No courses or assignments found. Confirm you are enrolled in active courses with dated assignments.'
    } else if (errs.length && assignments.length === 0) {
      error.value = errs.map((e) => e.error).filter(Boolean).join(' ') || 'Import had errors'
    }
  } catch (e) {
    error.value = e.message || 'Sync failed'
    if (loginStatus.value?.loggedIn) {
      currentStep.value = 'ready'
    } else {
      currentStep.value = 'url'
    }
  } finally {
    isSyncing.value = false
  }
}

function importResults() {
  if (!syncResults.value) return

  const payload = {
    courses: syncResults.value.courses || [],
    assignments: syncResults.value.assignments || [],
  }
  const counts = props.mergeImport(payload)

  profileStore.updateExtensionSync(counts.courses, counts.assignments)
  profileStore.syncLms('canvas')

  success(`Imported ${counts.courses} courses and ${counts.assignments} assignments`)

  if (sessionId.value) {
    closeCanvasSession(sessionId.value).catch(() => {})
    sessionId.value = null
  }
  loginStatus.value = null
  currentStep.value = 'url'
  props.onComplete?.()
}

async function cancelSync() {
  clearLoginPoll()
  isCheckingLogin.value = false
  if (sessionId.value) {
    await closeCanvasSession(sessionId.value).catch(() => {})
  }
  sessionId.value = null
  currentStep.value = 'url'
  loginStatus.value = null
  error.value = ''
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="currentStep === 'url'" class="space-y-5">
      <Input
        v-model="canvasUrl"
        label="Canvas URL"
        placeholder="e.g. yourschool.instructure.com"
        hint="With or without https://. A browser window opens so you can use SSO and MFA."
      />

      <div v-if="error" class="text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">
        {{ error }}
      </div>

      <p v-if="isCheckingLogin" class="text-sm text-gray-600">
        Waiting for you to finish signing in the browser…
      </p>

      <button
        type="button"
        @click="startLogin"
        :disabled="!canvasUrl?.trim() || isCheckingLogin"
        class="w-full px-4 py-3 rounded-xl bg-primary-900 text-white text-sm font-semibold hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-primary-900/15 transition-colors"
      >
        {{ isCheckingLogin ? 'Signing in…' : 'Sign in' }}
      </button>
      <button
        v-if="isCheckingLogin"
        type="button"
        class="w-full text-sm text-gray-500 hover:text-gray-800"
        @click="cancelSync"
      >
        Cancel
      </button>

      <p class="text-xs text-gray-500">
        Browser sign-in is required for Canvas in this app.
      </p>
    </div>

    <div v-else-if="currentStep === 'ready'" class="space-y-4">
      <div
        class="rounded-xl border-2 border-green-400 bg-green-50 p-5 shadow-sm ring-1 ring-green-200/80"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-start gap-3">
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-500 text-white">
            <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="min-w-0">
            <h4 class="text-lg font-semibold text-green-900">You are signed in to Canvas</h4>
            <p class="mt-1 text-sm text-green-800">
              The server is using your browser session. Click import to load courses and assignments from Canvas.
            </p>
            <p v-if="loginStatus?.currentUrl" class="mt-2 text-xs text-green-700/90 break-all">
              Last page: {{ loginStatus.currentUrl }}
            </p>
          </div>
        </div>
      </div>

      <div v-if="error" class="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{{ error }}</div>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          @click="startSync"
          :disabled="isSyncing"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
        >
          Import assignments
        </button>
        <button
          type="button"
          @click="downloadModuleZip"
          :disabled="isDownloadingZip"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {{ isDownloadingZip ? 'Building ZIP…' : 'Download modules & files (ZIP)' }}
        </button>
      </div>
    </div>

    <div v-else-if="currentStep === 'syncing'" class="space-y-4">
      <div class="bg-primary-50 border border-primary-200 rounded-lg p-4">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
            <svg class="w-5 h-5 text-primary-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
          <div>
            <h4 class="font-medium text-primary-800">Syncing with Canvas</h4>
            <p class="text-sm text-primary-600">
              Loading courses and assignments from the Canvas API. This may take a minute…
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="currentStep === 'results'" class="space-y-4">
      <div v-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-red-700">{{ error }}</p>
      </div>

      <div v-else class="bg-green-50 border border-green-200 rounded-lg p-4">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
            <svg class="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h4 class="font-medium text-green-800">Sync complete</h4>
            <p class="text-sm text-green-600">
              Found {{ syncResults?.courses?.length || 0 }} courses and
              {{ syncResults?.assignments?.length || 0 }} assignments
            </p>
          </div>
        </div>

        <div v-if="syncResults?.courses?.length" class="mt-4 space-y-2">
          <h5 class="text-sm font-medium text-gray-700">Courses</h5>
          <ul class="text-sm text-gray-800 space-y-2 max-h-48 overflow-y-auto">
            <li v-for="c in syncResults.courses" :key="c.canvasCourseId" class="border-b border-green-100/80 pb-2">
              <span class="font-medium">{{ c.name }}</span>
              <span v-if="c.instructor" class="block text-xs text-gray-600 mt-0.5">
                Instructor: {{ c.instructor }}
              </span>
            </li>
          </ul>
        </div>

        <div v-if="syncResults?.errors?.length" class="mt-4 text-sm text-amber-700">
          Some issues occurred during sync ({{ syncResults.errors.length }}). You can still import what was found.
        </div>
      </div>

      <div class="flex gap-3 flex-wrap">
        <button
          v-if="!error && (syncResults?.courses?.length || syncResults?.assignments?.length)"
          type="button"
          @click="importResults"
          class="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
        >
          Import to app
        </button>
        <button
          type="button"
          @click="downloadModuleZip"
          :disabled="isDownloadingZip"
          class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
        >
          {{ isDownloadingZip ? 'Building ZIP…' : 'Download modules & files (ZIP)' }}
        </button>
        <button type="button" @click="startSync" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">
          Sync again
        </button>
        <button type="button" @click="cancelSync" class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium">
          Close
        </button>
      </div>
    </div>
  </div>
</template>
