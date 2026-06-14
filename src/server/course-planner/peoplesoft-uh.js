/**
 * Factory for the UH-system PeopleSoft public Class Search.
 *
 * The University of Houston runs a single public COMMUNITY_ACCESS.CLASS_SEARCH
 * component at saprd.my.uh.edu that serves every institution in the UH System
 * (and TAMU-Victoria, which is hosted there). The term + subject dropdowns are
 * shared across institutions; only the INSTITUTION code selects which campus's
 * sections come back:
 *
 *   00730 University of Houston      (see uh-scraper.js)
 *   00784 UH-Downtown
 *   00759 UH-Clear Lake
 *   00765 Texas A&M University-Victoria
 *
 * So every campus is the same scraper with a different institution code. Like
 * the base PeopleSoft engine, results expose only Open/Closed status and meeting
 * times — no seat counts — so callers report enrollmentDataAvailable:false.
 */
import { cacheMemo } from './cache.js'
import { loadSearchForm, runClassSearch } from './peoplesoft.js'

const URL =
  'https://saprd.my.uh.edu/psc/saprd/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'

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

export function createUhSystemScraper({ school, institution }) {
  async function getTerms() {
    return cacheMemo(
      `${school}:terms`,
      async () => {
        const { $ } = await loadSearchForm(URL)
        return selectOptions($, 'CLASS_SRCH_WRK2_STRM', (text) => text)
      },
      60 * 60 * 1000
    )
  }

  async function getSubjects() {
    // The subject list is the same regardless of term, so it's not term-keyed.
    return cacheMemo(
      `${school}:subjects`,
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

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(`${school}:sections:${termCode}:${subjectCode}`, () =>
      runClassSearch({
        url: URL,
        school,
        termCode,
        termLabel,
        subjectLabel,
        applyCriteria: ($, body) => {
          const instName = $('select[name^="CLASS_SRCH_WRK2_INSTITUTION"]').attr('name')
          const strmName = $('select[name^="CLASS_SRCH_WRK2_STRM"]').attr('name')
          const subjName = $('select[name^="SSR_CLSRCH_WRK_SUBJECT_SRCH"]').attr('name')
          if (instName) body.set(instName, institution)
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

  return { getTerms, getSubjects, getSections }
}
