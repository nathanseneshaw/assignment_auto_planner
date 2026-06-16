/**
 * Texas Tech scraper (Ellucian Banner SSB JSON endpoints).
 *
 * The Banner Student Registration Self-Service API requires a session cookie +
 * a "term has been selected" server-side flag before /searchResults will
 * return data. The three steps:
 *
 *   1. GET  /StudentRegistrationSsb/ssb/registration  (sets JSESSIONID)
 *   2. POST /StudentRegistrationSsb/ssb/term/search   (sets selected term)
 *   3. GET  /StudentRegistrationSsb/ssb/searchResults/searchResults (the data)
 *
 * Cookies are forwarded manually between steps using the Set-Cookie response
 * header so no external cookie-jar library is required.
 */
import { cacheMemo } from './cache.js'
import { daysFromBooleans, parseCredits } from './util.js'

/**
 * Parse all Set-Cookie headers from a Response into a single Cookie string
 * suitable for re-use in subsequent requests.
 * @param {Response} res
 * @returns {string}
 */
function extractCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  // Each entry looks like "name=value; Path=/; HttpOnly"  keep only name=value.
  return raw.map((c) => c.split(';')[0].trim()).join('; ')
}

/**
 * Merge two cookie strings, preferring values from `next` on key collision.
 * @param {string} existing
 * @param {string} next
 * @returns {string}
 */
function mergeCookies(existing, next) {
  const map = new Map()
  for (const part of [existing, next]) {
    if (!part) continue
    for (const pair of part.split(';')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const key = pair.slice(0, eq).trim()
      const val = pair.slice(eq + 1).trim()
      if (key) map.set(key, val)
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

const SCHOOL = 'ttu'
const BASE = 'https://registration.texastech.edu'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'
const MEP = 'TTU'

/**
 * A per-term Banner session: visit registration, then bind the term.
 * Returns a fetch wrapper that automatically forwards the accumulated session
 * cookies on every call (read-only after setup  cookies are not updated
 * from subsequent responses, which is sufficient for Banner's read-only APIs).
 */
async function bannerSessionForTerm(termCode) {
  // Step 1: seed JSESSIONID
  const regRes = await fetch(
    `${BASE}/StudentRegistrationSsb/ssb/registration?mepCode=${MEP}`,
    { headers: { 'User-Agent': UA } }
  )
  let cookies = extractCookies(regRes)

  // Step 2: bind the term (server records the selection against JSESSIONID)
  const termRes = await fetch(
    `${BASE}/StudentRegistrationSsb/ssb/term/search?mode=search`,
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
      },
      body: new URLSearchParams({
        term: termCode,
        studyPath: '',
        studyPathText: '',
        startDatepicker: '',
        endDatepicker: '',
      }).toString(),
    }
  )
  cookies = mergeCookies(cookies, extractCookies(termRes))

  // Return a thin wrapper that forwards the accumulated cookies
  return (url, opts = {}) =>
    fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, Cookie: cookies, ...(opts.headers || {}) },
    })
}

/** Terms requires the JSESSIONID from the /registration GET  otherwise 500. */
export async function getTerms() {
  return cacheMemo(
    'ttu:terms',
    async () => {
      // Step 1: seed JSESSIONID
      const regRes = await fetch(
        `${BASE}/StudentRegistrationSsb/ssb/registration?mepCode=${MEP}`,
        { headers: { 'User-Agent': UA } }
      )
      const cookies = extractCookies(regRes)

      const res = await fetch(
        `${BASE}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=200`,
        { headers: { 'User-Agent': UA, Cookie: cookies } }
      )
      const data = await res.json()
      return data.map((t) => ({ code: t.code, label: t.description }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `ttu:subjects:${termCode}`,
    async () => {
      const cFetch = await bannerSessionForTerm(termCode)
      const res = await cFetch(
        `${BASE}/StudentRegistrationSsb/ssb/classSearch/get_subject?searchTerm=&term=${termCode}&offset=1&max=500`,
        { headers: { 'User-Agent': UA } }
      )
      const data = await res.json()
      return data.map((s) => ({ code: s.code, label: s.description }))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`ttu:sections:${termCode}:${subjectCode}`, async () => {
    const cFetch = await bannerSessionForTerm(termCode)
    // Banner caps pageMaxSize at ~500; large subjects (e.g., MATH) may need pagination.
    // For v1 we ask for 500 and trust that's enough for any one subject.
    const params = new URLSearchParams({
      txt_subject: subjectCode,
      txt_term: termCode,
      pageOffset: '0',
      pageMaxSize: '500',
      sortColumn: 'subjectDescription',
      sortDirection: 'asc',
    })
    const res = await cFetch(
      `${BASE}/StudentRegistrationSsb/ssb/searchResults/searchResults?${params}`,
      { headers: { 'User-Agent': UA } }
    )
    const json = await res.json()
    if (!json || json.success === false) {
      throw new Error('Texas Tech search returned no data')
    }
    const rows = Array.isArray(json.data) ? json.data : []
    return rows.map((r) => normalize(r, termCode, termLabel, subjectLabel))
  })
}

function normalize(r, termCode, termLabel, subjectLabel) {
  const max = numOrNull(r.maximumEnrollment)
  const current = numOrNull(r.enrollment)
  const avail = numOrNull(r.seatsAvailable)
  return {
    school: SCHOOL,
    termCode,
    termLabel: termLabel || r.termDesc || '',
    subjectCode: r.subject || '',
    subjectLabel: subjectLabel || r.subjectDescription || '',
    courseNumber: String(r.courseNumber || '').trim(),
    sectionNumber: String(r.sequenceNumber || '').trim(),
    crn: String(r.courseReferenceNumber || ''),
    title: r.courseTitle || '',
    instructors: (r.faculty || [])
      .map((f) => f.displayName)
      .filter(Boolean),
    credits: parseCredits(r.creditHours ?? r.creditHourLow),
    enrollment: { max, current, available: avail },
    status: r.openSection === true ? 'open' : r.openSection === false ? 'closed' : 'unknown',
    meetings: (r.meetingsFaculty || [])
      .map((mf) => mf.meetingTime)
      .filter(Boolean)
      .map((mt) => ({
        days: daysFromBooleans(mt),
        startTime: padTime(mt.beginTime),
        endTime: padTime(mt.endTime),
        location: [mt.buildingDescription || mt.building, mt.room].filter(Boolean).join(' '),
      })),
  }
}

function numOrNull(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function padTime(raw) {
  if (!raw) return null
  const s = String(raw).padStart(4, '0')
  return `${s.slice(0, 2)}:${s.slice(2)}`
}
