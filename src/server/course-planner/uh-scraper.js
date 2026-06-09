/**
 * University of Houston scraper (PeopleSoft classic public Class Search).
 *
 * UH exposes COMMUNITY_ACCESS.CLASS_SEARCH.GBL with no login. Unlike UTA, UH's
 * subject field is a real <select> (so subjects come straight off the form) and a
 * subject alone is enough search criteria. Institution 00730 = University of
 * Houston main campus (the dropdown also lists UH-Downtown / Clear Lake etc.).
 *
 * Only open/closed status is exposed — no seat counts.
 */
import { cacheMemo } from './cache.js'
import { loadSearchForm, runClassSearch } from './peoplesoft.js'

const SCHOOL = 'uh'
const URL =
  'https://saprd.my.uh.edu/psc/saprd/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'
const INSTITUTION = '00730'

/** Read a <select>'s options into [{ code, label }]. */
function selectOptions($, namePrefix, makeLabel) {
  const out = []
  $(`select[name^="${namePrefix}"] option`).each((_, o) => {
    const code = $(o).attr('value')
    if (!code) return
    out.push({ code, label: makeLabel($(o).text().trim(), code) })
  })
  return out
}

export async function getTerms() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      const { $ } = await loadSearchForm(URL)
      return selectOptions($, 'CLASS_SRCH_WRK2_STRM', (text) => text)
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  // UH's subject list is the same regardless of term, so it's not keyed by term.
  return cacheMemo(
    `${SCHOOL}:subjects`,
    async () => {
      const { $ } = await loadSearchForm(URL)
      // Option text is "ACCT (Accounting)" — prefer the parenthetical as the label.
      return selectOptions($, 'SSR_CLSRCH_WRK_SUBJECT_SRCH', (text, code) => {
        const m = text.match(/\(([^)]+)\)\s*$/)
        return m ? m[1].trim() : text.replace(code, '').trim() || code
      })
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
        const subjName = $('select[name^="SSR_CLSRCH_WRK_SUBJECT_SRCH"]').attr('name')
        if (instName) body.set(instName, INSTITUTION)
        if (strmName) body.set(strmName, termCode)
        if (subjName) body.set(subjName, subjectCode)
        // Search all sections, not just open ones.
        $('input[name^="SSR_CLSRCH_WRK_SSR_OPEN_ONLY"]').each((_, el) =>
          body.delete($(el).attr('name'))
        )
      },
    })
  )
}
