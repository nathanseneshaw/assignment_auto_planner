/**
 * Pure schedule-combination engine for the Course Planner's Builder mode.
 *
 * No Vue, Pinia, DOM, or storage imports - the whole module is exercised
 * directly with `node --test` (see __tests__/scheduleCombos.test.mjs).
 *
 * Time semantics are the page's canonical ones: strict-`<` overlap, so
 * back-to-back sections (one ends 10:50, the next starts 10:50) never
 * conflict. Sections with `meetings: []` are async/online/TBA and can never
 * conflict with anything.
 */
import { toMinutes, overlaps } from './scheduleTime.js'
import { sectionUnavailable } from './sectionAvailability.js'

// Re-exported so the engine's callers keep a single import site for the
// availability rule they filter combos with.
export { sectionUnavailable }

/** @typedef {{ day: string, startMin: number, endMin: number }} Interval */

/** Expand `{ days, startTime, endTime }` rows into per-day intervals, skipping unusable times. */
function rowsToIntervals(rows) {
  const out = []
  for (const r of rows || []) {
    if (!r || !r.startTime || !r.endTime) continue
    const startMin = toMinutes(r.startTime)
    const endMin = toMinutes(r.endTime)
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue
    for (const day of r.days || []) {
      out.push({ day, startMin, endMin })
    }
  }
  return out
}

/** meetings x days -> Interval[]; skips meetings with missing/unparseable times. */
export function sectionIntervals(section) {
  return rowsToIntervals(section?.meetings)
}

/** Work shifts -> Interval[] (same skip rule). */
export function shiftIntervals(workShifts) {
  return rowsToIntervals(workShifts)
}

/** True if any interval in a shares a day and overlaps (strict <) any interval in b. */
export function intervalsConflict(a, b) {
  for (const ia of a) {
    for (const ib of b) {
      if (ia.day === ib.day && overlaps(ia.startMin, ia.endMin, ib.startMin, ib.endMin)) {
        return true
      }
    }
  }
  return false
}

// Leading alpha component token of a sectionNumber: 'LEC 001' -> 'LEC',
// 'DIS-201' -> 'DIS'. A plain '001' (or a single letter like 'A01') has none.
const COMPONENT_RE = /^([A-Za-z]{2,4})[\s-]?\d/

/**
 * Group one course's sections into component slots.
 * Lecture+lab linkage is not in the data; the only hint some schools give is a
 * component token at the start of sectionNumber. Only a genuine multi-component
 * course (2+ distinct tokens) splits - a single uniform token ('LEC 001',
 * 'LEC 002') is just how that school labels sections.
 * Returns [{ component: 'LEC' | '', sections: [...] }].
 */
export function splitIntoComponentSlots(sections) {
  const groups = new Map()
  for (const s of sections || []) {
    const m = COMPONENT_RE.exec(String(s.sectionNumber || ''))
    const token = m ? m[1].toUpperCase() : ''
    if (!groups.has(token)) groups.set(token, [])
    groups.get(token).push(s)
  }
  const tokens = [...groups.keys()].filter((t) => t !== '')
  if (tokens.length >= 2) {
    return [...groups.entries()].map(([component, secs]) => ({ component, sections: secs }))
  }
  return [{ component: '', sections: [...(sections || [])] }]
}

/**
 * filters = { earliestStart: ''|'HH:MM', latestEnd: ''|'HH:MM', daysOff: ['F'], openOnly: bool }
 * Sections with no usable meeting times ALWAYS pass time/day filters (async courses).
 * openOnly rejects sections where sectionUnavailable() !== null.
 */
export function passesFilters(section, filters = {}) {
  if (filters.openOnly && sectionUnavailable(section) !== null) return false
  const intervals = sectionIntervals(section)
  if (!intervals.length) return true
  const earliest = filters.earliestStart ? toMinutes(filters.earliestStart) : null
  const latest = filters.latestEnd ? toMinutes(filters.latestEnd) : null
  const daysOff = filters.daysOff || []
  for (const iv of intervals) {
    if (daysOff.includes(iv.day)) return false
    if (earliest != null && iv.startMin < earliest) return false
    if (latest != null && iv.endMin > latest) return false
  }
  return true
}

/**
 * slots: [{ key, label, sections: [Section], pinned?: bool }] - one per course
 *        (or course-component), pins already applied by the caller (a pinned
 *        slot has exactly its pinned section). `pinned: true` exempts the
 *        slot's sections from passesFilters - a pin wins over filters.
 * busyIntervals: Interval[] (work shifts).
 * Returns { combos: [{ sections: [Section], metrics }], truncated: bool,
 *           emptySlots: [{ key, label, reason: 'no-sections' | 'filtered-out' }] }
 */
export function generateCombos({ slots, busyIntervals = [], filters = {}, maxCombos = 200 }) {
  const emptySlots = []
  const filtered = slots.map((slot, order) => {
    const all = slot.sections || []
    const sections = slot.pinned ? [...all] : all.filter((s) => passesFilters(s, filters))
    if (!sections.length) {
      emptySlots.push({
        key: slot.key,
        label: slot.label,
        reason: all.length ? 'filtered-out' : 'no-sections',
      })
    }
    return { key: slot.key, sections, order }
  })
  if (emptySlots.length) return { combos: [], truncated: false, emptySlots }

  // Fewest-options-first maximizes DFS pruning.
  filtered.sort((a, b) => a.sections.length - b.sections.length)

  const combos = []
  let truncated = false
  const pick = []

  function dfs(i, accumulated) {
    if (truncated) return
    if (i === filtered.length) {
      if (combos.length >= maxCombos) {
        truncated = true
        return
      }
      // Emit sections in the caller's original slot order, not DFS order.
      const sections = pick
        .map((section, idx) => ({ section, order: filtered[idx].order }))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.section)
      combos.push({ sections, metrics: comboMetrics(sections, busyIntervals) })
      return
    }
    for (const section of filtered[i].sections) {
      if (truncated) return
      const ivs = sectionIntervals(section)
      if (intervalsConflict(ivs, accumulated)) continue
      pick.push(section)
      dfs(i + 1, accumulated.concat(ivs))
      pick.pop()
    }
  }

  dfs(0, [...busyIntervals])
  return { combos, truncated, emptySlots: [] }
}

/**
 * { daysOnCampus, totalGapMin, earliestStartMin, latestEndMin, creditTotal }
 * daysOnCampus counts distinct days with at least one COURSE interval (not work).
 * totalGapMin: per day, (last course end - first course start) - sum of course
 * minutes, summed across days. earliest/latest are null for an all-async combo.
 * creditTotal sums non-null credits.
 */
export function comboMetrics(sections, busyIntervals = []) {
  const byDay = new Map()
  let creditTotal = 0
  for (const s of sections) {
    if (typeof s.credits === 'number') creditTotal += s.credits
    for (const iv of sectionIntervals(s)) {
      if (!byDay.has(iv.day)) byDay.set(iv.day, [])
      byDay.get(iv.day).push(iv)
    }
  }
  let totalGapMin = 0
  let earliestStartMin = null
  let latestEndMin = null
  for (const ivs of byDay.values()) {
    let first = Infinity
    let last = -Infinity
    let busy = 0
    for (const iv of ivs) {
      first = Math.min(first, iv.startMin)
      last = Math.max(last, iv.endMin)
      busy += iv.endMin - iv.startMin
    }
    totalGapMin += Math.max(0, last - first - busy)
    earliestStartMin = earliestStartMin == null ? first : Math.min(earliestStartMin, first)
    latestEndMin = latestEndMin == null ? last : Math.max(latestEndMin, last)
  }
  return { daysOnCampus: byDay.size, totalGapMin, earliestStartMin, latestEndMin, creditTotal }
}

// null-safe ascending compare; `nullAs` decides where metric-less (all-async)
// combos land relative to scheduled ones.
function cmpAsc(a, b, nullAs = Infinity) {
  const av = a == null ? nullAs : a
  const bv = b == null ? nullAs : b
  if (av === bv) return 0
  return av < bv ? -1 : 1
}

const SORT_COMPARATORS = {
  fewestDays: (a, b) =>
    cmpAsc(a.daysOnCampus, b.daysOnCampus) ||
    cmpAsc(a.totalGapMin, b.totalGapMin) ||
    cmpAsc(a.latestEndMin, b.latestEndMin),
  leastGaps: (a, b) =>
    cmpAsc(a.totalGapMin, b.totalGapMin) ||
    cmpAsc(a.daysOnCampus, b.daysOnCampus) ||
    cmpAsc(a.latestEndMin, b.latestEndMin),
  earliestDone: (a, b) =>
    cmpAsc(a.latestEndMin, b.latestEndMin) ||
    cmpAsc(a.daysOnCampus, b.daysOnCampus) ||
    cmpAsc(a.totalGapMin, b.totalGapMin),
  latestStart: (a, b) =>
    // Descending on start time; all-async combos (null) sort last.
    cmpAsc(b.earliestStartMin, a.earliestStartMin, -Infinity) ||
    cmpAsc(a.daysOnCampus, b.daysOnCampus) ||
    cmpAsc(a.totalGapMin, b.totalGapMin),
}

/** sortKey: 'fewestDays' (default) | 'leastGaps' | 'earliestDone' | 'latestStart'. Stable. */
export function sortCombos(combos, sortKey = 'fewestDays') {
  const cmp = SORT_COMPARATORS[sortKey] || SORT_COMPARATORS.fewestDays
  return [...combos].sort((a, b) => cmp(a.metrics, b.metrics))
}
