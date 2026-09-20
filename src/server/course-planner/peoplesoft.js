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
import { cacheMemo } from './cache.js'
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

/**
 * The class-search form. Most instances render it as `<form id="win0">`, but
 * some name it instead and give the id to the component (Nebraska, Louisville
 * and Mizzou all serve `<form id="CLASS_SEARCH" name="win0">`), which silently
 * produced an EMPTY form snapshot - and therefore a search with no criteria -
 * until this fell back to the name.
 */
function formSelector($) {
  return $('#win0').length ? '#win0' : 'form[name="win0"]'
}

/** Snapshot every field currently in the class-search form into a POST body. */
export function buildFormBody($) {
  const body = new URLSearchParams()
  const f = formSelector($)
  $(`${f} input, ${f} select, ${f} textarea`).each((_, el) => {
    const name = $(el).attr('name')
    if (!name) return
    const tag = el.tagName.toLowerCase()
    const type = ($(el).attr('type') || tag).toLowerCase()
    // Never post the on-page buttons. PeopleSoft signals the action through
    // ICAction, and some instances render Search/Clear as <input type="button">
    // INSIDE the form, whose visible label overflows the underlying field:
    // Nebraska rejected every search with "The value for the field 'Clear'
    // (CLASS_SRCH_WRK2.SSR_PB_CLEAR) was over by 4 characters".
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') {
      return
    }
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
 * Whether a search response is a criteria bounce rather than a results page. On
 * a cold guest session PeopleSoft intermittently fails to register the criteria
 * and re-renders the entry page — re-running the whole search on a fresh session
 * clears it. A genuine no-results search returns a results page (or a "no
 * results" message) and is NOT treated as a bounce.
 *
 * Instances word the bounce differently: UH and UT Arlington say "Select at
 * least 2 search criteria", Mizzou says "Specify additional selection criteria
 * to narrow your search". Mizzou's phrasing was not matched here originally, so
 * its searches never got the retry and roughly half of them came back empty even
 * with valid criteria — the flake looked like a broken parser.
 */
function isCriteriaBounce(rawText) {
  const isResults =
    /PAGE id='SSR_CLSRCH_RSLT'/.test(rawText) ||
    extractCdataHtml(rawText).includes('SSR_CLSRSLT_WRK_GROUPBOX')
  if (isResults) return false
  return /at least \d+ search|select at least|additional selection criteria/i.test(
    extractCdataHtml(rawText)
  )
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

/**
 * Factory for the plainest flavour of the classic component: a public
 * COMMUNITY_ACCESS class search whose SUBJECT field is a <select>.
 *
 * That is the shape Nebraska-Lincoln, Louisville and Mizzou serve, and it needs
 * far less work than UT Arlington's (uta-scraper.js), where the subject is free
 * text and the list has to be walked one alphabet tab at a time. Here the terms
 * and subjects are simply the two dropdowns on the search page.
 *
 * Options:
 *  - `institution` pins the campus on multi-campus instances; single-campus
 *    nodes still send it because the component expects the field.
 *  - `subjectLookup: true` for instances whose SUBJECT is a free-text input
 *    rather than a <select> (Nevada-Reno). The list then comes from the field's
 *    lookup button, walked one alphabet tab at a time - the same trick
 *    uta-scraper.js uses, except the row ids here are stock PeopleSoft
 *    (SSR_CLSRCH_SUBJ_SUBJECT$N) rather than UT Arlington's UTA_-prefixed ones.
 *  - `byCareer: true` for instances that reject a subject-only search. Both
 *    Mizzou and Nevada-Reno bounce back to the criteria page unless a second
 *    field is set, and academic career is the one field that can be enumerated
 *    and swept exhaustively: the search runs once per career (UGRD / GRAD /
 *    LAW / ...) and the results are merged on CRN. The obvious alternative -
 *    the catalog-number row with "greater than or equal to 0", which is what UT
 *    Arlington uses - is rejected outright by both hosts, and falling back to
 *    "contains" would silently drop every course number without that digit.
 *  - `extraCriteria(form$, body)` sets anything else a school needs.
 *
 * Seat counts come from the shared class-detail walk afterwards, exactly as they
 * do for UH and UTA.
 */
export function createPeopleSoftScraper({
  school,
  url,
  institution,
  subjectLookup = false,
  byCareer = false,
  extraCriteria,
}) {
  const SEL = {
    institution: 'select[name^="CLASS_SRCH_WRK2_INSTITUTION"]',
    term: 'select[name^="CLASS_SRCH_WRK2_STRM"]',
    // Matches the <select> and the free-text <input> spelling alike.
    subject: '[name^="SSR_CLSRCH_WRK_SUBJECT"]',
    career: 'select[name*="ACAD_CAREER"]',
    openOnly: 'input[name^="SSR_CLSRCH_WRK_SSR_OPEN_ONLY"]',
  }

  /** Non-empty <option>s of a select as { code, label }. */
  function options($, selector) {
    const out = []
    $(`${selector} option`).each((_, o) => {
      const code = ($(o).attr('value') || '').trim()
      if (!code) return
      out.push({ code, label: $(o).text().replace(/\s+/g, ' ').trim() || code })
    })
    return out
  }

  async function getTerms() {
    return cacheMemo(
      `${school}:terms`,
      async () => {
        const { $ } = await loadSearchForm(url)
        return options($, SEL.term)
      },
      60 * 60 * 1000
    )
  }

  /**
   * Free-text-subject instances: click the field's lookup button, then each
   * alphabet tab, collecting the code/description pairs from every panel. ICSID
   * rotates on each ICAJAX response, so it is carried forward between posts.
   */
  async function lookupSubjects() {
    const { cFetch, $, icsid: initialIcsid } = await loadSearchForm(url)
    let currentIcsid = initialIcsid
    let stateNum = 1

    async function postAction(action) {
      const body = buildFormBody($)
      const name = $(SEL.institution).attr('name')
      if (name) body.set(name, institution)
      setIcAction(body, { icsid: currentIcsid, action, stateNum: stateNum++ })
      const html = extractCdataHtml(await postForm(cFetch, url, body))
      const next = cheerio.load(html)('input[name="ICSID"]').attr('value')
      if (next) currentIcsid = next
      return html
    }

    const out = []
    const seen = new Set()
    function collect(html) {
      const $$ = cheerio.load(html)
      $$('[id^="SSR_CLSRCH_SUBJ_SUBJECT$"]').each((_, el) => {
        const n = (($$(el).attr('id') || '').match(/\$(\d+)$/) || [])[1]
        if (n == null) return
        const code = $$(el).text().trim()
        if (!code || seen.has(code)) return
        seen.add(code)
        const label = $$(`[id="SUBJECT_TBL_DESCRFORMAL$${n}"]`).text().trim() || code
        out.push({ code, label })
      })
    }

    collect(await postAction('CLASS_SRCH_WRK2_SSR_PB_SUBJ_SRCH$0'))
    for (const letter of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') {
      collect(await postAction(`SSR_CLSRCH_WRK2_SSR_ALPHANUM_${letter}`))
    }
    return out.sort((a, b) => a.code.localeCompare(b.code))
  }

  async function getSubjects(termCode) {
    return cacheMemo(
      `${school}:subjects:${termCode}`,
      async () => {
        const subjects = subjectLookup
          ? await lookupSubjects()
          : options((await loadSearchForm(url)).$, SEL.subject)
        if (!subjects.length) throw new Error(`${school} subject list came back empty`)
        return subjects
      },
      60 * 60 * 1000
    )
  }

  /** The careers this instance offers, e.g. ['UGRD', 'GRAD', 'LAW']. */
  async function getCareers() {
    return cacheMemo(
      `${school}:careers`,
      async () => {
        const { $ } = await loadSearchForm(url)
        return options($, SEL.career).map((c) => c.code)
      },
      6 * 60 * 60 * 1000
    )
  }

  function applyCriteria($, body, { termCode, subjectCode, career }) {
    const set = (selector, value) => {
      const name = $(selector).attr('name')
      if (name) body.set(name, value)
    }
    set(SEL.institution, institution)
    set(SEL.term, termCode)
    set(SEL.subject, subjectCode)
    if (career) set(SEL.career, career)
    // "Show Open Classes Only" is checked by default on several instances and
    // would silently hide full sections, which is exactly what a planner needs
    // to see. Drop the checkbox so the search returns everything.
    $(SEL.openOnly).each((_, el) => body.delete($(el).attr('name')))
    extraCriteria?.($, body)
  }

  async function searchOnce({ termCode, subjectCode, termLabel, subjectLabel, career }) {
    const criteria = ($, body) => applyCriteria($, body, { termCode, subjectCode, career })
    const sections = await runClassSearch({
      url,
      school,
      termCode,
      termLabel,
      subjectLabel,
      applyCriteria: criteria,
    })
    await enrichSectionsWithSeats({ url, applyCriteria: criteria, sections })
    return sections
  }

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(`${school}:sections:${termCode}:${subjectCode}`, async () => {
      if (!byCareer) {
        return searchOnce({ termCode, subjectCode, termLabel, subjectLabel })
      }
      // One pass per career, merged on CRN. Most subjects sit in a single
      // career, so all but one pass usually comes back empty.
      const careers = await getCareers()
      const results = await Promise.all(
        careers.map((career) =>
          searchOnce({ termCode, subjectCode, termLabel, subjectLabel, career }).catch(() => [])
        )
      )
      const byCrn = new Map()
      for (const section of results.flat()) {
        if (!byCrn.has(section.crn)) byCrn.set(section.crn, section)
      }
      return [...byCrn.values()]
    })
  }

  return { getTerms, getSubjects, getSections }
}
