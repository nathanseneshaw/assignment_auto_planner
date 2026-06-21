/**
 * Yale University scraper.
 *
 * Yale Course Search (courses.yale.edu) is backed by the public "FOSE" JSON API
 * (the same vendor system Brown/Columbia use). A single POST to
 * /api/?page=fose&route=search with {other:{srcdb}, criteria:[{field:'subject'…}]}
 * returns every section for a subject — code, CRN, section, instructor, current
 * enrollment, status flag and a JSON-encoded meetingTimes array.
 *
 * The term list (srcdb codes) and the subject list both live in <option> tags on
 * the search home page, so getTerms/getSubjects parse that once and cache it.
 *
 * FOSE search exposes current enrollment (`total`) and an open/closed flag but no
 * section capacity, so we can't show seats-available: enrollmentDataAvailable is
 * false even though `status` is real. Locations aren't in the search payload, so
 * meeting.location stays empty.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime } from './util.js'

const BASE = 'https://courses.yale.edu'
const SEARCH_API = `${BASE}/api/?page=fose&route=search`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// FOSE meetingTimes meet_day index → canonical day code.
const MEET_DAY = ['M', 'T', 'W', 'R', 'F', 'S', 'U']

/** Load + cache the search home page (carries both term and subject <option>s). */
async function loadHomePage() {
  return cacheMemo(
    'yale:home',
    async () => {
      const res = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`Yale Course Search returned HTTP ${res.status}`)
      return res.text()
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const html = await loadHomePage()
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<option[^>]*value=["'](\d{6})["'][^>]*>([^<]+)</g)) {
    const [, code, rawLabel] = m
    const label = rawLabel.trim()
    if (seen.has(code) || !/(Fall|Spring|Summer|Winter)/i.test(label)) continue
    seen.add(code)
    out.push({ code, label })
  }
  return out
}

export async function getSubjects() {
  const html = await loadHomePage()
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<option[^>]*value=["']([A-Z]{2,5})["'][^>]*>([^<]+)</g)) {
    const [, code, rawLabel] = m
    if (seen.has(code)) continue
    seen.add(code)
    // Labels arrive as "Computer Science (CPSC)" — drop the trailing code.
    const label = rawLabel.trim().replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim()
    out.push({ code, label: label || code })
  }
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

/** Parse the JSON-encoded meetingTimes string into grouped { days, start, end } meetings. */
function parseMeetings(meetingTimesJson) {
  let raw
  try {
    raw = JSON.parse(meetingTimesJson || '[]')
  } catch {
    return []
  }
  // Group occurrences that share a start/end time into one multi-day meeting.
  const byTime = new Map()
  for (const t of raw) {
    const startTime = normalizeTime(t.start_time)
    const endTime = normalizeTime(t.end_time)
    const day = MEET_DAY[Number(t.meet_day)]
    if (!startTime || !endTime || !day) continue
    const key = `${startTime}-${endTime}`
    if (!byTime.has(key)) byTime.set(key, { days: [], startTime, endTime, location: '' })
    const slot = byTime.get(key)
    if (!slot.days.includes(day)) slot.days.push(day)
  }
  return [...byTime.values()]
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`yale:sections:${termCode}:${subjectCode}`, async () => {
    const res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        other: { srcdb: termCode },
        criteria: [{ field: 'subject', value: subjectCode }],
      }),
    })
    if (!res.ok) throw new Error(`Yale search returned HTTP ${res.status}`)
    const data = await res.json()
    const results = Array.isArray(data.results) ? data.results : []

    return results.map((r) => {
      const parts = String(r.code || '').split(/\s+/)
      const courseNumber = parts.slice(1).join(' ') || r.code
      const current = Number(r.total)
      const cancelled = r.isCancelled && r.isCancelled !== ''
      return {
        school: 'yale',
        termCode,
        termLabel: termLabel || '',
        subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber,
        sectionNumber: r.no || '',
        crn: r.crn || '',
        title: r.title || '',
        instructors: String(r.instr || '')
          .split('/')
          .map((s) => s.trim())
          .filter((s) => s && s !== 'Staff'),
        credits: null, // not in the FOSE search payload
        enrollment: {
          max: null, // FOSE search exposes no section capacity
          current: Number.isFinite(current) ? current : null,
          available: null,
        },
        status: cancelled ? 'closed' : r.stat === 'A' ? 'open' : 'closed',
        meetings: parseMeetings(r.meetingTimes),
      }
    })
  })
}
