/**
 * Rutgers University-New Brunswick scraper.
 *
 * Rutgers publishes its whole Schedule of Classes as one public JSON blob per
 * campus+term: classes.rutgers.edu/soc/api/courses.json?year=&term=&campus=NB
 * (~1 MB compressed, ~4,400 courses). The subject query param is ignored by
 * the server, so - like the TAMU Howdy scraper - we cache the full term
 * payload (30 min) and filter client-side. The subject list is derived from
 * the same payload.
 *
 * There is no public terms endpoint; term codes are fixed digits
 * (0 = Winter, 1 = Spring, 7 = Summer, 9 = Fall), so getTerms synthesizes the
 * plausible terms around today and term-window.js trims to current + next.
 * Our composite code is "{year}:{termDigit}".
 *
 * Sections carry openStatus (boolean) but no seat counts. meetingTimes use
 * military times + one-letter day codes where H = Thursday. The section
 * "index" (Rutgers' registration index number) is the unique id.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime, parseCredits } from './util.js'

const API = 'https://classes.rutgers.edu/soc/api/courses.json'
const CAMPUS = 'NB'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

// Rutgers meetingDay -> canonical day code (H = Thursday).
const DAY_MAP = { M: 'M', T: 'T', W: 'W', H: 'R', F: 'F', S: 'S', U: 'U' }

const TERM_NAMES = { 0: 'Winter', 1: 'Spring', 7: 'Summer', 9: 'Fall' }

/** Full course list for one term, cached 30 min (it's ~1 MB compressed). */
async function loadCourses(termCode) {
  const [year, digit] = String(termCode).split(':')
  if (!year || !(digit in TERM_NAMES)) {
    throw new Error(`Bad Rutgers term code: ${termCode}`)
  }
  return cacheMemo(
    `rutgers:courses:${termCode}`,
    async () => {
      const res = await fetch(`${API}?year=${year}&term=${digit}&campus=${CAMPUS}`, {
        headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
      })
      if (!res.ok) throw new Error(`Rutgers SOC API returned HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Rutgers SOC API returned no course list')
      return data
    },
    30 * 60 * 1000
  )
}

export async function getTerms() {
  // Winter (0) runs in January under the NEXT year's code; Spring/Summer/Fall
  // under their own year. Offer this year's three semesters plus the next
  // year's Winter+Spring; term-window keeps current + next.
  const y = new Date().getFullYear()
  return [
    { code: `${y}:1`, label: `Spring ${y}` },
    { code: `${y}:7`, label: `Summer ${y}` },
    { code: `${y}:9`, label: `Fall ${y}` },
    { code: `${y + 1}:0`, label: `Winter ${y + 1}` },
    { code: `${y + 1}:1`, label: `Spring ${y + 1}` },
  ]
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `rutgers:subjects:${termCode}`,
    async () => {
      const courses = await loadCourses(termCode)
      const byCode = new Map()
      for (const c of courses) {
        if (c.subject && !byCode.has(c.subject)) {
          byCode.set(c.subject, c.subjectDescription || c.subject)
        }
      }
      return [...byCode.entries()]
        .map(([code, label]) => ({ code, label }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    30 * 60 * 1000
  )
}

function parseMeetings(meetingTimes) {
  const out = []
  for (const mt of meetingTimes || []) {
    const day = DAY_MAP[mt.meetingDay]
    const startTime = normalizeTime(mt.startTimeMilitary)
    const endTime = normalizeTime(mt.endTimeMilitary)
    if (!day || !startTime || !endTime) continue // async / by-arrangement rows
    const location = [mt.campusAbbrev, mt.buildingCode, mt.roomNumber].filter(Boolean).join(' ')
    // Merge same-time rows into one multi-day meeting.
    const slot = out.find((m) => m.startTime === startTime && m.endTime === endTime)
    if (slot) {
      if (!slot.days.includes(day)) slot.days.push(day)
    } else {
      out.push({ days: [day], startTime, endTime, location })
    }
  }
  return out
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`rutgers:sections:${termCode}:${subjectCode}`, async () => {
    const courses = await loadCourses(termCode)
    const out = []
    for (const c of courses) {
      if (c.subject !== subjectCode) continue
      for (const s of c.sections || []) {
        out.push({
          school: 'rutgers',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || c.subjectDescription || subjectCode,
          courseNumber: String(c.courseNumber || '').trim(),
          sectionNumber: String(s.number || '').trim(),
          crn: String(s.index || ''),
          title: c.expandedTitle?.trim() || c.title || '',
          instructors: (s.instructors || []).map((i) => i.name).filter(Boolean),
          credits: parseCredits(c.credits),
          enrollment: { max: null, current: null, available: null }, // not published
          status: s.openStatus === true ? 'open' : s.openStatus === false ? 'closed' : 'unknown',
          meetings: parseMeetings(s.meetingTimes),
        })
      }
    }
    return out
  })
}
