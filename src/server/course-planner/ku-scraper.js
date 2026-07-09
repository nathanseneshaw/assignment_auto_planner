/**
 * University of Kansas scraper.
 *
 * classes.ku.edu is a public Struts app. The search page's selects are
 * server-rendered (terms: "Fall 2026" = 4269; ~290 subjects), and the search
 * itself is one POST to /Classes/CourseSearch.action with plain form fields —
 * career "UndergraduateGraduate" covers the whole Lawrence/Edwards catalog and
 * searchClosed=true keeps full sections in the results.
 *
 * The results HTML is one outer table per course (h3 "EECS 101" + title +
 * "( credits )" in the header cell) holding a table.class_list whose rows come
 * in data-section triples: the main row (type, credits, class # = our CRN,
 * "Section number: N" tooltip, and a seats span whose popover title carries
 * FULL live counts — "113 students enrolled out of 420 maximum."), a
 * days/time/location row, and a hidden notes row. Instructor names and
 * buildings are login-gated ("Log in for more info"), so instructors stay
 * empty and location is the campus token that survives (e.g. "LAWRENCE").
 */
import * as cheerio from 'cheerio'
import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const BASE = 'https://classes.ku.edu'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function loadSearchPage() {
  return cacheMemo(
    'ku:home',
    async () => {
      const res = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (!res.ok) throw new Error(`ku search page returned HTTP ${res.status}`)
      const html = await res.text()
      if (!html.includes('classesSearchTerm')) {
        throw new Error('ku search page did not render the search form')
      }
      return html
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const $ = cheerio.load(await loadSearchPage())
  const out = []
  $('#classesSearchTerm option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim()
    const label = $(o).text().trim()
    if (/^\d{3,5}$/.test(code)) out.push({ code, label })
  })
  return out
}

export async function getSubjects() {
  const $ = cheerio.load(await loadSearchPage())
  const out = []
  $('#classesSearchSubject option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim()
    if (!code) return
    // Labels look like "EECS Elect Engr & Computer Science" — drop the code.
    const label = $(o).text().replace(/\s+/g, ' ').trim().replace(new RegExp(`^${code}\\s+`), '')
    out.push({ code, label: label || code })
  })
  return out
}

/**
 * "W 02:00 PM - 02:50 PM ... - LAWRENCE" (per <br>-separated line) -> meetings.
 * Day tokens come in BOTH forms: single-letter ("W") and two-letter runs
 * ("TuTh", "MoWeFr") — parseDays handles either once the run is captured.
 */
function parseMeetingCell(cellHtml) {
  const out = []
  for (const part of cellHtml.split(/<br\s*\/?>/i)) {
    const text = cheerio.load(`<div>${part}</div>`)('div').text().replace(/\s+/g, ' ').trim()
    const m = text.match(
      /^((?:Mo|Tu|We|Th|Fr|Sa|Su)+|[MTWRFSU]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*(.*)$/i
    )
    if (!m) continue
    const days = parseDays(m[1])
    const startTime = normalizeTime(m[2])
    const endTime = normalizeTime(m[3])
    if (!days.length || !startTime || !endTime) continue
    const location = m[4].replace(/^[\s-]+/, '').replace(/\s+/g, ' ').trim()
    out.push({ days, startTime, endTime, location })
  }
  return out
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`ku:sections:${termCode}:${subjectCode}`, async () => {
    // Struts pins the search to a jsessionid — warm a jar on the form page first.
    const cFetch = makeFetchCookie(fetch, new CookieJar())
    await cFetch(`${BASE}/`, { headers: { 'User-Agent': UA } })
    const res = await cFetch(`${BASE}/Classes/CourseSearch.action`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${BASE}/`,
      },
      body: new URLSearchParams({
        classesSearchText: '',
        searchCareer: 'UndergraduateGraduate',
        searchTerm: termCode,
        searchSubject: subjectCode,
        searchClosedClass: 'true',
        searchClosed: 'true',
      }).toString(),
    })
    if (!res.ok) throw new Error(`ku search returned HTTP ${res.status}`)
    const html = await res.text()
    const $ = cheerio.load(html)
    const sections = []

    $('table.class_list').each((_, tbl) => {
      // The outer per-course table holds "<h3>EECS 101</h3> Title ( credits ) Term".
      const outer = $(tbl).parents('table').last()
      const headerTd = outer.find('h3').first().parent()
      const courseCode = outer.find('h3').first().text().replace(/\s+/g, ' ').trim()
      const cm = courseCode.match(/^([A-Z0-9&]+)\s+(\S+)$/)
      const headerText = headerTd.text().replace(/\s+/g, ' ').trim()
      let title = headerText.replace(courseCode, '').trim()
      const creditM = title.match(/\(\s*([\d.]+(?:\s*-\s*[\d.]+)?)\s*\)/)
      title = title.replace(/\(\s*[\d.]+(?:\s*-\s*[\d.]+)?\s*\).*$/, '').trim()
      const courseCredits = parseCredits(creditM?.[1])

      // Rows come in data-section groups: main row, meeting row, hidden notes row.
      const bySection = new Map()
      $(tbl)
        .find('tr[data-section]')
        .each((__, tr) => {
          const id = $(tr).attr('data-section')
          if (!bySection.has(id)) bySection.set(id, [])
          bySection.get(id).push(tr)
        })

      for (const [crn, trs] of bySection) {
        let sectionNumber = ''
        let type = ''
        let enrollment = { max: null, current: null, available: null }
        let status = 'unknown'
        const meetings = []
        for (const tr of trs) {
          if ($(tr).attr('style')?.includes('display:none')) continue
          const strong = $(tr).find('strong[title^="Section number"]').first()
          if (strong.length) {
            sectionNumber = (strong.attr('title') || '').replace(/^Section number:\s*/, '').trim()
            type = $(tr).find('td').first().text().trim()
            const seatSpan = $(tr).find('span.avail_open, span.avail_closed').first()
            if (seatSpan.length) {
              status = seatSpan.hasClass('avail_open') ? 'open' : 'closed'
              // Popover title: "113 students enrolled out of 420 maximum."
              const t = (seatSpan.attr('title') || '').match(/(\d+)\s+students enrolled out of\s+(\d+)/)
              if (t) {
                const current = Number(t[1])
                const max = Number(t[2])
                enrollment = { max, current, available: Math.max(0, max - current) }
              }
            }
            continue
          }
          const meetTd = $(tr).find('td[colspan]').first()
          if (meetTd.length) meetings.push(...parseMeetingCell(meetTd.html() || ''))
        }
        if (!sectionNumber && !type) continue // stray row group (notes-only)
        sections.push({
          school: 'ku',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber: cm ? cm[2] : courseCode,
          sectionNumber: type ? `${type} ${sectionNumber}` : sectionNumber,
          crn,
          title,
          instructors: [], // login-gated on the public page
          credits: courseCredits,
          enrollment,
          status,
          meetings,
        })
      }
    })
    return sections
  })
}
