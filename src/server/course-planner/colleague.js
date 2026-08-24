/**
 * Factory for Ellucian Colleague Self-Service course-catalog scrapers.
 *
 * A fourth engine alongside Banner 9 SSB (banner-ssb.js), Banner 8 "classic"
 * (banner-classic.js) and PeopleSoft (peoplesoft.js). Several schools run
 * Colleague Self-Service and expose a guest "Course Catalog" search with NO
 * login — e.g. Texas Woman's University (selfservice.twu.edu).
 *
 * It's an ASP.NET MVC app that speaks JSON. Every call needs an antiforgery
 * token+cookie pair, harvested from the catalog landing page:
 *   1. GET  {base}/Student/Courses                                  -> __RequestVerificationToken (hidden field + cookie)
 *   2. GET  {base}/Student/Courses/GetCatalogAdvancedSearchAsync    -> { Terms, Subjects, ... } all filter facets
 *   3. POST {base}/Student/Courses/SearchAsync                      -> { Sections, TotalPages, ... } the data
 *
 * The advanced-search facet endpoint (2) returns the full term list plus a
 * catalog-wide subject list (every subject the school has ever offered, not
 * just this term's). The search endpoint (3) is filtered by subject+term and
 * paginated 30 sections per page (the server caps the page size, so
 * quantityPerPage is ignored and we walk TotalPages); called WITHOUT a subject
 * it also returns a per-term `Subjects` facet, which is how getSubjects trims
 * the picker down to subjects that actually have sections in the chosen term.
 *
 * Both the advanced-search GET and the SearchAsync POST require the antiforgery
 * token echoed in a __RequestVerificationToken header (the cookie alone 400s).
 * Sections carry full enrollment (capacity / enrolled / available) + meeting
 * times, so callers report enrollmentDataAvailable:true.
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import { cacheMemo } from './cache.js'
import { parseCredits } from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// A single subject in a single term never approaches this many sections; it's
// only a backstop so a misreported TotalPages can't loop forever.
const MAX_PAGES = 25

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `legacyApi: true` targets the older Self-Service release (Tarrant County
 * College, McLennan, Southwestern, Hardin-Simmons all run it). Two differences,
 * both purely transport — the JSON that comes back is field-for-field identical:
 *   - the endpoints have no "Async" suffix (GetCatalogAdvancedSearch /
 *     PostSearchCriteria; the Async names 404), and
 *   - the search criteria are POSTed bare instead of wrapped in
 *     { searchParameters: "<json string>" }. The wrapped form does NOT error on
 *     these hosts — it silently ignores every filter and returns the whole
 *     catalog as `Courses`, so getting this wrong looks like a working search.
 */
export function createColleagueScraper({ school, base, legacyApi = false }) {
  const coursesUrl = `${base}/Student/Courses`
  const facetsPath = legacyApi ? 'GetCatalogAdvancedSearch' : 'GetCatalogAdvancedSearchAsync'
  const searchPath = legacyApi ? 'PostSearchCriteria' : 'SearchAsync'

  /** GET the catalog landing page; return a cookie-bound fetch + antiforgery token. */
  async function session() {
    const cFetch = makeFetchCookie(fetch, new CookieJar())
    const html = await (await cFetch(coursesUrl, { headers: { 'User-Agent': UA } })).text()
    const token = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ||
      html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/) || [])[1]
    if (!token) throw new Error(`${school}: no antiforgery token on catalog page`)
    return { cFetch, token }
  }

  /** The advanced-search facet payload: full Terms + Subjects + Locations lists. */
  async function advancedSearch() {
    const { cFetch, token } = await session()
    const res = await cFetch(`${base}/Student/Courses/${facetsPath}`, {
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: coursesUrl,
        __RequestVerificationToken: token,
      },
    })
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`${school}: advanced-search returned no facets`)
    }
    return data
  }

  async function getTerms() {
    return cacheMemo(
      `${school}:terms`,
      async () => {
        const data = await advancedSearch()
        // Terms arrive as tuples: { Item1: code, Item2: label }.
        return (Array.isArray(data.Terms) ? data.Terms : [])
          .map((t) => ({ code: t.Item1, label: decodeEntities(t.Item2) }))
          .filter((t) => t.code)
      },
      60 * 60 * 1000
    )
  }

  /** The catalog-wide subject list: every subject the school has ever offered. */
  async function allSubjects() {
    const data = await advancedSearch()
    return (Array.isArray(data.Subjects) ? data.Subjects : [])
      .filter((s) => s.ShowInCourseSearch !== false && s.Code)
      .map((s) => ({ code: s.Code, label: decodeEntities(s.Description) }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  /**
   * Subjects that actually have sections in `termCode`.
   *
   * The advanced-search facet is catalog-wide, so using it directly fills the
   * picker with subjects that yield "no sections" for the selected term —
   * Dallas College lists 135 but only 77 have Fall 2026 sections; TWU lists 66
   * against 56. One unfiltered search for the term returns a `Subjects` facet
   * holding exactly that term's subjects with per-subject counts, for one extra
   * request that the 1 h cache absorbs. Verified 2026-08-22 against a full
   * 33-page walk of Dallas College's Fall 2026 term: identical 77 codes, none
   * missing, none spurious, counts summing to TotalItems.
   *
   * Falls back to the catalog-wide list when no term is given or the facet
   * comes back empty, so the picker can never end up blank.
   */
  async function getSubjects(termCode) {
    return cacheMemo(
      `${school}:subjects:${termCode || 'all'}`,
      async () => {
        if (termCode) {
          const { cFetch, token } = await session()
          const json = await searchPage(cFetch, token, { termCode, page: 1 })
          const inTerm = (Array.isArray(json.Subjects) ? json.Subjects : [])
            .filter((s) => s.Value && Number(s.Count) > 0)
            .map((s) => ({ code: s.Value, label: decodeEntities(s.Description) }))
            .sort((a, b) => a.code.localeCompare(b.code))
          if (inTerm.length) return inTerm
        }
        return allSubjects()
      },
      60 * 60 * 1000
    )
  }

  /**
   * One page of the section search. Omit `subjectCode` to search the whole term
   * — that form is what surfaces the per-term Subjects facet in the response.
   */
  async function searchPage(cFetch, token, { subjectCode, termCode, page }) {
    const criteria = {
      keyword: null, terms: [termCode], requirement: null, subrequirement: null,
      courseIds: null, sectionIds: null, requirementText: null, subrequirementText: '',
      group: null, startTime: null, endTime: null, openSections: null,
      subjects: subjectCode ? [subjectCode] : [],
      academicLevels: [], courseLevels: [], synonyms: [],
      courseTypes: [], topicCodes: [], days: [], locations: [], faculty: [],
      onlineCategories: null, keywordComponents: [], startDate: null, endDate: null,
      startsAtTime: null, endsAtTime: null, pageNumber: page, sortOn: 'None',
      sortDirection: 'Ascending', subjectsBadge: [], locationsBadge: [],
      termFiltersBadge: [], daysBadge: [], facultyBadge: [], academicLevelsBadge: [],
      courseLevelsBadge: [], courseTypesBadge: [], topicCodesBadge: [],
      onlineCategoriesBadge: [], openAndWaitlistedSections: null,
      subRequirementText: null, quantityPerPage: 30, searchResultsView: 'SectionListing',
    }
    const res = await cFetch(`${base}/Student/Courses/${searchPath}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: coursesUrl,
        __RequestVerificationToken: token,
      },
      body: legacyApi
        ? JSON.stringify(criteria)
        : JSON.stringify({ searchParameters: JSON.stringify(criteria) }),
    })
    const json = await res.json()
    if (!json || typeof json !== 'object') throw new Error(`${school} search returned no data`)
    return json
  }

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(
      `${school}:sections:${termCode}:${subjectCode}`,
      async () => {
        const { cFetch, token } = await session()
        const out = []
        let page = 1
        let totalPages = 1
        do {
          const json = await searchPage(cFetch, token, { subjectCode, termCode, page })
          const rows = Array.isArray(json.Sections) ? json.Sections : []
          totalPages = Number(json.TotalPages) || 1
          for (const r of rows) out.push(normalize(r, school, termCode, termLabel, subjectLabel))
          page += 1
        } while (page <= totalPages && page <= MAX_PAGES)
        return out
      },
      5 * 60 * 1000
    )
  }

  return { getTerms, getSubjects, getSections }
}

/** "MKT*3113" / "ITSC-1001" / "ACCT_2301" -> ["", "MKT", "3113"]. */
const SEP_RE = /^\s*([^*\-_\s]+)\s*[*\-_]\s*(.*)$/

// JS-style day numbering used in FormattedMeetingTimes.Days: 0=Sun … 6=Sat.
const DAY_NUM = ['U', 'M', 'T', 'W', 'R', 'F', 'S']

function daysFromNumbers(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((n) => DAY_NUM[Number(n)])
    .filter(Boolean)
}

/** "13:00:00" / "9:05:00" -> "13:00" / "09:05". */
function hhmm(raw) {
  if (!raw) return null
  const m = String(raw).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function toMeeting(m) {
  const days = daysFromNumbers(m.Days)
  const startTime = hhmm(m.StartTime)
  const endTime = hhmm(m.EndTime)
  // Online / TBA meetings carry no days or times — not schedulable, so drop them.
  if (!days.length || !startTime || !endTime) return null
  const location = decodeEntities([m.BuildingDisplay, m.RoomDisplay].filter(Boolean).join(' '))
  return { days, startTime, endTime, location }
}

function numOrNull(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function deriveStatus(r) {
  const d = String(r.AvailabilityStatusDisplay || '').toLowerCase()
  if (d.includes('open')) return 'open'
  // A waitlisted/full/closed section has no directly registrable seats.
  if (d.includes('waitlist') || d.includes('closed') || d.includes('full')) return 'closed'
  if (r.HasUnlimitedSeats) return 'open'
  const avail = numOrNull(r.Available)
  if (avail !== null) return avail > 0 ? 'open' : 'closed'
  const max = numOrNull(r.Capacity)
  const cur = numOrNull(r.Enrolled)
  if (max !== null && cur !== null) return cur < max ? 'open' : 'closed'
  return 'unknown'
}

function normalize(r, school, termCode, termLabel, subjectLabel) {
  // CourseName is "SUBJ<sep>NUM"; trust it over the searched subject so
  // cross-listed courses keep their printed prefix. The separator is a Colleague
  // site setting: TWU prints "MKT*3113", Dallas College "ITSC-1001", McLennan
  // "ACCT_2301". Split on the FIRST separator only, so a course number that
  // itself contains one survives.
  const [, subjFromName = '', numFromName = ''] =
    String(r.CourseName || '').match(SEP_RE) || []
  const max = numOrNull(r.Capacity)
  const current = numOrNull(r.Enrolled)
  const available = numOrNull(r.Available)
  const instructors = [
    ...new Set((Array.isArray(r.FacultyDisplay) ? r.FacultyDisplay : []).map(decodeEntities)),
  ].filter((n) => n && !/^staff$/i.test(n))
  return {
    school,
    termCode,
    termLabel: termLabel || r.TermDisplay || '',
    subjectCode: (subjFromName || '').trim(),
    subjectLabel: subjectLabel || '',
    courseNumber: (numFromName || '').trim(),
    sectionNumber: String(r.Number || '').trim(),
    crn: String(r.Synonym || ''),
    title: decodeEntities(r.Title || r.SectionTitleDisplay),
    instructors,
    credits: parseCredits(r.MinimumCredits),
    enrollment: { max: r.HasUnlimitedSeats ? null : max, current, available },
    status: deriveStatus(r),
    meetings: (Array.isArray(r.FormattedMeetingTimes) ? r.FormattedMeetingTimes : [])
      .map(toMeeting)
      .filter(Boolean),
  }
}
