<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useProfileStore } from '../stores/profile'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Badge } from './ui'
import { useToast } from '../composables/useToast'
import { syncSession, closeSession } from '../services/blackboardBrowserService'
import { ensureCourseForBlackboardItem } from '../utils/blackboardImport.js'
import {
  sanitizeBlackboardCourseDisplayName,
  blackboardCourseTitlesLooselyEqual,
} from '../utils/blackboardCourseName.js'

const props = defineProps({
  initialSessionId: { type: String, default: null },
  onComplete: Function,
})

const profileStore = useProfileStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()
const { success } = useToast()

const sessionId = ref(props.initialSessionId || null)
const isSyncing = ref(false)
const syncResults = ref(null)
const currentStep = ref(props.initialSessionId ? 'syncing' : 'extension')
const error = ref('')

onUnmounted(() => {
  if (sessionId.value) {
    closeSession(sessionId.value).catch(() => {})
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
    const result = await syncSession(sessionId.value)
    syncResults.value = result.data
    currentStep.value = 'results'

    if (result.data.courses.length === 0 && result.data.assignments.length === 0) {
      error.value = result.data.errors?.[0]?.error || 'No data found'
    }
  } catch (e) {
    error.value = e.message
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

function importResults() {
  if (!syncResults.value) return

  let coursesAdded = 0
  let assignmentsAdded = 0

  const syncCourses = syncResults.value.courses || []

  for (const course of syncCourses) {
    const displayName =
      sanitizeBlackboardCourseDisplayName(course.name || course.fullName || '') ||
      course.name ||
      course.fullName
    const existing = coursesStore.courses.find(
      (c) =>
        c.blackboardId === course.id ||
        c.name === course.name ||
        c.name === course.fullName ||
        (displayName && blackboardCourseTitlesLooselyEqual(c.name, displayName))
    )
    if (!existing) {
      coursesStore.addCourse({
        name: displayName || 'Untitled course',
        code: course.code || '',
        instructor: course.instructor || '',
        term: course.term || '',
        blackboardId: course.id,
        lmsSource: 'blackboard',
      })
      coursesAdded++
    }
  }

  for (const assignment of syncResults.value.assignments || []) {
    const { course, created } = ensureCourseForBlackboardItem(
      coursesStore,
      syncCourses,
      assignment,
      'blackboard'
    )
    if (!course) continue
    if (created) coursesAdded++

    const existing = assignmentsStore.assignments.find(
      (a) => a.title === assignment.title && a.courseId === course.id
    )
    if (!existing) {
      assignmentsStore.addAssignment({
        title: assignment.title,
        description: assignment.description || '',
        dueDate:
          assignment.dueDate ||
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        courseId: course.id,
        courseName: course.name,
        type: assignment.type || 'assignment',
        blackboardId: assignment.id,
        images: assignment.images || [],
        importSource: 'blackboard',
      })
      assignmentsAdded++
    }
  }

  profileStore.updateExtensionSync(coursesAdded, assignmentsAdded)

  success(`Imported ${coursesAdded} courses and ${assignmentsAdded} assignments`)

  if (sessionId.value) {
    closeSession(sessionId.value).catch(() => {})
    sessionId.value = null
  }
  props.onComplete?.()
}

async function closeAndReset() {
  if (sessionId.value) {
    await closeSession(sessionId.value).catch(() => {})
    sessionId.value = null
  }
  syncResults.value = null
  currentStep.value = 'extension'
  error.value = ''
}
</script>

<template>
  <div class="space-y-6">
    <!-- Step 1: Extension instructions -->
    <div v-if="currentStep === 'extension'" class="space-y-5">
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-3">
        <h4 class="font-semibold text-gray-900">Sync via the Assignment Planner extension</h4>
        <p class="text-sm text-gray-700">
          Your browser does the login. The Assignment Planner extension reads your Blackboard
          session cookies and sends them to the server, which does the rest.
        </p>
        <ol class="text-sm text-gray-700 list-decimal pl-5 space-y-2">
          <li>
            <strong>Install the extension</strong> (one-time):
            open <code class="px-1 bg-gray-200 rounded text-xs">chrome://extensions</code>,
            turn on <em>Developer mode</em>, click <em>Load unpacked</em>, and select the
            <code class="px-1 bg-gray-200 rounded text-xs">extension/</code> folder of this project.
          </li>
          <li>Open Blackboard in a tab and log in normally.</li>
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
        Nothing else to configure here — close this when you're ready to head to Blackboard.
      </p>
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
            <h4 class="font-medium text-primary-800">Syncing with Blackboard</h4>
            <p class="text-sm text-primary-600">
              The server is requesting each course and parsing assignment data. This may take a minute…
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
            <h4 class="font-medium text-green-800">Sync Complete!</h4>
            <p class="text-sm text-green-600">
              Found {{ syncResults?.courses?.length || 0 }} courses and {{ syncResults?.assignments?.length || 0 }} assignments
            </p>
          </div>
        </div>

        <div v-if="syncResults?.courses?.length" class="mt-4 space-y-2">
          <h5 class="text-sm font-medium text-gray-700">Courses found:</h5>
          <div class="flex flex-col gap-2 items-start">
            <Badge v-for="course in syncResults.courses.slice(0, 5)" :key="course.id" variant="default">
              {{ course.name }}
            </Badge>
            <Badge v-if="syncResults.courses.length > 5" variant="default">
              +{{ syncResults.courses.length - 5 }} more
            </Badge>
          </div>
        </div>

        <div v-if="syncResults?.errors?.length" class="mt-4 text-sm text-amber-600">
          {{ syncResults.errors.length }} error(s) occurred during sync
        </div>
      </div>

      <div class="flex gap-3 flex-wrap">
        <button
          v-if="!error && syncResults?.courses?.length"
          @click="importResults"
          class="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
        >
          Import to App
        </button>
        <button
          @click="startSync"
          class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
        >
          Sync Again
        </button>
        <button
          @click="closeAndReset"
          class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
