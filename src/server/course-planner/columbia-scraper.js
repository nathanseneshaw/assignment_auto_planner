/**
 * Columbia University scraper.
 *
 * Columbia's public "Directory of Classes" (doc.sis.columbia.edu) serves plain
 * static HTML, one page per (subject, term):
 *
 *   /sel/subjects.html               → every subject + the terms it's offered in
 *   /subj/<SUBJ>/_<Term>.html        → all sections for that subject+term
 *
 * The subject page exposes call number (our CRN), points (credits), live
 * enrollment counts (e.g. "51 students (60 max)"), instructors and title — so
 * enrollment data IS available. Meeting day/time/location were moved into Vergil
 * (which needs a Columbia UNI login); the public listing leaves those columns
 * blank, so meetings come back empty. Per-section detail pages do embed one
 * meeting line in a <meta> tag, but a single subject has 200+ sections and we
 * won't fan out hundreds of requests per click.
 *
 *   Term tokens : "Fall2025" / "Spring2026" / "Summer2026"  (used verbatim in URLs)
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseCredits } from './util.js'

const SCHOOL = 'columbia'
const BASE = 'https://doc.sis.columbia.edu'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Season → digit used only for chronological sorting of term tokens.
const SEASON_ORDER = { spring: 1, summer: 2, fall: 3, winter: 0 }

/** "Fall2025" → "Fall 2025". */
function termLabelFromToken(token) {
  return token.replace(/([A-Za-z]+)(\d{4})/, '$1 $2')
}
/** "Fall2025" → 20253, for sorting terms chronologically. */
function termSortKey(token) {
  const m = token.match(/^([A-Za-z]+)(\d{4})$/)
  if (!m) return 0
  const season = SEASON_ORDER[m[1].toLowerCase()] ?? 9
  return Number(m[2]) * 10 + season
}

/**
 * Parse /sel/subjects.html once: every <tr> is `<td>Label</td><td>term links</td>`,
 * with the subject code living in each link's href (/subj/<CODE>/_<Term>.html).
 */
async function loadCatalog() {
  return cacheMemo(
    `${SCHOOL}:catalog`,
    async () => {
      const html = await (await fetch(`${BASE}/sel/subjects.html`, { headers: { 'User-Agent': UA } })).text()
      const $ = cheerio.load(html)
      const subjects = [] // { code, label, terms: [token] }
      const termTokens = new Set()

      $('tr').each((_, tr) => {
        const tds = $(tr).find('td')
        if (tds.length < 2) return
        const label = $(tds[0]).text().trim()
        if (!label) return
        let code = null
        const terms = []
        $(tds[1])
          .find('a[href*="/subj/"]')
          .each((__, a) => {
            const m = ($(a).attr('href') || '').match(/\/subj\/([^/]+)\/_([A-Za-z]+\d{4})\.html/)
            if (!m) return
            code = m[1]
            terms.push(m[2])
            termTokens.add(m[2])
          })
        if (code && terms.length) subjects.push({ code, label, terms })
      })

      const terms = [...termTokens]
        .sort((a, b) => termSortKey(a) - termSortKey(b))
        .map((token) => ({ code: token, label: termLabelFromToken(token) }))
      return { subjects, terms }
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const { terms } = await loadCatalog()
  return terms
}

export async function getSubjects(termCode) {
  const { subjects } = await loadCatalog()
  return subjects
    .filter((s) => !termCode || s.terms.includes(termCode))
    .map((s) => ({ code: s.code, label: s.label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const url = `${BASE}/subj/${encodeURIComponent(subjectCode)}/_${encodeURIComponent(termCode)}.html`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`Columbia fetch failed: HTTP ${res.status}`)
    const $ = cheerio.load(await res.text())

    const sections = []
    let course = { courseNumber: '', title: '' }

    $('table.course-listing tr').each((_, tr) => {
      const $tr = $(tr)
      const th = $tr.find('th').first()
      if (th.length) {
        // "Fall 2025 Computer Science W1004<br>INTRO-COMPUT SCI/PROG IN JAVA"
        const [head, ...rest] = (th.html() || '').split(/<br\s*\/?>/i)
        const firstLine = cheerio.load(`<x>${head}</x>`)('x').text().trim()
        const title = cheerio.load(`<x>${rest.join(' ')}</x>`)('x').text().trim()
        const courseNumber = firstLine.split(/\s+/).pop() || ''
        course = { courseNumber, title }
        return
      }

      const link = $tr.find('td a[href*="/subj/"]').first()
      if (!link.length) return
      // ".../subj/COMS/W1004-20253-001/" → [courseNum, termNum, section]
      const token = ((link.attr('href') || '').match(/\/([^/]+)\/?$/) || [])[1] || ''
      const parts = token.split('-')
      const sectionNumber =
        parts[2] || (link.text().match(/Section\s+(\S+)/i) || [])[1] || ''

      const fields = {}
      $tr.find('dl dt').each((__, dt) => {
        const key = $(dt).text().replace(/:\s*$/, '').trim()
        fields[key] = $(dt).next('dd').text().trim()
      })

      const enr = parseEnrollment(fields['Enrollment'])
      sections.push({
        school: SCHOOL,
        termCode,
        termLabel: termLabel || termLabelFromToken(termCode),
        subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber: parts[0] || course.courseNumber,
        sectionNumber,
        crn: fields['Call Number'] || '',
        title: course.title,
        instructors: parseInstructors(fields['Instructors'] || fields['Instructor']),
        credits: parseCredits(fields['Points']),
        enrollment: enr,
        status: decideStatus(enr),
        meetings: [], // meeting times live in Vergil (login-gated)
      })
    })

    return sections
  })
}

/** "51 students (60 max) as of June 21, 2026" → { current, max, available }. */
function parseEnrollment(raw) {
  const blank = { max: null, current: null, available: null }
  if (!raw) return blank
  const m = raw.match(/(\d+)\s+students?\s*\((\d+)\s*max\)/i)
  if (!m) return blank
  const current = Number(m[1])
  const max = Number(m[2])
  return { max, current, available: Math.max(0, max - current) }
}

function decideStatus({ max, available }) {
  if (max === null || available === null) return 'unknown'
  return available > 0 ? 'open' : 'closed'
}

function parseInstructors(raw) {
  if (!raw) return []
  return raw
    .split(/\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s && !/^(staff|tba|to be announced)$/i.test(s))
}
