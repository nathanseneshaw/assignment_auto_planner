/**
 * University of Arkansas scraper.
 *
 * The UA System moved to Workday, and its public Schedule of Classes
 * (registrar.uark.edu/schedule-of-classes/) is a thin front end over a JSON API:
 *
 *   GET  {API}/api/Fabric/Metadata       -> terms, colleges, departments, facets
 *   POST {API}/api/Fabric/ClassSchedule  -> sections (DataTables-style paging)
 *
 * The page's own app.js hardcodes that API host, and it is an Azure app whose
 * name still carries a "-dev-" segment. That is not a mistake on our side - it
 * is what the production registrar page calls - but it does mean the host is
 * more likely than most to move, so a 404 here should be read as "they renamed
 * the backend", not "the parser broke".
 *
 * Data quality is among the best in the roster: every section carries
 * Enrollment_Count / Section_Capacity, meeting days, start/end times, room,
 * delivery mode and instructor, and the whole Fall 2026 term is 10,982 rows.
 * The one gap is credit hours - Workday does not publish them here at all
 * (there is no credits/hours/units field on the row), so credits is always null.
 *
 * Two field traps worth pinning down. The per-day columns Mon..Sun exist but are
 * null on EVERY row, including sections that clearly meet MWF - the real day
 * data is the `Meeting_Days` string ("Monday/Wednesday/Friday"). And that string
 * must not go through util.parseDays, whose two-letter walk reads the "S" in
 * "WEDNESDAY" as Saturday; the full names are mapped explicitly below.
 *
 * Term codes here are the API's own verbose labels ("UAF Fall 2026
 * (08/17/2026-12/11/2026)"), because that string is both the identifier the
 * search filters on and the only term key the API exposes. term-window.js
 * rewrites the display label to "Fall 2026" and passes the code through
 * untouched, which is exactly what this needs.
 *
 * There is no subject facet in the metadata - subjects are a property of the
 * sections - so getSubjects derives them from one term-wide fetch, cached
 * hourly, the same shape banner-ssb.js uses for its shared-instance schools.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime } from './util.js'

const SCHOOL = 'uark'
const API = 'https://app-schedule-of-classes-dev-ncus.azurewebsites.net'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://registrar.uark.edu/schedule-of-classes/',
}

/** Sections per request. The API accepts large pages; 2000 keeps it to ~6 calls. */
const PAGE_SIZE = 2000

async function getMetadata() {
  return cacheMemo(
    `${SCHOOL}:metadata`,
    async () => {
      const res = await fetch(`${API}/api/Fabric/Metadata`, { headers: HEADERS })
      if (!res.ok) throw new Error(`Arkansas metadata returned HTTP ${res.status}`)
      return res.json()
    },
    60 * 60 * 1000
  )
}

/** One page of the DataTables-style search. */
async function fetchPage(term, start) {
  const body = new URLSearchParams({
    draw: '1',
    start: String(start),
    length: String(PAGE_SIZE),
    page: String(Math.floor(start / PAGE_SIZE) + 1),
    SortColumn: '',
    SortDirection: 'asc',
    ColumnFilters: '',
    Standard_Academic_Period: term,
  })
  const res = await fetch(`${API}/api/Fabric/ClassSchedule`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Arkansas class search returned HTTP ${res.status}`)
  const json = await res.json()
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Arkansas class search returned no data')
  }
  return json
}

/**
 * Every row for a term, walking the pager. Cached as one unit because there is
 * no subject filter in the API: getSubjects and every getSections call for the
 * term all read this same list, so without the shared cache each click would
 * re-pull all ~11k rows.
 */
async function fetchTerm(term) {
  return cacheMemo(
    `${SCHOOL}:term-rows:${term}`,
    async () => {
      const first = await fetchPage(term, 0)
      const rows = [...first.data]
      const total = Number(first.recordsFiltered) || rows.length
      while (rows.length < total) {
        const page = await fetchPage(term, rows.length)
        if (!page.data.length) break // defensive: never loop on a bad page
        rows.push(...page.data)
      }
      return rows
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const meta = await getMetadata()
  const periods = Array.isArray(meta.StandardAcademicPeriods)
    ? meta.StandardAcademicPeriods
    : []
  // The label IS the code here (see the file header). The metadata list is
  // alphabetical, not chronological, but no two entries clean to the same
  // season+year so the term window's own sort settles the order.
  return periods.map((p) => ({ code: p, label: p }))
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `${SCHOOL}:subjects:${termCode}`,
    async () => {
      const rows = await fetchTerm(termCode)
      const byCode = new Map()
      for (const r of rows) {
        const code = String(r.Course_Subject || '').trim()
        if (!code || byCode.has(code)) continue
        // The API has no subject-name field; Department_Name is the closest
        // human label (several subjects can share one department).
        byCode.set(code, String(r.Department_Name || '').trim() || code)
      }
      return [...byCode]
        .map(([code, label]) => ({ code, label }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    // There is no subject filter in the search params (the UI filters by
    // department, which is coarser), so read the cached term-wide list and
    // select the subject here.
    const rows = await fetchTerm(termCode)
    return rows
      .filter((r) => String(r.Course_Subject || '').trim() === subjectCode)
      .map((r) => normalize(r, termCode, termLabel, subjectLabel))
  })
}

// Meeting_Days spells the days out and joins them with "/". Mapped explicitly
// (see the header): util.parseDays mis-reads full names.
const DAY_NAMES = {
  MONDAY: 'M',
  TUESDAY: 'T',
  WEDNESDAY: 'W',
  THURSDAY: 'R',
  FRIDAY: 'F',
  SATURDAY: 'S',
  SUNDAY: 'U',
}

function parseMeetingDays(raw) {
  const out = String(raw || '')
    .split(/[/,;]/)
    .map((d) => DAY_NAMES[d.trim().toUpperCase()])
    .filter(Boolean)
  return [...new Set(out)]
}

/** Workday prints "11:50:00"; normalizeTime wants HH:MM. */
function clockTime(raw) {
  const m = String(raw || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? normalizeTime(`${m[1].padStart(2, '0')}:${m[2]}`) : null
}

function normalize(r, termCode, termLabel, subjectLabel) {
  const max = numOrNull(r.Section_Capacity)
  const current = numOrNull(r.Enrollment_Count)
  const days = parseMeetingDays(r.Meeting_Days)
  const startTime = clockTime(r.Start_Time)
  const endTime = clockTime(r.End_Time)
  const instructors = [r.Primary_Instructor, ...String(r.Instructors || '').split(/\s*;\s*/)]
    .map((s) => String(s || '').trim())
    .filter(Boolean)

  return {
    school: SCHOOL,
    termCode,
    termLabel: termLabel || r.Standard_Academic_Period || '',
    subjectCode: String(r.Course_Subject || '').trim(),
    subjectLabel: subjectLabel || String(r.Department_Name || '').trim(),
    courseNumber: String(r.Course_Number || '').trim(),
    sectionNumber: String(r.Course_Section || '').trim(),
    // Workday has no CRN; its section GUID is the only stable per-section id.
    crn: String(r.Workday_ID || ''),
    title: String(r.Course_Name || '').trim(),
    instructors: [...new Set(instructors)],
    // Workday publishes no credit-hour field on this feed (see header).
    credits: null,
    enrollment: {
      max,
      current,
      available: max != null && current != null ? Math.max(0, max - current) : null,
    },
    status:
      r.Section_Status === 'Open'
        ? 'open'
        : r.Section_Status === 'Closed' || r.Section_Status === 'Canceled'
          ? 'closed'
          : r.Section_Status === 'Waitlist'
            ? 'waitlist'
            : 'unknown',
    // Rows without a day+time are online / arranged sections, which Arkansas
    // publishes with every meeting field null. Emit no meeting rather than an
    // empty one so the planner treats them the way it treats other schools'.
    meetings:
      days.length || startTime
        ? [
            {
              days,
              startTime,
              endTime,
              // "UAF | No Classroom Required" for online rows; keep the campus
              // half off and show only the room part when there is one.
              location: String(r.Location || '')
                .split('|')
                .pop()
                .trim(),
            },
          ]
        : [],
  }
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
