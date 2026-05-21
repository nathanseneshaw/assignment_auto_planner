/**
 * UT Dallas scraper — server-side, runs in Express for both web and Electron clients.
 *
 * Why a browser: CourseBook's search endpoint (POST /clips/clip-cb11-hat.zog)
 * is gated by reCAPTCHA v3. Plain HTTP gets HTTP 200 with empty body because
 * the request carries no token + scores zero. Playwright + the stealth plugin
 * mints a real token on page load, which gates subsequent search calls.
 *
 * Same contract as the other scrapers:
 *   getTerms()      -> [{ code, label }]
 *   getSubjects()   -> [{ code, label }]    (term-independent on UTD)
 *   getSections({ termCode, subjectCode, termLabel?, subjectLabel? }) -> [Section]
 *
 * Caching is handled by the shared `cacheMemo` — 5 min for sections, 1 h for
 * the static term/subject dropdowns.
 */
import * as cheerio from 'cheerio'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { cacheMemo } from './cache.js'

chromium.use(StealthPlugin())

const SCHOOL = 'utd'
const BASE = 'https://coursebook.utdallas.edu'
const GUIDED_URL = `${BASE}/guidedsearch`

// ── Browser singleton ────────────────────────────────────────────────────────
// One Chromium per process; pages are short-lived. Lazily started so dev
// startup isn't blocked by a launch when nobody uses UTD.

let _browser = null
let _browserPromise = null

async function getBrowser() {
  if (_browser?.isConnected()) return _browser
  if (_browserPromise) return _browserPromise
  _browserPromise = chromium
    .launch({
      headless: true,
      // Hide the "controlled by automation" banner so reCAPTCHA v3 doesn't
      // immediately flag us. Stealth covers the rest.
      args: ['--disable-blink-features=AutomationControlled'],
    })
    .then((b) => {
      _browser = b
      b.on('disconnected', () => {
        _browser = null
      })
      return b
    })
    .finally(() => {
      _browserPromise = null
    })
  return _browserPromise
}

async function newPage() {
  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  })
  return { context, page: await context.newPage() }
}

// ── Terms + subjects: server-rendered dropdowns, plain fetch is fine ────────

async function loadForm() {
  return cacheMemo(
    'utd:form',
    async () => {
      const res = await fetch(GUIDED_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)' },
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

// ── Section search: requires the headless browser ────────────────────────────

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  const cacheKey = `utd:sections:${termCode}:${subjectCode}`
  return cacheMemo(cacheKey, async () => {
    const cpValue = await findCpValue(subjectCode)
    const html = await runGuidedSearch({ termCode, cpValue })
    if (!html) return []
    return parseSectionsHtml(html, { termCode, termLabel, subjectCode, subjectLabel })
  })
}

/** Drive the guided search form in a real Chromium page and return the
 *  inner HTML of the #sr div once results have loaded. */
async function runGuidedSearch({ termCode, cpValue }) {
  const { context, page } = await newPage()
  try {
    await page.goto(GUIDED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Let reCAPTCHA v3 mint + verify its token. The /glips/captcha.zog POST
    // is the signal that the token has been accepted server-side.
    await Promise.race([
      page.waitForResponse(
        (r) => r.url().includes('/glips/captcha.zog') && r.status() === 200,
        { timeout: 12000 }
      ),
      page.waitForTimeout(8000),
    ]).catch(() => {})

    await page.selectOption('#combobox_term', termCode)
    await page.selectOption('#combobox_cp', cpValue)

    // Fire the search. We accept any response status from the clips endpoint
    // (reCAPTCHA may downgrade the request to a non-200 on low-score runs).
    // The fallback waitForTimeout lets us read whatever #sr contains even if
    // the network request never completes (bot-blocked).
    const searchDone = Promise.race([
      page.waitForResponse(
        (r) =>
          r.url().includes('/clips/clip-cb11-hat.zog') &&
          r.request().method() === 'POST',
        { timeout: 28000 }
      ),
      page.waitForTimeout(25000),
    ]).catch(() => {})

    await page.evaluate(() => {
      if (typeof window.do_guided_search !== 'function') {
        throw new Error('do_guided_search not loaded')
      }
      window.do_guided_search()
    })
    await searchDone
    // Short settle so jQuery's success handler can swap #sr content in.
    await page.waitForTimeout(1000)

    const srHtml = await page.locator('#sr').innerHTML()
    const preview = srHtml.slice(0, 300).replace(/\s+/g, ' ')
    console.log(`[utd] #sr preview (${srHtml.length} chars): ${preview}`)
    return srHtml
  } finally {
    await context.close().catch(() => {})
  }
}

// ── HTML parser ─────────────────────────────────────────────────────────────
//
// Row shape (one per section) — CourseBook 11:
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
    if (text && text !== '—') out.push(text)
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
  // Tooltip looks like "{status} - 10% Filled" — the literal "{status}" is
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

/** Optional graceful shutdown for tests / process exit. */
export async function close() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}
