/**
 * UT Dallas scraper (utd)  UTDNebula public API (https://api.utdnebula.com).
 *
 * UTD's own CourseBook is reCAPTCHA-v3 / NetID-gated and cannot be reached with
 * plain HTTP (see the investigation in memory). Nebula Labs (UTD students) run a
 * public JSON API that mirrors the CourseBook data, so we consume that.
 *
 * Auth: every data endpoint sits behind a Google Cloud API Gateway requiring an
 * `x-api-key` header. The key is free (provisioned via the Nebula Discord) and
 * read from `process.env.NEBULA_API_KEY`; without it all calls 401.
 *
 * Strategy (shaped by the data model + a hard 20-rows-per-page server limit):
 *   - Nebula stores ~8 years of history and duplicates every course per catalog
 *     year (CS alone has ~967 course docs). Term lives on the Section, and the
 *     section-list endpoints can't be filtered by BOTH subject and term, so we:
 *       1. Pull two global indexes ONCE (cached 1h): every course
 *          (`/course/all`, id -> subject/number/title/credits) and every
 *          professor (`/professor/all`, id -> name).
 *       2. Fetch a whole TERM's sections at a time (`/section?academic_session.
 *          name=<term>`), paged in parallel and cached 30m, then filter to the
 *          requested subject in memory via each section's course_reference.
 *     Fetching per-term (not per-subject) means the ~1k6k sections of a term are
 *     fetched once and reused across every subject click. Fetching per-subject
 *     instead would pull all 8 years of that subject (5k+ CS sections, ~40s) just
 *     to show one term  measured and rejected.
 *   - There are NO seat counts, so enrollment is always null and status always
 *     'unknown' (registered as enrollmentDataAvailable:false).
 *
 * Every endpoint wraps its payload in { status, message, data }.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays, parseCredits } from './util.js'

const SCHOOL = 'utd'
const BASE = 'https://api.utdnebula.com'

// Server-side page size (configs.GetEnvLimit default = 20). Immutable from our side.
const PAGE = 20
// Concurrent page requests when walking a term's sections. Keeps a big Fall term
// (~5k sections / ~250 pages) to a few seconds while staying well under the
// gateway's 1000-reads/min quota.
const WAVE = 8

function apiKey() {
  const key = process.env.NEBULA_API_KEY
  if (!key) {
    throw new Error(
      'NEBULA_API_KEY is not set  request a free key from the Nebula Labs Discord and add it to the server env.'
    )
  }
  return key
}

/** GET a Nebula path and unwrap the { status, message, data } envelope. */
async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': apiKey(), Accept: 'application/json' },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`Nebula ${path} -> HTTP ${res.status}: ${body?.message || 'request failed'}`)
  }
  const data = body?.data
  return data === undefined || data === null ? [] : data
}

/**
 * Walk an offset-paginated endpoint, firing WAVE pages at a time. Offset results
 * are contiguous, so once any page in a wave is empty or short we've hit the end.
 */
async function pageOffsetParallel(pathBase) {
  const sep = pathBase.includes('?') ? '&' : '?'
  const out = []
  for (let base = 0; base < 100000; base += WAVE * PAGE) {
    const chunks = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => api(`${pathBase}${sep}offset=${base + i * PAGE}`))
    )
    let done = false
    for (const chunk of chunks) {
      if (!Array.isArray(chunk) || chunk.length === 0) {
        done = true
        continue
      }
      out.push(...chunk)
      if (chunk.length < PAGE) done = true
    }
    if (done) break
  }
  return out
}

/**
 * Global course index (cached 1h): one /course/all call (~21k docs, ~5s) keyed by
 * _id for section joins, plus the distinct subject-prefix list for getSubjects.
 */
function loadCourseIndex() {
  return cacheMemo(
    'utd:course-index',
    async () => {
      const courses = await api('/course/all')
      const byId = new Map()
      const subjects = new Set()
      for (const c of Array.isArray(courses) ? courses : []) {
        const prefix = String(c.subject_prefix || '').toUpperCase()
        byId.set(String(c._id), {
          subjectCode: prefix,
          courseNumber: String(c.course_number || '').trim(),
          title: c.title || '',
          credits: parseCredits(c.credit_hours),
        })
        if (prefix) subjects.add(prefix)
      }
      return { byId, subjects: [...subjects].sort((a, b) => a.localeCompare(b)) }
    },
    60 * 60 * 1000
  )
}

/** Global professor id -> "First Last" map (cached 1h): one /professor/all call. */
function loadProfessorIndex() {
  return cacheMemo(
    'utd:professor-index',
    async () => {
      const profs = await api('/professor/all')
      const byId = new Map()
      for (const p of Array.isArray(profs) ? profs : []) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
        if (p._id && name) byId.set(String(p._id), name)
      }
      return byId
    },
    60 * 60 * 1000
  )
}

/** All sections for one term (cached 30m); subject filtering is done by the caller. */
function loadTermSections(termCode) {
  return cacheMemo(
    `utd:term-sections:${termCode}`,
    () => pageOffsetParallel(`/section?academic_session.name=${encodeURIComponent(termCode)}`),
    30 * 60 * 1000
  )
}

/**
 * Nebula term code -> "Season YYYY" label. Live-verified format is
 * <2-digit year><season letter>: "18U" = Summer 2018, "26F" = Fall 2026,
 * "26S" = Spring 2026. term-window.js re-derives the final label from this, so it
 * only needs a season word + year.
 */
function formatTermLabel(code) {
  const s = String(code).trim().toLowerCase()
  const seasons = { f: 'Fall', s: 'Spring', u: 'Summer', w: 'Winter' }
  let m = s.match(/^(\d{2})([fsuw])$/)
  if (m) return `${seasons[m[2]]} 20${m[1]}`
  m = s.match(/^(\d{4})([fsuw])$/)
  if (m) return `${seasons[m[2]]} ${m[1]}`
  return code // unexpected format: pass through for term-window to attempt
}

/** Nebula meeting_days (full day names) -> unified single-letter day codes. */
const DAY_NAME = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'R',
  friday: 'F',
  saturday: 'S',
  sunday: 'U',
}
function mapMeetingDays(days) {
  const list = Array.isArray(days) ? days : [days]
  const out = []
  for (const d of list) {
    const key = String(d || '').trim().toLowerCase()
    if (DAY_NAME[key]) out.push(DAY_NAME[key])
    else out.push(...parseDays(String(d || ''))) // fallback for abbreviations
  }
  return [...new Set(out)]
}

/** One Nebula meeting -> unified meeting, or null for a TBA/empty row. */
function mapMeeting(m) {
  const days = mapMeetingDays(m?.meeting_days)
  const startTime = normalizeTime(m?.start_time)
  const endTime = normalizeTime(m?.end_time)
  const location = [m?.location?.building, m?.location?.room].filter(Boolean).join(' ').trim()
  if (!days.length && !startTime && !location) return null
  return { days, startTime, endTime, location }
}

// ---- Public scraper contract -------------------------------------------------

/**
 * Distinct terms Nebula has data for, derived from the CS 1337 staple (offered
 * every term, so its sections span the full term list). Cached 1h. The route
 * trims this to the current + next term via term-window.js.
 */
export async function getTerms() {
  return cacheMemo(
    'utd:terms',
    async () => {
      const terms = new Set()
      // /course/sections is a nested aggregate (former_offset = course window,
      // latter_offset = sections within it). CS1337 has ~10 catalog-year docs, so
      // one former window covers them; we still guard for a second just in case.
      for (let w = 0; w < 2; w++) {
        let windowRows = 0
        for (let page = 0; page < 100; page++) {
          const chunk = await api(
            `/course/sections?subject_prefix=CS&course_number=1337&former_offset=${w * PAGE}&latter_offset=${page * PAGE}`
          )
          if (!Array.isArray(chunk) || chunk.length === 0) break
          windowRows += chunk.length
          for (const s of chunk) {
            const name = s?.academic_session?.name
            if (name) terms.add(String(name))
          }
          if (chunk.length < PAGE) break
        }
        if (windowRows === 0) break
      }
      return [...terms].map((code) => ({ code, label: formatTermLabel(code) }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(_termCode) {
  const idx = await loadCourseIndex()
  return idx.subjects.map((code) => ({ code, label: code }))
}

export async function getSections({ termCode, subjectCode, termLabel = '' }) {
  const subject = String(subjectCode || '').toUpperCase()
  const wantTerm = String(termCode)

  const [idx, professors, sections] = await Promise.all([
    loadCourseIndex(),
    loadProfessorIndex(),
    loadTermSections(wantTerm),
  ])

  const out = []
  for (const s of sections) {
    const course = idx.byId.get(String(s.course_reference))
    // Filter to the requested subject via the section's course.
    if (!course || course.subjectCode !== subject) continue

    const meetings = Array.isArray(s.meetings) ? s.meetings.map(mapMeeting).filter(Boolean) : []
    const instructors = Array.isArray(s.professors)
      ? s.professors.map((id) => professors.get(String(id))).filter(Boolean)
      : []

    out.push({
      school: SCHOOL,
      termCode: wantTerm,
      termLabel: termLabel || formatTermLabel(wantTerm),
      subjectCode: course.subjectCode,
      subjectLabel: course.subjectCode,
      courseNumber: course.courseNumber,
      sectionNumber: String(s.section_number || '').trim(),
      // internal_class_number is UTD's registration class number (our CRN analog);
      // fall back to the Mongo id so every row still has a unique key.
      crn: String(s.internal_class_number || s._id || ''),
      title: course.title,
      instructors,
      credits: course.credits ?? null,
      enrollment: { max: null, current: null, available: null },
      status: 'unknown', // Nebula exposes no seat / open-closed data
      meetings,
    })
  }
  return out
}
