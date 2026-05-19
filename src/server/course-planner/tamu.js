/**
 * Texas A&M scraper (Howdy public class search).
 *
 * Endpoints (no auth required):
 *   - GET  /api/all-terms                  list of all Banner STVTERM rows
 *   - POST /api/course-sections            full term's sections (subject param is ignored
 *                                          server-side — we filter client-side after caching)
 *
 * Important caveat for the unified shape: TAMU returns "NA" for max / current /
 * available enrollment in the public search. Only an open/closed flag
 * (STUSEAT_OPEN) is reliable. Our enrollment fields stay null and `status`
 * reflects that flag.
 *
 * Memory: one term's payload is ~30 MB raw and ~5 MB after normalising. We
 * cache the normalised list for 5 min to amortise the first-fetch latency.
 */
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const SCHOOL = 'tamu'
const BASE = 'https://howdyportal.tamu.edu'
const UA = 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)'

export async function getTerms() {
  return cacheMemo(
    'tamu:terms',
    async () => {
      const res = await fetch(`${BASE}/api/all-terms`, { headers: { 'User-Agent': UA } })
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      // Sort newest-first (term codes are lexicographically sortable).
      list.sort((a, b) => String(b.STVTERM_CODE).localeCompare(String(a.STVTERM_CODE)))
      return list.map((t) => ({
        code: String(t.STVTERM_CODE),
        label: String(t.STVTERM_DESC || t.STVTERM_CODE),
      }))
    },
    60 * 60 * 1000
  )
}

/** Fetches + normalises ONE term's sections; cached so subject queries reuse it. */
async function loadTerm(termCode) {
  return cacheMemo(
    `tamu:term-sections:${termCode}`,
    async () => {
      const res = await fetch(`${BASE}/api/course-sections`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ termCode, subject: '', publicSearch: 'Y' }),
      })
      if (!res.ok) throw new Error(`TAMU sections fetch failed: HTTP ${res.status}`)
      const rows = await res.json()
      return rows.map((r) => normalize(r, termCode))
    },
    5 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  const sections = await loadTerm(termCode)
  const seen = new Map()
  for (const s of sections) {
    if (s.subjectCode && !seen.has(s.subjectCode)) {
      seen.set(s.subjectCode, { code: s.subjectCode, label: s.subjectLabel || s.subjectCode })
    }
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export async function getSections({ termCode, subjectCode }) {
  const sections = await loadTerm(termCode)
  if (!subjectCode) return sections
  const want = String(subjectCode).toUpperCase()
  return sections.filter((s) => s.subjectCode === want)
}

function normalize(r, termCode) {
  const meetings = parseMeetingsClob(r.SWV_CLASS_SEARCH_JSON_CLOB)
  const instructors = parseInstructorsJson(r.SWV_CLASS_SEARCH_INSTRCTR_JSON)
  // TAMU's "subjectDescription" comes back as "ACCT - Accounting"; strip the code prefix.
  const subjectLabel = String(r.SWV_CLASS_SEARCH_SUBJECT_DESC || '')
    .replace(/^[A-Z]+\s*-\s*/, '')
    .trim()
  return {
    school: SCHOOL,
    termCode,
    termLabel: '',
    subjectCode: String(r.SWV_CLASS_SEARCH_SUBJECT || '').toUpperCase(),
    subjectLabel,
    courseNumber: String(r.SWV_CLASS_SEARCH_COURSE || '').trim(),
    sectionNumber: String(r.SWV_CLASS_SEARCH_SECTION || '').trim(),
    crn: String(r.SWV_CLASS_SEARCH_CRN || ''),
    title: r.SWV_CLASS_SEARCH_TITLE || '',
    instructors,
    credits: parseCredits(r.SWV_CLASS_SEARCH_SSBSECT_HOURS ?? r.SWV_CLASS_SEARCH_HOURS_LOW),
    enrollment: { max: null, current: null, available: null },
    status: r.STUSEAT_OPEN === 'Y' ? 'open' : r.STUSEAT_OPEN === 'N' ? 'closed' : 'unknown',
    meetings,
  }
}

function parseMeetingsClob(raw) {
  if (!raw) return []
  let arr
  try {
    arr = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr.map((m) => {
    const days = []
    if (m.SSRMEET_MON_DAY) days.push('M')
    if (m.SSRMEET_TUE_DAY) days.push('T')
    if (m.SSRMEET_WED_DAY) days.push('W')
    if (m.SSRMEET_THU_DAY) days.push('R')
    if (m.SSRMEET_FRI_DAY) days.push('F')
    if (m.SSRMEET_SAT_DAY) days.push('S')
    if (m.SSRMEET_SUN_DAY) days.push('U')
    return {
      days,
      startTime: normalizeTime(m.SSRMEET_BEGIN_TIME),
      endTime: normalizeTime(m.SSRMEET_END_TIME),
      location: [m.SSRMEET_BLDG_CODE, m.SSRMEET_ROOM_CODE].filter(Boolean).join(' '),
    }
  })
}

function parseInstructorsJson(raw) {
  if (!raw) return []
  let arr
  try {
    arr = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  // Names look like "Michelle C. Diaz (P)" — strip the trailing "(P)"/"(S)" role tag.
  return arr.map((a) => String(a.NAME || '').replace(/\s*\([A-Z]\)\s*$/, '').trim()).filter(Boolean)
}
