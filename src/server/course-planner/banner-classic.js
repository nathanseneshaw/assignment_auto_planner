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
 * The listing carries meeting times + instructors but NO seat counts, so
 * enrollment.* stays null and callers report enrollmentDataAvailable:false.
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

export function createBannerClassicScraper({ school, base, prefix }) {
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
      return parseListing(html, { school, termCode, termLabel, subjectLabel })
    })
  }

  return { getTerms, getSubjects, getSections }
}

/** Parse a Banner "Class Schedule Listing" page into the unified Section shape. */
function parseListing(html, { school, termCode, termLabel, subjectLabel }) {
  const $ = cheerio.load(html)
  const out = []

  $('th.ddtitle').each((_, th) => {
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
