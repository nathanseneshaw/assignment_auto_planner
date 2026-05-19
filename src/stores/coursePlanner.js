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

  /** Wipe state — called when the user switches their primary school in profile. */
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
  }
})
