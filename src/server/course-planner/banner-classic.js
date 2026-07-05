/**
 * Factory for Ellucian Banner 8 "classic" self-service schedule scrapers — the
 * bwckschd.p_disp_dyn_sched flow. Several Texas schools expose this public,
 * no-login "Class Schedule Listing" (often for Texas HB 2504 compliance):
 * UTSA (asap.utsa.edu/pls/prod), UTEP (goldmine.utep.edu/prod), St Mary's
 * (appssbprd.stmarytx.edu/BPRD).
 *
 * This is a DIFFERENT system from the Banner 9 SSB JSON API in banner-ssb.js
 * (TTU/TxState/Baylor) and from PeopleSoft in peoplesoft.js (UH/UTA). It returns
 * HTML, not JSON.
 *
 * Three steps over plain HTTP. A cookie jar warm-up (GET the term-select page)
 * keeps instances that check JSESSIONID happy; the actual query is term-keyed in
 * the POST body so the calls are effectively stateless:
 *   1. GET  {base}{prefix}/bwckschd.p_disp_dyn_sched   -> <select name=p_term> term options
 *   2. POST {base}{prefix}/bwckgens.p_proc_term_date   -> <select name=sel_subj> subject options
 *   3. POST {base}{prefix}/bwckschd.p_get_crse_unsec   -> "Class Schedule Listing" HTML
 *
 * The listing carries meeting times + instructors but NO seat counts. Those live
 * on the public per-CRN detail page (bwckschd.p_disp_detail_sched), whose
 * "Registration Availability" table has Capacity / Actual / Remaining, so after
 * parsing the listing we fetch every section's detail page (bounded concurrency)
 * and fill enrollment.* from it. The bulk "Look Up Classes" page (bwskfcls) that
 * carries Cap/Act/Rem in one request is login-gated on all our schools.
 */
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `enrichSeats: false` skips the per-CRN detail-page walk. Purdue serves the
 * detail pages but rate-bans the IP after ~90 rapid hits (every response
 * becomes a 519-byte "Information Page"), and its bulk bwskfcls page is
 * login-gated - so at Purdue's subject sizes (600+ sections) there is no safe
 * public seat source and sections ship with null enrollment / unknown status.
 */
export function createBannerClassicScraper({ school, base, prefix, enrichSeats = true }) {
  const root = `${base}${prefix}`
  const schedUrl = `${root}/bwckschd.p_disp_dyn_sched`

  /** A fresh cookie-jar session warmed up by loading the term-select page. */
  async function warmSession() {
    const cFetch = makeFetchCookie(fetch, new CookieJar())
    await cFetch(schedUrl, { headers: { 'User-Agent': UA } })
    return cFetch
  }

  async function getTerms() {
    return cacheMemo(
      `${school}:terms`,
      async () => {
        const html = await (await fetch(schedUrl, { headers: { 'User-Agent': UA } })).text()
        const $ = cheerio.load(html)
        const out = []
        $('select[name="p_term"] option').each((_, o) => {
          const code = $(o).attr('value')
          if (code && /^\d{5,6}$/.test(code)) {
            out.push({ code, label: decodeEntities($(o).text()) })
          }
        })
        return out
      },
      60 * 60 * 1000
    )
  }

  async function getSubjects(termCode) {
    return cacheMemo(
      `${school}:subjects:${termCode}`,
      async () => {
        const cFetch = await warmSession()
        const html = await (
          await cFetch(`${root}/bwckgens.p_proc_term_date`, {
            method: 'POST',
            headers: {
              'User-Agent': UA,
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: schedUrl,
            },
            body: `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term=${encodeURIComponent(termCode)}`,
          })
        ).text()
        const $ = cheerio.load(html)
        const out = []
        $('select[name="sel_subj"] option').each((_, o) => {
          const code = $(o).attr('value')
          if (!code || code === '%' || code === 'dummy') return
          // Labels arrive as "Accounting" or "Accounting (ACCT)" — drop the suffix.
          const label = decodeEntities($(o).text()).replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim()
          out.push({ code, label: label || code })
        })
        return out.sort((a, b) => a.code.localeCompare(b.code))
      },
      60 * 60 * 1000
    )
  }

  function sectionSearchBody(termCode, subjectCode) {
    const p = new URLSearchParams()
    p.append('term_in', termCode)
    // Banner relies on a leading "dummy" placeholder before each real multi-value
    // field, plus a "%" wildcard for the filters we don't constrain.
    p.append('sel_subj', 'dummy')
    p.append('sel_subj', subjectCode)
    p.append('sel_day', 'dummy')
    p.append('sel_schd', 'dummy'); p.append('sel_schd', '%')
    p.append('sel_insm', 'dummy'); p.append('sel_insm', '%')
    p.append('sel_camp', 'dummy'); p.append('sel_camp', '%')
    p.append('sel_levl', 'dummy'); p.append('sel_levl', '%')
    p.append('sel_sess', 'dummy'); p.append('sel_sess', '%')
    p.append('sel_instr', 'dummy'); p.append('sel_instr', '%')
    p.append('sel_ptrm', 'dummy'); p.append('sel_ptrm', '%')
    p.append('sel_attr', 'dummy'); p.append('sel_attr', '%')
    p.append('sel_crse', '')
    p.append('sel_title', '')
    p.append('sel_from_cred', '')
    p.append('sel_to_cred', '')
    p.append('begin_hh', '0'); p.append('begin_mi', '0'); p.append('begin_ap', 'a')
    p.append('end_hh', '0'); p.append('end_mi', '0'); p.append('end_ap', 'a')
    return p.toString()
  }

  /** Seats row of the detail page's "Registration Availability" table. */
  async function fetchSeats(cFetch, termCode, crn) {
    const res = await cFetch(
      `${root}/bwckschd.p_disp_detail_sched?term_in=${encodeURIComponent(termCode)}&crn_in=${encodeURIComponent(crn)}`,
      { headers: { 'User-Agent': UA, Referer: schedUrl } }
    )
    const html = await res.text()
    // <th ...><SPAN ...>Seats</SPAN></th> <td>Capacity</td> <td>Actual</td> <td>Remaining</td>
    const m = html.match(
      />\s*Seats\s*<\/SPAN>\s*<\/th>\s*<td[^>]*>\s*(-?\d+)\s*<\/td>\s*<td[^>]*>\s*(-?\d+)\s*<\/td>\s*<td[^>]*>\s*(-?\d+)\s*<\/td>/i
    )
    if (!m) return null
    const [, max, current, available] = m.map(Number)
    return { max, current, available }
  }

  /** Fill enrollment + open/closed status from per-CRN detail pages, N at a time. */
  async function enrichWithSeats(cFetch, termCode, sections) {
    const queue = [...sections]
    async function worker() {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const seats = await fetchSeats(cFetch, termCode, s.crn)
          if (seats) {
            s.enrollment = seats
            s.status = seats.available > 0 ? 'open' : 'closed'
          }
        } catch {
          // One flaky detail page shouldn't sink the listing — leave nulls.
        }
      }
    }
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker))
  }

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(`${school}:sections:${termCode}:${subjectCode}`, async () => {
      const cFetch = await warmSession()
      const html = await (
        await cFetch(`${root}/bwckschd.p_get_crse_unsec`, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: schedUrl,
          },
          body: sectionSearchBody(termCode, subjectCode),
        })
      ).text()
      const sections = parseListing(html, { school, termCode, termLabel, subjectLabel })
      if (enrichSeats) await enrichWithSeats(cFetch, termCode, sections)
      return sections
    })
  }

  return { getTerms, getSubjects, getSections }
}

/** Parallel detail-page fetches per listing — enough to keep a big subject fast
 *  without hammering these older Banner hosts. */
const DETAIL_CONCURRENCY = 8

/** Parse a Banner "Class Schedule Listing" page into the unified Section shape. */
function parseListing(html, { school, termCode, termLabel, subjectLabel }) {
  const $ = cheerio.load(html)
  const out = []

  // Most schools mark section headers th.ddtitle; Purdue's customized skin
  // uses th.ddlabel. The strict title regex below filters out any other
  // ddlabel row headers (e.g. nothing on the listing page matches it).
  $('th.ddtitle, th.ddlabel').each((_, th) => {
    const titleText = decodeEntities($(th).find('a').first().text() || $(th).text())
    // "Principles of Accounting I - 13215 - ACC 2013 - 002"
    const m = titleText.match(/^(.*) - (\d+) - (\S+)\s+(\S+) - (\S+)$/)
    if (!m) return
    const [, title, crn, subjectCode, courseNumber, sectionNumber] = m

    const detail = $(th).closest('tr').next('tr').find('td.dddefault').first()
    const detailText = detail.text()
    const credits = parseCredits((detailText.match(/(\d+(?:\.\d+)?)\s+Credits/) || [])[1])

    const meetings = []
    detail
      .find('table.datadisplaytable')
      .first()
      .find('tr')
      .each((__, tr) => {
        const tds = $(tr).find('td.dddefault')
        if (tds.length < 7) return // header row uses th.ddheader
        const timeText = decodeEntities($(tds[1]).text())
        const dayText = decodeEntities($(tds[2]).text())
        const whereText = decodeEntities($(tds[3]).text())
        const tm = timeText.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i)
        const days = parseDays(dayText)
        if (!tm || !days.length) return // TBA / online-async meeting → not schedulable
        const startTime = normalizeTime(tm[1])
        const endTime = normalizeTime(tm[2])
        if (!startTime || !endTime) return
        const location = /^tba$/i.test(whereText) ? '' : whereText
        meetings.push({ days, startTime, endTime, location })
      })

    const instructors = parseInstructors($, detail)

    out.push({
      school,
      termCode,
      termLabel: termLabel || '',
      subjectCode,
      subjectLabel: subjectLabel || subjectCode,
      courseNumber,
      sectionNumber,
      crn,
      title,
      instructors,
      credits,
      enrollment: { max: null, current: null, available: null },
      status: 'unknown',
      meetings,
    })
  })

  return out
}

/** Pull instructor names from the meeting table's Instructors column (gathered
 *  across all meeting rows, deduped), dropping the "(P)"/"(Primary)" role tags
 *  and the e-mail link image. */
function parseInstructors($, detail) {
  const seen = new Set()
  const out = []
  detail
    .find('table.datadisplaytable')
    .first()
    .find('tr')
    .each((_, tr) => {
      const tds = $(tr).find('td.dddefault')
      if (tds.length < 7) return
      const clone = $(tds[6]).clone()
      clone.find('a, img').remove()
      const text = decodeEntities(clone.text()).replace(/\s*\([^)]*\)/g, '')
      for (const name of text.split(',').map((s) => s.trim())) {
        if (!name || /^(tba|to be announced|staff)$/i.test(name)) continue
        if (seen.has(name)) continue
        seen.add(name)
        out.push(name)
      }
    })
  return out
}
