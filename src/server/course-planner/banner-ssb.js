/**
 * Factory for Ellucian Banner Student Registration Self-Service (SSB) scrapers.
 *
 * Several Texas schools run the exact same Banner 9 SSB JSON API that Texas Tech
 * does (see ttu-scraper.js for the original, annotated walk-through). Rather than
 * copy that file per school, this factory takes the host (and optional mepCode)
 * and returns the three-function scraper contract.
 *
 * The Banner flow is always:
 *   1. GET  /StudentRegistrationSsb/ssb/registration   (sets JSESSIONID)
 *   2. POST /StudentRegistrationSsb/ssb/term/search     (binds the term server-side)
 *   3. GET  /StudentRegistrationSsb/ssb/searchResults/searchResults  (the data)
 *
 * `getTerms` only needs step 1; subjects/sections need the term bound first.
 *
 * ttu-scraper.js is intentionally left as its own file (it pins mepCode=TTU);
 * this factory powers the schools that need no mepCode (Texas State, Baylor).
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import { cacheMemo } from './cache.js'
import { daysFromBooleans, parseCredits } from './util.js'

const UA = 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)'

/** Decode the handful of HTML entities Banner leaves in subject/term labels (e.g. Baylor's "Acad. for Teaching &amp; Learning"). */
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

/**
 * `closeConnections: true` sends "Connection: close" on every request. Needed
 * when the school fronts Banner with a multi-node F5 pool (Georgia Tech): the
 * BIGipServer persistence cookie is only issued on a fresh TCP connection, and
 * without it Node's shared keep-alive pool sprays requests across nodes, so
 * the node-local JSESSIONID term binding is silently lost (search "succeeds"
 * with totalCount 0). Fresh connections make the cookie arrive every time.
 */
export function createBannerScraper({ school, base, mepCode = '', closeConnections = false }) {
  const mepQ = mepCode ? `?mepCode=${mepCode}` : ''
  const mepAmp = mepCode ? `&mepCode=${mepCode}` : ''
  const baseHeaders = closeConnections
    ? { 'User-Agent': UA, Connection: 'close' }
    : { 'User-Agent': UA }

  /** A per-term Banner session: visit registration, then bind the term. */
  async function bannerSessionForTerm(termCode) {
    const jar = new CookieJar()
    const cFetch = makeFetchCookie(fetch, jar)
    await cFetch(`${base}/StudentRegistrationSsb/ssb/registration${mepQ}`, {
      headers: baseHeaders,
    })
    await cFetch(`${base}/StudentRegistrationSsb/ssb/term/search?mode=search`, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        term: termCode,
        studyPath: '',
        studyPathText: '',
        startDatepicker: '',
        endDatepicker: '',
      }).toString(),
    })
    return cFetch
  }

  async function getTerms() {
    return cacheMemo(
      `${school}:terms`,
      async () => {
        const jar = new CookieJar()
        const cFetch = makeFetchCookie(fetch, jar)
        await cFetch(`${base}/StudentRegistrationSsb/ssb/registration${mepQ}`, {
          headers: baseHeaders,
        })
        const res = await cFetch(
          `${base}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=200${mepAmp}`,
          { headers: baseHeaders }
        )
        const data = await res.json()
        return (Array.isArray(data) ? data : []).map((t) => ({
          code: t.code,
          label: decodeEntities(t.description),
        }))
      },
      60 * 60 * 1000
    )
  }

  async function getSubjects(termCode) {
    return cacheMemo(
      `${school}:subjects:${termCode}`,
      async () => {
        const cFetch = await bannerSessionForTerm(termCode)
        const res = await cFetch(
          `${base}/StudentRegistrationSsb/ssb/classSearch/get_subject?searchTerm=&term=${termCode}&offset=1&max=500${mepAmp}`,
          { headers: baseHeaders }
        )
        const data = await res.json()
        return (Array.isArray(data) ? data : []).map((s) => ({
          code: s.code,
          label: decodeEntities(s.description),
        }))
      },
      60 * 60 * 1000
    )
  }

  /** One searchResults page (Banner caps pageMaxSize at 500). */
  async function fetchResultsPage(cFetch, termCode, subjectCode, pageOffset) {
    const params = new URLSearchParams({
      txt_subject: subjectCode,
      txt_term: termCode,
      pageOffset: String(pageOffset),
      pageMaxSize: '500',
      sortColumn: 'subjectDescription',
      sortDirection: 'asc',
    })
    const res = await cFetch(
      `${base}/StudentRegistrationSsb/ssb/searchResults/searchResults?${params}${mepAmp}`,
      { headers: baseHeaders }
    )
    const json = await res.json()
    if (!json || json.success === false) {
      throw new Error(`${school} search returned no data`)
    }
    return json
  }

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(`${school}:sections:${termCode}:${subjectCode}`, async () => {
      let cFetch = await bannerSessionForTerm(termCode)
      let first = await fetchResultsPage(cFetch, termCode, subjectCode, 0)
      // A fresh Banner session occasionally reports zero rows for a subject
      // that has plenty (term binding didn't take, seen on Georgia Tech), and
      // it reports totalCount 0 too - indistinguishable from a real empty
      // subject. Subjects come from the same term so a truly empty one is
      // rare; one retry on a brand-new session is cheap and shakes it loose.
      if (!first.data?.length) {
        cFetch = await bannerSessionForTerm(termCode)
        first = await fetchResultsPage(cFetch, termCode, subjectCode, 0)
      }
      const rows = Array.isArray(first.data) ? [...first.data] : []
      // Big subjects (e.g. Georgia Tech CS at ~1,700 sections) span multiple
      // 500-row pages; keep the same session and walk the offsets.
      const total = Number(first.totalCount) || rows.length
      while (rows.length < total) {
        const page = await fetchResultsPage(cFetch, termCode, subjectCode, rows.length)
        if (!page.data?.length) break // defensive: never loop on a bad page
        rows.push(...page.data)
      }
      return rows.map((r) => normalize(r, school, termCode, termLabel, subjectLabel))
    })
  }

  return { getTerms, getSubjects, getSections }
}

function normalize(r, school, termCode, termLabel, subjectLabel) {
  const max = numOrNull(r.maximumEnrollment)
  const current = numOrNull(r.enrollment)
  const avail = numOrNull(r.seatsAvailable)
  return {
    school,
    termCode,
    termLabel: termLabel || r.termDesc || '',
    subjectCode: r.subject || '',
    subjectLabel: subjectLabel || r.subjectDescription || '',
    courseNumber: String(r.courseNumber || '').trim(),
    sectionNumber: String(r.sequenceNumber || '').trim(),
    crn: String(r.courseReferenceNumber || ''),
    title: decodeEntities(r.courseTitle),
    instructors: (r.faculty || []).map((f) => decodeEntities(f.displayName)).filter(Boolean),
    credits: parseCredits(r.creditHours ?? r.creditHourLow),
    enrollment: { max, current, available: avail },
    status:
      r.openSection === true ? 'open' : r.openSection === false ? 'closed' : 'unknown',
    meetings: (r.meetingsFaculty || [])
      .map((mf) => mf.meetingTime)
      .filter(Boolean)
      .map((mt) => ({
        days: daysFromBooleans(mt),
        startTime: padTime(mt.beginTime),
        endTime: padTime(mt.endTime),
        location: decodeEntities(
          [mt.buildingDescription || mt.building, mt.room].filter(Boolean).join(' ')
        ),
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
