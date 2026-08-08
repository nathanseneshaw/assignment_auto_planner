/**
 * Schedule Builder store.
 *
 * Powers the Builder mode of "/course-planner": the student picks candidate
 * COURSES (not sections), we fetch every section for them and generate all
 * non-conflicting combinations around their work shifts.
 *
 * State buckets:
 *   - Persisted (localStorage): `candidatesByBucket`, keyed by
 *     `school:termCode` so switching terms shows that term's picks.
 *   - Ephemeral: generated combos + fetch/loading flags.
 *
 * Depends one-directionally on the coursePlanner store (school, term
 * selection, work shifts); coursePlanner must NOT import this store.
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import * as coursePlannerApi from '../services/coursePlannerApi.js'
import { useCoursePlannerStore } from './coursePlanner.js'
import {
  splitIntoComponentSlots,
  passesFilters,
  generateCombos,
  sortCombos,
  shiftIntervals,
} from '../utils/scheduleCombos.js'

const CANDIDATES_KEY = 'coursePlanner:candidates'
const MAX_CANDIDATES = 8
const MAX_COMBOS = 200

export const useScheduleBuilderStore = defineStore('scheduleBuilder', () => {
  const planner = useCoursePlannerStore()

  // Persisted: { 'rice:202610': [Candidate] } where
  // Candidate = { school, termCode, subjectCode, subjectLabel, courseNumber, title, pinnedCrn }
  const candidatesByBucket = ref(loadCandidates())

  const bucketKey = computed(() =>
    planner.schoolCode && planner.selectedTermCode
      ? `${planner.schoolCode}:${planner.selectedTermCode}`
      : ''
  )

  const candidates = computed(() =>
    bucketKey.value ? candidatesByBucket.value[bucketKey.value] || [] : []
  )

  const canAddMore = computed(() => candidates.value.length < MAX_CANDIDATES)

  // Non-reactive section cache: Map 'school:term:subject' -> Section[].
  // Plain Map outside reactivity on purpose - section arrays are large and only
  // read during generate().
  const sectionCache = new Map()

  const loading = reactive({ sections: false })
  const errors = reactive({ sections: '' })
  const fetchProgress = ref('') // e.g. 'Loading MATH sections (2 of 3)'
  const filters = reactive({ earliestStart: '', latestEnd: '', daysOff: [], openOnly: true })
  const sortKey = ref('fewestDays')
  const combos = ref([])
  const comboIndex = ref(0)
  const truncated = ref(false)
  const emptySlots = ref([])
  const generated = ref(false)
  // Labels of pinned course slots whose pin failed the current filters but was
  // kept anyway (pin wins over filters) - the UI shows a one-line note.
  const pinOverrides = ref([])

  const activeCombo = computed(() => combos.value[comboIndex.value] || null)
  const previewSections = computed(() => activeCombo.value?.sections || [])

  const inFlight = { sections: null }

  function candidateKey(c) {
    return `${c.school}:${c.termCode}:${c.subjectCode}:${c.courseNumber}`
  }

  function isCandidate(section) {
    return candidates.value.some((c) => candidateKey(c) === candidateKey(section))
  }

  function setBucket(key, list) {
    candidatesByBucket.value = { ...candidatesByBucket.value, [key]: list }
    persistCandidates()
    clearResults()
  }

  /** Derive a Candidate from any Section row of the course and add it to its term bucket. */
  function addCandidate(section) {
    if (!section || !section.school || !section.termCode) return
    const cand = {
      school: section.school,
      termCode: section.termCode,
      subjectCode: section.subjectCode,
      subjectLabel: section.subjectLabel || '',
      courseNumber: section.courseNumber,
      title: section.title || '',
      pinnedCrn: null,
    }
    const key = `${cand.school}:${cand.termCode}`
    const list = candidatesByBucket.value[key] || []
    if (list.some((c) => candidateKey(c) === candidateKey(cand))) return
    if (list.length >= MAX_CANDIDATES) return
    setBucket(key, [...list, cand])
  }

  function removeCandidate(key) {
    if (!bucketKey.value) return
    setBucket(bucketKey.value, candidates.value.filter((c) => candidateKey(c) !== key))
  }

  function setPin(key, crnOrNull) {
    if (!bucketKey.value) return
    setBucket(
      bucketKey.value,
      candidates.value.map((c) =>
        candidateKey(c) === key ? { ...c, pinnedCrn: crnOrNull || null } : c
      )
    )
  }

  function clearCandidates() {
    if (!bucketKey.value) return
    setBucket(bucketKey.value, [])
  }

  function clearResults() {
    combos.value = []
    comboIndex.value = 0
    truncated.value = false
    emptySlots.value = []
    generated.value = false
    pinOverrides.value = []
  }

  /** Mutate filters through here (not deep watchers) so results always clear with them. */
  function setFilters(patch) {
    Object.assign(filters, patch)
    clearResults()
  }

  function setSortKey(key) {
    sortKey.value = key
    combos.value = sortCombos(combos.value, key)
    comboIndex.value = 0
  }

  function subjectCacheKey(c) {
    return `${c.school}:${c.termCode}:${c.subjectCode}`
  }

  /**
   * Fetch every distinct subject the current candidates need, SEQUENTIALLY
   * (the server rate-limits and a cold scrape can take a minute; parallel
   * fetches would just queue and time out). Returns true when every subject
   * is cached; false on failure/abort (already-cached entries are kept).
   */
  async function ensureSections() {
    const missing = []
    const seen = new Set()
    for (const c of candidates.value) {
      const key = subjectCacheKey(c)
      if (seen.has(key)) continue
      seen.add(key)
      if (!sectionCache.has(key)) missing.push(c)
    }
    if (!missing.length) return true

    inFlight.sections?.abort()
    const ac = new AbortController()
    inFlight.sections = ac
    loading.sections = true
    errors.sections = ''
    try {
      for (let i = 0; i < missing.length; i++) {
        const c = missing[i]
        fetchProgress.value = `Loading ${c.subjectCode} sections (${i + 1} of ${missing.length})`
        const rows = await coursePlannerApi.getSections(
          c.school,
          {
            termCode: c.termCode,
            subjectCode: c.subjectCode,
            termLabel: planner.selectedTermLabel,
            subjectLabel: c.subjectLabel,
          },
          { signal: ac.signal }
        )
        sectionCache.set(subjectCacheKey(c), rows)
      }
      return true
    } catch (e) {
      if (e?.name === 'AbortError') return false // superseded by a newer run; it owns the state now
      errors.sections = e?.message || 'Failed to load sections.'
      return false
    } finally {
      // Only the run that's still current clears the flags - an aborted one
      // must not flip them off under the run that replaced it.
      if (inFlight.sections === ac) {
        loading.sections = false
        fetchProgress.value = ''
        inFlight.sections = null
      }
    }
  }

  /** Fetch (cache-aware), build slots, and generate sorted conflict-free combos. */
  async function generate() {
    if (!candidates.value.length) return
    clearResults()
    const ok = await ensureSections()
    if (!ok) return

    const slots = []
    const overriddenPins = []
    const filterSnapshot = {
      earliestStart: filters.earliestStart,
      latestEnd: filters.latestEnd,
      daysOff: [...filters.daysOff],
      openOnly: filters.openOnly,
    }

    for (const c of candidates.value) {
      const rows = (sectionCache.get(subjectCacheKey(c)) || []).filter(
        (s) => s.courseNumber === c.courseNumber
      )
      for (const compSlot of splitIntoComponentSlots(rows)) {
        const label = `${c.subjectCode} ${c.courseNumber}${compSlot.component ? ' ' + compSlot.component : ''}`
        const base = {
          key: `${candidateKey(c)}:${compSlot.component}`,
          label,
          sections: compSlot.sections,
        }
        // A pin narrows only the component slot that contains its CRN; the
        // pinned section is kept even when filters would drop it (pin wins).
        const pinned = c.pinnedCrn
          ? compSlot.sections.filter((s) => s.crn === c.pinnedCrn)
          : []
        if (pinned.length) {
          base.sections = pinned
          base.pinned = true
          if (!pinned.every((s) => passesFilters(s, filterSnapshot))) {
            overriddenPins.push(label)
          }
        }
        slots.push(base)
      }
    }

    const result = generateCombos({
      slots,
      busyIntervals: shiftIntervals(planner.workShifts),
      filters: filterSnapshot,
      maxCombos: MAX_COMBOS,
    })
    combos.value = sortCombos(result.combos, sortKey.value)
    truncated.value = result.truncated
    emptySlots.value = result.emptySlots
    pinOverrides.value = overriddenPins
    comboIndex.value = 0
    generated.value = true
  }

  /** Full wipe when the user switches school on the Profile page. */
  function resetForSchoolChange() {
    inFlight.sections?.abort()
    inFlight.sections = null
    loading.sections = false
    fetchProgress.value = ''
    errors.sections = ''
    sectionCache.clear()
    candidatesByBucket.value = {}
    persistCandidates()
    clearResults()
  }

  // --- Persistence ---

  function persistCandidates() {
    try {
      localStorage.setItem(CANDIDATES_KEY, JSON.stringify(candidatesByBucket.value))
    } catch (e) {
      console.warn('[scheduleBuilder] persist failed:', e)
    }
  }

  function loadCandidates() {
    try {
      const raw = localStorage.getItem(CANDIDATES_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (e) {
      console.warn('[scheduleBuilder] load failed:', e)
      return {}
    }
  }

  return {
    candidates,
    canAddMore,
    candidateKey,
    isCandidate,
    loading,
    errors,
    fetchProgress,
    filters,
    setFilters,
    sortKey,
    setSortKey,
    combos,
    comboIndex,
    truncated,
    emptySlots,
    generated,
    pinOverrides,
    activeCombo,
    previewSections,
    addCandidate,
    removeCandidate,
    setPin,
    clearCandidates,
    ensureSections,
    generate,
    clearResults,
    resetForSchoolChange,
  }
})
