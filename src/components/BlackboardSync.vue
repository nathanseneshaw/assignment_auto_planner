<script setup>
import { ref, onUnmounted } from 'vue'
import { useProfileStore } from '../stores/profile'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Badge, Input } from './ui'
import { useToast } from '../composables/useToast'
import {
  startSsoSession,
  pollLoginStatus,
  syncSession,
  closeSession,
} from '../services/blackboardBrowserService'
import { ensureCourseForBlackboardItem } from '../utils/blackboardImport.js'
import {
  sanitizeBlackboardCourseDisplayName,
  blackboardCourseTitlesLooselyEqual,
} from '../utils/blackboardCourseName.js'

const props = defineProps({
  onComplete: Function
})

const profileStore = useProfileStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()
const { success } = useToast()

const blackboardUrl = ref(profileStore.lmsConnections.blackboard.apiUrl || '')
const sessionId = ref(null)
const stopLoginPoll = ref(null)
const isSyncing = ref(false)
const isCheckingLogin = ref(false)
const syncResults = ref(null)
const currentStep = ref('url') // url, ready, syncing, results
const error = ref('')
const loginStatus = ref(null)

function clearLoginPoll() {
  stopLoginPoll.value?.()
  stopLoginPoll.value = null
}

onUnmounted(() => {
  clearLoginPoll()
  if (sessionId.value) {
    closeSession(sessionId.value).catch(() => {})
  }
})

async function startLogin() {
  if (!blackboardUrl.value?.trim()) {
    error.value = 'Enter your Blackboard URL'
    return
  }

  error.value = ''
  isCheckingLogin.value = true
  clearLoginPoll()

  try {
    const result = await startSsoSession(blackboardUrl.value.trim(), {})
    sessionId.value = result.sessionId
    if (result.blackboardUrl) {
      blackboardUrl.value = result.blackboardUrl
      profileStore.lmsConnections.blackboard.apiUrl = result.blackboardUrl
    } else {
      profileStore.lmsConnections.blackboard.apiUrl = blackboardUrl.value
    }
    loginStatus.value = { loggedIn: false }

    success(
      'Complete sign-in in the browser window that opened (including MFA if prompted). This dialog will continue when you are logged in.',
      8000
    )

    stopLoginPoll.value = pollLoginStatus(result.sessionId, status => {
      loginStatus.value = status
      if (status.loggedIn) {
        clearLoginPoll()
        isCheckingLogin.value = false
        currentStep.value = 'ready'
        profileStore.connectBlackboardBrowser(blackboardUrl.value)
        success('Signed in to Blackboard. You can import courses when ready.', 6000)
      }
    })
  } catch (e) {
    error.value = e.message
    isCheckingLogin.value = false
  }
}

async function startSync() {
  if (!sessionId.value) return
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
  
  let coursesAdded = 0
  let assignmentsAdded = 0
  
  const syncCourses = syncResults.value.courses || []

  for (const course of syncCourses) {
    const displayName =
      sanitizeBlackboardCourseDisplayName(course.name || course.fullName || '') ||
      course.name ||
      course.fullName
    const existing = coursesStore.courses.find(
      c =>
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
        lmsSource: 'blackboard'
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
      a => a.title === assignment.title && a.courseId === course.id
    )
    if (!existing) {
      assignmentsStore.addAssignment({
        title: assignment.title,
        description: assignment.description || '',
        dueDate: assignment.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        courseId: course.id,
        courseName: course.name,
        type: assignment.type || 'assignment',
        blackboardId: assignment.id,
        images: assignment.images || [],
        importSource: 'blackboard'
      })
      assignmentsAdded++
    }
  }
  
  // Update sync tracking
  profileStore.updateExtensionSync(coursesAdded, assignmentsAdded)
  
  success(`Imported ${coursesAdded} courses and ${assignmentsAdded} assignments`)
  
  // Close session and reset
  if (sessionId.value) {
    closeSession(sessionId.value).catch(() => {})
  }
  props.onComplete?.()
}

async function cancelSync() {
  clearLoginPoll()
  isCheckingLogin.value = false
  if (sessionId.value) {
    await closeSession(sessionId.value).catch(() => {})
  }
  sessionId.value = null
  currentStep.value = 'url'
  loginStatus.value = null
}
</script>

<template>
  <div class="space-y-6">
    <!-- Step 1: Enter URL -->
    <div v-if="currentStep === 'url'" class="space-y-5">
      <Input
        v-model="blackboardUrl"
        label="Blackboard URL"
        placeholder="e.g. blackboard.yourschool.edu"
        hint="With or without https://. Sign-in opens in a browser so you can use SSO and MFA."
      />

      <div v-if="error" class="text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">{{ error }}</div>

      <p v-if="isCheckingLogin" class="text-sm text-gray-600">
        Waiting for you to finish signing in the browser…
      </p>

      <button
        type="button"
        @click="startLogin"
        :disabled="!blackboardUrl?.trim() || isCheckingLogin"
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
    </div>
    
    <!-- Step: Signed in — full in-modal prompt (replaces easy-to-miss toast) -->
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
            <h4 class="text-lg font-semibold text-green-900">You are signed in to Blackboard</h4>
            <p class="mt-1 text-sm text-green-800">
              The server is using your browser session. Click import to load courses and assignments.
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
          Import my courses
        </button>
        <button type="button" @click="cancelSync" class="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </div>
    
    <!-- Step 3: Syncing -->
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
    
    <!-- Step 4: Results -->
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
        
        <!-- Preview -->
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
          @click="cancelSync" 
          class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
