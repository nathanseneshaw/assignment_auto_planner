<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Card, Modal, Input, Button, Badge, ProgressBar, EmptyState, ConfirmDialog } from '../components/ui'
import { sanitizeBlackboardCourseDisplayName } from '../utils/blackboardCourseName.js'

const route = useRoute()
const router = useRouter()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()

const showAddModal = ref(false)
const editingCourse = ref(null)
const showDeleteConfirm = ref(false)
const courseToDelete = ref(null)

const newCourse = ref({
  name: '',
  code: '',
  instructor: ''
})

function courseCardTitle(course) {
  return sanitizeBlackboardCourseDisplayName(course?.name || '') || course?.name || ''
}

function resetForm() {
  newCourse.value = { name: '', code: '', instructor: '' }
  editingCourse.value = null
}

function openAddModal() {
  resetForm()
  showAddModal.value = true
}

function maybeOpenAddModalFromRoute() {
  if (route.query.action === 'add') {
    openAddModal()
    const { action, ...restQuery } = route.query
    router.replace({ path: route.path, query: restQuery })
  }
}

function addCourse() {
  if (!newCourse.value.name.trim()) return
  
  if (editingCourse.value) {
    coursesStore.updateCourse(editingCourse.value.id, {
      name: newCourse.value.name.trim(),
      code: newCourse.value.code.trim(),
      instructor: newCourse.value.instructor.trim()
    })
  } else {
    coursesStore.addCourse({
      name: newCourse.value.name.trim(),
      code: newCourse.value.code.trim(),
      instructor: newCourse.value.instructor.trim(),
      lmsSource: 'manual'
    })
  }
  
  showAddModal.value = false
  resetForm()
}

function editCourse(course) {
  editingCourse.value = course
  newCourse.value = {
    name: course.name,
    code: course.code || '',
    instructor: course.instructor || ''
  }
  showAddModal.value = true
}

function getAssignmentCount(courseId) {
  return assignmentsStore.assignmentsByCourse[courseId]?.length || 0
}

function getCompletedCount(courseId) {
  const assignments = assignmentsStore.assignmentsByCourse[courseId] || []
  return assignments.filter(a => a.status === 'completed').length
}

function getProgressPercentage(courseId) {
  const total = getAssignmentCount(courseId)
  if (total === 0) return 0
  return Math.round((getCompletedCount(courseId) / total) * 100)
}

function getUpcomingAssignments(courseId) {
  const assignments = assignmentsStore.assignmentsByCourse[courseId] || []
  const now = new Date()
  return assignments
    .filter(a => new Date(a.dueDate) >= now && a.status !== 'completed')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 2)
}

function promptDeleteCourse(course) {
  courseToDelete.value = course
  showDeleteConfirm.value = true
}

function confirmDeleteCourse() {
  if (courseToDelete.value) {
    coursesStore.deleteCourse(courseToDelete.value.id)
    courseToDelete.value = null
  }
}

function getDeleteMessage() {
  if (!courseToDelete.value) return ''
  const count = getAssignmentCount(courseToDelete.value.id)
  if (count > 0) {
    return `This course has ${count} assignment(s). Deleting it will not remove the assignments, but they will no longer be associated with this course.`
  }
  return 'Are you sure you want to delete this course? This action cannot be undone.'
}

function formatDate(dateString) {
  const date = new Date(dateString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const totalStats = computed(() => ({
  courses: coursesStore.courses.length,
  assignments: assignmentsStore.assignments.length,
  completed: assignmentsStore.assignments.filter(a => a.status === 'completed').length
}))

onMounted(() => {
  maybeOpenAddModalFromRoute()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-gray-900">Courses</h2>
        <p class="text-gray-500">Manage your courses and track progress</p>
      </div>
      <Button @click="openAddModal" variant="primary">
        <svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Course
      </Button>
    </div>

    <!-- Overview Stats -->
    <Card class="relative overflow-hidden border-gray-200/70">
      <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary-800 to-primary-950 rounded-l-2xl" aria-hidden="true" />
      <div class="pl-4 grid grid-cols-3 gap-4 sm:gap-6">
        <div class="text-center sm:text-left">
          <p class="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{{ totalStats.courses }}</p>
          <p class="text-gray-500 text-sm mt-1 font-medium">Active courses</p>
        </div>
        <div class="text-center sm:text-left border-x border-gray-100 px-2 sm:px-4">
          <p class="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{{ totalStats.assignments }}</p>
          <p class="text-gray-500 text-sm mt-1 font-medium">Assignments</p>
        </div>
        <div class="text-center sm:text-left">
          <p class="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{{ totalStats.completed }}</p>
          <p class="text-gray-500 text-sm mt-1 font-medium">Completed</p>
        </div>
      </div>
    </Card>

    <!-- Empty State -->
    <Card v-if="coursesStore.courses.length === 0" padding="none">
      <EmptyState 
        icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        title="No courses yet"
        description="Add your courses to start organizing assignments"
        action-label="Add Your First Course"
        @action="openAddModal"
      />
    </Card>

    <!-- Courses Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card 
        v-for="course in coursesStore.coursesSorted"
        :key="course.id"
        hover
        class="group relative overflow-hidden"
      >
        <!-- Color Accent -->
        <div 
          class="absolute top-0 left-0 w-full h-1"
          :class="course.color.bg.replace('100', '500')"
        ></div>

        <div class="pt-2">
          <!-- Header -->
          <div class="flex items-start justify-between mb-4">
            <div 
              class="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
              :class="course.color.bg"
            >
              <svg 
                class="w-6 h-6"
                :class="course.color.text"
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            
            <!-- Actions -->
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                @click="editCourse(course)"
                class="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button 
                @click="promptDeleteCourse(course)"
                class="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-lg transition-all"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Course Info -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-lg font-semibold text-gray-900 line-clamp-1">{{ courseCardTitle(course) }}</h3>
            </div>
            <div class="flex items-center gap-2 text-sm text-gray-500">
              <span v-if="course.code" class="font-medium">{{ course.code }}</span>
              <span v-if="course.code && course.instructor">•</span>
              <span v-if="course.instructor">{{ course.instructor }}</span>
            </div>
          </div>

          <!-- Progress -->
          <div class="mb-4">
            <div class="flex items-center justify-between text-sm mb-2">
              <span class="text-gray-500">Progress</span>
              <span class="font-semibold text-gray-900">
                {{ getCompletedCount(course.id) }}/{{ getAssignmentCount(course.id) }} completed
              </span>
            </div>
            <ProgressBar 
              :value="getProgressPercentage(course.id)" 
              size="md"
              :variant="getProgressPercentage(course.id) === 100 ? 'success' : 'primary'"
            />
          </div>

          <!-- Upcoming Assignments -->
          <div v-if="getUpcomingAssignments(course.id).length > 0" class="border-t border-gray-100 pt-4">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Upcoming</p>
            <div class="space-y-2">
              <div 
                v-for="assignment in getUpcomingAssignments(course.id)"
                :key="assignment.id"
                class="flex items-center justify-between text-sm"
              >
                <span class="text-gray-700 truncate flex-1 mr-2">{{ assignment.title }}</span>
                <span class="text-xs text-gray-500 whitespace-nowrap">{{ formatDate(assignment.dueDate) }}</span>
              </div>
            </div>
          </div>

          <div v-else-if="getAssignmentCount(course.id) === 0" class="border-t border-gray-100 pt-4">
            <p class="text-sm text-gray-400 text-center">No assignments yet</p>
          </div>
        </div>
      </Card>
    </div>

    <!-- Add/Edit Course Modal -->
    <Modal 
      v-model="showAddModal" 
      :title="editingCourse ? 'Edit Course' : 'Add New Course'" 
      size="md"
      @close="resetForm"
    >
      <form id="course-form" @submit.prevent="addCourse" class="space-y-5">
        <Input
          v-model="newCourse.name"
          label="Course Name"
          placeholder="e.g., Introduction to Computer Science"
          required
        />

        <div class="grid grid-cols-2 gap-4">
          <Input
            v-model="newCourse.code"
            label="Course Code"
            placeholder="e.g., CS101"
          />

          <Input
            v-model="newCourse.instructor"
            label="Instructor"
            placeholder="e.g., Dr. Smith"
          />
        </div>
      </form>

      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button type="button" variant="secondary" @click="showAddModal = false; resetForm()">
            Cancel
          </Button>
          <Button
            type="submit"
            form="course-form"
            variant="primary"
            :disabled="!newCourse.name.trim()"
          >
            {{ editingCourse ? 'Save Changes' : 'Add Course' }}
          </Button>
        </div>
      </template>
    </Modal>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Course"
      :message="getDeleteMessage()"
      confirm-text="Delete"
      cancel-text="Cancel"
      variant="danger"
      @confirm="confirmDeleteCourse"
    />
  </div>
</template>
