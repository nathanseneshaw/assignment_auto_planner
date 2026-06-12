/**
 * UT Dallas scraper  server-side, runs in Express for both web and Electron clients.
 *
 * NOTE: Browser-based section search (playwright-extra + puppeteer-extra-plugin-stealth)
 * has been removed. CourseBook's search endpoint is reCAPTCHA v3 gated and cannot be
 * reached without a headless browser. getSections() returns [] as a stub.
 *
 * Still functional:
 *   getTerms()    -> [{ code, label }]
 *   getSubjects() -> [{ code, label }]    (term-independent on UTD)
 *   getSections() -> []                   (stubbed  browser automation removed)
 *
 * Caching is handled by the shared `cacheMemo`  1 h for the static term/subject dropdowns.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'

const SCHOOL = 'utd'
const BASE = 'https://coursebook.utdallas.edu'
const GUIDED_URL = `${BASE}/guidedsearch`

// ── Terms + subjects: server-rendered dropdowns, plain fetch is fine ────────

async function loadForm() {
  return cacheMemo(
    'utd:form',
    async () => {
      const res = await fetch(GUIDED_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Plannr/1.0)' },
      })
      const html = await res.text()
      const $ = cheerio.load(html)

      const terms = []
      $('#combobox_term option').each((_, el) => {
        const code = $(el).attr('value') || ''
        const label = $(el).text().trim()
        // Skip year separators and the "all terms" sentinel.
        if (!code.startsWith('term_') || code === 'term_all') return
        terms.push({ code, label })
      })

      const subjects = []
      $('#combobox_cp option').each((_, el) => {
        const cpValue = $(el).attr('value') || ''
        const text = $(el).text().trim()
        if (!cpValue.startsWith('cp_')) return
        // "CS - Computer Science" → code "CS", label "Computer Science"
        const m = text.match(/^([A-Z0-9]+)\s*-\s*(.+)$/)
        const code = m ? m[1] : cpValue.replace(/^cp_/, '').toUpperCase()
        const label = m ? m[2] : text
        subjects.push({ code, label, cpValue })
      })

      return { terms, subjects }
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  return (await loadForm()).terms
}

export async function getSubjects() {
  // UTD's subject list is the same for every term.
  return (await loadForm()).subjects.map(({ code, label }) => ({ code, label }))
}

async function findCpValue(subjectCode) {
  const { subjects } = await loadForm()
  const match = subjects.find(
    (s) => s.code.toLowerCase() === String(subjectCode).toLowerCase()
  )
  return match?.cpValue || `cp_${String(subjectCode).toLowerCase()}`
}

// ── Section search: stubbed (browser automation removed) ─────────────────────
//
// CourseBook's search endpoint is reCAPTCHA v3 gated. The playwright-extra /
// puppeteer-extra-plugin-stealth packages that previously drove a headless
// Chromium have been uninstalled. Returning an empty array keeps the rest of
// the app from crashing.

export async function getSections({ termCode, subjectCode }) {
  console.warn(
    `[utd] getSections(${termCode}, ${subjectCode})  UTD browser scraping is disabled ` +
    '(playwright-extra / puppeteer-extra-plugin-stealth removed). Returning [].'
  )
  return []
}

// ── HTML parser ─────────────────────────────────────────────────────────────
//
// Row shape (one per section)  CourseBook 11:
//   <tr class="cb-row" data-id="cs1325.001.26f">
//     <td>26F<br><span class="section-open">Open</span></td>      ← term + status
//     <td><a href="/search/cs1325.001.26f">CS 1325.001</a></td>    ← class address
//     <td style="display:none">…</td>                               ← internal id
//     <td>Introduction to Programming  (3 Semester Credit Hours)</td>
//     <td><a …>Sruthi Chappidi</a></td>                             ← instructor
//     <td>
//       <span class="clstbl__resultrow__day">Tuesday &amp; Thursday</span>
//       <span class="clstbl__resultrow__time">8:30am - 9:45am</span>
//       <div class="clstbl__resultrow__location">ECSW 1.315</div>
//     </td>
//     <td><div title="{status} - 10% Filled" …></div></td>           ← fill %

function parseSectionsHtml(html, { termCode, termLabel, subjectCode, subjectLabel }) {
  const $ = cheerio.load(html)
  const out = []

  $('tr.cb-row').each((_, tr) => {
    const $tr = $(tr)
    const addr = ($tr.attr('data-id') || '').trim()
    const parsed = parseClassAddress(addr)
    if (!parsed) return
    if (parsed.subject.toUpperCase() !== String(subjectCode).toUpperCase()) return

    const cells = $tr.find('> td').toArray().map((td) => $(td))
    const status = parseStatusCell(cells[0])
    const { title, credits } = splitTitleAndCredits(cells[3]?.text().trim() || '')
    const instructors = parseInstructors(cells[4])
    const meetings = parseScheduleCell(cells[5])
    const fillPercent = parseFillPercent(cells[6])

    out.push({
      school: SCHOOL,
      termCode,
      termLabel: termLabel || '',
      subjectCode: parsed.subject.toUpperCase(),
      subjectLabel: subjectLabel || '',
      courseNumber: parsed.number,
      sectionNumber: parsed.section,
      crn: addr,
      title: title || `${parsed.subject.toUpperCase()} ${parsed.number}`,
      instructors,
      credits,
      enrollment: { max: null, current: null, available: null, fillPercent },
      status,
      meetings,
    })
  })

  return out
}

function parseStatusCell($td) {
  if (!$td) return 'unknown'
  if ($td.find('.section-open').length) return 'open'
  if ($td.find('.section-closed, .section-full').length) return 'closed'
  if ($td.find('.section-wait, .section-waitlist').length) return 'closed'
  const t = $td.text().toLowerCase()
  if (t.includes('open')) return 'open'
  if (t.includes('closed') || t.includes('full') || t.includes('wait')) return 'closed'
  return 'unknown'
}

function splitTitleAndCredits(text) {
  if (!text) return { title: '', credits: null }
  const m = text.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\s*Semester Credit Hours\)\s*$/i)
  if (m) return { title: m[1].trim(), credits: Number(m[2]) }
  return { title: text.replace(/\s+/g, ' ').trim(), credits: null }
}

function parseInstructors($td) {
  if (!$td) return []
  const out = []
  $td.find('a').each((_, a) => {
    const name = $td.find(a).text().replace(/\s+/g, ' ').trim()
    if (name) out.push(name)
  })
  if (!out.length) {
    const text = $td.text().replace(/\s+/g, ' ').trim()
    if (text && text !== '') out.push(text)
  }
  return out
}

function parseScheduleCell($td) {
  if (!$td) return []
  const dayText = $td.find('.clstbl__resultrow__day').text().trim()
  const timeText = $td.find('.clstbl__resultrow__time').text().trim()
  const location = $td.find('.clstbl__resultrow__location').text().trim()
  if (!dayText && !timeText) return []
  const days = parseScheduleDays(dayText)
  const times = parseScheduleTime(timeText)
  if (!times) return []
  return [{ days, startTime: times.start, endTime: times.end, location }]
}

function parseScheduleDays(raw) {
  if (!raw) return []
  const s = raw.toLowerCase()
  const out = []
  if (/\bsun/.test(s)) out.push('U')
  if (/\bmon/.test(s)) out.push('M')
  if (/\btue/.test(s)) out.push('T')
  if (/\bwed/.test(s)) out.push('W')
  if (/\bthu/.test(s)) out.push('R')
  if (/\bfri/.test(s)) out.push('F')
  if (/\bsat/.test(s)) out.push('S')
  return out
}

function parseScheduleTime(raw) {
  if (!raw) return null
  const m = raw.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i)
  if (!m) return null
  return { start: to24h(m[1]), end: to24h(m[2]) }
}

function to24h(raw) {
  const m = String(raw).trim().toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2}):(\d{2})(AM|PM)$/)
  if (!m) return null
  let h = Number(m[1])
  if (m[3] === 'PM' && h !== 12) h += 12
  if (m[3] === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function parseFillPercent($td) {
  if (!$td) return null
  // Tooltip looks like "{status} - 10% Filled"  the literal "{status}" is
  // unsubstituted on UTD's side. Just extract the number.
  const title = $td.find('[title]').attr('title') || $td.attr('title') || ''
  const m = title.match(/(\d{1,3})\s*%/)
  return m ? Number(m[1]) : null
}

function parseClassAddress(addr) {
  const m = String(addr).match(/^([a-z]+)(\d+[a-z]?)\.(\d+[a-z]?)\.(\d{2}[fsu])$/i)
  if (!m) return null
  return { subject: m[1], number: m[2], section: m[3], term: m[4] }
}

/** No-op  browser singleton was removed along with playwright-extra. */
export async function close() {}
