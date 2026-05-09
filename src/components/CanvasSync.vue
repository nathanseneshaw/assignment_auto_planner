<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useToast } from '../composables/useToast'
import {
  syncCanvasBrowserSession,
  downloadCanvasModuleFilesZip,
  closeCanvasSession,
} from '../services/canvasBrowserService'
import LmsBrowserPanel from './LmsBrowserPanel.vue'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

const props = defineProps({
  mergeImport: {
    type: Function,
    required: true,
  },
  initialSessionId: { type: String, default: null },
  onComplete: Function,
})

const { success } = useToast()

const sessionId = ref(props.initialSessionId || null)
const isSyncing = ref(false)
const isDownloadingZip = ref(false)
const syncResults = ref(null)
const currentStep = ref(props.initialSessionId ? 'syncing' : 'extension')
const error = ref('')

onUnmounted(() => {
  if (sessionId.value) {
    closeCanvasSession(sessionId.value).catch(() => {})
  }
})

async function startSync() {
  if (!sessionId.value) {
    error.value = 'No session — sync from the extension first.'
    return
  }
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
      error.value =
        errs.map((e) => e.error).filter(Boolean).join(' ') || 'Import had errors'
    }
  } catch (e) {
    error.value = e.message || 'Sync failed'
    currentStep.value = 'extension'
  } finally {
    isSyncing.value = false
  }
}

onMounted(() => {
  if (props.initialSessionId) {
    void startSync()
  }
})

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

function importResults() {
  if (!syncResults.value) return

  const payload = {
    courses: syncResults.value.courses || [],
    assignments: syncResults.value.assignments || [],
  }
  const counts = props.mergeImport(payload)

  success(`Imported ${counts.courses} courses and ${counts.assignments} assignments`)

  if (sessionId.value) {
    closeCanvasSession(sessionId.value).catch(() => {})
    sessionId.value = null
  }
  props.onComplete?.()
}

async function closeAndReset() {
  if (sessionId.value) {
    await closeCanvasSession(sessionId.value).catch(() => {})
    sessionId.value = null
  }
  syncResults.value = null
  currentStep.value = 'extension'
  error.value = ''
}

function onBrowserSessionReady(sid) {
  sessionId.value = sid
  void startSync()
}
</script>

<template>
  <div class="space-y-6">
    <!-- Step 1: Extension instructions / Embedded browser (Electron) -->
    <div v-if="currentStep === 'extension'">
      <!-- Desktop app: show embedded browser directly -->
      <div v-if="isElectron">
        <LmsBrowserPanel
          lms-type="canvas"
          :on-success="onBrowserSessionReady"
        />
      </div>

      <!-- Web: show extension install instructions -->
      <div v-else class="space-y-5">
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-3">
          <h4 class="font-semibold text-gray-900">Sync via the Assignment Planner extension</h4>
          <p class="text-sm text-gray-700">
            Your browser does the login. The Assignment Planner extension reads your Canvas
            session cookies and sends them to the server, which does the rest.
          </p>
          <ol class="text-sm text-gray-700 list-decimal pl-5 space-y-2">
            <li>
              <strong>Install the extension</strong> (one-time):
              open <code class="px-1 bg-gray-200 rounded text-xs">chrome://extensions</code>,
              turn on <em>Developer mode</em>, click <em>Load unpacked</em>, and select the
              <code class="px-1 bg-gray-200 rounded text-xs">extension/</code> folder of this project.
            </li>
            <li>Open Canvas in a tab and log in normally.</li>
            <li>Click the Assignment Planner Sync icon in your toolbar.</li>
            <li>Click <strong>Sync this site</strong>. This window will open automatically.</li>
          </ol>
        </div>

        <div
          v-if="error"
          class="text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-100"
        >
          {{ error }}
        </div>

        <p class="text-xs text-gray-500">
          Nothing else to configure here — close this when you're ready to head to Canvas.
        </p>
      </div>
    </div>

    <!-- Step 2: Syncing -->
    <div v-else-if="currentStep === 'syncing'" class="space-y-4">
      <div class="bg-primary-50 border border-primary-200 rounded-lg p-4">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
            <svg class="w-5 h-5 text-primary-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div>
            <h4 class="font-medium text-primary-800">Syncing with Canvas</h4>
            <p class="text-sm text-primary-600">
              Loading courses and assignments from Canvas. This may take a minute…
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3: Results -->
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
        <button type="button" @click="closeAndReset" class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium">
          Close
        </button>
      </div>
    </div>
  </div>
</template>
