<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { Card, Modal, Input, Dropdown, Button, Badge, EmptyState, ConfirmDialog } from '../components/ui'
import { resolveAssignmentCourseName, importSourceLabel } from '../utils/assignmentDisplay.js'

const route = useRoute()
const router = useRouter()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

const showModal = ref(false)
const isEditing = ref(false)
const editingAssignmentId = ref(null)
const showDeleteConfirm = ref(false)
const assignmentToDelete = ref(null)
const expandedAssignments = ref(new Set())
const filterCourse = ref('all')
/** 'all' | 'active' | 'completed' */
const filterCompletion = ref('all')
const searchQuery = ref('')

const courseFilterOptions = computed(() => [
  { value: 'all', label: 'All Courses' },
  ...coursesStore.courses.map((c) => ({ value: c.id, label: c.name })),
])

const completionFilterOptions = [
  { value: 'all', label: 'All assignments' },
  { value: 'active', label: 'Active only' },
  { value: 'completed', label: 'Completed only' },
]

const modalCourseOptions = computed(() => [
  { value: '', label: 'Select a course' },
  ...coursesStore.courses.map((c) => ({ value: c.id, label: c.name })),
])

const formData = ref({
  title: '',
  description: '',
  courseId: '',
  dueDate: ''
})

const filteredAssignments = computed(() => {
  let result = assignmentsStore.assignmentsByDueDate

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(a => 
      a.title.toLowerCase().includes(query) ||
      a.description?.toLowerCase().includes(query)
    )
  }

  if (filterCourse.value !== 'all') {
    result = result.filter(a => a.courseId === filterCourse.value)
  }

  if (filterCompletion.value === 'active') {
    result = result.filter(a => a.status !== 'completed')
  } else if (filterCompletion.value === 'completed') {
    result = result.filter(a => a.status === 'completed')
  }

  return result
})

const assignmentStats = computed(() => ({
  total: assignmentsStore.assignments.length,
  completed: assignmentsStore.assignments.filter(a => a.status === 'completed').length,
  active: assignmentsStore.assignments.filter(a => a.status !== 'completed').length,
  overdue: assignmentsStore.overdueAssignments.length
}))

const modalTitle = computed(() => isEditing.value ? 'Edit Assignment' : 'Add New Assignment')

function parseDateString(s) {
  if (!s) return new Date()
  // Date-only strings (YYYY-MM-DD) must be parsed as local time, not UTC
  if (s.length === 10) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(s)
}

function formatDate(dateString) {
  return parseDateString(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatCompletedLine(assignment) {
  if (!assignment.completedAt) return 'Completed'
  return `Completed ${formatDate(assignment.completedAt)}`
}

function getDaysUntil(dateString) {
  const date = parseDateString(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24))
}

function getStatusBadge(assignment) {
  const days = getDaysUntil(assignment.dueDate)
  
  if (assignment.status === 'completed') {
    return { text: 'Completed', variant: 'success' }
  }
  if (assignment.status === 'in_progress') {
    return { text: 'In progress', variant: 'primary' }
  }
  if (days < 0) {
    return { text: 'Overdue', variant: 'danger' }
  }
  if (days < 2) {
    return { text: 'Due Soon', variant: 'warning' }
  }
  if (days <= 7) {
    return { text: 'Upcoming', variant: 'default' }
  }
  return { text: 'Not Due Yet', variant: 'default' }
}

function getCourseColor(courseId) {
  const course = coursesStore.getCourseById(courseId)
  return course?.color || { bg: 'bg-gray-100', text: 'text-gray-800' }
}

function assignmentCourseLabel(assignment) {
  return resolveAssignmentCourseName(assignment, coursesStore.getCourseById)
}

function assignmentImportLabel(assignment) {
  return importSourceLabel(assignment.importSource)
}

function badgeColorsForAssignment(assignment) {
  if (assignment.courseId) return getCourseColor(assignment.courseId)
  return { bg: 'bg-stone-100', text: 'text-stone-800' }
}

function resetForm() {
  formData.value = {
    title: '',
    description: '',
    courseId: '',
    dueDate: ''
  }
  isEditing.value = false
  editingAssignmentId.value = null
}

function openAddModal() {
  resetForm()
  showModal.value = true
}

function maybeOpenAddModalFromRoute() {
  if (route.query.action === 'add') {
    openAddModal()
    const { action, ...restQuery } = route.query
    router.replace({ path: route.path, query: restQuery })
  }
}

function openEditModal(assignment) {
  isEditing.value = true
  editingAssignmentId.value = assignment.id
  formData.value = {
    title: assignment.title,
    description: assignment.description || '',
    courseId: assignment.courseId || '',
    dueDate: assignment.dueDate
  }
  showModal.value = true
}

function saveAssignment() {
  if (!formData.value.title.trim() || !formData.value.dueDate) return

  const course = coursesStore.getCourseById(formData.value.courseId)
  
  if (isEditing.value && editingAssignmentId.value) {
    assignmentsStore.updateAssignment(editingAssignmentId.value, {
      title: formData.value.title.trim(),
      description: formData.value.description.trim(),
      courseId: formData.value.courseId,
      courseName: course?.name || 'No Course',
      dueDate: formData.value.dueDate
    })
  } else {
    assignmentsStore.addAssignment({
      title: formData.value.title.trim(),
      description: formData.value.description.trim(),
      courseId: formData.value.courseId,
      courseName: course?.name || 'No Course',
      dueDate: formData.value.dueDate,
      status: 'pending'
    })
  }

  showModal.value = false
  resetForm()
}

function promptDeleteAssignment(assignment) {
  assignmentToDelete.value = assignment
  showDeleteConfirm.value = true
}

function confirmDeleteAssignment() {
  if (assignmentToDelete.value) {
    assignmentsStore.deleteAssignment(assignmentToDelete.value.id)
    assignmentToDelete.value = null
  }
}

function toggleExpanded(assignmentId) {
  if (expandedAssignments.value.has(assignmentId)) {
    expandedAssignments.value.delete(assignmentId)
  } else {
    expandedAssignments.value.add(assignmentId)
  }
}

function isExpanded(assignmentId) {
  return expandedAssignments.value.has(assignmentId)
}

function shouldShowExpandButton(description) {
  return description && description.length > 150
}

function getMinDate() {
  return new Date().toISOString().split('T')[0]
}

function toggleAssignmentComplete(assignment) {
  if (assignment.status === 'completed') {
    assignmentsStore.markAssignmentIncomplete(assignment.id)
  } else {
    assignmentsStore.markAssignmentComplete(assignment.id)
  }
}

onMounted(() => {
  maybeOpenAddModalFromRoute()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Assignments</h2>
        <p class="text-gray-500 dark:text-gray-400">Manage and track all your assignments</p>
      </div>
      <Button @click="openAddModal" variant="primary">
        <svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Assignment
      </Button>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-gray-900 dark:text-gray-100">{{ assignmentStats.total }}</p>
        <p class="text-sm text-gray-500">Total</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-emerald-700">{{ assignmentStats.completed }}</p>
        <p class="text-sm text-gray-500">Completed</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-primary-800">{{ assignmentStats.active }}</p>
        <p class="text-sm text-gray-500">Active</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold" :class="assignmentStats.overdue > 0 ? 'text-danger-600' : 'text-gray-400'">
          {{ assignmentStats.overdue }}
        </p>
        <p class="text-sm text-gray-500">Overdue</p>
      </Card>
    </div>

    <!-- Filters -->
    <Card>
      <div class="flex flex-col sm:flex-row gap-4">
        <!-- Search -->
        <div class="flex-1">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search assignments..."
              class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>

        <!-- Course Filter -->
        <div class="sm:w-48">
          <Dropdown v-model="filterCourse" :options="courseFilterOptions" />
        </div>

        <!-- Completion filter -->
        <div class="sm:w-44">
          <Dropdown v-model="filterCompletion" :options="completionFilterOptions" />
        </div>
      </div>
    </Card>

    <!-- Assignments List -->
    <Card v-if="filteredAssignments.length === 0" padding="none">
      <EmptyState 
        icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        title="No assignments found"
        :description="searchQuery || filterCourse !== 'all' || filterCompletion !== 'all' 
          ? 'Try adjusting your filters' 
          : 'Get started by adding your first assignment'"
        :action-label="!searchQuery && filterCourse === 'all' && filterCompletion === 'all' ? 'Add Assignment' : ''"
        @action="openAddModal"
      />
    </Card>

    <div v-else class="space-y-4">
      <Card 
        v-for="assignment in filteredAssignments"
        :key="assignment.id"
        hover
        class="group transition-shadow"
        :class="assignment.status === 'completed' ? 'bg-primary-50/25 dark:bg-primary-900/10 ring-1 ring-primary-100 dark:ring-primary-900/30' : ''"
      >
        <div class="flex flex-col gap-3">
          <!-- Header Row -->
          <div class="flex flex-col sm:flex-row sm:items-start gap-3">
            <!-- Main Content -->
            <div class="flex-1 min-w-0 order-2 sm:order-1">
              <div class="flex flex-wrap items-center gap-2 mb-2">
                <h3
                  class="text-lg font-semibold"
                  :class="assignment.status === 'completed' ? 'text-gray-500 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'"
                >
                  {{ assignment.title }}
                </h3>
                <Badge :variant="getStatusBadge(assignment).variant" dot>
                  {{ getStatusBadge(assignment).text }}
                </Badge>
              </div>

              <div class="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                <span
                  v-if="assignmentCourseLabel(assignment)"
                  class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium"
                  :class="[badgeColorsForAssignment(assignment).bg, badgeColorsForAssignment(assignment).text]"
                >
                  {{ assignmentCourseLabel(assignment) }}
                </span>
                <span
                  v-if="assignmentImportLabel(assignment)"
                  class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-gray-600/80"
                >
                  {{ assignmentImportLabel(assignment) }}
                </span>

                <span class="inline-flex items-center gap-1.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Due {{ formatDate(assignment.dueDate) }}
                </span>
              </div>
            </div>

            <!-- Edit / delete only -->
            <div class="flex items-center justify-end gap-1 shrink-0 order-1 sm:order-2 sm:pt-0.5">
              <button 
                type="button"
                @click.stop="openEditModal(assignment)"
                class="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                title="Edit assignment"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button 
                type="button"
                @click.stop="promptDeleteAssignment(assignment)"
                class="p-2 text-gray-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/30 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                title="Delete assignment"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Description (Expandable) -->
          <div v-if="assignment.description" class="relative">
            <p 
              class="text-gray-600 dark:text-gray-400 whitespace-pre-wrap"
              :class="{ 'line-clamp-2': !isExpanded(assignment.id) }"
            >
              {{ assignment.description }}
            </p>
            
            <!-- Expand/Collapse Button -->
            <button
              v-if="shouldShowExpandButton(assignment.description)"
              @click="toggleExpanded(assignment.id)"
              class="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1 transition-colors"
            >
              <span>{{ isExpanded(assignment.id) ? 'Show less' : 'Show more' }}</span>
              <svg 
                class="w-4 h-4 transition-transform" 
                :class="{ 'rotate-180': isExpanded(assignment.id) }"
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <!-- Completion: same pattern as “Show more” — text actions in a footer strip -->
          <div 
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700/80"
          >
            <p 
              v-if="assignment.status === 'completed'" 
              class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2"
            >
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 shrink-0">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span>{{ formatCompletedLine(assignment) }}</span>
            </p>
            <p v-else class="text-sm text-gray-500">
              Finished this assignment?
            </p>
            <div class="flex items-center gap-4 sm:ml-auto sm:shrink-0">
              <button
                v-if="assignment.status !== 'completed'"
                type="button"
                class="text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-primary-900 dark:hover:text-primary-400 transition-colors"
                @click.stop="toggleAssignmentComplete(assignment)"
              >
                Mark complete
              </button>
              <button
                v-else
                type="button"
                class="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                @click.stop="toggleAssignmentComplete(assignment)"
              >
                Mark active again
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Add/Edit Assignment Modal -->
    <Modal v-model="showModal" :title="modalTitle" size="lg" @close="resetForm">
      <form id="assignment-form" @submit.prevent="saveAssignment" class="space-y-5">
        <Input
          v-model="formData.title"
          label="Assignment Title"
          placeholder="e.g., Research Essay on Climate Change"
          required
        />

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
          <textarea
            v-model="formData.description"
            rows="4"
            placeholder="Add any details about the assignment..."
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Dropdown v-model="formData.courseId" label="Course" :options="modalCourseOptions" />

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Due Date <span class="text-danger-500">*</span>
            </label>
            <input
              v-model="formData.dueDate"
              type="date"
              required
              class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent scheme-light dark:scheme-dark"
            />
          </div>
        </div>

        <p v-if="isEditing" class="text-sm text-gray-500">
          At the bottom of each card, use <strong class="font-medium text-gray-700">Mark complete</strong> or <strong class="font-medium text-gray-700">Mark active again</strong>.
        </p>
      </form>

      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button type="button" variant="secondary" @click="showModal = false; resetForm()">
            Cancel
          </Button>
          <Button
            type="submit"
            form="assignment-form"
            variant="primary"
            :disabled="!formData.title.trim() || !formData.dueDate"
          >
            {{ isEditing ? 'Save Changes' : 'Add Assignment' }}
          </Button>
        </div>
      </template>
    </Modal>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Assignment"
      :message="`Are you sure you want to delete '${assignmentToDelete?.title}'? This action cannot be undone.`"
      confirm-text="Delete"
      cancel-text="Cancel"
      variant="danger"
      @confirm="confirmDeleteAssignment"
    />
  </div>
</template>
