/**
 * Old Dominion University scraper.
 *
 * ODU's public Course Search (courses.odu.edu) is a thin front-end over a set
 * of key-free PHP JSON services:
 *   GET /services/getParams.php?param=terms            -> terms
 *   GET /services/getParams.php?param=subj             -> subjects (term-agnostic)
 *   GET /services/getCourses.php?subj=CS&termcode=NNN  -> sections for a subject
 *
 * The sections feed is rich: one row per section carrying CRN, course number,
 * title, instructor, DAYS ("MWF") + TIMES ("03:00 PM - 03:50 PM"), building/room,
 * and live enrollment as ENROLL "37 of 45" (current of max). There is no section
 * number in the feed, so the CRN stands in as the unique id. No credit-hours
 * field is published, so credits stays null.
 *
 * Term codes are ODU-style 6-digit (202610 = Fall 2026); the feed also lists
 * part-of-term sessions ("Fall 2026 First Eight Weeks") that normalize to the
 * same Season+Year and dedupe away in the term window (the main term is listed
 * first).
 */
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime } from './util.js'

const BASE = 'https://courses.odu.edu'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*',
  Referer: `${BASE}/`,
}

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`ODU returned HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('ODU returned a non-JSON response')
  }
}

export async function getTerms() {
  return cacheMemo(
    'odu:terms',
    async () => {
      const rows = await getJson(`${BASE}/services/getParams.php?param=terms`)
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.TERM_CODE && r.TERM_DESC)
        .map((r) => ({ code: String(r.TERM_CODE), label: String(r.TERM_DESC).trim() }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  return cacheMemo(
    'odu:subjects',
    async () => {
      const rows = await getJson(`${BASE}/services/getParams.php?param=subj`)
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.SUBJ_CODE)
        .map((r) => ({ code: String(r.SUBJ_CODE), label: String(r.SUBJ_DESC || r.SUBJ_CODE).trim() }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    6 * 60 * 60 * 1000
  )
}

/** ENROLL "37 of 45" -> { max, current, available }; anything else -> nulls. */
function parseEnroll(raw) {
  const m = String(raw || '').match(/(\d+)\s*of\s*(\d+)/i)
  if (!m) return { max: null, current: null, available: null }
  const current = Number(m[1])
  const max = Number(m[2])
  return { max, current, available: Math.max(0, max - current) }
}

/** "MWF" + "03:00 PM - 03:50 PM" -> one meeting, or null when not scheduled. */
function parseMeeting(daysRaw, timesRaw, location) {
  const days = parseDays(daysRaw)
  const tm = String(timesRaw || '').match(
    /(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i
  )
  if (!days.length || !tm) return null
  const startTime = normalizeTime(tm[1])
  const endTime = normalizeTime(tm[2])
  if (!startTime || !endTime) return null
  return { days, startTime, endTime, location: location || '' }
}

function parseInstructors(raw) {
  // "Ranjan, Desh" is one name (Last, First) - split only on hard separators.
  return String(raw || '')
    .split(/\s*[;/]\s*|\s+&\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(tba|to be announced|staff)$/i.test(s))
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`odu:sections:${termCode}:${subjectCode}`, async () => {
    const rows = await getJson(
      `${BASE}/services/getCourses.php?subj=${encodeURIComponent(subjectCode)}&termcode=${encodeURIComponent(termCode)}`
    )
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const enrollment = parseEnroll(r.ENROLL)
      const location = [r.BUILDING_NAME, r.ROOM_NUM].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
      const meeting = parseMeeting(r.DAYS, r.TIMES, location)
      return {
        school: 'odu',
        termCode,
        termLabel: termLabel || String(r.TERM_DESC || ''),
        subjectCode: String(r.SUBJ_CODE || subjectCode),
        subjectLabel: subjectLabel || String(r.SUBJ_DESC || subjectCode),
        courseNumber: String(r.CRSE_NUM || '').trim(),
        // The feed carries no section number; the CRN is the unique id.
        sectionNumber: '',
        crn: String(r.CRN || ''),
        title: String(r.TITLE || '').trim(),
        instructors: parseInstructors(r.INSTRUCTOR),
        credits: null,
        enrollment,
        status:
          enrollment.available === null
            ? 'unknown'
            : enrollment.available > 0
              ? 'open'
              : 'closed',
        meetings: meeting ? [meeting] : [],
      }
    })
  })
}
