/**
 * Texas Christian University scraper.
 *
 * TCU's public class search at https://classes.tcu.edu/ is a classic ASP.NET
 * WebForms page (a thin, no-login front-end over TCU's PeopleSoft CS). It is NOT
 * a Banner/PeopleSoft-helper school — it drives the usual __VIEWSTATE postback
 * dance:
 *
 *   1. GET  classes.tcu.edu                       → form + viewstate + term list
 *   2. POST __EVENTTARGET=ddlTerm (AutoPostBack)  → repopulates the term's ~150
 *                                                   subjects AND a fresh viewstate
 *   3. POST btnSearch=Search                       → the "Term Search Results" grid
 *
 * Step 2 is MANDATORY: the subject dropdown is term-dependent, so a one-shot
 * GET→search just bounces back to the entry form. The site also intermittently
 * returns an `err.aspx` "Class Search Pages are temporarily down" page (an F5
 * quirk, NOT a permanent outage), so every public call retries on a fresh session.
 *
 * Results grid columns (15): ClassNbr | Course | Note | Sec.Ses. | Type |
 * CoreCode | Title | StartDate | InstructionMode | DaysTime | Status | EnrMax |
 * RsvMax | WaitMax | CourseMatls. Paired values (enrolled/max, section/session,
 * days/time) are split by <br> inside the cell. Full enrollment data is exposed
 * (enrolled + max seats) and times are 24-hour. Instructor + credits are not in
 * the grid (they live behind a per-row syllabus link), so those stay empty/null.
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays } from './util.js'

const SCHOOL = 'tcu'
const BASE = 'https://classes.tcu.edu/'
const UA = 'Mozilla/5.0 (compatible; AssignmentAutoPlanner/1.0)'
const HEADERS = { 'User-Agent': UA }
const MAX_TRIES = 5

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** Open a fresh cookie-jar session and load the entry form (carries ASP.NET_SessionId). */
async function loadForm() {
  const jar = new CookieJar()
  const cFetch = makeFetchCookie(fetch, jar)
  const html = await (await cFetch(BASE, { headers: HEADERS })).text()
  return { cFetch, $: cheerio.load(html) }
}

const vs = ($, name) => $(`#${name}`).attr('value') || ''

/**
 * Build a postback body. We send the known fixed field set explicitly (rather
 * than snapshotting every input) because a stray submit/event field desyncs the
 * AutoPostBack. `over` patches fields; a null value deletes one.
 */
function formBody($, termCode, over = {}) {
  const body = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __VIEWSTATE: vs($, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: vs($, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: vs($, '__EVENTVALIDATION'),
    ddlTerm: termCode,
    ddlSession: 'ANY',
    ddlSubject: 'ANY',
    ddlAttribute: 'ANY',
    ddlLocation: 'ANY',
    ddlLevel: 'ANY',
    ddlDay: 'ANY',
    ddlStartTime: 'ANY',
    ddlEndtime: '2000',
    txtCrsNumber: '',
    txtSection: '',
    rbStatus: 'rbStatusAny',
    hdnShowBldg: 'Y',
  })
  for (const [k, v] of Object.entries(over)) {
    if (v === null) body.delete(k)
    else body.set(k, v)
  }
  return body
}

const postForm = (cFetch, body) =>
  cFetch(BASE, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://classes.tcu.edu',
      Referer: BASE,
    },
    body: body.toString(),
  }).then((r) => r.text())

/** GET the form, then bind a term via the ddlTerm AutoPostBack. Returns the term-bound $ (fresh viewstate + that term's subjects). */
async function bindTerm(termCode) {
  const { cFetch, $ } = await loadForm()
  const html = await postForm(
    cFetch,
    formBody($, termCode, { __EVENTTARGET: 'ddlTerm', ddlSubject: 'ANY', btnSearch: null })
  )
  return { cFetch, $: cheerio.load(html) }
}

// ---- Public contract ----

export async function getTerms() {
  return cacheMemo(
    'tcu:terms',
    async () => {
      const { $ } = await loadForm()
      const out = []
      $('#ddlTerm option').each((_, o) => {
        const code = $(o).attr('value')
        if (!code || code === 'ANY') return
        out.push({ code, label: niceTermLabel($(o).text()) })
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `tcu:subjects:${termCode}`,
    async () => {
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const { $ } = await bindTerm(termCode)
        const subs = []
        $('#ddlSubject option').each((_, o) => {
          const code = $(o).attr('value')
          if (!code || code === 'ANY') return
          // "ACCT - Accounting" → label "Accounting"
          const label = $(o).text().replace(/^\s*[A-Z0-9]+\s*-\s*/, '').trim() || code
          subs.push({ code, label })
        })
        if (subs.length) return subs
        await delay(1200)
      }
      throw new Error('TCU subjects: ddlTerm postback returned no subjects (transient)')
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(
    `tcu:sections:${termCode}:${subjectCode}`,
    async () => {
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const { cFetch, $ } = await bindTerm(termCode)
        const html = await postForm(cFetch, formBody($, termCode, { ddlSubject: subjectCode, btnSearch: 'Search' }))
        if (/temporarily down|err\.aspx/i.test(html)) {
          await delay(1200)
          continue
        }
        const $$ = cheerio.load(html)
        // A real results page is titled "... Term Search Results"; anything else
        // (the bare entry form) is a transient bounce — retry on a fresh session.
        if (!/Search Results/i.test($$('title').text())) {
          await delay(1200)
          continue
        }
        return parseSections($$, { termCode, subjectCode, termLabel, subjectLabel })
      }
      throw new Error(
        `TCU sections: classes.tcu.edu kept returning the entry form / err.aspx for ${subjectCode} (transient)`
      )
    },
    5 * 60 * 1000
  )
}

// ---- Parsing ----

function parseSections($, { termCode, subjectCode, termLabel, subjectLabel }) {
  const out = []
  $('table.results tr').each((_, tr) => {
    const tds = $(tr).find('td')
    if (tds.length < 12) return // header / spacer rows
    const crn = cellText($, tds[0])
    if (!/^\d+$/.test(crn)) return

    // "ENGL 10103" → subject + course number
    const courseCell = cellText($, tds[1])
    const cm = courseCell.match(/^([A-Za-z]{2,})\s+(\S+)$/)
    const subjCode = (cm ? cm[1] : subjectCode || '').toUpperCase()
    const courseNumber = cm ? cm[2] : courseCell

    const secLines = cellLines($, tds[3]) // ["010", "REG"]
    const enrLines = cellLines($, tds[11]) // ["<enrolled>", "<max>"]
    const current = toInt(enrLines[0])
    const max = toInt(enrLines[1])
    const available = max != null && current != null ? Math.max(0, max - current) : null
    const meeting = parseMeeting(cellLines($, tds[9]))

    out.push({
      school: SCHOOL,
      termCode,
      termLabel: termLabel || '',
      subjectCode: subjCode,
      subjectLabel: subjectLabel || '',
      courseNumber,
      sectionNumber: secLines[0] || '',
      crn,
      title: cellText($, tds[6]),
      instructors: [], // not in the results grid (behind the per-row syllabus link)
      credits: null, // not in the results grid
      enrollment: { max, current, available },
      status: mapStatus(cellText($, tds[10]), available),
      meetings: meeting ? [meeting] : [],
    })
  })
  return out
}

/** "MWF" + "14:00-15:20" (24h, split by <br>) → a meeting, or null for TBA/ARR rows. */
function parseMeeting(lines) {
  const days = lines[0] || ''
  if (!days || /^(TBA|ARR|TBD|ONLINE|WEB)/i.test(days)) return null
  const d = parseDays(days)
  if (!d.length) return null
  const m = (lines[1] || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return {
    days: d,
    startTime: `${m[1].padStart(2, '0')}:${m[2]}`,
    endTime: `${m[3].padStart(2, '0')}:${m[4]}`,
    location: lines[2] || '',
  }
}

function mapStatus(raw, available) {
  const a = String(raw).toLowerCase()
  if (a.includes('open')) return 'open'
  if (a.includes('closed') || a.includes('wait') || a.includes('full')) return 'closed'
  if (available != null) return available > 0 ? 'open' : 'closed'
  return 'unknown'
}

/** "26 Fall" → "Fall 2026" (fall back to the raw label if it doesn't match). */
function niceTermLabel(raw) {
  const s = String(raw).replace(/\s+/g, ' ').trim()
  const m = s.match(/^(\d{2})\s+(Fall|Spring|Summer|Wintersession|Winter|May(?:mester)?)$/i)
  if (!m) return s
  const season = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()
  return `${season} 20${m[1]}`
}

const cellText = ($, cell) => $(cell).text().replace(/\s+/g, ' ').trim()

/** Split a results cell on its <br> tags into trimmed, non-empty lines. */
function cellLines($, cell) {
  const html = ($(cell).html() || '').replace(/<br\s*\/?>/gi, '\n')
  return cheerio
    .load(`<d>${html}</d>`)('d')
    .text()
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function toInt(v) {
  if (v == null) return null
  const n = parseInt(String(v).trim(), 10)
  return Number.isFinite(n) ? n : null
}
