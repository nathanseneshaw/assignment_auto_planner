<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProfileStore } from '../stores/profile'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Card, Input, Button, Badge } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import BlackboardSync from '../components/BlackboardSync.vue'
import CanvasSync from '../components/CanvasSync.vue'
import { useToast } from '../composables/useToast'
import { 
  testBlackboardLogin, 
  getBlackboardCourses, 
  checkServerHealth 
} from '../services/blackboardService'
import { ensureCourseForBlackboardItem } from '../utils/blackboardImport.js'
import {
  sanitizeBlackboardCourseDisplayName,
  blackboardCourseTitlesLooselyEqual,
} from '../utils/blackboardCourseName.js'

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const profileStore = useProfileStore()
const authStore = useAuthStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()

const showImportModal = ref(false)
const importData = ref(null)
const showBlackboardModal = ref(false)
const showBlackboardSyncModal = ref(false)
const showCanvasSyncModal = ref(false)
const syncing = ref({ canvas: false, blackboard: false })
const serverOnline = ref(false)

const blackboardForm = ref({
  apiUrl: profileStore.lmsConnections.blackboard.apiUrl || '',
  username: profileStore.lmsConnections.blackboard.username || '',
  password: '',
  selectedCourses: [...(profileStore.lmsConnections.blackboard.courseIds || [])]
})

const blackboardStep = ref(1)
const blackboardLoading = ref(false)
const blackboardCourses = ref([])

const blackboardError = ref('')

const accountDisplayName = computed(() => {
  const u = authStore.user
  if (isSupabaseConfigured && u) {
    const meta = u.user_metadata || {}
    return (
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      profileStore.profile.name ||
      '—'
    )
  }
  return profileStore.profile.name || '—'
})

const accountDisplayEmail = computed(() => {
  if (isSupabaseConfigured && authStore.user?.email) {
    return authStore.user.email
  }
  return profileStore.profile.email || '—'
})

function normalizeCanvasUrlClient(input) {
  if (!input) return ''
  let u = String(input).trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    return new URL(u).origin
  } catch {
    return u
  }
}

function bbCourseListLabel(course) {
  if (!course) return ''
  return (
    sanitizeBlackboardCourseDisplayName(course.name || course.fullName || '') ||
    course.name ||
    course.fullName ||
    ''
  )
}

onMounted(async () => {
  serverOnline.value = await checkServerHealth()

  // Check for import data from browser extension
  const importParam = route.query.import
  if (importParam) {
    try {
      const data = JSON.parse(importParam)
      if (data && (data.courses?.length > 0 || data.assignments?.length > 0)) {
        importData.value = data
        
        // Auto-import if flag is set (from automated extension sync)
        if (data.autoImport) {
          // Small delay to let page render
          setTimeout(() => {
            const result = importFromExtension()
            if (result) {
              profileStore.updateExtensionSync(result.courses, result.assignments)
              showToast(`Imported ${result.courses} courses and ${result.assignments} assignments from Blackboard`, 'success')
            }
          }, 300)
        } else {
          showImportModal.value = true
        }
      }
      // Clear the URL parameter
      router.replace({ query: {} })
    } catch (e) {
      console.error('Failed to parse import data:', e)
    }
  }
})

function importFromExtension() {
  if (!importData.value) return
  
  let coursesAdded = 0
  let assignmentsAdded = 0
  
  // Import courses
  if (importData.value.courses) {
    for (const course of importData.value.courses) {
      const displayName =
        sanitizeBlackboardCourseDisplayName(course.name || course.fullName || '') ||
        course.name ||
        course.fullName
      const existingCourse = coursesStore.courses.find(
        c =>
          c.blackboardId === course.id ||
          c.name === course.name ||
          (course.fullName && c.name === course.fullName) ||
          (displayName && blackboardCourseTitlesLooselyEqual(c.name, displayName))
      )
      if (!existingCourse) {
        coursesStore.addCourse({
          name: displayName || 'Untitled course',
          code: course.code || '',
          instructor: course.instructor || '',
          term: course.term || '',
          blackboardId: course.id,
          lmsSource: 'extension'
        })
        coursesAdded++
      } else if (course.instructor && !existingCourse.instructor) {
        // Update instructor if we now have it but didn't before
        coursesStore.updateCourse(existingCourse.id, { instructor: course.instructor })
      }
    }
  }
  
  const coursesList = importData.value.courses || []

  // Import assignments
  if (importData.value.assignments) {
    for (const assignment of importData.value.assignments) {
      const { course, created } = ensureCourseForBlackboardItem(
        coursesStore,
        coursesList,
        assignment,
        'extension'
      )
      if (!course) continue
      if (created) coursesAdded++

      const existingAssignment = assignmentsStore.assignments.find(
        a => a.title === assignment.title && a.courseId === course.id
      )
      if (!existingAssignment) {
        assignmentsStore.addAssignment({
          title: assignment.title,
          description: assignment.description ?? '',
          dueDate: assignment.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          courseId: course.id,
          courseName: course.name,
          type: assignment.type || 'assignment',
          blackboardId: assignment.id,
          images: assignment.images || [],
          importSource: 'extension'
        })
        assignmentsAdded++
      }
    }
  }
  
  showImportModal.value = false
  importData.value = null
  
  return { courses: coursesAdded, assignments: assignmentsAdded }
}

function handleManualImport() {
  const result = importFromExtension()
  if (result) {
    profileStore.updateExtensionSync(result.courses, result.assignments)
    showToast(`Imported ${result.courses} courses and ${result.assignments} assignments from Blackboard`, 'success')
  }
}

function cancelImport() {
  showImportModal.value = false
  importData.value = null
}

function openBlackboardModal() {
  blackboardForm.value.apiUrl = profileStore.lmsConnections.blackboard.apiUrl || ''
  blackboardForm.value.username = profileStore.lmsConnections.blackboard.username || ''
  blackboardForm.value.password = ''
  blackboardForm.value.selectedCourses = [...(profileStore.lmsConnections.blackboard.courseIds || [])]
  blackboardError.value = ''
  blackboardStep.value = 1
  blackboardCourses.value = []
  showBlackboardModal.value = true
}

function closeBlackboardModal() {
  showBlackboardModal.value = false
  blackboardStep.value = 1
  blackboardCourses.value = []
  blackboardError.value = ''
  blackboardLoading.value = false
}

function mergeCanvasImport(payload) {
  const courses = payload?.courses || []
  const assignments = payload?.assignments || []
  let coursesAdded = 0
  let assignmentsAdded = 0

  for (const c of courses) {
    const existing = coursesStore.courses.find(
      x => x.canvasCourseId === c.canvasCourseId || x.name === c.name
    )
    if (!existing) {
      coursesStore.addCourse({
        name: c.name,
        code: '',
        instructor: c.instructor || '',
        term: c.term || '',
        canvasCourseId: c.canvasCourseId,
        lmsSource: 'canvas'
      })
      coursesAdded++
    } else {
      const updates = {}
      if (c.instructor && !existing.instructor) updates.instructor = c.instructor
      if (c.term && !existing.term) updates.term = c.term
      if (Object.keys(updates).length) coursesStore.updateCourse(existing.id, updates)
      if (c.canvasCourseId && !existing.canvasCourseId) {
        coursesStore.updateCourse(existing.id, { canvasCourseId: c.canvasCourseId })
      }
    }
  }

  for (const a of assignments) {
    const course = coursesStore.courses.find(x => x.canvasCourseId === a.canvasCourseId)
    if (!course) continue
    const exists = assignmentsStore.assignments.find(
      x =>
        (a.canvasAssignmentId && x.canvasAssignmentId === a.canvasAssignmentId) ||
        (x.title === a.title && x.courseId === course.id)
    )
    if (!exists) {
      assignmentsStore.addAssignment({
        title: a.title,
        description: a.description || '',
        dueDate: a.dueDate,
        courseId: course.id,
        courseName: course.name,
        canvasAssignmentId: a.canvasAssignmentId,
        status: 'pending',
        importSource: 'canvas'
      })
      assignmentsAdded++
    }
  }

  return { courses: coursesAdded, assignments: assignmentsAdded }
}

async function verifyBlackboardCredentials() {
  if (!blackboardForm.value.apiUrl || !blackboardForm.value.username || !blackboardForm.value.password) {
    blackboardError.value = 'Please fill in all fields'
    return
  }

  blackboardLoading.value = true
  blackboardError.value = ''

  try {
    const result = await getBlackboardCourses(
      blackboardForm.value.apiUrl,
      blackboardForm.value.username,
      blackboardForm.value.password
    )

    if (result.success) {
      blackboardCourses.value = result.courses
      if (blackboardForm.value.selectedCourses.length === 0) {
        blackboardForm.value.selectedCourses = result.courses.map(c => c.id)
      }
      blackboardStep.value = 2
    } else {
      blackboardError.value = result.error || 'Failed to connect. Check your credentials.'
    }
  } catch (error) {
    blackboardError.value = 'Unable to connect to the server. Make sure the backend is running.'
  } finally {
    blackboardLoading.value = false
  }
}

function toggleCourseSelection(courseId) {
  const index = blackboardForm.value.selectedCourses.indexOf(courseId)
  if (index === -1) {
    blackboardForm.value.selectedCourses.push(courseId)
  } else {
    blackboardForm.value.selectedCourses.splice(index, 1)
  }
}

function selectAllCourses() {
  blackboardForm.value.selectedCourses = blackboardCourses.value.map(c => c.id)
}

function deselectAllCourses() {
  blackboardForm.value.selectedCourses = []
}

async function connectBlackboard() {
  if (blackboardForm.value.selectedCourses.length === 0) {
    blackboardError.value = 'Please select at least one course'
    return
  }

  profileStore.connectBlackboard(
    blackboardForm.value.apiUrl,
    blackboardForm.value.username,
    blackboardForm.value.password,
    blackboardForm.value.selectedCourses,
    blackboardCourses.value
  )
  
  closeBlackboardModal()
}

async function syncPlatform(platform) {
  syncing.value[platform] = true
  
  if (platform === 'canvas' && profileStore.isCanvasConnected) {
    // Canvas sync/login is browser-based from the modal.
    showCanvasSyncModal.value = true
    syncing.value.canvas = false
    return
  }

  if (platform === 'blackboard') {
    // Always allow a fresh Blackboard browser sign-in/sync, even if already connected.
    showBlackboardSyncModal.value = true
    syncing.value.blackboard = false
    return
  }

  if (platform !== 'canvas') {
    await new Promise(resolve => setTimeout(resolve, 1500))
    profileStore.syncLms(platform)
  }
  
  if (platform !== 'canvas') syncing.value[platform] = false
}

function formatLastSynced(dateString) {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
}

function getInitials(name) {
  const n = String(name || '').trim()
  if (!n || n === '—') return '?'
  return n.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 2)
}

const signingOut = ref(false)

async function signOutAccount() {
  signingOut.value = true
  try {
    await authStore.signOut()
    await router.push({ name: 'Login' })
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Profile & Settings</h1>
      <p class="text-gray-500 mt-1">Manage your profile and connect your learning management systems</p>
    </div>

    <!-- Account details (read-only; not editable fields) -->
    <Card>
      <div class="flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8">
        <div class="flex-shrink-0 flex sm:block items-center gap-4 sm:gap-0">
          <div
            class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary-900 flex items-center justify-center text-white text-xl sm:text-2xl font-bold shadow-md shadow-primary-900/15 ring-4 ring-gray-100"
            aria-hidden="true"
          >
            {{ getInitials(accountDisplayName) }}
          </div>
          <div class="sm:hidden min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 leading-tight">Your account</h2>
            <p class="text-xs text-gray-500 mt-1">Information from your profile</p>
          </div>
        </div>

        <div class="flex-1 min-w-0 space-y-1">
          <div class="hidden sm:block">
            <h2 class="text-lg font-semibold text-gray-900">Your account</h2>
          </div>

          <p class="text-xs text-gray-500 sm:hidden mt-1 mb-4">
            {{
              isSupabaseConfigured ? 'From your signed-in account.' : 'Stored on this device.'
            }}
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 pt-4 sm:pt-5 border-t border-gray-100">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Full name</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 leading-snug break-words">
                {{ accountDisplayName }}
              </p>
            </div>
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Email</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 leading-snug break-all">
                {{ accountDisplayEmail }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- LMS Integrations -->
    <div>
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Learning Management Systems</h2>
      <p class="text-gray-500 text-sm mb-4">Connect your Canvas and/or Blackboard accounts to automatically sync your courses and assignments.</p>
      
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Canvas Card -->
        <Card class="relative overflow-hidden">
          <div class="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
          
          <div class="flex items-start gap-4 relative">
            <div class="w-14 h-14 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
              <svg class="w-8 h-8 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93s3.06-7.44 7-7.93v15.86zm2-15.86c1.03.13 2 .45 2.87.93H13v-.93zM13 7h5.24c.25.31.48.65.68 1H13V7zm0 3h6.74c.08.33.15.66.19 1H13v-1zm0 9.93V19h2.87c-.87.48-1.84.8-2.87.93zM18.24 17H13v-1h5.92c-.2.35-.43.69-.68 1zm1.5-3H13v-1h6.93c-.04.34-.11.67-.19 1z"/>
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-lg font-semibold text-gray-900">Canvas LMS</h3>
                <Badge v-if="profileStore.isCanvasConnected" variant="success">Connected</Badge>
                <Badge v-else variant="default">Not Connected</Badge>
              </div>
              <p class="text-sm text-gray-500 mb-4">
                Sign in with your browser (SSO/MFA) to connect Canvas courses and assignments.
              </p>
              
              <template v-if="profileStore.isCanvasConnected">
                <div class="space-y-3">
                  <button
                    type="button"
                    @click="showCanvasSyncModal = true"
                    :disabled="!serverOnline"
                    class="btn-primary text-sm px-4 py-2 w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sign in with Canvas
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="flex flex-col gap-3">
                  <button
                    type="button"
                    @click="showCanvasSyncModal = true"
                    :disabled="!serverOnline"
                    class="btn-primary text-sm px-4 py-2 w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sign in with Canvas
                  </button>
                </div>
              </template>
            </div>
          </div>
        </Card>

        <!-- Blackboard Card -->
        <Card class="relative overflow-hidden">
          <div class="absolute top-0 right-0 w-32 h-32 bg-gray-500/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
          
          <div class="flex items-start gap-4 relative">
            <div class="w-14 h-14 rounded-xl bg-gray-800 flex items-center justify-center flex-shrink-0">
              <svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-lg font-semibold text-gray-900">Blackboard Learn</h3>
                <Badge v-if="profileStore.isBlackboardConnected" variant="success">Connected</Badge>
                <Badge v-else variant="default">Not Connected</Badge>
              </div>
              <p class="text-sm text-gray-500 mb-4">
                Sign in with your browser (including SSO/MFA if required) to sync Blackboard courses and assignments.
              </p>
              
              <template v-if="profileStore.isBlackboardConnected">
                <div class="space-y-3">
                  <div class="flex items-center gap-2 pt-2">
                    <button 
                      @click="syncPlatform('blackboard')"
                      :disabled="syncing.blackboard"
                      class="btn-primary text-sm px-4 py-2 w-full flex items-center justify-center gap-2"
                    >
                      <svg 
                        class="w-4 h-4" 
                        :class="{ 'animate-spin': syncing.blackboard }"
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {{ syncing.blackboard ? 'Signing in...' : 'Sign in with Blackboard' }}
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="flex flex-col gap-3">
                  <button 
                    @click="showBlackboardSyncModal = true"
                    class="btn-primary text-sm px-4 py-2 flex items-center gap-2"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sign in with Blackboard
                  </button>
                </div>
              </template>
            </div>
          </div>
        </Card>
      </div>
      
      <!-- Extension sync status card (green) -->
      <Card v-if="profileStore.extensionSync.lastSynced" class="mt-6 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
              <svg class="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-gray-900">Sync Status</h3>
              <p class="text-sm text-gray-600">
                Last synced: <span class="font-medium">{{ formatLastSynced(profileStore.extensionSync.lastSynced) }}</span>
              </p>
              <p class="text-xs text-gray-500 mt-1">
                {{ profileStore.extensionSync.coursesImported }} courses, {{ profileStore.extensionSync.assignmentsImported }} assignments imported
              </p>
            </div>
          </div>
          <Badge variant="success" class="shrink-0">Auto-synced</Badge>
        </div>
      </Card>
    </div>

    <!-- Blackboard Connection Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showBlackboardModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50" @click="closeBlackboardModal"></div>
          <div class="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center">
                <svg class="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
                </svg>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900">Connect Blackboard</h3>
                <p class="text-sm text-gray-500">
                  {{ blackboardStep === 1 ? 'Enter your Blackboard login credentials' : 'Select courses to sync' }}
                </p>
              </div>
            </div>

            <!-- Step indicator -->
            <div class="flex items-center gap-2 mb-6">
              <div class="flex items-center gap-2">
                <div :class="['w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium', blackboardStep >= 1 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600']">
                  1
                </div>
                <span class="text-sm text-gray-600">Credentials</span>
              </div>
              <div class="flex-1 h-0.5 bg-gray-200 mx-2">
                <div :class="['h-full bg-primary-600 transition-all', blackboardStep >= 2 ? 'w-full' : 'w-0']"></div>
              </div>
              <div class="flex items-center gap-2">
                <div :class="['w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium', blackboardStep >= 2 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600']">
                  2
                </div>
                <span class="text-sm text-gray-600">Courses</span>
              </div>
            </div>

            <!-- Server status warning -->
            <div v-if="!serverOnline" class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div class="flex items-center gap-2 text-amber-800">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span class="text-sm font-medium">Backend server not running</span>
              </div>
              <p class="text-sm text-amber-700 mt-1">
                Run <code class="bg-amber-100 px-1 rounded">cd server && npm install && npm start</code> to start the server.
              </p>
            </div>

            <!-- Step 1: Credentials -->
            <div v-if="blackboardStep === 1" class="space-y-4">
              <Input
                v-model="blackboardForm.apiUrl"
                label="Blackboard URL"
                placeholder="https://blackboard.yourschool.edu"
                hint="Your institution's Blackboard URL"
              />
              <Input
                v-model="blackboardForm.username"
                label="Username"
                placeholder="Enter your Blackboard username"
                hint="Usually your student ID or email"
              />
              <Input
                v-model="blackboardForm.password"
                type="password"
                label="Password"
                placeholder="Enter your Blackboard password"
                :error="blackboardError"
              />
              
              <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-blue-800">
                  <strong>Note:</strong> Your credentials are only used to fetch your courses and assignments. 
                  They are stored locally on your device and sent directly to Blackboard.
                </p>
              </div>
            </div>

            <!-- Step 2: Course Selection -->
            <div v-if="blackboardStep === 2" class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-600">
                  Found {{ blackboardCourses.length }} course{{ blackboardCourses.length !== 1 ? 's' : '' }}
                </span>
                <div class="flex items-center gap-2">
                  <button @click="selectAllCourses" class="text-sm text-primary-600 hover:text-primary-700">
                    Select all
                  </button>
                  <span class="text-gray-300">|</span>
                  <button @click="deselectAllCourses" class="text-sm text-primary-600 hover:text-primary-700">
                    Deselect all
                  </button>
                </div>
              </div>

              <div class="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                <label
                  v-for="course in blackboardCourses"
                  :key="course.id"
                  class="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    :checked="blackboardForm.selectedCourses.includes(course.id)"
                    @change="toggleCourseSelection(course.id)"
                    class="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ bbCourseListLabel(course) }}</p>
                    <p v-if="course.code || course.term" class="text-xs text-gray-500">
                      {{ [course.code, course.term].filter(Boolean).join(' • ') }}
                    </p>
                  </div>
                </label>
              </div>

              <p v-if="blackboardError" class="text-sm text-danger-600">{{ blackboardError }}</p>

              <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p class="text-sm text-gray-600">
                  <strong>{{ blackboardForm.selectedCourses.length }}</strong> course{{ blackboardForm.selectedCourses.length !== 1 ? 's' : '' }} selected for syncing
                </p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-200">
              <button 
                v-if="blackboardStep === 2" 
                @click="blackboardStep = 1" 
                class="btn-ghost px-4 py-2 flex items-center gap-2"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <div v-else></div>
              
              <div class="flex items-center gap-3">
                <button @click="closeBlackboardModal" class="btn-ghost px-4 py-2">
                  Cancel
                </button>
                <button 
                  v-if="blackboardStep === 1"
                  @click="verifyBlackboardCredentials" 
                  :disabled="blackboardLoading || !serverOnline"
                  class="btn-primary px-4 py-2 flex items-center gap-2"
                >
                  <svg v-if="blackboardLoading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ blackboardLoading ? 'Connecting...' : 'Next' }}
                </button>
                <button 
                  v-else
                  @click="connectBlackboard" 
                  class="btn-primary px-4 py-2"
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Import from Extension Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showImportModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50" @click="cancelImport"></div>
          <div class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <svg class="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900">Import from Blackboard</h3>
                <p class="text-sm text-gray-500">Data received from browser extension</p>
              </div>
            </div>

            <div class="space-y-4">
              <div class="p-4 bg-gray-50 rounded-lg">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-sm text-gray-600">Courses found</span>
                  <span class="font-semibold text-gray-900">{{ importData?.courses?.length || 0 }}</span>
                </div>
                <div class="flex justify-between items-center mb-2">
                  <span class="text-sm text-gray-600">Assignments found</span>
                  <span class="font-semibold text-gray-900">{{ importData?.assignments?.length || 0 }}</span>
                </div>
                <div v-if="importData?.assignments?.some(a => a.images?.length > 0)" class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">With images</span>
                  <span class="font-semibold text-gray-900">{{ importData?.assignments?.filter(a => a.images?.length > 0).length || 0 }}</span>
                </div>
              </div>

              <div v-if="importData?.courses?.length > 0" class="max-h-48 overflow-y-auto">
                <p class="text-xs font-medium text-gray-500 uppercase mb-2">Courses</p>
                <div class="space-y-2">
                  <div v-for="course in importData.courses" :key="course.id" class="text-sm border-b border-gray-100 pb-2">
                    <div class="font-medium text-gray-900 truncate">{{ bbCourseListLabel(course) }}</div>
                    <div v-if="course.instructor" class="text-xs text-gray-500">
                      Instructor: {{ course.instructor }}
                    </div>
                    <div v-if="course.code || course.term" class="text-xs text-gray-400">
                      {{ [course.code, course.term].filter(Boolean).join(' • ') }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
              <button @click="cancelImport" class="btn-ghost px-4 py-2">
                Cancel
              </button>
              <button @click="handleManualImport" class="btn-primary px-4 py-2">
                Import All
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    
    <!-- Blackboard Sync Modal (server-side HTTP scraper) -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showBlackboardSyncModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50" @click="showBlackboardSyncModal = false"></div>
          <div class="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center">
                <svg class="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
                </svg>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900">Sync with Blackboard</h3>
                <p class="text-sm text-gray-500">Login and import your courses</p>
              </div>
              <button @click="showBlackboardSyncModal = false" class="ml-auto p-2 hover:bg-gray-100 rounded-lg">
                <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <BlackboardSync :on-complete="() => showBlackboardSyncModal = false" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCanvasSyncModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50" @click="showCanvasSyncModal = false"></div>
          <div class="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
                <svg class="w-7 h-7 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93s3.06-7.44 7-7.93v15.86zm2-15.86c1.03.13 2 .45 2.87.93H13v-.93zM13 7h5.24c.25.31.48.65.68 1H13V7zm0 3h6.74c.08.33.15.66.19 1H13v-1zm0 9.93V19h2.87c-.87.48-1.84.8-2.87.93zM18.24 17H13v-1h5.92c-.2.35-.43.69-.68 1zm1.5-3H13v-1h6.93c-.04.34-.11.67-.19 1z"/>
                </svg>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900">Sync with Canvas</h3>
                <p class="text-sm text-gray-500">Sign in and import your courses</p>
              </div>
              <button type="button" @click="showCanvasSyncModal = false" class="ml-auto p-2 hover:bg-gray-100 rounded-lg">
                <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <CanvasSync :merge-import="mergeCanvasImport" :on-complete="() => (showCanvasSyncModal = false)" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Session (compact; last section on page when Supabase is configured) -->
    <Card v-if="isSupabaseConfigured" padding="none" class="rounded-xl px-4 py-3">
      <div
        class="flex flex-col gap-2 flex-wrap sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      >
        <h2 class="text-base font-semibold text-gray-900 leading-tight sm:mb-0">Session</h2>
        <div class="flex shrink-0">
          <template v-if="authStore.user">
            <Button variant="outline" :loading="signingOut" :disabled="signingOut" @click="signOutAccount">
              Sign out
            </Button>
          </template>
          <template v-else>
            <router-link to="/login">
              <Button>Sign in</Button>
            </router-link>
          </template>
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95);
}
</style>
