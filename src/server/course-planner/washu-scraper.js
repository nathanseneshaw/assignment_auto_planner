/**
 * Washington University in St. Louis scraper.
 *
 * WashU runs on Workday, but the registrar publishes a genuinely public mirror
 * as a plain POST form on its own WordPress site:
 *
 *   GET  {URL}  -> term / school / department / level / mode <select>s
 *   POST {URL}  -> the matching sections, server-rendered
 *
 * No API, no JSON, no session: the same URL takes the filters as form fields and
 * returns the results inline. `school` is optional (posting a term alone returns
 * all 6,495 Fall 2026 sections), so this only ever sends term + department.
 *
 * Facet note: WashU's picker is by DEPARTMENT ("Computer Science & Engineering"),
 * not by subject code, so that department name is the subject `code` this scraper
 * hands the planner - it is the only value the form accepts. Each section's own
 * `subjectCode` still comes from its course heading ("CSE 5401" -> CSE / 5401),
 * so sections render as "CSE 5401" the way every other school does.
 *
 * Results markup: one `.scpi__classes--row` per COURSE, carrying the department,
 * title, "CSE 5401" heading and "3 Units"; inside it one `.scpi-class__data`
 * block per SECTION, whose label/value pairs give Section, Term, Instructor,
 * Delivery Mode, Days, Time and "Seats Taken" as taken/capacity ("24/70").
 *
 * Paging: 149 course rows per page. The response carries a hidden `paged` input
 * holding the NEXT page number, so the walk just re-posts with it until it stops
 * advancing. A department-scoped search almost always fits on one page (CSE is
 * 68 courses / 618 sections), so this rarely fires.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseCredits } from './util.js'

const SCHOOL = 'washu'
const URL = 'https://registrar.washu.edu/classes-registration/class-schedule-search/'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Hard stop on the pager: 149 rows/page, so this covers the whole catalogue. */
const MAX_PAGES = 60

async function loadHome() {
  return cacheMemo(
    `${SCHOOL}:home`,
    async () => {
      const res = await fetch(URL, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`WashU class search returned HTTP ${res.status}`)
      return res.text()
    },
    60 * 60 * 1000
  )
}

async function search({ term, department = '', paged = '' }) {
  const body = new URLSearchParams({
    term,
    school: '',
    department,
    level: '',
    instructor: '',
    mode: '',
    courses_search: '',
  })
  if (paged) {
    body.set('paged', paged)
    body.set('pagination-submit', '')
  }
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: URL,
    },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`WashU class search returned HTTP ${res.status}`)
  return cheerio.load(await res.text())
}

/** Distinct <option> values of a select, in document order. */
function optionValues($, selector) {
  const out = []
  const seen = new Set()
  $(`${selector} option`).each((_, o) => {
    const v = ($(o).attr('value') || '').trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  })
  return out
}

export async function getTerms() {
  const $ = cheerio.load(await loadHome())
  // Values are the labels ("2026 Fall"), and the form filters on that string, so
  // code and label are the same. "2026 Medicine Year" has no season and is
  // dropped by term-window's own parser.
  return optionValues($, '#termselect').map((v) => ({ code: v, label: v }))
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `${SCHOOL}:subjects:${termCode}`,
    async () => {
      // Posting the term alone re-renders the department select scoped to that
      // term (67 for Fall 2026, vs 19 on the unfiltered landing page).
      const $ = await search({ term: termCode })
      return optionValues($, '#departmentselect')
        .map((v) => ({ code: v, label: v }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const out = []
    let paged = ''
    for (let i = 0; i < MAX_PAGES; i++) {
      const $ = await search({ term: termCode, department: subjectCode, paged })
      $('.scpi__classes--row').each((_, rowEl) => {
        out.push(...parseCourseRow($, $(rowEl), termCode, termLabel, subjectLabel))
      })
      const next = ($('input[name="paged"]').attr('value') || '').trim()
      if (!next || next === paged) break
      paged = next
    }
    return out
  })
}

/** One `.scpi__classes--row` -> one section per `.scpi-class__data` block. */
function parseCourseRow($, $row, termCode, termLabel, subjectLabel) {
  const department = text($row.find('.scpi-class__department').first())
  const title = text($row.find('.scpi-class__header .scpi-class__heading.wide').first())
  const courseCode = text($row.find('.scpi-class__header .scpi-class__heading.middle').first())
  const units = text($row.find('.scpi-class__header .scpi-class__heading.narrow').first())

  // "CSE 5401" -> subject CSE, number 5401. A handful of WashU codes carry a
  // letter suffix ("L45 Art 500"), so take the LAST whitespace-separated token
  // as the number and everything before it as the subject.
  const parts = courseCode.split(/\s+/).filter(Boolean)
  const courseNumber = parts.length > 1 ? parts[parts.length - 1] : ''
  const subject = parts.length > 1 ? parts.slice(0, -1).join(' ') : courseCode

  const sections = []
  $row.find('.scpi-class__data').each((_, dataEl) => {
    const $data = $(dataEl)
    const f = {}
    $data.find('.scpi-class__data-box').each((__, boxEl) => {
      const $box = $(boxEl)
      f[text($box.find('.scpi-class__label').first())] = text(
        $box.find('.scpi-class__value').first()
      )
    })
    const { max, current } = parseSeats(f['Seats Taken'])
    sections.push({
      school: SCHOOL,
      termCode,
      termLabel: termLabel || f.Term || '',
      subjectCode: subject,
      subjectLabel: subjectLabel || department,
      courseNumber,
      sectionNumber: f.Section || '',
      // Workday has no CRN; the section-definition id is the stable per-section key.
      crn: ($data.attr('data-section-id') || '').trim(),
      title,
      instructors: splitInstructors(f.Instructor),
      credits: parseCredits(units),
      enrollment: {
        max,
        current,
        available: max != null && current != null ? Math.max(0, max - current) : null,
      },
      // The listing shows seats but no open/closed flag, so derive it: a section
      // at or over capacity is closed, anything else with known counts is open.
      status: max == null || current == null ? 'unknown' : current < max ? 'open' : 'closed',
      meetings: parseMeeting(f.Days, f.Time),
    })
  })
  return sections
}

function text($el) {
  return $el.text().replace(/\s+/g, ' ').trim()
}

/** "24/70" -> { current: 24, max: 70 }. Blank / "-" on unpublished sections. */
function parseSeats(raw) {
  const m = String(raw || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return { max: null, current: null }
  return { current: Number(m[1]), max: Number(m[2]) }
}

function splitInstructors(raw) {
  return String(raw || '')
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '-')
}

const DAY_ABBR = { MON: 'M', TUE: 'T', WED: 'W', THU: 'R', FRI: 'F', SAT: 'S', SUN: 'U' }

/** Days "Tue Thu" + Time "10:00 AM-11:20 AM" -> one meeting row. */
function parseMeeting(daysRaw, timeRaw) {
  const days = String(daysRaw || '')
    .split(/\s+/)
    .map((d) => DAY_ABBR[d.trim().toUpperCase().slice(0, 3)])
    .filter(Boolean)
  const m = String(timeRaw || '').match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i
  )
  const startTime = m ? normalizeTime(m[1]) : null
  const endTime = m ? normalizeTime(m[2]) : null
  if (!days.length && !startTime) return []
  // The public listing carries no room, only the delivery mode, so location is
  // intentionally empty rather than repeating "In-Person".
  return [{ days: [...new Set(days)], startTime, endTime, location: '' }]
}
