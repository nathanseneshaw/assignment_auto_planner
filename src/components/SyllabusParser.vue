<script setup>
import { ref, computed } from 'vue'
import { Button, Card, Input, Modal } from './ui'
import * as syllabusService from '../services/syllabusService'
import { hydrateLmsStoresFromSupabase } from '../services/lmsSupabaseHydration'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_EXT = ['pdf', 'docx']

const file = ref(null)
const fileError = ref('')
const parsing = ref(false)
const parseError = ref('')
const parseMeta = ref(null)

// The review UI lives inside a Modal driven by this flag.
const reviewOpen = ref(false)
const draft = ref(null)
const saving = ref(false)
const saveError = ref('')
const saveResult = ref(null)

const fileInputEl = ref(null)

const canParse = computed(() => !!file.value && !parsing.value && !!authStore.user)
const canSave = computed(() => {
  if (!draft.value || saving.value) return false
  if (!draft.value.course?.name?.trim()) return false
  return true
})

function pickFile() {
  fileInputEl.value?.click()
}

function onFileChange(event) {
  const picked = event.target.files?.[0] || null
  fileError.value = ''
  saveResult.value = null
  if (!picked) {
    file.value = null
    return
  }
  if (picked.size > MAX_FILE_BYTES) {
    fileError.value = 'File is too large. Max size is 5 MB.'
    file.value = null
    event.target.value = ''
    return
  }
  const ext = (picked.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    fileError.value = 'Only .pdf and .docx files are supported.'
    file.value = null
    event.target.value = ''
    return
  }
  file.value = picked
}

async function handleParse() {
  if (!canParse.value) return
  parsing.value = true
  parseError.value = ''
  parseMeta.value = null
  saveResult.value = null
  try {
    const res = await syllabusService.parseSyllabus(file.value)
    draft.value = {
      course: {
        name: res.draft?.course?.name || '',
        code: res.draft?.course?.code || '',
        term: res.draft?.course?.term || '',
        instructor: res.draft?.course?.instructor || '',
      },
      assignments: Array.isArray(res.draft?.assignments)
        ? res.draft.assignments.map((a) => ({
            name: a?.name || '',
            dueAt: a?.dueAt || null,
            // Keep description in state so it round-trips to the save call,
            // even though we don't surface it in the modal UI.
            description: a?.description || '',
          }))
        : [],
    }
    parseMeta.value = res.meta || null
    reviewOpen.value = true
  } catch (e) {
    parseError.value = e?.message || 'Could not parse the syllabus.'
  } finally {
    parsing.value = false
  }
}

// ----- review/edit helpers -----

function addAssignmentRow() {
  if (!draft.value) return
  draft.value.assignments.push({ name: '', dueAt: null, description: '' })
}

function removeAssignmentRow(idx) {
  if (!draft.value) return
  draft.value.assignments.splice(idx, 1)
}

/** Convert an ISO 8601 string to the `YYYY-MM-DD` value an <input type="date"> wants. */
function isoToDateInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Convert a `YYYY-MM-DD` string from <input type="date"> back to an ISO string.
 * Anchors at 23:59:00 local time — assignments are typically due end-of-day,
 * and the underlying `assignments.due_at` column is timestamptz so it needs a time.
 */
function dateInputToIso(value) {
  if (!value) return null
  const [y, m, d] = value.split('-').map((v) => Number(v))
  if (!y || !m || !d) return null
  const local = new Date(y, m - 1, d, 23, 59, 0)
  if (Number.isNaN(local.getTime())) return null
  return local.toISOString()
}

function onDueDateInput(idx, event) {
  if (!draft.value) return
  draft.value.assignments[idx].dueAt = dateInputToIso(event.target.value)
}

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  saveError.value = ''
  try {
    const payload = {
      course: {
        name: draft.value.course.name.trim(),
        code: draft.value.course.code?.trim() || null,
        term: draft.value.course.term?.trim() || null,
        instructor: draft.value.course.instructor?.trim() || null,
      },
      assignments: draft.value.assignments
        .filter((a) => a.name?.trim())
        .map((a) => ({
          name: a.name.trim(),
          dueAt: a.dueAt || null,
          description: a.description?.trim() || null,
        })),
    }
    const result = await syllabusService.saveSyllabus(payload)
    saveResult.value = {
      courseName: payload.course.name,
      assignmentsInserted: result.assignmentsInserted || 0,
      assignmentsSkipped: result.assignmentsSkipped || 0,
    }
    await hydrateLmsStoresFromSupabase()
    closeReviewAndReset()
  } catch (e) {
    saveError.value = e?.message || 'Could not save the syllabus.'
  } finally {
    saving.value = false
  }
}

function closeReviewAndReset() {
  reviewOpen.value = false
  draft.value = null
  parseMeta.value = null
  file.value = null
  if (fileInputEl.value) fileInputEl.value.value = ''
}

function handleModalClose() {
  // Block close while we're mid-save so the network call can finish.
  if (saving.value) {
    reviewOpen.value = true
    return
  }
  // Closing the modal discards the draft.
  draft.value = null
  saveError.value = ''
}
</script>

<template>
  <Card padding="md">
    <div class="mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Syllabus parser</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Upload a course syllabus (PDF or DOCX). We'll use AI to pull out the course details and assignment due dates,
        let you review and edit them, then add everything to your assignments.
      </p>
    </div>

    <div class="space-y-4">
      <div v-if="!authStore.user" class="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
        Sign in to use the syllabus parser.
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">Syllabus file</label>
        <input
          ref="fileInputEl"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          class="hidden"
          @change="onFileChange"
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="secondary" :disabled="parsing" @click="pickFile">
            Choose file…
          </Button>
          <span v-if="file" class="text-sm text-gray-700 dark:text-gray-200 truncate max-w-xs">{{ file.name }}</span>
          <span v-else class="text-sm text-gray-400 dark:text-gray-500">PDF or DOCX, up to 5 MB</span>
        </div>
        <p v-if="fileError" class="mt-2 text-sm text-danger-600">{{ fileError }}</p>
      </div>

      <div>
        <Button :loading="parsing" :disabled="!canParse" @click="handleParse">
          Parse syllabus
        </Button>
      </div>

      <div v-if="parseError" class="text-sm text-danger-700 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/30 border border-danger-200 dark:border-danger-800/60 rounded-xl p-3">
        {{ parseError }}
      </div>

      <div v-if="saveResult" class="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3">
        Imported <strong>{{ saveResult.courseName }}</strong> with {{ saveResult.assignmentsInserted }} assignment(s) — visible now on the Assignments page.
        <span v-if="saveResult.assignmentsSkipped > 0">
          ({{ saveResult.assignmentsSkipped }} row(s) without a due date were skipped.)
        </span>
      </div>
    </div>
  </Card>

  <!-- Review modal — appears after a successful parse ----------------------- -->
  <Modal
    v-model="reviewOpen"
    title="Review syllabus"
    size="full"
    :closable="!saving"
    @close="handleModalClose"
  >
    <div v-if="draft" class="space-y-6">
      <div v-if="parseMeta?.truncated" class="text-xs text-warning-800 dark:text-warning-300 bg-warning-50 dark:bg-warning-900/30 border border-warning-200 dark:border-warning-800/60 rounded-xl p-3">
        This syllabus was long. We sent the first ~50 000 characters plus the last 5 000 to the parser, so a few
        middle items may be missing — add any missing rows below before saving.
      </div>

      <section>
        <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Course</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input v-model="draft.course.name" label="Course name" required />
          <Input v-model="draft.course.code" label="Course code (optional)" />
          <Input v-model="draft.course.term" label="Term (optional)" />
          <Input v-model="draft.course.instructor" label="Instructor (optional)" />
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Assignments ({{ draft.assignments.length }})</h4>
          <Button size="sm" variant="secondary" @click="addAssignmentRow">+ Add row</Button>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Assignments without a due date can't be saved — fill one in or remove the row.
        </p>

        <div v-if="draft.assignments.length === 0" class="text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
          No assignments detected. Click "Add row" to enter them manually.
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="(a, idx) in draft.assignments"
            :key="idx"
            class="border border-gray-200 dark:border-gray-700 rounded-xl p-3"
          >
            <div class="grid grid-cols-1 md:grid-cols-[2fr,1fr,auto] gap-3 items-end">
              <Input v-model="a.name" label="Name" placeholder="Problem Set 3" />
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-gray-600 dark:text-gray-400">Due date</label>
                <input
                  type="date"
                  :value="isoToDateInput(a.dueAt)"
                  class="w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 scheme-light dark:scheme-dark"
                  :class="a.dueAt ? 'border-gray-200 dark:border-gray-700' : 'border-danger-300 bg-danger-50/40 dark:bg-danger-900/30'"
                  @input="onDueDateInput(idx, $event)"
                />
              </div>
              <Button size="sm" variant="ghost" @click="removeAssignmentRow(idx)">Remove</Button>
            </div>
          </li>
        </ul>
      </section>

      <div v-if="saveError" class="text-sm text-danger-700 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/30 border border-danger-200 dark:border-danger-800/60 rounded-xl p-3">
        {{ saveError }}
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <Button variant="ghost" :disabled="saving" @click="reviewOpen = false">Cancel</Button>
        <Button :loading="saving" :disabled="!canSave" @click="handleSave">
          Import course
        </Button>
      </div>
    </template>
  </Modal>
</template>
