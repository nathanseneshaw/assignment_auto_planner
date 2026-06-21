/**
 * University of Pennsylvania scraper.
 *
 * Penn runs CourseLeaf CLSS ("Search Classes") at courses.upenn.edu, which is
 * backed by the public **fose** JSON API (the same engine behind Brown's
 * Courses@Brown). No login, no cookies, no API key.
 *
 *   POST /api/?page=fose&route=search   body = raw JSON
 *     { "other": { "srcdb": "<term>" }, "criteria": [ {field,value}, ... ] }
 *
 * The search response carries everything we need except seat counts, credits and
 * room — those live behind a per-section `route=details` call. Fetching details
 * for every section (a single subject like CIS has 250+ sections) would mean
 * hundreds of requests per click, so we stay with the single search request and
 * report enrollmentDataAvailable:false. The search still exposes open/closed
 * status, meeting day/time, instructors and titles.
 *
 *   Term codes  : 6-digit YYYY[10|20|30]  (10=Spring, 20=Summer, 30=Fall)
 *   fose meet_day: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
 */
import { cacheMemo } from './cache.js'
import { normalizeTime } from './util.js'

const SCHOOL = 'upenn'
const BASE = 'https://courses.upenn.edu'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// fose meet_day index → our canonical day letters (Monday-indexed).
const DAY_LETTERS = ['M', 'T', 'W', 'R', 'F', 'S', 'U']

/** POST a fose search and return the parsed JSON. */
async function foseSearch(srcdb, criteria) {
  const res = await fetch(`${BASE}/api/?page=fose&route=search`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ other: { srcdb }, criteria }),
  })
  if (!res.ok) throw new Error(`Penn search failed: HTTP ${res.status}`)
  const json = await res.json()
  if (json && json.fatal) throw new Error(`Penn search rejected: ${json.fatal}`)
  return json
}

export async function getTerms() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      const html = await (await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } })).text()
      // The landing page's term <select> holds <option value="202530">Fall 2025</option>.
      const seen = new Set()
      const terms = []
      for (const m of html.matchAll(/value="(\d{6})">([^<]+)</g)) {
        const code = m[1]
        if (seen.has(code)) continue
        seen.add(code)
        terms.push({ code, label: m[2].trim() })
      }
      return terms
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `${SCHOOL}:subjects:${termCode}`,
    async () => {
      // fose has no subject-facet endpoint, so derive the list from a full-term
      // search and dedupe the subject prefix of every section's "code".
      const data = await foseSearch(termCode, [])
      const seen = new Set()
      for (const r of data.results || []) {
        const code = String(r.code || '').trim().split(/\s+/)[0]
        if (code) seen.add(code)
      }
      return [...seen].sort().map((code) => ({ code, label: code }))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const data = await foseSearch(termCode, [{ field: 'subject', value: subjectCode }])
    return (data.results || []).map((r) =>
      normalize(r, { termCode, subjectCode, termLabel, subjectLabel })
    )
  })
}

function normalize(r, { termCode, subjectCode, termLabel, subjectLabel }) {
  // "CIS 1070" → subject "CIS", course "1070".
  const [codeSubj, ...courseRest] = String(r.code || '').trim().split(/\s+/)
  const cancelled = truthy(r.isCancelled)
  return {
    school: SCHOOL,
    termCode,
    termLabel: termLabel || '',
    subjectCode: codeSubj || subjectCode,
    subjectLabel: subjectLabel || codeSubj || subjectCode,
    courseNumber: courseRest.join(' '),
    sectionNumber: String(r.no || '').trim(),
    crn: String(r.crn || ''),
    title: decodeEntities(r.title),
    instructors: parseInstructors(r.instr),
    credits: null, // search omits credit hours; only the details route has them
    enrollment: { max: null, current: null, available: null },
    status: cancelled ? 'closed' : mapStatus(r.stat),
    meetings: parseMeetings(r.meetingTimes),
  }
}

/** fose meetingTimes is a JSON string of per-day entries; group same time into one meeting. */
function parseMeetings(raw) {
  if (!raw) return []
  let entries
  try {
    entries = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  const byTime = new Map()
  for (const e of entries) {
    const day = DAY_LETTERS[Number(e.meet_day)]
    const startTime = normalizeTime(e.start_time)
    const endTime = normalizeTime(e.end_time)
    if (!day || !startTime || !endTime) continue
    const key = `${startTime}-${endTime}`
    if (!byTime.has(key)) byTime.set(key, { days: [], startTime, endTime, location: '' })
    const slot = byTime.get(key)
    if (!slot.days.includes(day)) slot.days.push(day)
  }
  return [...byTime.values()]
}

function parseInstructors(raw) {
  if (!raw) return []
  return String(raw)
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && !/^(staff|tba|to be announced)$/i.test(s))
}

/** fose status: A = open/available, C = closed, F = full (closed). */
function mapStatus(stat) {
  const s = String(stat || '').toUpperCase()
  if (s === 'A') return 'open'
  if (s === 'C' || s === 'F') return 'closed'
  return 'unknown'
}

function truthy(v) {
  return v !== '' && v !== null && v !== undefined && v !== '0' && v !== false
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}
