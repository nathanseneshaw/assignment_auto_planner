/**
 * Shared helpers for Oracle PeopleSoft Campus Solutions "classic" Class Search.
 *
 * Several schools expose a public, no-login class search via the
 * COMMUNITY_ACCESS.CLASS_SEARCH.GBL component (UH, UT Arlington). They share an
 * identical results page, so the parser lives here; the per-school differences
 * (host, institution code, how the subject field works) live in the school files.
 *
 * The classic component is an ICAJAX form: GET the page to obtain ICSID + the
 * current field values, then POST back with `ICAction` set to the Search button.
 * The response is an XML envelope whose CDATA blocks contain the results HTML.
 *
 * The results list exposes only an Open / Closed / Wait List status per section.
 * Seat COUNTS live one click deeper: posting ICAction=MTG_CLASSNAME$N opens row
 * N's class-detail panel, whose "Class Availability" box carries
 * SSR_CLS_DTL_WRK_ENRL_CAP / _ENRL_TOT / _AVAILABLE_SEATS. Only IC bookkeeping
 * fields are needed for that postback (no form snapshot), but the walk is
 * stateful: detail → BACK → next detail, with ICStateNum advancing each post and
 * no way to jump detail-to-detail. enrichSectionsWithSeats() therefore fans the
 * CRN list out over a few parallel guest sessions, each re-running the search and
 * walking its share of the queue.
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
import { parseDays, normalizeTime } from './util.js'

export const PS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Open a fresh cookie-jar session and load the class-search form page. */
export async function loadSearchForm(componentUrl) {
  const jar = new CookieJar()
  const cFetch = makeFetchCookie(fetch, jar)
  const html = await (await cFetch(componentUrl, { headers: { 'User-Agent': PS_UA } })).text()
  const $ = cheerio.load(html)
  const icsid = $('input[name="ICSID"]').attr('value') || ''
  return { cFetch, $, icsid }
}

/** Snapshot every field currently in the #win0 form into a POST body. */
export function buildFormBody($) {
  const body = new URLSearchParams()
  $('#win0 input, #win0 select, #win0 textarea').each((_, el) => {
    const name = $(el).attr('name')
    if (!name) return
    const tag = el.tagName.toLowerCase()
    const type = ($(el).attr('type') || tag).toLowerCase()
    if (type === 'checkbox' || type === 'radio') {
      if ($(el).attr('checked') !== undefined) body.set(name, $(el).attr('value') || 'Y')
      return
    }
    if (tag === 'select') {
      body.set(name, $(el).find('option[selected]').attr('value') ?? '')
      return
    }
    body.set(name, $(el).attr('value') ?? '')
  })
  return body
}

/** Set the ICAJAX bookkeeping fields needed for any classic postback. */
export function setIcAction(body, { icsid, action, stateNum = 1 }) {
  body.set('ICAJAX', '1')
  body.set('ICNAVTYPEDROPDOWN', '0')
  body.set('ICType', 'Panel')
  body.set('ICElementNum', '0')
  body.set('ICStateNum', String(stateNum))
  body.set('ICModelCancel', '0')
  body.set('ICResubmit', '0')
  body.set('ICSID', icsid)
  body.set('ICAction', action)
}

/** POST a form body to a classic component and return the raw response text. */
export async function postForm(cFetch, componentUrl, body) {
  const res = await cFetch(componentUrl, {
    method: 'POST',
    headers: { 'User-Agent': PS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  return await res.text()
}

/**
 * Whether a search response is the "Select at least N search criteria" bounce
 * rather than a results page. On a cold guest session PeopleSoft intermittently
 * fails to register the criteria and re-renders the entry page — re-running the
 * whole search on a fresh session clears it. A genuine no-results search returns
 * a results page (or a "no results" message) and is NOT treated as a bounce.
 */
function isCriteriaBounce(rawText) {
  const isResults =
    /PAGE id='SSR_CLSRCH_RSLT'/.test(rawText) ||
    extractCdataHtml(rawText).includes('SSR_CLSRSLT_WRK_GROUPBOX')
  if (isResults) return false
  return /at least \d+ search|select at least/i.test(extractCdataHtml(rawText))
}

/**
 * Run a classic class search, retrying on the cold-session criteria bounce.
 *
 * `applyCriteria(form$, body)` sets the school-specific fields (institution,
 * term, subject, …) on the POST body. Each attempt uses a fresh session.
 */
export async function runClassSearch({
  url,
  school,
  termCode,
  termLabel = '',
  subjectLabel = '',
  applyCriteria,
  maxTries = 5,
}) {
  let lastText = ''
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const { cFetch, $, icsid } = await loadSearchForm(url)
    const body = buildFormBody($)
    setIcAction(body, { icsid, action: 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH' })
    applyCriteria($, body)
    lastText = await postForm(cFetch, url, body)
    if (!isCriteriaBounce(lastText)) break
  }
  return parseSearchResults(lastText, { school, termCode, termLabel, subjectLabel })
}

/** Pull the concatenated HTML out of a PeopleSoft XML/CDATA response (pass-through if already HTML). */
export function extractCdataHtml(text) {
  if (!text.includes('<![CDATA[')) return text
  let html = ''
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  let m
  while ((m = re.exec(text))) html += m[1] + '\n'
  return html
}

/**
 * Parse a classic class-search results response into the unified Section shape.
 *
 * Results are grouped by course: `SSR_CLSRSLT_WRK_GROUPBOX2GP$K` holds the
 * "SUBJ 1234 - Title" header, and each section's fields are addressed by a global
 * index N: MTG_CLASS_NBR$N (the class number = our CRN), MTG_CLASSNAME$N
 * ("01-LEC ..."), MTG_DAYTIME$N, MTG_ROOM$N, MTG_INSTR$N, plus a status icon in
 * DERIVED_CLSRCH_SSR_STATUS_LONG$N. A section with split meetings repeats its
 * class number across rows, so we merge rows that share a CRN.
 */
export function parseSearchResults(rawText, { school, termCode, termLabel = '', subjectLabel = '' }) {
  const $ = cheerio.load(extractCdataHtml(rawText))
  const byCrn = new Map()

  $('div[id^="win0divSSR_CLSRSLT_WRK_GROUPBOX2$"]').each((_, group) => {
    const $g = $(group)
    const header = $g
      .find('[id^="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$"]')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
    // "ACCT 2301 - Principles of Financial Accounting"
    const hm = header.match(/^([A-Z]{2,6})\s+(\S+)\s*-\s*(.+)$/)
    const subjectCode = hm ? hm[1] : ''
    const courseNumber = hm ? hm[2] : ''
    const title = hm ? hm[3].trim() : header

    $g.find('[id^="MTG_CLASS_NBR$"]').each((__, el) => {
      const id = $(el).attr('id') || ''
      if (id.includes('$span$')) return // the span duplicate — skip
      const n = (id.match(/\$(\d+)$/) || [])[1]
      if (n == null) return
      const crn = $(el).text().trim()
      if (!/^\d+$/.test(crn)) return

      const classname = $g.find(`[id="MTG_CLASSNAME$${n}"]`).text().replace(/\s+/g, ' ').trim()
      const sectionNumber = (classname.match(/^(\S+?)-/) || [])[1] || classname.split(/\s/)[0] || ''
      const daytime = $g.find(`[id="MTG_DAYTIME$${n}"]`).text().replace(/\s+/g, ' ').trim()
      const room = $g.find(`[id="MTG_ROOM$${n}"]`).text().replace(/\s+/g, ' ').trim()
      const instr = $g.find(`[id="MTG_INSTR$${n}"]`).text().replace(/\s+/g, ' ').trim()
      const statusAlt =
        $g.find(`[id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${n}"] img`).attr('alt') || ''

      const meeting = parseMeeting(daytime, room)

      const existing = byCrn.get(crn)
      if (existing) {
        // Same section, another meeting pattern (lecture + lab, etc.).
        if (meeting) existing.meetings.push(meeting)
        return
      }
      byCrn.set(crn, {
        school,
        termCode,
        termLabel,
        subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber,
        sectionNumber,
        crn,
        title,
        instructors: parseInstructors(instr),
        credits: null, // not shown on the results list (would need per-class detail)
        enrollment: { max: null, current: null, available: null },
        status: mapStatus(statusAlt),
        meetings: meeting ? [meeting] : [],
      })
    })
  })

  return [...byCrn.values()]
}

/** "MoWe 1:00PM - 2:30PM" + "MH 118" → a meeting, or null for TBA/arranged rows. */
function parseMeeting(daytime, room) {
  if (!daytime || /^TBA/i.test(daytime)) return null
  const m = daytime.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)$/i)
  if (!m) return null
  const days = parseDays(m[1])
  const startTime = normalizeTime(m[2])
  const endTime = normalizeTime(m[3])
  if (!days.length || !startTime || !endTime) return null
  return { days, startTime, endTime, location: room || '' }
}

// ---- Seat counts via the class-detail walk ------------------------------------

// Politeness bounds: a subject with more sections than this keeps null seats
// (the walk would mean 500+ postbacks); otherwise we aim for ~a dozen sections
// per parallel session.
const MAX_SEAT_SECTIONS = 250
const SEATS_PER_SESSION = 12
const MAX_SEAT_SESSIONS = 6

/** ICStateNum from a classic ICAJAX XML response (PS advances it every post). */
export function stateNumOf(rawText, fallback) {
  const m = rawText.match(/<FIELD id=['"]ICStateNum['"]><!\[CDATA\[(\d+)/)
  return m ? Number(m[1]) : fallback
}

/** PS occasionally rotates ICSID; re-read it from a response (XML FIELD or form
 *  input, either attribute order) and keep the fallback when absent. */
export function icsidOf(text, fallback) {
  const m =
    text.match(/<FIELD id=['"]ICSID['"]><!\[CDATA\[([^\]]+)/) ||
    text.match(/name=['"]ICSID['"][^>]*value=['"]([^'"]+)['"]/) ||
    text.match(/value=['"]([^'"]+)['"][^>]*name=['"]ICSID['"]/)
  return m ? m[1] : fallback
}

/** crn -> grid row index N (first row wins; split meetings repeat the CRN). */
export function mapCrnToIndex(html) {
  const $ = cheerio.load(html)
  const byCrn = new Map()
  $('[id^="MTG_CLASS_NBR$"]').each((_, el) => {
    const id = $(el).attr('id') || ''
    if (id.includes('$span$')) return
    const n = (id.match(/\$(\d+)$/) || [])[1]
    const crn = $(el).text().trim()
    if (n != null && /^\d+$/.test(crn) && !byCrn.has(crn)) byCrn.set(crn, n)
  })
  return byCrn
}

function detailSeats(html) {
  const grab = (field) => {
    const m = html.match(new RegExp(`id=['"]SSR_CLS_DTL_WRK_${field}['"][^>]*>\\s*([\\d,]+)`))
    return m ? Number(m[1].replace(/,/g, '')) : null
  }
  const max = grab('ENRL_CAP')
  const current = grab('ENRL_TOT')
  const available = grab('AVAILABLE_SEATS')
  if (max == null && current == null && available == null) return null
  return { max, current, available }
}

/** POST an IC-bookkeeping-only action (detail open / back) and return raw text. */
async function postAction(cFetch, url, { icsid, action, stateNum }) {
  const body = new URLSearchParams()
  setIcAction(body, { icsid, action, stateNum })
  return postForm(cFetch, url, body)
}

/**
 * Drain a shared CRN queue on one live results session: for each CRN, open its
 * class-detail panel (MTG_CLASSNAME$N), read the Class Availability numbers into
 * the matching section, and post BACK. `session` is { cFetch, icsid, stateNum,
 * crnToIndex } positioned on a results page. Stops (without throwing) as soon as
 * the session state looks broken, so other workers can drain the remainder.
 */
export async function walkSeatQueue({ url, session, queue, sectionsByCrn, retried = new Set() }) {
  // A worker that dies mid-CRN puts that CRN back (once) so a healthy worker
  // can pick it up instead of silently dropping its seats.
  const requeue = (crn) => {
    if (retried.has(crn)) return
    retried.add(crn)
    queue.push(crn)
  }
  for (let crn = queue.shift(); crn != null; crn = queue.shift()) {
    const idx = session.crnToIndex.get(crn)
    if (idx == null) continue
    try {
      const rawDetail = await postAction(session.cFetch, url, {
        icsid: session.icsid,
        action: `MTG_CLASSNAME$${idx}`,
        stateNum: session.stateNum,
      })
      session.stateNum = stateNumOf(rawDetail, session.stateNum + 1)
      session.icsid = icsidOf(rawDetail, session.icsid)

      const seats = detailSeats(extractCdataHtml(rawDetail))
      if (seats) {
        const section = sectionsByCrn.get(crn)
        section.enrollment = seats
        if (section.status === 'unknown' && seats.available != null) {
          section.status = seats.available > 0 ? 'open' : 'closed'
        }
      }

      const rawBack = await postAction(session.cFetch, url, {
        icsid: session.icsid,
        action: 'CLASS_SRCH_WRK2_SSR_PB_BACK',
        stateNum: session.stateNum,
      })
      session.stateNum = stateNumOf(rawBack, session.stateNum + 1)
      session.icsid = icsidOf(rawBack, session.icsid)
      if (!seats) {
        requeue(crn)
        return // state is suspect — stop this worker, others drain the queue
      }
    } catch {
      requeue(crn)
      return // dead session: abandon this worker, the rest of the queue survives
    }
  }
}

/** How many parallel walk sessions a queue of N sections warrants. */
export function seatSessionCount(n) {
  return Math.min(MAX_SEAT_SESSIONS, Math.max(1, Math.ceil(n / SEATS_PER_SESSION)))
}

/** Whether a section list is small enough to walk seat details for. */
export function seatWalkAllowed(n) {
  return n > 0 && n <= MAX_SEAT_SECTIONS
}

/**
 * Fill `enrollment` on already-parsed sections by walking each one's class-detail
 * panel. Spawns a few parallel sessions, each re-running the same search (via
 * `applyCriteria`, exactly as runClassSearch did) and then draining a shared CRN
 * queue with detail → BACK postback pairs. Individual failures leave that
 * section's enrollment null; they never fail the caller.
 */
export async function enrichSectionsWithSeats({ url, applyCriteria, sections }) {
  const sectionsByCrn = new Map(sections.map((s) => [s.crn, s]))
  const queue = sections.map((s) => s.crn).filter(Boolean)
  if (!seatWalkAllowed(queue.length)) return
  const retried = new Set() // shared one-retry budget across workers

  async function openResultsSession() {
    // Same cold-session bounce retry as runClassSearch, per worker session.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { cFetch, $, icsid } = await loadSearchForm(url)
      const body = buildFormBody($)
      setIcAction(body, { icsid, action: 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH' })
      applyCriteria($, body)
      const raw = await postForm(cFetch, url, body)
      const html = extractCdataHtml(raw)
      if (html.includes('SSR_CLSRSLT_WRK_GROUPBOX')) {
        return {
          cFetch,
          icsid: icsidOf(raw, icsid),
          stateNum: stateNumOf(raw, 2),
          crnToIndex: mapCrnToIndex(html),
        }
      }
    }
    return null
  }

  async function worker() {
    const session = await openResultsSession()
    if (!session) return
    await walkSeatQueue({ url, session, queue, sectionsByCrn, retried })
  }

  await Promise.all(Array.from({ length: seatSessionCount(queue.length) }, worker))
}

/** Instructors are comma-separated "First Last" names; drop placeholders. */
function parseInstructors(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^(staff|to be announced|tba)$/i.test(s))
}

function mapStatus(alt) {
  const a = String(alt).toLowerCase()
  if (a.includes('open')) return 'open'
  if (a.includes('closed') || a.includes('wait')) return 'closed'
  return 'unknown'
}
