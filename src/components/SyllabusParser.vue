<script setup>
import { ref, computed } from 'vue'
import { Button, Input, Modal, DatePicker } from './ui'
import IntegrationRow from './features/IntegrationRow.vue'
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

function clearFile() {
  file.value = null
  fileError.value = ''
  if (fileInputEl.value) fileInputEl.value.value = ''
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
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T23:59:00`
  draft.value.assignments.push({ name: '', dueAt: new Date(todayIso).toISOString(), description: '' })
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
 * Anchors at 23:59:00 local time  assignments are typically due end-of-day,
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
  <IntegrationRow icon="📄" title="Syllabus import">
    <template #subtitle>
      <span v-if="!authStore.user">Sign in to import a syllabus</span>
      <span v-else-if="fileError || parseError" class="text-danger-600 dark:text-danger-400">{{ fileError || parseError }}</span>
      <span v-else-if="saveResult" class="text-primary-700 dark:text-primary-400">
        Imported {{ saveResult.courseName }} · {{ saveResult.assignmentsInserted }} assignment(s) added
      </span>
      <span v-else-if="parsing">Reading {{ file?.name }}…</span>
      <span v-else-if="file">{{ file.name }} · ready to parse</span>
      <span v-else>PDF or DOCX, up to 5 MB · AI pulls out due dates</span>
    </template>

    <template #action>
      <input
        ref="fileInputEl"
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        class="hidden"
        @change="onFileChange"
      />

      <!-- No file yet → open the picker -->
      <button
        v-if="!file"
        type="button"
        :disabled="!authStore.user"
        class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors border-gray-300 text-gray-700 hover:bg-surface/70 hover:border-gray-400 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="pickFile"
      >
        Import <span aria-hidden="true">→</span>
      </button>

      <!-- File chosen → clear + parse -->
      <template v-else>
        <button
          type="button"
          title="Remove file"
          :disabled="parsing"
          class="w-7 h-7 rounded-full inline-flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/30 disabled:opacity-40 disabled:pointer-events-none"
          @click="clearFile"
        >
          <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
        <button
          type="button"
          :disabled="!canParse"
          class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors border-primary-300 text-primary-700 hover:bg-primary-50 hover:border-primary-400 dark:border-primary-700/70 dark:text-primary-300 dark:hover:bg-primary-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          @click="handleParse"
        >
          <svg v-if="parsing" class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {{ parsing ? 'Parsing…' : 'Parse' }}
          <span v-if="!parsing" aria-hidden="true">→</span>
        </button>
      </template>
    </template>
  </IntegrationRow>

  <!-- Review modal  appears after a successful parse ----------------------- -->
  <Modal
    v-model="reviewOpen"
    title="Review syllabus"
    size="full"
    :closable="!saving"
    @close="handleModalClose"
  >
    <div v-if="draft" class="space-y-8">

      <!-- Truncation notice -->
      <div v-if="parseMeta?.truncated" class="flex items-start gap-2.5 text-xs text-warning-800 dark:text-warning-300 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/40 rounded-xl px-4 py-3">
        <svg class="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 4a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0V5Zm-.75 6a.875.875 0 1 0 0-1.75A.875.875 0 0 0 8 11Z"/>
        </svg>
        <span>Syllabus was too long to send in full. We used the first ~50 000 and last 5 000 characters. A few middle items may be missing; add them below before saving.</span>
      </div>

      <!-- Course section -->
      <section>
        <div class="flex items-center gap-3 mb-4">
          <p class="eyebrow text-[11px] tracking-widest text-gray-400 dark:text-gray-500 uppercase">Course</p>
          <div class="flex-1 h-px bg-paper-line dark:bg-gray-700/60"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
          <Input v-model="draft.course.name" label="Course name" required />
          <Input v-model="draft.course.code" label="Course code (optional)" />
          <Input v-model="draft.course.term" label="Term (optional)" />
          <Input v-model="draft.course.instructor" label="Instructor (optional)" />
        </div>
      </section>

      <!-- Assignments section -->
      <section>
        <div class="flex items-center gap-3 mb-1">
          <p class="eyebrow text-[11px] tracking-widest text-gray-400 dark:text-gray-500 uppercase">Assignments</p>
          <span class="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[11px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
            {{ draft.assignments.length }}
          </span>
          <div class="flex-1 h-px bg-paper-line dark:bg-gray-700/60"></div>
        </div>
        <p class="text-[11px] text-gray-400 dark:text-gray-500 mb-4">
          Rows without a due date won't be saved. Fill one in or remove the row.
        </p>

        <!-- Column headers -->
        <div v-if="draft.assignments.length > 0" class="grid grid-cols-[1fr_148px_32px] gap-x-2 px-1 mb-1">
          <span class="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Name</span>
          <span class="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Due date</span>
          <span></span>
        </div>

        <div v-if="draft.assignments.length === 0" class="text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center">
          No assignments detected. Click "Add row" to enter them manually.
        </div>

        <ul v-else class="space-y-1.5">
          <li
            v-for="(a, idx) in draft.assignments"
            :key="idx"
            class="grid grid-cols-[1fr_148px_32px] gap-x-2 items-center"
          >
            <!-- Name -->
            <input
              v-model="a.name"
              type="text"
              placeholder="Assignment name"
              class="w-full px-3 py-2 rounded-lg border bg-surface dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/25 border-gray-200 dark:border-gray-700 transition-colors"
            />
            <!-- Due date -->
            <DatePicker
              :model-value="isoToDateInput(a.dueAt)"
              placeholder="Pick a due date"
              size="sm"
              @update:model-value="(v) => { a.dueAt = dateInputToIso(v) }"
            />
            <!-- Remove -->
            <button
              type="button"
              title="Remove row"
              class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 dark:text-gray-600 hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/30"
              @click="removeAssignmentRow(idx)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
                <path d="M2 2l10 10M12 2L2 12"/>
              </svg>
            </button>
          </li>
        </ul>

        <!-- Add row -->
        <button
          type="button"
          class="mt-3 flex items-center gap-1.5 text-[13px] text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 rounded"
          @click="addAssignmentRow"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M7 1v12M1 7h12"/>
          </svg>
          Add row
        </button>
      </section>

      <!-- Save error -->
      <div v-if="saveError" class="flex items-start gap-2.5 text-sm text-danger-700 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700/40 rounded-xl px-4 py-3">
        <svg class="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 4a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0V5Zm-.75 6a.875.875 0 1 0 0-1.75A.875.875 0 0 0 8 11Z"/>
        </svg>
        {{ saveError }}
      </div>

    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <Button variant="secondary" :disabled="saving" @click="reviewOpen = false">Cancel</Button>
        <Button variant="primary" :loading="saving" :disabled="!canSave" @click="handleSave">
          Import course
        </Button>
      </div>
    </template>
  </Modal>
</template>
