<script setup>
import { ref, computed, watch } from 'vue'
import { Modal, Input, Dropdown, DatePicker, Button } from '../ui'
import { useAssignmentsStore } from '../../stores/assignments'
import { useCoursesStore } from '../../stores/courses'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null },
  // Pre-fills the scheduled date when adding a brand-new task (e.g. the planner
  // opens the modal already pinned to the day the user is viewing). Ignored when
  // editing an existing task.
  defaultDate: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save'])

const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

const PRIORITY_OPTIONS = [
  {
    value: 'normal',
    label: 'Normal',
    activeClasses: 'bg-primary-700 border-primary-700 text-white shadow-sm shadow-primary-900/20 dark:bg-primary-600 dark:border-primary-600',
    dot: 'bg-white',
  },
  {
    value: 'high',
    label: 'High',
    activeClasses: 'bg-warning-500 border-warning-500 text-white shadow-sm shadow-warning-600/25 dark:bg-warning-500 dark:border-warning-500',
    dot: 'bg-white',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    activeClasses: 'bg-danger-600 border-danger-600 text-white shadow-sm shadow-danger-600/25 dark:bg-danger-600 dark:border-danger-600',
    dot: 'bg-white',
  },
]

const priorityOrder = { urgent: 1, high: 2, normal: 3 }

const isEditing = computed(() => props.task !== null)
const modalTitle = computed(() => (isEditing.value ? 'Edit Task' : 'Add New Task'))

const title = ref('')
const scheduledDate = ref('')
const priorityLevel = ref('normal')
const courseId = ref('')
const assignmentId = ref('')

const titleError = ref('')

// Filter assignments by selected course, or show all if no course picked
const filteredAssignments = computed(() => {
  if (!courseId.value) return assignmentsStore.assignments
  return assignmentsStore.assignments.filter(a => a.courseId === courseId.value)
})

const courseOptions = computed(() => [
  { value: '', label: 'No course' },
  ...coursesStore.courses.map(c => ({ value: c.id, label: c.name })),
])

const assignmentOptions = computed(() => [
  { value: '', label: 'No assignment' },
  ...filteredAssignments.value.map(a => ({ value: a.id, label: a.title })),
])

// When assignment changes, sync the course field to match
watch(assignmentId, (newId) => {
  if (!newId) return
  const assignment = assignmentsStore.getAssignmentById(newId)
  if (assignment?.courseId) courseId.value = assignment.courseId
})

// When course changes, clear assignment if it no longer belongs to that course
watch(courseId, (newCourseId) => {
  if (!assignmentId.value) return
  const assignment = assignmentsStore.getAssignmentById(assignmentId.value)
  if (assignment && assignment.courseId !== newCourseId) assignmentId.value = ''
})

// Populate form when opened for editing
watch(() => props.modelValue, (open) => {
  if (!open) return
  titleError.value = ''
  if (props.task) {
    title.value = props.task.title || ''
    scheduledDate.value = props.task.scheduledDate || ''
    priorityLevel.value = props.task.priorityLevel || 'normal'
    courseId.value = props.task.courseId || ''
    assignmentId.value = props.task.assignmentId || ''
  } else {
    title.value = ''
    scheduledDate.value = props.defaultDate || ''
    priorityLevel.value = 'normal'
    courseId.value = ''
    assignmentId.value = ''
  }
})

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function close() {
  emit('update:modelValue', false)
}

function handleSubmit() {
  titleError.value = ''
  if (!title.value.trim()) {
    titleError.value = 'Task title is required'
    return
  }
  const assignment = assignmentId.value
    ? assignmentsStore.getAssignmentById(assignmentId.value)
    : null
  const course = courseId.value
    ? coursesStore.getCourseById(courseId.value)
    : null

  emit('save', {
    title: title.value.trim(),
    scheduledDate: scheduledDate.value,
    priorityLevel: priorityLevel.value,
    priority: priorityOrder[priorityLevel.value],
    assignmentId: assignment?.id || null,
    courseId: course?.id || assignment?.courseId || null,
    courseName: course?.name || assignment?.courseName || null,
  })

  close()
}
</script>

<template>
  <Modal :modelValue="modelValue" size="lg" @close="close" @update:modelValue="emit('update:modelValue', $event)">
    <template #header>
      <h3 class="display text-xl text-gray-900 dark:text-gray-100">{{ modalTitle }}</h3>
    </template>

    <form id="task-form" class="space-y-5" @submit.prevent="handleSubmit">
      <!-- Title -->
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">
          Task <span class="text-rust-500">*</span>
        </label>
        <Input
          v-model="title"
          placeholder="e.g. Read chapter 4, review notes..."
          :error="titleError"
          required
        />
      </div>

      <!-- Scheduled Date -->
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">
          Scheduled Date <span class="normal-case text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <DatePicker v-model="scheduledDate" placeholder="Pick a day (optional)" />
      </div>

      <!-- Priority -->
      <div class="space-y-2">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Priority</label>
        <div class="flex gap-2">
          <button
            v-for="opt in PRIORITY_OPTIONS"
            :key="opt.value"
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all duration-150"
            :class="priorityLevel === opt.value
              ? opt.activeClasses
              : 'bg-surface dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
            @click="priorityLevel = opt.value"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :class="priorityLevel === opt.value ? opt.dot : 'bg-gray-300'"
            />
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Course -->
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Course</label>
        <Dropdown v-model="courseId" :options="courseOptions" />
      </div>

      <!-- Assignment (filtered by course) -->
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Assignment</label>
        <Dropdown v-model="assignmentId" :options="assignmentOptions" />
      </div>
    </form>

    <template #footer>
      <div class="flex gap-3 justify-end">
        <Button variant="secondary" type="button" @click="close">Cancel</Button>
        <Button
          type="submit"
          form="task-form"
          variant="primary"
          :disabled="!title.trim()"
        >
          {{ isEditing ? 'Save Changes' : 'Add Task' }}
        </Button>
      </div>
    </template>
  </Modal>
</template>
