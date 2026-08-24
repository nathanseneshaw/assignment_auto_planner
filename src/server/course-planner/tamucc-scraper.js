/**
 * Texas A&M University-Corpus Christi scraper.
 *
 * A&M-Corpus Christi's SAIL portal is login-gated, but the registrar publishes
 * the whole schedule through a small public PHP app at
 * banner.tamucc.edu/schedule (Texas HB 2504 "Public Access to Course
 * Information"). One POST per subject returns a single table carrying
 * everything we need — CRN, course, title, live seats, instructor, meeting time
 * and room — so there is no per-section detail walk.
 *
 * Form fields (from the landing page):
 *   frmTerm    term code, e.g. 202609 = Fall Full Term 2026
 *   frmGroup   course-type filter; "one" = All Courses
 *   frmPrefix  the subject option VALUE, which is "CODE-Label" ("ACCT-Accounting")
 *   frmCampus  left empty (its select ships with no options)
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays, parseCredits } from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const SCHOOL = 'tamucc'
const FORM_URL = 'https://banner.tamucc.edu/schedule/'
const SEARCH_URL = 'https://banner.tamucc.edu/schedule/BPROD.php'

async function loadForm() {
  return cacheMemo(
    `${SCHOOL}:form`,
    async () => {
      const res = await fetch(FORM_URL, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`TAMUCC schedule form returned HTTP ${res.status}`)
      return cheerio.load(await res.text())
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const $ = await loadForm()
  const out = []
  $('select[name="frmTerm"] option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim()
    const label = $(o).text().replace(/\s+/g, ' ').trim()
    if (!code || !/^\d{6}$/.test(code)) return
    out.push({ code, label })
  })
  // Every season also has "Fall 1 / Fall 2 Online Mini-Term" codes listed BEFORE
  // the real one; their labels clean to the same Season+Year and would shadow
  // the full term in the term-window dedup.
  const full = out.filter((t) => /full term/i.test(t.label))
  return full.length ? full : out
}

/** The subject <select>'s raw option values ("ACCT-Accounting"), keyed by code. */
async function subjectOptions() {
  return cacheMemo(
    `${SCHOOL}:subject-options`,
    async () => {
      const $ = await loadForm()
      const out = []
      $('select[name="frmPrefix"] option').each((_, o) => {
        const value = ($(o).attr('value') || '').trim()
        // "" = placeholder, "SelectCourseSelected" = the All Subjects entry.
        if (!value || !value.includes('-')) return
        const code = value.slice(0, value.indexOf('-')).trim()
        const label = value.slice(value.indexOf('-') + 1).trim()
        if (!code) return
        out.push({ code, label: label || code, value })
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  const opts = await subjectOptions()
  return opts
    .map(({ code, label }) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * "TR 09:30-10:45AM" → one meeting. Only the END time carries the meridiem, so
 * the start inherits it and flips to the other half of the day when that would
 * make the class run backwards ("TR 11:00-12:15PM" is 11am-12:15pm).
 */
function parseMeeting(timeText, location) {
  const m = String(timeText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*([AaPp][Mm])$/)
  if (!m) return null
  const days = parseDays(m[1])
  if (!days.length) return null
  const suffix = m[4].toUpperCase()
  const endTime = normalizeTime(`${m[3]}${suffix}`)
  let startTime = normalizeTime(`${m[2]}${suffix}`)
  if (!startTime || !endTime) return null
  if (startTime >= endTime) {
    const flipped = normalizeTime(`${m[2]}${suffix === 'PM' ? 'AM' : 'PM'}`)
    if (flipped && flipped < endTime) startTime = flipped
  }
  return { days, startTime, endTime, location }
}

/** "33 / 95 / 5" → { max: 95, current: 62, available: 33 }; waitlist ignored. */
function parseSeats(text) {
  const m = String(text || '').match(/(-?\d+)\s*\/\s*(-?\d+)/)
  if (!m) return { max: null, current: null, available: null }
  const available = Number(m[1])
  const max = Number(m[2])
  // Available goes negative when a section is over-enrolled, so current can
  // legitimately exceed capacity.
  return { max, current: max - available, available }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const opts = await subjectOptions()
    const opt = opts.find((o) => o.code === subjectCode)
    if (!opt) throw new Error(`TAMUCC has no subject "${subjectCode}"`)

    const body = new URLSearchParams({
      frmTerm: termCode,
      frmGroup: 'one', // All Courses
      frmPrefix: opt.value,
      frmCampus: '',
    })
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: FORM_URL,
      },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`TAMUCC section search returned HTTP ${res.status}`)
    const $ = cheerio.load(await res.text())

    const out = []
    $('tr').each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get()
      if (cells.length < 14) return
      const crn = cells[0]
      if (!/^\d{4,6}$/.test(crn)) return // header / spacer rows

      // "ACCT-2301.002" → subject, course number, section number.
      const course = cells[1].match(/^([A-Z]+)\s*-\s*([\w]+)\.([\w]+)$/i)
      if (!course) return

      const instructor = cells[9]
      const meeting = parseMeeting(cells[10], /^tba$/i.test(cells[11]) ? '' : cells[11])
      const enrollment = parseSeats(cells[6])

      out.push({
        school: SCHOOL,
        termCode,
        termLabel: termLabel || '',
        subjectCode: course[1].toUpperCase(),
        subjectLabel: subjectLabel || subjectCode,
        courseNumber: course[2],
        sectionNumber: course[3],
        crn,
        title: cells[4],
        instructors: instructor && !/^(tba|staff)$/i.test(instructor) ? [instructor] : [],
        credits: parseCredits(cells[13]),
        enrollment,
        status:
          enrollment.available == null ? 'unknown' : enrollment.available > 0 ? 'open' : 'closed',
        meetings: meeting ? [meeting] : [],
      })
    })
    return out
  })
}
