<script setup>
import { ref, computed, watch } from 'vue'
import { Modal, Input, Dropdown, DatePicker, Button } from '../ui'
import { useAssignmentsStore } from '../../stores/assignments'
import { useCoursesStore } from '../../stores/courses'
import { useTasksStore } from '../../stores/tasks'

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
const tasksStore = useTasksStore()

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
const group = ref('')

const titleError = ref('')

// ── Group combobox state ─────────────────────────────────────────────────────
const groupDropdownOpen = ref(false)

const groupSuggestions = computed(() => {
  const q = group.value.trim().toLowerCase()
  return tasksStore.taskGroups.filter(g => !q || g.toLowerCase().includes(q))
})

function selectGroup(name) {
  group.value = name
  groupDropdownOpen.value = false
}

function onGroupBlur() {
  // Delay so a click on a suggestion fires before we close.
  setTimeout(() => { groupDropdownOpen.value = false }, 150)
}

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
    group.value = props.task.group || ''
  } else {
    title.value = ''
    scheduledDate.value = props.defaultDate || ''
    priorityLevel.value = 'normal'
    courseId.value = ''
    assignmentId.value = ''
    group.value = ''
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
    group: group.value.trim() || null,
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

      <!-- Group -->
      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">
          Group <span class="normal-case text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <div class="relative">
          <input
            v-model="group"
            type="text"
            placeholder="e.g. Study, Work, Personal…"
            class="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-surface dark:bg-gray-800 text-[15px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/25 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-600/60 transition-[border-color,box-shadow] duration-200 pr-8"
            @focus="groupDropdownOpen = true"
            @blur="onGroupBlur"
          />
          <button
            v-if="group"
            type="button"
            tabindex="-1"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-0.5 rounded"
            @click="group = ''"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <!-- Existing group suggestions -->
          <Transition name="dropdown">
            <div
              v-if="groupDropdownOpen && groupSuggestions.length"
              class="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200/80 dark:border-gray-700/60 bg-surface dark:bg-gray-800 py-1 shadow-[0_4px_16px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04)]"
            >
              <button
                v-for="s in groupSuggestions"
                :key="s"
                type="button"
                class="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[14px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer"
                @mousedown.prevent="selectGroup(s)"
              >
                <svg class="w-3 h-3 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {{ s }}
              </button>
            </div>
          </Transition>
        </div>
        <p v-if="group && !tasksStore.taskGroups.includes(group.trim())" class="font-mono text-[11px] text-primary-600 dark:text-primary-400">
          Creates a new group "{{ group.trim() }}"
        </p>
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
