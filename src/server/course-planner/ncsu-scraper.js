/**
 * NC State University scraper.
 *
 * NC State's "Course Catalog & Schedule of Classes" (coursecat) is a plain
 * public PHP app:
 *   GET  webappprd.acs.ncsu.edu/php/coursecat/              -> term <select>
 *   POST webappprd.acs.ncsu.edu/php/coursecat/subjects.php  -> {"subj_html"} per term
 *   POST webappprd.acs.ncsu.edu/php/coursecat/search.php    -> {"html": "..."} JSON
 *
 * The search accepts the bare subject prefix ("CSC"), and the returned HTML
 * carries one <section class="course"> block per course, each with an
 * <h1>CSC 110 <small>Title</small> <span class=units>Units: 3</span></h1>
 * header and a section table whose "Avail." column shows LIVE seats as
 * "Open<br/>1/60" — open seats / total seats — so full seat counts arrive in
 * a single request (current = total - open). Meetings render as a
 * ul.weekdisplay day strip (li.meet = meeting day) followed by
 * "1:30 PM - 2:45 PM" text.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseCredits } from './util.js'

const BASE = 'https://webappprd.acs.ncsu.edu/php/coursecat'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }

const DAY_ABBR = {
  sunday: 'U',
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'R',
  friday: 'F',
  saturday: 'S',
}

/** Load + cache the search form page (carries both term and subject selects). */
async function loadFormPage() {
  return cacheMemo(
    'ncsu:form',
    async () => {
      const res = await fetch(`${BASE}/`, { headers: HEADERS })
      if (!res.ok) throw new Error(`NC State coursecat returned HTTP ${res.status}`)
      return res.text()
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const $ = cheerio.load(await loadFormPage())
  const out = []
  const seen = new Set()
  $('select[name="term"] option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim()
    const label = $(o).text().trim() // "2026 Fall Term"
    if (!/^\d{4}$/.test(code) || seen.has(code)) return
    seen.add(code)
    out.push({ code, label })
  })
  return out
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `ncsu:subjects:${termCode}`,
    async () => {
      // The subject browse list loads per-term via subjects.php; entries carry
      // data-value="CSC - Computer Science". The search accepts the bare
      // prefix, so that's what we use as the code.
      const res = await fetch(`${BASE}/subjects.php`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${BASE}/`,
        },
        body: `strm=${encodeURIComponent(termCode)}`,
      })
      if (!res.ok) throw new Error(`NC State subjects returned HTTP ${res.status}`)
      const data = await res.json()
      const $ = cheerio.load(String(data.subj_html || ''))
      const out = []
      const seen = new Set()
      $('a[data-value]').each((_, a) => {
        const m = ($(a).attr('data-value') || '').match(/^([A-Z]{2,4})\s+-\s+(.+)$/)
        if (!m || seen.has(m[1])) return
        seen.add(m[1])
        out.push({ code: m[1], label: m[2].trim() })
      })
      return out
    },
    60 * 60 * 1000
  )
}

/** "Open<br/>1/60" availability cell -> enrollment + status. */
function parseAvail(cell$) {
  const statusText = cell$.find('span').first().text().trim().toLowerCase()
  const m = cell$
    .text()
    .replace(/\s+/g, ' ')
    .match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return { enrollment: { max: null, current: null, available: null }, status: 'unknown' }
  const available = Number(m[1])
  const max = Number(m[2])
  const enrollment = { max, available, current: Math.max(0, max - available) }
  // "Open" / "Reserved" (seats held for specific majors) still have takable
  // seats; "Closed" / "Waitlist" do not.
  let status = 'unknown'
  if (/closed|waitlist/.test(statusText)) status = 'closed'
  else if (/open|reserved/.test(statusText)) status = available > 0 ? 'open' : 'closed'
  return { enrollment, status }
}

/** The weekdisplay strip + "1:30 PM - 2:45 PM" text -> one meeting (or null). */
function parseMeeting($, td) {
  const days = []
  $(td)
    .find('li.meet abbr')
    .each((_, a) => {
      const day = DAY_ABBR[String($(a).attr('title') || '').split(' ')[0].toLowerCase()]
      if (day && !days.includes(day)) days.push(day)
    })
  const timeM = $(td)
    .text()
    .match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i)
  if (!days.length || !timeM) return null
  const startTime = normalizeTime(timeM[1])
  const endTime = normalizeTime(timeM[2])
  if (!startTime || !endTime) return null
  return { days, startTime, endTime }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`ncsu:sections:${termCode}:${subjectCode}`, async () => {
    const body = new URLSearchParams({
      term: termCode,
      subject: subjectCode,
      'course-inequality': '=',
      'course-number': '',
      session: '',
      start_time_inequality: '<=',
      start_time: '',
      end_time_inequality: '<=',
      end_time: '',
      instructor_name: '',
      current_strm: termCode,
    }).toString()
    const res = await fetch(`${BASE}/search.php`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/`,
      },
      body,
    })
    if (!res.ok) throw new Error(`NC State search returned HTTP ${res.status}`)
    const data = await res.json()
    const $ = cheerio.load(String(data.html || ''))

    const out = []
    $('section.course').each((_, sec) => {
      const h1 = $(sec).find('h1').first()
      const title = h1.find('small').first().text().trim()
      const credits = parseCredits((h1.find('span.units').text().match(/Units:\s*([\d.]+)/) || [])[1])
      // h1 text starts "CSC 110 ..."; take the course number after the subject.
      const headM = h1
        .text()
        .replace(/\s+/g, ' ')
        .match(/^\s*([A-Z]{2,4})\s+(\S+)/)
      if (!headM) return
      const [, subj, courseNumber] = headM

      $(sec)
        .find('table.section-table tr')
        .each((__, tr) => {
          const tds = $(tr).find('td')
          if (tds.length < 8) return // header/footer rows
          const sectionNumber = $(tds[0]).text().trim()
          const crn = $(tds[2]).text().trim()
          if (!crn || !/^\d+$/.test(crn)) return
          const { enrollment, status } = parseAvail($(tds[3]))
          const meeting = parseMeeting($, tds[4])
          const location = $(tds[5]).text().replace(/\s+/g, ' ').trim()
          const instructors = $(tds[6])
            .text()
            .split(';')
            .map((s) => s.replace(/\s+/g, ' ').trim())
            .filter((s) => s && !/^(tba|staff)$/i.test(s))
          out.push({
            school: 'ncsu',
            termCode,
            termLabel: termLabel || '',
            subjectCode: subj,
            subjectLabel: subjectLabel || subj,
            courseNumber,
            sectionNumber,
            crn,
            title,
            instructors,
            credits,
            enrollment,
            status,
            meetings: meeting
              ? [{ ...meeting, location: /^tba$/i.test(location) ? '' : location }]
              : [],
          })
        })
    })
    return out
  })
}
