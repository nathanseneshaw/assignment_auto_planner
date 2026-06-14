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
 * The advanced-search facet endpoint (2) returns the full term + subject lists
 * in one shot — subjects are global, not per-term. The search endpoint (3) is
 * filtered by subject+term and paginated 30 sections per page (the server caps
 * the page size, so quantityPerPage is ignored and we walk TotalPages).
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

export function createColleagueScraper({ school, base }) {
  const coursesUrl = `${base}/Student/Courses`

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
    const res = await cFetch(`${base}/Student/Courses/GetCatalogAdvancedSearchAsync`, {
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

  // Colleague subjects are global, not term-scoped; termCode is accepted only to
  // satisfy the shared scraper contract and is intentionally ignored.
  async function getSubjects() {
    return cacheMemo(
      `${school}:subjects`,
      async () => {
        const data = await advancedSearch()
        return (Array.isArray(data.Subjects) ? data.Subjects : [])
          .filter((s) => s.ShowInCourseSearch !== false && s.Code)
          .map((s) => ({ code: s.Code, label: decodeEntities(s.Description) }))
          .sort((a, b) => a.code.localeCompare(b.code))
      },
      60 * 60 * 1000
    )
  }

  /** One page of the section search for a (subject, term) pair. */
  async function searchPage(cFetch, token, { subjectCode, termCode, page }) {
    const criteria = {
      keyword: null, terms: [termCode], requirement: null, subrequirement: null,
      courseIds: null, sectionIds: null, requirementText: null, subrequirementText: '',
      group: null, startTime: null, endTime: null, openSections: null,
      subjects: [subjectCode], academicLevels: [], courseLevels: [], synonyms: [],
      courseTypes: [], topicCodes: [], days: [], locations: [], faculty: [],
      onlineCategories: null, keywordComponents: [], startDate: null, endDate: null,
      startsAtTime: null, endsAtTime: null, pageNumber: page, sortOn: 'None',
      sortDirection: 'Ascending', subjectsBadge: [], locationsBadge: [],
      termFiltersBadge: [], daysBadge: [], facultyBadge: [], academicLevelsBadge: [],
      courseLevelsBadge: [], courseTypesBadge: [], topicCodesBadge: [],
      onlineCategoriesBadge: [], openAndWaitlistedSections: null,
      subRequirementText: null, quantityPerPage: 30, searchResultsView: 'SectionListing',
    }
    const res = await cFetch(`${base}/Student/Courses/SearchAsync`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: coursesUrl,
        __RequestVerificationToken: token,
      },
      body: JSON.stringify({ searchParameters: JSON.stringify(criteria) }),
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
  // CourseName is "SUBJ*NUM" (e.g. "MKT*3113"); trust it over the searched
  // subject so cross-listed courses keep their printed prefix.
  const [subjFromName, numFromName] = String(r.CourseName || '').split('*')
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
