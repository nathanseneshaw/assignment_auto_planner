/**
 * East Texas A&M University (formerly Texas A&M Commerce) scraper.
 *
 * Public ASP.NET schedule app at appsprod.tamuc.edu/Schedule.aspx. No login.
 * One HTML page per (term, department) pair; we scrape:
 *   - terms from the `ddlterm` <select>
 *   - departments from the `.navSubj` sidebar
 *   - sections by walking the course table, joining each `StandardSubHeader`
 *     section row with the following `<tr>` that carries `cInfoLinks`
 *     (meeting line + campus + building + room).
 *
 * The URL parameter is `Dept` (department), but the actual SUBJ prefix shown
 * per course can differ (e.g. the CSCI department contains COSC + CSCI
 * courses). We trust the SUBJ printed on each course header row, not the URL.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseCredits, normalizeTime } from './util.js'

const SCHOOL = 'tamuc'
const BASE = 'https://appsprod.tamuc.edu/Schedule/Schedule.aspx'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

export async function getTerms() {
  return cacheMemo(
    'tamuc:terms',
    async () => {
      const html = await fetchHtml(BASE)
      const $ = cheerio.load(html)
      const terms = []
      $('select[name$="ddlterm"] option').each((_, el) => {
        const code = $(el).attr('value')
        const label = $(el).text().trim()
        if (code) terms.push({ code, label })
      })
      return terms
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `tamuc:subjects:${termCode}`,
    async () => {
      // Friendly department names only appear in the `span.navSubj` sidebar,
      // which is only rendered on Dept-specific pages. Bootstrap by fetching
      // the Loc=MAIN tree to grab any one Dept code, then load that Dept's
      // page to read the full academic-department listing.
      const treeHtml = await fetchHtml(
        `${BASE}?Term=${encodeURIComponent(termCode)}&Loc=MAIN`
      )
      const $tree = cheerio.load(treeHtml)
      const seedCodes = []
      $tree('a[href*="Dept="]').each((_, el) => {
        const href = $tree(el).attr('href') || ''
        if (/[?&](Attr|CN)=/i.test(href)) return
        const m = href.match(/[?&]Dept=([^&"]+)/i)
        if (m) seedCodes.push(decodeURIComponent(m[1]))
      })
      if (!seedCodes.length) return []

      // Non-academic categories (Honors, QEP, PO, DC, PP) render their own
      // tiny navSubj. Academic depts render the full ~18-entry sidebar  so
      // try several seeds in parallel and keep the largest payload.
      const candidates = seedCodes.slice(0, 8)
      const results = await Promise.all(
        candidates.map(async (seed) => {
          try {
            const h = await fetchHtml(
              `${BASE}?WO=M&Term=${encodeURIComponent(termCode)}&Loc=MAIN&Dept=${encodeURIComponent(seed)}`
            )
            const $$ = cheerio.load(h)
            const out = []
            const seenLocal = new Set()
            $$('span.navSubj a.nav').each((_, el) => {
              const href = $$(el).attr('href') || ''
              const m = href.match(/[?&]Dept=([^&"]+)/i)
              if (!m) return
              const code = decodeURIComponent(m[1])
              if (seenLocal.has(code)) return
              seenLocal.add(code)
              const label = $$(el).find('span').text().trim() || code
              out.push({ code, label })
            })
            return out
          } catch {
            return []
          }
        })
      )
      // Largest set wins.
      const best = results.reduce((a, b) => (b.length > a.length ? b : a), [])
      return best.sort((a, b) => a.label.localeCompare(b.label))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(
    `tamuc:sections:${termCode}:${subjectCode}`,
    async () => {
      const url = `${BASE}?Term=${encodeURIComponent(termCode)}&Dept=${encodeURIComponent(subjectCode)}`
      const html = await fetchHtml(url)
      const $ = cheerio.load(html)

      let course = { subject: subjectCode, courseNumber: '', title: '', credits: null }
      let pendingSection = null
      const out = []

      $('div.CourseTable tr').each((_, tr) => {
        const $tr = $(tr)
        const cls = $tr.attr('class') || ''
        const tds = $tr.find('td').toArray().map((td) => $(td))

        if (cls === 'StandardRowOdd' || cls === 'StandardRowEven') {
          // LightGrey course header row: SUBJ, CourseNum, Title (+ Hours span).
          if (tds.length >= 3) {
            const subj = tds[0].text().trim()
            const num = tds[1].text().trim()
            const titleCell = tds[2].clone()
            const hoursText = titleCell.find('span.hours, div.hours').text()
            titleCell.find('span.hours, div.hours').remove()
            const title = titleCell.text().trim()
            // Course-level credit may be a range ("Hours: 0-4"); the section
            // row's own hours win when present.
            course = {
              subject: subj || subjectCode,
              courseNumber: num,
              title,
              credits: parseCredits(hoursText.replace(/Hours:\s*/i, '')),
            }
          }
          pendingSection = null
          return
        }

        if (cls === 'StandardSubHeader') {
          // Section row: Section#, CRN, Instructor (+ Hours), Max Seats, Enrolled.
          if (tds.length < 5) {
            pendingSection = null
            return
          }
          const sectionNumber = tds[0].text().trim()
          const crn = tds[1].text().trim()
          const instrCell = tds[2].clone()
          const hoursText = instrCell.find('div.hours, span.hours').text()
          instrCell.find('div.hours, span.hours').remove()
          const instructor = instrCell.text().replace(/\s+/g, ' ').trim()
          const max = toInt(tds[3].text())
          const current = toInt(tds[4].text())
          const sectionCredits = parseCredits(hoursText.replace(/Hours:\s*/i, ''))
          pendingSection = {
            school: SCHOOL,
            termCode,
            termLabel: termLabel || '',
            subjectCode: course.subject,
            subjectLabel: subjectLabel || '',
            courseNumber: course.courseNumber,
            sectionNumber,
            crn,
            title: course.title,
            instructors: instructor ? [instructor] : [],
            credits: sectionCredits ?? course.credits,
            enrollment: {
              max,
              current,
              available: max !== null && current !== null ? Math.max(0, max - current) : null,
            },
            status:
              max !== null && current !== null
                ? current >= max
                  ? 'closed'
                  : 'open'
                : 'unknown',
            meetings: [],
          }
          out.push(pendingSection)
          return
        }

        // Plain <tr> after a section row carries the meeting/campus info.
        if (!pendingSection) return
        const infoSpan = $tr.find('span.cInfoLinks')
        if (!infoSpan.length) return
        const rawHtml = infoSpan.html() || ''
        const text = $('<div>').html(rawHtml.replace(/<br\s*\/?>/gi, '\n')).text()
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
        const meetingLine = lines.find((l) =>
          /^(Mon|Tue|Wed|Thurs|Thu|Fri|Sat|Sun|Web Based)/i.test(l)
        )
        if (!meetingLine || /^Web Based/i.test(meetingLine)) return
        // "Tue, Thurs 9:30a-10:45a    Campus: Main    Building: JOUR    Room: 102"
        const m = meetingLine.match(
          /^([A-Za-z, ]+?)\s+(\d{1,2}:\d{2}[ap])\s*-\s*(\d{1,2}:\d{2}[ap])(?:\s+(.*))?$/
        )
        if (!m) return
        const days = parseTamucDays(m[1])
        const start = normalizeAmPmShort(m[2])
        const end = normalizeAmPmShort(m[3])
        const tail = m[4] || ''
        const bld = tail.match(/Building:\s*([A-Z0-9]+)/i)?.[1] || ''
        const room = tail.match(/Room:\s*([A-Z0-9]+)/i)?.[1] || ''
        const location = [bld, room].filter(Boolean).join(' ')
        if (days.length && start && end) {
          pendingSection.meetings.push({ days, startTime: start, endTime: end, location })
        }
      })
      return out
    },
    5 * 60 * 1000
  )
}

const DAY_NAME_MAP = {
  MON: 'M', TUE: 'T', WED: 'W', THU: 'R', THURS: 'R',
  FRI: 'F', SAT: 'S', SUN: 'U',
}

function parseTamucDays(raw) {
  if (!raw) return []
  const tokens = raw.split(/[,\s]+/).map((d) => d.trim().toUpperCase()).filter(Boolean)
  return [...new Set(tokens.map((d) => DAY_NAME_MAP[d]).filter(Boolean))]
}

/** "9:30a" / "12:30p" → "09:30" / "12:30". Delegates to normalizeTime once expanded. */
function normalizeAmPmShort(raw) {
  const m = String(raw).trim().match(/^(\d{1,2}:\d{2})([ap])$/i)
  if (!m) return null
  return normalizeTime(`${m[1]}${m[2].toUpperCase()}M`)
}

function toInt(v) {
  const s = String(v).trim()
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}
