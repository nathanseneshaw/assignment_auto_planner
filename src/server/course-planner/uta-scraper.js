/**
 * University of Texas at Arlington scraper (PeopleSoft classic public Class Search).
 *
 * UTA runs the UT Share PeopleSoft instance at arcs-prd.utshare.utsystem.edu and
 * exposes COMMUNITY_ACCESS.CLASS_SEARCH.GBL with no login. Two quirks vs UH:
 *
 *   1. The subject field is FREE TEXT (no <select>), so the subject list comes
 *      from the form's subject-lookup button instead.
 *   2. UTA requires at least two search criteria, so a subject search alone is
 *      rejected. We pair the subject with "catalog number >= 0", which matches
 *      every course in the subject.
 *
 * Only open/closed status is exposed — no seat counts.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import {
  loadSearchForm,
  buildFormBody,
  setIcAction,
  postForm,
  runClassSearch,
  extractCdataHtml,
} from './peoplesoft.js'

const SCHOOL = 'uta'
const URL =
  'https://arcs-prd.utshare.utsystem.edu/psc/ARCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'
const INSTITUTION = 'UTARL'

export async function getTerms() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      const { $ } = await loadSearchForm(URL)
      const out = []
      $('select[name^="CLASS_SRCH_WRK2_STRM"] option').each((_, o) => {
        const code = $(o).attr('value')
        if (code) out.push({ code, label: $(o).text().trim() })
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `${SCHOOL}:subjects:${termCode}`,
    async () => {
      const { cFetch, $, icsid: initialIcsid } = await loadSearchForm(URL)
      const instName = $('select[name^="CLASS_SRCH_WRK2_INSTITUTION"]').attr('name')
      const strmName = $('select[name^="CLASS_SRCH_WRK2_STRM"]').attr('name')

      // Build a base POST body from the initial form, setting institution + term.
      // We reuse this snapshot for every subsequent ICAJAX post (the form fields
      // don't change between letter tabs — only ICAction / ICStateNum / ICSID do).
      function baseBody() {
        const b = buildFormBody($)
        if (instName) b.set(instName, INSTITUTION)
        if (strmName && termCode) b.set(strmName, termCode)
        return b
      }

      let currentIcsid = initialIcsid
      let stateNum = 1

      async function postLetter(action) {
        const b = baseBody()
        setIcAction(b, { icsid: currentIcsid, action, stateNum: stateNum++ })
        const raw = await postForm(cFetch, URL, b)
        const html = extractCdataHtml(raw)
        // Keep ICSID in sync — PeopleSoft rotates it on each ICAJAX response.
        const newIcsid = cheerio.load(html)('input[name="ICSID"]').attr('value')
        if (newIcsid) currentIcsid = newIcsid
        return html
      }

      function collectSubjects(html, out, seen) {
        const $$ = cheerio.load(html)
        $$('[id^="UTA_CLSRCH_SUBJ_SUBJECT$"]').each((_, el) => {
          const n = ($$(el).attr('id').match(/\$(\d+)$/) || [])[1]
          if (n == null) return
          const code = $$(el).text().trim()
          if (!code || seen.has(code)) return
          seen.add(code)
          const label = $$(`[id="SUBJECT_TBL_DESCRFORMAL$${n}"]`).text().trim() || code
          out.push({ code, label })
        })
      }

      const out = []
      const seen = new Set()

      // Initial lookup button → returns the A tab by default.
      const htmlA = await postLetter('CLASS_SRCH_WRK2_SSR_PB_SUBJ_SRCH$0')
      collectSubjects(htmlA, out, seen)

      // Click each remaining letter tab in the same session.
      for (const letter of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const html = await postLetter(`SSR_CLSRCH_WRK2_SSR_ALPHANUM_${letter}`)
        collectSubjects(html, out, seen)
      }

      if (!out.length) throw new Error('UTA subject lookup returned no subjects')
      return out.sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, () =>
    runClassSearch({
      url: URL,
      school: SCHOOL,
      termCode,
      termLabel,
      subjectLabel,
      applyCriteria: ($, body) => {
        const instName = $('select[name^="CLASS_SRCH_WRK2_INSTITUTION"]').attr('name')
        const strmName = $('select[name^="CLASS_SRCH_WRK2_STRM"]').attr('name')
        const subjName = $('input[name^="SSR_CLSRCH_WRK_SUBJECT$"]').attr('name')
        const catName = $('input[name^="SSR_CLSRCH_WRK_CATALOG_NBR"]').attr('name')
        const matchName = $('select[name^="SSR_CLSRCH_WRK_SSR_EXACT_MATCH1"]').attr('name')

        if (instName) body.set(instName, INSTITUTION)
        if (strmName) body.set(strmName, termCode)
        if (subjName) body.set(subjName, subjectCode)
        // Second criterion: catalog number >= 0 → matches every course in the subject.
        if (catName) body.set(catName, '0')
        if (matchName) body.set(matchName, 'G')
        $('input[name^="SSR_CLSRCH_WRK_SSR_OPEN_ONLY"]').each((_, el) =>
          body.delete($(el).attr('name'))
        )
      },
    })
  )
}
