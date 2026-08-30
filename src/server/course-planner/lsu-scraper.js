/**
 * Louisiana State University scraper.
 *
 * LSU moved to Workday and publishes its public catalogue at
 * courseofferings.lsu.edu - an ASP.NET MVC page whose filters are plain GET
 * query params, so there is no form POST, no session and no API to reverse:
 *
 *   GET {URL}?University=..&Department=..&AcademicPeriod=..  -> rendered sections
 *
 * The three filters are all required; with fewer, the page renders the form and
 * the message "Please select a campus, department, and academic period to view
 * course offerings". The Academic Period <select> is also empty until University
 * and Department are set, which is why getTerms below fetches with a department
 * first rather than reading the landing page.
 *
 * `University` pins the campus: AU00000079 is Baton Rouge (the school we list),
 * AU00000071 is LSU Eunice.
 *
 * Markup: one Bootstrap `.accordion-item` per course, its `.accordion-header`
 * reading "CSC 1350 COMP SCI I-MJRS", containing one
 * `<section aria-label="Section 001-LEC">` per section. Inside each section the
 * fields are label-prefixed cells - "Enrollment: 39/40", "3 Credit Hours",
 * "Format: Lecture", "Location: 1200 Patrick F. Taylor Hall",
 * "Instructor: ...", "Meeting Pattern: Monday Wednesday Friday 11:30 AM - 12:20 PM".
 *
 * Two things worth pinning down. Meeting patterns spell the days out, so they
 * must not go through util.parseDays (its two-letter walk reads the "S" in
 * "WEDNESDAY" as Saturday); the full names are mapped explicitly below. And a
 * section can carry SEVERAL patterns, separated by <br> inside one cell, so the
 * cell is split on the tag rather than on its flattened text.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseCredits } from './util.js'

const SCHOOL = 'lsu'
const URL = 'https://courseofferings.lsu.edu/LSU'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const BATON_ROUGE = 'AU00000079'

async function load(params) {
  const res = await fetch(`${URL}?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`LSU course offerings returned HTTP ${res.status}`)
  return cheerio.load(await res.text())
}

/** Distinct <option> values of a select, in document order. */
function optionValues($, selector) {
  const out = []
  const seen = new Set()
  $(`${selector} option`).each((_, o) => {
    const value = ($(o).attr('value') || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ code: value, label: text($(o)) || value })
  })
  return out
}

export async function getSubjects() {
  return cacheMemo(
    `${SCHOOL}:subjects`,
    async () => {
      // The department list is on the landing page and is campus-wide, not
      // term-scoped, so it needs no filters (and takes no termCode).
      const $ = await load({ University: BATON_ROUGE })
      const subjects = optionValues($, '#department')
      if (!subjects.length) throw new Error('LSU returned no departments')
      return subjects
    },
    6 * 60 * 60 * 1000
  )
}

export async function getTerms() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      // Academic Period only populates once a department is chosen; any
      // department yields the same campus-wide period list, so use the first.
      const [first] = await getSubjects()
      const $ = await load({ University: BATON_ROUGE, Department: first.code })
      // Labels carry the date span - "Fall Semester 2026 (08/24/2026-12/12/2026)".
      // term-window rewrites them to "Fall 2026"; the code stays untouched.
      // LSU also lists half-term and online sub-sessions ("First Fall 2026",
      // "Online Second Fall 2026") that clean to the same season+year and would
      // shadow the full term in the dedup, so keep only the full semester.
      return optionValues($, '#academicPeriod').filter((t) => /Semester/i.test(t.label))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const $ = await load({
      University: BATON_ROUGE,
      Department: subjectCode,
      AcademicPeriod: termCode,
    })
    const out = []
    $('section[aria-label^="Section"]').each((_, el) => {
      const parsed = parseSection($, $(el), termCode, termLabel, subjectLabel, subjectCode)
      if (parsed) out.push(parsed)
    })
    return out
  })
}

function text($el) {
  return $el.text().replace(/\s+/g, ' ').trim()
}

function parseSection($, $sec, termCode, termLabel, subjectLabel, department) {
  const heading = text($sec.closest('.accordion-item').find('.accordion-header').first())
  // "CSC 1350 COMP SCI I-MJRS" -> subject / number / title.
  const m = heading.match(/^(\S+)\s+(\S+)\s*(.*)$/)
  if (!m) return null
  const [, subjectCode, courseNumber, title] = m

  // "Section 001-LEC" -> "001-LEC". The schedule-type suffix has to stay: LSU
  // numbers a course's lecture and its lab identically ("001-LEC" / "001-LAB"),
  // so trimming it would collapse two real, differently-scheduled sections into
  // one indistinguishable row.
  const sectionNumber = ($sec.attr('aria-label') || '').replace(/^Section\s*/i, '').trim()

  // Every detail lives in a label-prefixed cell; collect them by prefix rather
  // than slicing one flattened string, so an empty field can't swallow the next.
  const cells = []
  $sec.find('div.mb-3 > span').each((_, s) => cells.push($(s)))
  const cellText = (prefix) => {
    const hit = cells.find((c) => text(c).toLowerCase().startsWith(prefix.toLowerCase()))
    return hit ? text(hit).slice(prefix.length).trim() : ''
  }

  const enrolment = text($sec).match(/Enrollment:\s*(\d+)\s*\/\s*(\d+)/)
  const current = enrolment ? Number(enrolment[1]) : null
  const max = enrolment ? Number(enrolment[2]) : null

  const instructor = cellText('Instructor:')
  const location = cellText('Location:')

  return {
    school: SCHOOL,
    termCode,
    termLabel: termLabel || '',
    subjectCode,
    subjectLabel: subjectLabel || department,
    courseNumber,
    sectionNumber,
    // Workday exposes no CRN on this page; section id is the course code plus
    // the section label, which is unique within a term.
    crn: `${subjectCode} ${courseNumber} ${sectionNumber}`,
    title: title.trim(),
    instructors: instructor ? [instructor] : [],
    credits: parseCredits(creditsOf(cells)),
    enrollment: {
      max,
      current,
      available: max != null && current != null ? Math.max(0, max - current) : null,
    },
    // The badge reads "N Seats Open"; fall back to the counts when it is absent.
    status: max == null || current == null ? 'unknown' : current < max ? 'open' : 'closed',
    meetings: parseMeetings($, cells, location),
  }
}

/**
 * The credit-hours cell is unlabelled ("3 Credit Hours"), so match its shape.
 * Variable-credit courses print a range ("1 - 3 Credit Hours") - roughly half of
 * a department's sections at LSU, since every independent-study and special-topics
 * row is variable - so the range form has to be accepted too. parseCredits keeps
 * the leading number, i.e. the low end of the range.
 */
function creditsOf(cells) {
  const hit = cells.find((c) => /^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?\s+Credit Hours/i.test(text(c)))
  return hit ? text(hit).replace(/\s*Credit Hours.*/i, '') : ''
}

const DAY_NAMES = {
  MONDAY: 'M',
  TUESDAY: 'T',
  WEDNESDAY: 'W',
  THURSDAY: 'R',
  FRIDAY: 'F',
  SATURDAY: 'S',
  SUNDAY: 'U',
}

/**
 * The "Meeting Pattern:" cell holds zero or more patterns separated by <br>,
 * each "Monday Wednesday Friday 11:30 AM - 12:20 PM".
 */
function parseMeetings($, cells, location) {
  const cell = cells.find((c) => /^Meeting Pattern:/i.test(text(c)))
  if (!cell) return []
  const chunks = (cell.html() || '')
    .split(/<br\s*\/?>/i)
    .map((part) => text(cheerio.load(`<div>${part}</div>`)('div')))
    .map((s) => s.replace(/^Meeting Pattern:\s*/i, '').trim())
    .filter(Boolean)

  const out = []
  for (const chunk of chunks) {
    const days = []
    for (const word of chunk.split(/\s+/)) {
      const day = DAY_NAMES[word.replace(/[^A-Za-z]/g, '').toUpperCase()]
      if (day) days.push(day)
    }
    const times = chunk.match(
      /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i
    )
    const startTime = times ? normalizeTime(times[1].replace(/\s+/g, '')) : null
    const endTime = times ? normalizeTime(times[2].replace(/\s+/g, '')) : null
    if (!days.length && !startTime) continue
    out.push({ days: [...new Set(days)], startTime, endTime, location })
  }
  return out
}
