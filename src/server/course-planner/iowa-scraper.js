/**
 * University of Iowa scraper.
 *
 * Iowa's MAUI system exposes a public, key-free JSON API:
 *   GET /maui/api/pub/registrar/sessions/current + /sessions/bounded  -> terms
 *   GET /maui/api/pub/lookups/registrar/coursesubjects               -> subjects
 *   GET /maui/api/pub/registrar/sections?json={"sessionId":N,
 *       "courseSubject":"CS"}                                        -> sections
 *
 * (The sections endpoint's query lives in a `json` parameter — plain query
 * params 500. Found via MAUI's own API documentation page.)
 *
 * Sections carry FULL live enrollment (maxEnroll / currentEnroll), an
 * Open/Closed status, instructors, and timeAndLocations rows with day
 * booleans and "1:30P"-style times. Term codes are MAUI session ids (1134 =
 * Fall 2026); labels come from shortDescription ("Fall 2026").
 */
import { cacheMemo } from './cache.js'
import { daysFromBooleans, normalizeTime } from './util.js'

const API = 'https://api.maui.uiowa.edu/maui/api'
const UA = 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)'
const HEADERS = { 'User-Agent': UA, Accept: 'application/json' }

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Iowa MAUI returned HTTP ${res.status}`)
  return res.json()
}

export async function getTerms() {
  return cacheMemo(
    'iowa:terms',
    async () => {
      const current = await getJson(`${API}/pub/registrar/sessions/current`)
      // The bounded list is keyed by internal session id; a window around the
      // current id comfortably covers a few years each way.
      const startId = Math.max(1, Number(current.id) - 15)
      const sessions = await getJson(
        `${API}/pub/registrar/sessions/bounded?startId=${startId}&limit=40`
      )
      return (Array.isArray(sessions) ? sessions : [])
        .filter((s) => s && s.id && s.shortDescription)
        .map((s) => ({ code: String(s.id), label: s.shortDescription }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  return cacheMemo(
    'iowa:subjects',
    async () => {
      const subjects = await getJson(`${API}/pub/lookups/registrar/coursesubjects`)
      return (Array.isArray(subjects) ? subjects : [])
        .filter((s) => s && s.naturalKey)
        .map((s) => ({ code: s.naturalKey, label: s.description || s.naturalKey }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    6 * 60 * 60 * 1000
  )
}

/** "1:30P" / "10:00A" -> "13:30" / "10:00". */
function mauiTime(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AP])M?$/i)
  if (!m) return null
  return normalizeTime(`${m[1]}:${m[2]}${m[3]}M`)
}

function statusOf(raw) {
  const s = String(raw || '').toLowerCase()
  if (s === 'open') return 'open'
  if (s === 'closed' || s === 'full') return 'closed'
  return 'unknown'
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`iowa:sections:${termCode}:${subjectCode}`, async () => {
    const q = encodeURIComponent(
      JSON.stringify({ sessionId: Number(termCode), courseSubject: subjectCode })
    )
    // MAUI answers 404 (not an empty payload) when a session has no published
    // sections for the subject yet (e.g. a far-future term).
    const res = await fetch(`${API}/pub/registrar/sections?json=${q}`, { headers: HEADERS })
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`Iowa MAUI returned HTTP ${res.status}`)
    const data = await res.json()
    const rows = Array.isArray(data?.payload) ? data.payload : []

    return rows.map((r) => {
      // subjectCourse is "CS:1020"; the part after the colon is the course number.
      const courseNumber = String(r.subjectCourse || '')
        .split(':')
        .slice(1)
        .join(':') || String(r.subjectCourse || '')
      const max = r.unlimitedEnroll ? null : numOrNull(r.maxEnroll)
      const current = numOrNull(r.currentEnroll)
      const meetings = []
      for (const t of r.timeAndLocations || []) {
        if (t.arrangedTime) continue
        const days = daysFromBooleans({
          sunday: t.sun,
          monday: t.mon,
          tuesday: t.tue,
          wednesday: t.wed,
          thursday: t.thu,
          friday: t.fri,
          saturday: t.sat,
        })
        const startTime = mauiTime(t.startTime)
        const endTime = mauiTime(t.endTime)
        if (!days.length || !startTime || !endTime) continue
        meetings.push({
          days,
          startTime,
          endTime,
          location: [t.building, t.room].filter(Boolean).join(' '),
        })
      }
      return {
        school: 'iowa',
        termCode,
        termLabel: termLabel || '',
        subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber,
        sectionNumber: String(r.sectionNumber || '').trim(),
        // MAUI has no legacy CRN; the numeric sectionId is the unique id.
        crn: String(r.sectionId || ''),
        title: [r.courseTitle, r.subTitle].filter(Boolean).join(': '),
        instructors: (r.instructors || [])
          .map((i) => (i && (i.name || i.fullName)) || '')
          .map((s) => s.trim())
          .filter((s) => s && !/^(tba|staff)$/i.test(s)),
        credits: numOrNull(r.hours),
        enrollment: {
          max,
          current,
          available:
            max !== null && current !== null ? Math.max(0, max - current) : null,
        },
        status: statusOf(r.status),
        meetings,
      }
    })
  })
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
