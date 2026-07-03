/**
 * University of Texas at Tyler scraper (PeopleSoft classic public Class Search).
 *
 * UT Tyler runs the same COMMUNITY_ACCESS.CLASS_SEARCH.GBL component as UH/UTA,
 * but it is NOT reachable cold: hitting it directly 302-redirects into SAML SSO.
 * The trick (this is what the public "Guest" homepage tile does) is to first GET
 * the guest landing page, which auto-issues a guest PS_TOKEN cookie; once that's
 * in the jar the class-search form loads with no login. See bannerSessionForTerm
 * in banner-ssb.js for the analogous "warm-up then work" pattern.
 *
 * Several quirks vs UH/UTA:
 *   1. The form is <form name="win0" id="CLASS_SEARCH">, so fields must be scoped
 *      by name (form[name="win0"]) — the peoplesoft.js helpers key off #win0 and
 *      would collect nothing here, which is why this file is self-contained.
 *   2. The Subject dropdown is empty until an Academic Career is chosen, and is
 *      filtered by it. Careers: UGRD/GRAD/MEDS/PHAR/HSCT. So a search is a stateful
 *      sequence of full-page postbacks: term -> career -> Search.
 *      Terms suffixed "- SOM" are School-of-Medicine terms (medical subjects only);
 *      the plain terms (e.g. "2026 Fall") carry the ~80-subject general catalog.
 *   3. Like UTA it demands >=2 search criteria; we pair the Subject with catalog
 *      number >= 0 (which matches every course in the subject).
 *   4. The Search button must post with ICAJAX=1 (a full-page post silently
 *      swallows the query). The form's pushbutton inputs must NOT be submitted —
 *      their values ("Search"/"Clear") overflow a maxlen-1 field and abort the run.
 *   5. A broad search returns a "your search will return over 50 classes, continue?"
 *      soft warning that must be acknowledged (#ICSave) to load the results.
 *
 * The results list exposes open/closed status; seat counts are filled in by
 * walking each section's class-detail panel with the shared PeopleSoft helpers
 * (the parked results session is reused as the first walker).
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import {
  parseSearchResults,
  extractCdataHtml,
  walkSeatQueue,
  seatSessionCount,
  seatWalkAllowed,
  mapCrnToIndex,
  stateNumOf,
  icsidOf,
} from './peoplesoft.js'

const SCHOOL = 'uttyler'
const BASE = 'https://tycs-prd.utshare.utsystem.edu'
const LANDING = `${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`
const CLASS_SEARCH = `${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL`
const INSTITUTION = 'UTTYL'
// Every academic career the guest class search exposes; the Subject list is the
// union across the careers that actually offer classes in a given term.
const CAREERS = ['UGRD', 'GRAD', 'MEDS', 'PHAR', 'HSCT']
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Field selectors (PeopleSoft suffixes the ids with $N occurrence indices).
const SEL = {
  institution: 'select[id^="CLASS_SRCH_WRK2_INSTITUTION"]',
  term: 'select[id^="CLASS_SRCH_WRK2_STRM"]',
  career: 'select[id^="SSR_CLSRCH_WRK_ACAD_CAREER"]',
  subject: 'select[id^="SSR_CLSRCH_WRK_SUBJECT_SRCH"]',
  catalog: 'input[id^="SSR_CLSRCH_WRK_CATALOG_NBR"]',
  match: 'select[id^="SSR_CLSRCH_WRK_SSR_EXACT_MATCH1"]',
}
const SEARCH_BTN = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH'

/**
 * One guest browser session against the class-search component. Each instance
 * owns a cookie jar; open() does the guest warm-up + loads the form, post()
 * replays a single non-AJAX (ICAJAX=0) postback so every response is a full page
 * we can re-snapshot (the AJAX partials can't be statefully re-driven).
 */
class GuestSession {
  constructor() {
    this.cFetch = makeFetchCookie(fetch, new CookieJar())
  }

  async open() {
    await this.cFetch(LANDING, { headers: { 'User-Agent': UA } }) // issues guest PS_TOKEN
    const html = await (await this.cFetch(CLASS_SEARCH, { headers: { 'User-Agent': UA } })).text()
    this.$ = cheerio.load(html)
    if (/cmd=login|SAMLAUTH/.test(html) || !this.name(SEL.institution)) {
      throw new Error('UT Tyler guest class-search form did not load (no PS_TOKEN?)')
    }
    return this
  }

  /** The runtime field name behind a selector (ids/names carry $N suffixes). */
  name(sel) {
    return this.$(sel).attr('name')
  }

  /** Current non-empty <option>s of a <select> as [{ code, label }]. */
  options(sel) {
    const out = []
    this.$(`${sel} option`).each((_, o) => {
      const code = this.$(o).attr('value')
      if (code) out.push({ code, label: this.$(o).text().trim() })
    })
    return out
  }

  selected(sel) {
    return this.$(`${sel} option[selected]`).attr('value') || ''
  }

  /** Snapshot the win0 form into a POST body, always omitting the open-only filter. */
  snapshot() {
    const body = new URLSearchParams()
    this.$('form[name="win0"]')
      .find('input, select, textarea')
      .each((_, el) => {
        const name = this.$(el).attr('name')
        if (!name || /SSR_CLSRCH_WRK_SSR_OPEN_ONLY/.test(name)) return // never restrict to open
        const tag = el.tagName.toLowerCase()
        const type = (this.$(el).attr('type') || tag).toLowerCase()
        // Pushbuttons carry their label as a value ("Search"/"Clear") but their DB
        // field max length is 1, so submitting it trips a length error that silently
        // aborts the search. The clicked button is identified by ICAction, not value.
        if (['button', 'submit', 'image', 'reset'].includes(type)) return
        if (type === 'checkbox' || type === 'radio') {
          if (this.$(el).attr('checked') !== undefined) body.set(name, this.$(el).attr('value') || 'Y')
          return
        }
        if (tag === 'select') {
          body.set(name, this.$(el).find('option[selected]').attr('value') ?? '')
          return
        }
        body.set(name, this.$(el).attr('value') ?? '')
      })
    return body
  }

  /**
   * Replay one postback (ICAction=`action`) applying `values` overrides.
   * Navigation steps use ICAJAX=0 (a full page we can re-snapshot); the Search and
   * its warning-acknowledge pass icajax:'1' + changed:true so the component
   * actually runs the query and surfaces its soft warning.
   */
  async post(action, values = {}, { icajax = '0', changed = false } = {}) {
    const body = this.snapshot()
    for (const [k, v] of Object.entries(values)) if (k) body.set(k, v)
    body.set('ICAJAX', icajax)
    body.set('ICNAVTYPEDROPDOWN', '0')
    body.set('ICType', 'Panel')
    body.set('ICElementNum', '0')
    body.set('ICModelCancel', '0')
    body.set('ICResubmit', '0')
    body.set('ICStateNum', this.$('input[name="ICStateNum"]').attr('value') || '2')
    body.set('ICSID', this.$('input[name="ICSID"]').attr('value') || '')
    body.set('ICAction', action)
    if (changed) body.set('ICChanged', '1')
    const html = await (
      await this.cFetch(CLASS_SEARCH, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    ).text()
    this.$ = cheerio.load(html)
    return html
  }
}

/** Open a session and drive term -> career so the Subject dropdown is populated. */
async function sessionForTermCareer(termCode, career) {
  const s = await new GuestSession().open()
  const inst = s.name(SEL.institution)
  const term = s.name(SEL.term)
  await s.post(term, { [inst]: INSTITUTION, [term]: termCode })
  if (s.selected(SEL.term) !== termCode) throw new Error('term did not bind')
  const careerField = s.name(SEL.career)
  await s.post(careerField, { [inst]: INSTITUTION, [term]: termCode, [careerField]: career })
  // The career must actually bind: on a transient miss PeopleSoft keeps the prior
  // career's (often full) Subject list, which would mis-attribute every subject to
  // this career and make later searches bounce. Reject it so callers retry.
  if (s.selected(SEL.career) !== career) throw new Error('career did not bind')
  return s
}

export async function getTerms() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      const s = await new GuestSession().open()
      return s.options(SEL.term)
    },
    60 * 60 * 1000
  )
}

// term:subject -> Set(careers) learned during getSubjects, so getSections only
// searches the careers that actually offer the subject (most have just one).
const subjectCareers = new Map()
function rememberCareer(termCode, subjectCode, career) {
  const key = `${termCode}:${subjectCode}`
  if (!subjectCareers.has(key)) subjectCareers.set(key, new Set())
  subjectCareers.get(key).add(career)
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `${SCHOOL}:subjects:${termCode}`,
    async () => {
      const merged = new Map()
      const careerResults = await Promise.all(
        CAREERS.map(async (career) => {
          let subs = []
          for (let attempt = 0; attempt < 3 && !subs.length; attempt++) {
            try {
              const s = await sessionForTermCareer(termCode, career)
              subs = s.options(SEL.subject)
            } catch {
              /* transient state hiccup — retry */
            }
          }
          return { career, subs }
        })
      )
      for (const { career, subs } of careerResults) {
        for (const sub of subs) {
          if (!merged.has(sub.code)) merged.set(sub.code, sub.label)
          rememberCareer(termCode, sub.code, career)
        }
      }
      return [...merged]
        .map(([code, label]) => ({ code, label }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

/**
 * Drive one guest session all the way to a term+career+subject results page.
 * Returns { s, raw } (a live session parked on the results, plus the raw results
 * response), 'not-offered' when the career's Subject dropdown lacks the subject,
 * or null on the transient cold-session bounce (caller retries).
 */
async function openCareerResults({ termCode, subjectCode, career }) {
  let s
  try {
    s = await sessionForTermCareer(termCode, career)
  } catch {
    return null
  }
  // Subject must appear in this career's dropdown, else it's not offered here.
  if (!s.options(SEL.subject).some((o) => o.code === subjectCode)) return 'not-offered'

  const inst = s.name(SEL.institution)
  const term = s.name(SEL.term)
  const careerField = s.name(SEL.career)
  const subject = s.name(SEL.subject)
  const ctx = { [inst]: INSTITUTION, [term]: termCode, [careerField]: career }

  // Two criteria in one Search submit: Subject + catalog number >= 0 (which
  // matches every course in the subject). icajax:'1' + changed make the
  // component actually run the query — a plain full-page post silently swallows
  // it — and return its soft warning.
  const catName = s.name(SEL.catalog)
  const matchName = s.name(SEL.match)
  let html = await s.post(
    SEARCH_BTN,
    { ...ctx, [subject]: subjectCode, [matchName]: 'G', [catName]: '0' },
    { icajax: '1', changed: true }
  )

  // A broad search trips "Your search will return over 50 classes, continue?";
  // acknowledge it (#ICSave = the OK button) to load the full results page.
  if (/return over \d+ class|Student SS Warning|SSR_SS_WARNING/i.test(html)) {
    html = await s.post('#ICSave', {}, { icajax: '1' })
  }

  // A results page (or a legit "no classes found") vs a transient bounce back to
  // the entry form — only the former is parseable; retry the latter.
  if (!/SSR_CLSRSLT_WRK_GROUPBOX|SSR_CLSRCH_RSLT|did not return any|no classes found/i.test(html)) {
    return null
  }
  return { s, raw: html }
}

/** A walkSeatQueue-compatible session from a parked results response. */
function walkSessionFrom({ s, raw }) {
  return {
    cFetch: s.cFetch,
    icsid: icsidOf(raw, ''),
    stateNum: stateNumOf(raw, 2),
    crnToIndex: mapCrnToIndex(extractCdataHtml(raw)),
  }
}

/** Run one term+career+subject search, retrying the cold-session criteria bounce. */
async function searchCareer({ termCode, subjectCode, career, termLabel, subjectLabel }, maxTries = 5) {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const opened = await openCareerResults({ termCode, subjectCode, career })
    if (opened === 'not-offered') return { sections: [], results: null }
    if (!opened) continue
    const sections = parseSearchResults(opened.raw, {
      school: SCHOOL,
      termCode,
      termLabel,
      subjectLabel: subjectLabel || subjectCode,
    })
    return { sections, results: opened }
  }
  throw new Error(`UT Tyler search for ${subjectCode} (${career}) kept bouncing`)
}

// UT Tyler gets a smaller session pool than UH/UTA: every extra walk session
// costs a full guest warm-up + term/career/search drive (~6 round trips).
const MAX_WALK_SESSIONS = 4

/**
 * Walk class-detail panels for one career's sections (detail → BACK postbacks via
 * the shared PeopleSoft helper), reusing the career's parked results session as
 * the first worker and opening extra sessions for big subjects.
 */
async function fetchCareerSeats({ termCode, subjectCode, career, results, crns, sectionsByCrn }) {
  if (!seatWalkAllowed(crns.length)) return
  const queue = [...crns]
  const retried = new Set() // shared one-retry budget across workers
  const workerCount = Math.min(MAX_WALK_SESSIONS, seatSessionCount(queue.length))

  async function worker(first) {
    let opened = first ? results : null
    if (!opened) {
      opened = await openCareerResults({ termCode, subjectCode, career })
      if (!opened || opened === 'not-offered') return
    }
    await walkSeatQueue({
      url: CLASS_SEARCH,
      session: walkSessionFrom(opened),
      queue,
      sectionsByCrn,
      retried,
    })
  }

  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i === 0)))
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    // Search only the careers known to offer this subject; fall back to all if the
    // subject index is cold (getSections hit before getSubjects).
    const known = subjectCareers.get(`${termCode}:${subjectCode}`)
    const careers = known && known.size ? [...known] : CAREERS

    const byCrn = new Map()
    const crnCareer = new Map() // crn -> career whose section object won the dedup
    const careerResults = new Map() // career -> parked results session for the walk
    const settled = await Promise.allSettled(
      careers.map((career) =>
        searchCareer({ termCode, subjectCode, career, termLabel, subjectLabel })
      )
    )
    let lastErr = null
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled') {
        for (const sec of result.value.sections) {
          byCrn.set(sec.crn, sec) // dedup across careers
          crnCareer.set(sec.crn, careers[i])
        }
        if (result.value.results) careerResults.set(careers[i], result.value.results)
      } else {
        lastErr = result.reason // one flaky career shouldn't sink the others
      }
    }
    // Surface an error only if every career failed and none produced sections.
    if (!byCrn.size && lastErr) throw lastErr

    // Seat counts: walk each career's own sections (a CRN deduped away from a
    // career is walked under the career that won it).
    await Promise.all(
      careers.map((career) => {
        const crns = [...crnCareer].filter(([, c]) => c === career).map(([crn]) => crn)
        if (!crns.length) return null
        return fetchCareerSeats({
          termCode,
          subjectCode,
          career,
          results: careerResults.get(career) || null,
          crns,
          sectionsByCrn: byCrn,
        })
      })
    )

    return [...byCrn.values()]
  })
}
