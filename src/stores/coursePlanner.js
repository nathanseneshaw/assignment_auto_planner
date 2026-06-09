/**
 * Course Planner store.
 *
 * Powers the "/course-planner" page. State falls into two buckets:
 *
 *   - Ephemeral (in-memory only): terms / subjects / current section search
 *     results + loading + error flags. These are re-fetched whenever the user
 *     switches school, term, or subject.
 *
 *   - Persisted (localStorage): `savedSectionsBySchool`. Adding a section to
 *     the weekly grid drops it into the bucket for the section's school. We
 *     key by school so switching schools doesn't lose work.
 *
 * The user's active school comes from the profile store; this store doesn't
 * own that piece of state.
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import * as coursePlannerApi from '../services/coursePlannerApi.js'
import { useProfileStore } from './profile.js'

const STORAGE_KEY = 'coursePlanner:saved'
const WORK_STORAGE_KEY = 'coursePlanner:work'

export const useCoursePlannerStore = defineStore('coursePlanner', () => {
  const profileStore = useProfileStore()
  const schoolCode = computed(() => profileStore.profile.school || '')

  // Ephemeral
  const terms = ref([])
  const subjects = ref([])
  const sections = ref([])
  const selectedTermCode = ref('')
  const selectedTermLabel = ref('')
  const selectedSubjectCode = ref('')
  const selectedSubjectLabel = ref('')

  const loading = reactive({ terms: false, subjects: false, sections: false })
  const errors = reactive({ terms: '', subjects: '', sections: '' })

  // Persisted: { rice: [Section, ...], ttu: [...], tamu: [...], smu: [...] }
  const savedSectionsBySchool = ref(loadSaved())

  const savedSections = computed(() => {
    if (!schoolCode.value) return []
    return savedSectionsBySchool.value[schoolCode.value] || []
  })

  // Persisted: weekly work shifts. Global (not per-school) — a job doesn't
  // change when you switch which catalog you're browsing.
  // Shape: [{ id, days: ['M','W'], startTime: '09:00', endTime: '17:00' }]
  const workShifts = ref(loadWork())

  // --- Loaders ---

  async function loadTerms() {
    if (!schoolCode.value) return
    loading.terms = true
    errors.terms = ''
    terms.value = []
    try {
      terms.value = await coursePlannerApi.getTerms(schoolCode.value)
    } catch (e) {
      errors.terms = e?.message || 'Failed to load terms.'
    } finally {
      loading.terms = false
    }
  }

  async function loadSubjects() {
    if (!schoolCode.value || !selectedTermCode.value) return
    loading.subjects = true
    errors.subjects = ''
    subjects.value = []
    try {
      subjects.value = await coursePlannerApi.getSubjects(
        schoolCode.value,
        selectedTermCode.value
      )
    } catch (e) {
      errors.subjects = e?.message || 'Failed to load subjects.'
    } finally {
      loading.subjects = false
    }
  }

  async function loadSections() {
    if (!schoolCode.value || !selectedTermCode.value || !selectedSubjectCode.value) return
    loading.sections = true
    errors.sections = ''
    sections.value = []
    try {
      sections.value = await coursePlannerApi.getSections(schoolCode.value, {
        termCode: selectedTermCode.value,
        subjectCode: selectedSubjectCode.value,
        termLabel: selectedTermLabel.value,
        subjectLabel: selectedSubjectLabel.value,
      })
    } catch (e) {
      errors.sections = e?.message || 'Failed to load sections.'
    } finally {
      loading.sections = false
    }
  }

  // --- Selection setters that cascade ---

  function setTerm(code, label = '') {
    selectedTermCode.value = code
    selectedTermLabel.value = label
    selectedSubjectCode.value = ''
    selectedSubjectLabel.value = ''
    subjects.value = []
    sections.value = []
    if (code) loadSubjects()
  }

  function setSubject(code, label = '') {
    selectedSubjectCode.value = code
    selectedSubjectLabel.value = label
    sections.value = []
    if (code) loadSections()
  }

  /**
   * Reset the planner to a clean slate for a newly-picked school. Called from the
   * profile page the moment the user changes their school. Clears the live search
   * state (terms / subjects / sections / current selection) AND the saved weekly
   * plan, so no courses from the previous school linger on the planner grid.
   *
   * Work shifts are intentionally left untouched — a job schedule isn't tied to
   * which course catalog you're browsing.
   */
  function resetForSchoolChange() {
    terms.value = []
    subjects.value = []
    sections.value = []
    selectedTermCode.value = ''
    selectedTermLabel.value = ''
    selectedSubjectCode.value = ''
    selectedSubjectLabel.value = ''
    errors.terms = ''
    errors.subjects = ''
    errors.sections = ''
    // Drop every saved section so the weekly grid starts empty for the new school.
    savedSectionsBySchool.value = {}
    persistSaved()
  }

  // --- Saved sections ---

  function sectionKey(s) {
    return `${s.school}:${s.termCode}:${s.crn}`
  }

  function isSaved(section) {
    return savedSections.value.some((s) => sectionKey(s) === sectionKey(section))
  }

  function addSection(section) {
    if (!section || !section.school) return
    // Reject sections that are explicitly closed or enrollment-full.
    if (section.status === 'closed') return
    const enr = section.enrollment || {}
    const atCapacity =
      (enr.available != null && enr.available <= 0) ||
      (enr.max != null && enr.current != null && enr.current >= enr.max)
    if (atCapacity) return
    const list = savedSectionsBySchool.value[section.school] || []
    if (list.some((s) => sectionKey(s) === sectionKey(section))) return
    savedSectionsBySchool.value = {
      ...savedSectionsBySchool.value,
      [section.school]: [...list, section],
    }
    persistSaved()
  }

  function removeSection(section) {
    const list = savedSectionsBySchool.value[section.school] || []
    savedSectionsBySchool.value = {
      ...savedSectionsBySchool.value,
      [section.school]: list.filter((s) => sectionKey(s) !== sectionKey(section)),
    }
    persistSaved()
  }

  function persistSaved() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSectionsBySchool.value))
    } catch (e) {
      console.warn('[coursePlanner] persist failed:', e)
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (e) {
      console.warn('[coursePlanner] load failed:', e)
      return {}
    }
  }

  // --- Work shifts ---

  /** Replace the whole weekly work schedule (the modal edits a draft, then commits it here). */
  function setWorkShifts(shifts) {
    workShifts.value = Array.isArray(shifts) ? shifts : []
    persistWork()
  }

  function persistWork() {
    try {
      localStorage.setItem(WORK_STORAGE_KEY, JSON.stringify(workShifts.value))
    } catch (e) {
      console.warn('[coursePlanner] persist work failed:', e)
    }
  }

  function loadWork() {
    try {
      const raw = localStorage.getItem(WORK_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      console.warn('[coursePlanner] load work failed:', e)
      return []
    }
  }

  return {
    schoolCode,
    terms,
    subjects,
    sections,
    selectedTermCode,
    selectedTermLabel,
    selectedSubjectCode,
    selectedSubjectLabel,
    loading,
    errors,
    savedSections,
    loadTerms,
    loadSubjects,
    loadSections,
    setTerm,
    setSubject,
    resetForSchoolChange,
    isSaved,
    addSection,
    removeSection,
    workShifts,
    setWorkShifts,
  }
})
