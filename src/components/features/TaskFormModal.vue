<script setup>
import { ref, computed, watch } from 'vue'
import { Modal, Input, Dropdown, Button } from '../ui'
import { useAssignmentsStore } from '../../stores/assignments'
import { useCoursesStore } from '../../stores/courses'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'save'])

const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

const PRIORITY_OPTIONS = [
  {
    value: 'normal',
    label: 'Normal',
    activeClasses: 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-[0_0_8px_2px_rgba(52,211,153,0.35)]',
    dot: 'bg-emerald-500',
  },
  {
    value: 'high',
    label: 'High',
    activeClasses: 'bg-amber-50 border-amber-300 text-amber-700',
    dot: 'bg-amber-400',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    activeClasses: 'bg-danger-50 border-danger-300 text-danger-600',
    dot: 'bg-danger-500',
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
    scheduledDate.value = props.task.scheduledDate || localDateKey()
    priorityLevel.value = props.task.priorityLevel || 'normal'
    courseId.value = props.task.courseId || ''
    assignmentId.value = props.task.assignmentId || ''
  } else {
    title.value = ''
    scheduledDate.value = localDateKey()
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
  if (!scheduledDate.value) return

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
  <Modal :modelValue="modelValue" :title="modalTitle" size="lg" @close="close" @update:modelValue="emit('update:modelValue', $event)">
    <form id="task-form" class="space-y-5" @submit.prevent="handleSubmit">
      <!-- Title -->
      <Input
        v-model="title"
        label="Task"
        placeholder="e.g. Read chapter 4, review notes..."
        :error="titleError"
        required
      />

      <!-- Scheduled Date -->
      <div>
        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          Scheduled Date <span class="text-danger-500">*</span>
        </label>
        <input
          v-model="scheduledDate"
          type="date"
          required
          class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200 scheme-light dark:scheme-dark"
        />
      </div>

      <!-- Priority -->
      <div>
        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Priority</label>
        <div class="flex gap-2">
          <button
            v-for="opt in PRIORITY_OPTIONS"
            :key="opt.value"
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all duration-150"
            :class="priorityLevel === opt.value
              ? opt.activeClasses
              : 'bg-white dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
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
      <Dropdown v-model="courseId" label="Course" :options="courseOptions" />

      <!-- Assignment (filtered by course) -->
      <Dropdown v-model="assignmentId" label="Assignment" :options="assignmentOptions" />
    </form>

    <template #footer>
      <div class="flex gap-3 justify-end">
        <Button variant="secondary" type="button" @click="close">Cancel</Button>
        <Button
          type="submit"
          form="task-form"
          variant="primary"
          :disabled="!title.trim() || !scheduledDate"
        >
          {{ isEditing ? 'Save Changes' : 'Add Task' }}
        </Button>
      </div>
    </template>
  </Modal>
</template>
