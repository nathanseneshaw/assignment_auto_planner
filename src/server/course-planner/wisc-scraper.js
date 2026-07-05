/**
 * University of Wisconsin-Madison scraper.
 *
 * public.enroll.wisc.edu is a public JSON API (no key, no cookies) but its
 * CloudFront edge rejects requests without browser-ish Referer/Origin
 * headers, so every call sends them.
 *
 *   - GET  /api/search/v1/terms                    -> term list (1272 = Fall 2026)
 *   - GET  /api/search/v1/subjectsMap/{term}       -> { subjectCode: "COMP SCI" }
 *   - POST /api/search/v1  (ES-style body)         -> paged course hits per subject
 *   - GET  /api/search/v1/enrollmentPackages/{term}/{subject}/{courseId}
 *
 * Search hits are COURSES; the actual enrollable sections come from the
 * per-course enrollmentPackages call (one package = one enrollable LEC/DIS
 * combo), fetched with bounded concurrency - same N+1 pattern as UPenn's
 * details walk. Packages carry full seat data (capacity / currentlyEnrolled /
 * openSeats, with aggregate* variants when seats are split across reserve
 * pools) and an OPEN/WAITLISTED/CLOSED status. Meeting times arrive as
 * milliseconds-from-midnight plus a MONDAY/TUESDAY day-name list.
 */
import { cacheMemo } from './cache.js'
import { parseCredits } from './util.js'

const BASE = 'https://public.enroll.wisc.edu/api/search/v1'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** CloudFront blocks bare scripted clients; these headers get through. */
const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  Origin: 'https://public.enroll.wisc.edu',
  Referer: 'https://public.enroll.wisc.edu/search/',
}

const PAGE_SIZE = 100
const PACKAGE_CONCURRENCY = 8

const DAY_CODE = {
  MONDAY: 'M',
  TUESDAY: 'T',
  WEDNESDAY: 'W',
  THURSDAY: 'R',
  FRIDAY: 'F',
  SATURDAY: 'S',
  SUNDAY: 'U',
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`UW-Madison API returned HTTP ${res.status}`)
  return res.json()
}

export async function getTerms() {
  return cacheMemo(
    'wisc:terms',
    async () => {
      const data = await apiGet('/terms')
      return (Array.isArray(data) ? data : []).map((t) => ({
        code: t.termCode,
        label: t.longDescription || t.shortDescription || t.termCode,
      }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `wisc:subjects:${termCode}`,
    async () => {
      const map = await apiGet(`/subjectsMap/${encodeURIComponent(termCode)}`)
      return Object.entries(map || {})
        .map(([code, label]) => ({ code, label: String(label) }))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
    60 * 60 * 1000
  )
}

/** All course hits for a subject, paging until `found` is exhausted. */
async function searchCourses(termCode, subjectCode) {
  const hits = []
  let page = 1
  for (;;) {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTerm: termCode,
        queryString: '*',
        filters: [{ term: { 'subject.subjectCode': subjectCode } }],
        page,
        pageSize: PAGE_SIZE,
        sortOrder: 'SCORE',
      }),
    })
    if (!res.ok) throw new Error(`UW-Madison search returned HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data.hits) ? data.hits : []
    hits.push(...batch)
    const found = Number(data.found) || 0
    if (!batch.length || hits.length >= found) break
    page += 1
  }
  return hits
}

/** Milliseconds-from-midnight -> "HH:MM", or null. */
function msToHHMM(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  const mins = Math.round(n / 60000)
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function packageMeetings(pkg) {
  const out = []
  for (const sec of pkg.sections || []) {
    for (const cm of sec.classMeetings || []) {
      if (cm.meetingType && cm.meetingType !== 'CLASS') continue // skip EXAM rows
      const days = (cm.meetingDaysList || []).map((d) => DAY_CODE[d]).filter(Boolean)
      const startTime = msToHHMM(cm.meetingTimeStart)
      const endTime = msToHHMM(cm.meetingTimeEnd)
      if (!days.length || !startTime || !endTime) continue // online / async
      const building = cm.building?.buildingName
      const location =
        building && building !== 'ONLINE' ? [building, cm.room].filter(Boolean).join(' ') : ''
      // Merge duplicate rows shared by LEC+DIS of the same package.
      const dup = out.find(
        (m) =>
          m.startTime === startTime &&
          m.endTime === endTime &&
          m.days.join('') === days.join('') &&
          m.location === location
      )
      if (!dup) out.push({ days, startTime, endTime, location })
    }
  }
  return out
}

function packageInstructors(pkg) {
  const out = []
  for (const sec of pkg.sections || []) {
    const people = []
    if (sec.instructor) people.push(sec.instructor)
    if (Array.isArray(sec.instructors)) people.push(...sec.instructors)
    for (const p of people) {
      const n = p?.name || p?.personAttributes?.name || p
      const name =
        typeof n === 'string' ? n : [n?.first, n?.last].filter(Boolean).join(' ').trim()
      if (name && !out.includes(name)) out.push(name)
    }
  }
  return out
}

function normalizePackage(hit, pkg, { termCode, termLabel, subjectCode, subjectLabel }) {
  const es = pkg.enrollmentStatus || {}
  // Reserve-pool sections report 0 on the plain fields and the real numbers
  // on the aggregate* variants.
  const max = es.capacity || es.aggregateCapacity || null
  const current =
    es.capacity || !es.aggregateCapacity ? numOrNull(es.currentlyEnrolled) : numOrNull(es.aggregateCurrentlyEnrolled)
  const pes = pkg.packageEnrollmentStatus || {}
  const available =
    numOrNull(pes.availableSeats) ?? (max !== null && current !== null ? max - current : null)
  const status =
    pes.status === 'OPEN' ? 'open' : pes.status ? 'closed' : 'unknown'
  const sectionNumber = (pkg.sections || [])
    .map((s) => `${s.type || ''} ${s.sectionNumber || ''}`.trim())
    .filter(Boolean)
    .join(' / ')
  return {
    school: 'wisc',
    termCode,
    termLabel: termLabel || '',
    subjectCode,
    subjectLabel: subjectLabel || hit.subject?.shortDescription || subjectCode,
    courseNumber: String(hit.catalogNumber || '').trim(),
    sectionNumber,
    crn: String(pkg.enrollmentClassNumber ?? pkg.docId ?? ''),
    title: hit.title || '',
    instructors: packageInstructors(pkg),
    credits: parseCredits(hit.creditRange),
    enrollment: { max, current, available },
    status,
    meetings: packageMeetings(pkg),
  }
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`wisc:sections:${termCode}:${subjectCode}`, async () => {
    const hits = await searchCourses(termCode, subjectCode)
    const out = []
    const queue = [...hits]
    async function worker() {
      for (let hit = queue.shift(); hit; hit = queue.shift()) {
        try {
          const pkgs = await apiGet(
            `/enrollmentPackages/${encodeURIComponent(termCode)}/${encodeURIComponent(subjectCode)}/${encodeURIComponent(hit.courseId)}`
          )
          for (const pkg of Array.isArray(pkgs) ? pkgs : []) {
            if (pkg.published === false) continue
            out.push(normalizePackage(hit, pkg, { termCode, termLabel, subjectCode, subjectLabel }))
          }
        } catch {
          // One course's package call failing shouldn't sink the subject.
        }
      }
    }
    await Promise.all(Array.from({ length: PACKAGE_CONCURRENCY }, worker))
    // Workers finish out of order; keep the catalog ordering.
    out.sort(
      (a, b) =>
        a.courseNumber.localeCompare(b.courseNumber, undefined, { numeric: true }) ||
        a.sectionNumber.localeCompare(b.sectionNumber)
    )
    return out
  })
}
