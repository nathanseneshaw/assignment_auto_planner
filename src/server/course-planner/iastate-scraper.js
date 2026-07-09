/**
 * Iowa State University scraper.
 *
 * classes.iastate.edu is an Azure SPA over a public Workday-backed JSON API
 * (api.classes.iastate.edu/api). Three endpoints, no auth:
 *   GET  /academic-periods                       -> terms ("ACADEMIC_PERIOD-2026Fall")
 *   GET  /course-subjects?academicPeriod={term}  -> ["ACCT - Accounting", ...]
 *   POST /courses/search                         -> courses, each with sections[]
 *
 * The search POST is picky: it wants the FULL SPA payload (all 15 filter
 * fields, with the SPA's exact defaults — courseNumber "" not null, openSeats
 * false, daysOfTheWeek []), and `courseSubject` must be the verbatim
 * "CODE - Name" string from the subjects endpoint. Sections carry live
 * `openSeats` only (no capacity or current enrollment anywhere in the
 * payload), instructors, credits and "MWF | 8:50 AM - 9:40 AM" meeting
 * patterns. Section ids are Workday-style ("COURSE_SECTION-3-1346107") and
 * stand in for the CRN.
 */
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const API = 'https://api.classes.iastate.edu/api'
const UA = 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)'

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`iastate API returned HTTP ${res.status} for ${url}`)
  const body = await res.json()
  return Array.isArray(body?.data) ? body.data : []
}

export async function getTerms() {
  return cacheMemo(
    'iastate:terms',
    async () => {
      const periods = await fetchJson(`${API}/academic-periods`)
      // Labels look like "2026 Fall Semester (08/24/2026-12/18/2026)" — the
      // parenthesized date range reads as an academic-year span in the term
      // window's year parser, so it's stripped here.
      return periods.map((p) => ({
        code: p.id,
        label: String(p.name || p.id).replace(/\s*\([^)]*\)\s*$/, ''),
      }))
    },
    60 * 60 * 1000
  )
}

/** The search endpoint wants the verbatim "CODE - Name" subject string. */
async function subjectStrings(termCode) {
  return cacheMemo(
    `iastate:subjectStrings:${termCode}`,
    () => fetchJson(`${API}/course-subjects?academicPeriod=${encodeURIComponent(termCode)}`),
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  const raw = await subjectStrings(termCode)
  return raw
    .map((s) => {
      const m = String(s).match(/^(\S+)\s+-\s+(.*)$/)
      return m ? { code: m[1], label: m[2] } : { code: String(s), label: String(s) }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** "MWF | 8:50 AM - 9:40 AM" (possibly several, newline-separated) -> meetings. */
function parseMeetingPatterns(raw, location) {
  const out = []
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z]+)\s*\|\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*$/i)
    if (!m) continue
    const days = parseDays(m[1])
    const startTime = normalizeTime(m[2])
    const endTime = normalizeTime(m[3])
    if (!days.length || !startTime || !endTime) continue
    out.push({ days, startTime, endTime, location: location || '' })
  }
  return out
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`iastate:sections:${termCode}:${subjectCode}`, async () => {
    const strings = await subjectStrings(termCode)
    const subjectString =
      strings.find((s) => String(s).startsWith(`${subjectCode} - `)) || subjectCode
    const res = await fetch(`${API}/courses/search`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academicPeriodId: termCode,
        courseSubject: subjectString,
        courseNumber: '',
        level: null,
        requirement: null,
        instructor: '',
        semesterTag: null,
        credits: null,
        openSeats: false,
        daysOfTheWeek: [],
        sectionStartDate: null,
        sectionEndDate: null,
        title: '',
        deliveryMode: null,
        allowedGradingBases: [],
      }),
    })
    if (!res.ok) throw new Error(`iastate search returned HTTP ${res.status}`)
    const body = await res.json()
    const courses = Array.isArray(body?.data) ? body.data : []

    const sections = []
    for (const course of courses) {
      // course.number is "ACCT 2150"; the UI wants just the number part.
      const courseNumber = String(course.number || '')
        .replace(new RegExp(`^${subjectCode}\\s+`), '')
        .trim()
      for (const s of course.sections || []) {
        const available = Number.isFinite(Number(s.openSeats)) ? Number(s.openSeats) : null
        const location = String(s.locations || '').split(/\r?\n/)[0].trim()
        sections.push({
          school: 'iastate',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber,
          sectionNumber: String(s.number || '').trim(),
          crn: String(s.id || '').replace(/^COURSE_SECTION-/, ''),
          title: String(course.title || ''),
          instructors: String(s.instructors || '')
            .split(/[;\n]/)
            .map((x) => x.trim())
            .filter((x) => x && !/^(tba|staff)$/i.test(x)),
          credits: parseCredits(s.credits ?? s.minCredits),
          // Workday publishes live open seats only — no capacity or enrolled
          // count anywhere in the payload.
          enrollment: { max: null, current: null, available },
          status: available === null ? 'unknown' : available > 0 ? 'open' : 'closed',
          meetings: parseMeetingPatterns(s.meetingPatterns, location),
        })
      }
    }
    return sections
  })
}
