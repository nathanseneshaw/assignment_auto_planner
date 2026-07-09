/**
 * George Washington University scraper.
 *
 * GWU's Schedule of Classes is a public ColdFusion app (my.gwu.edu/mod/pws):
 *   GET  /                                        -> per-term subjects.cfm links (campId=1 = main campus)
 *   GET  /subjects.cfm?campId=1&termId={t}        -> courses.cfm links, one per subject
 *   GET  /courses.cfm?campId=1&termId&subjId      -> section table, paginated
 *
 * Term ids encode the season (202603 = 2026 Fall: suffix 01 Spring, 02 Summer,
 * 03 Fall), and the landing page's term links are labelled by CAMPUS, not
 * term, so labels are synthesized from the id. Section rows are
 * tr.crseRow1 (secondary/linked lab sections ride the same class); the
 * crseRow2 row under each is comments only. Multi-meeting sections join
 * locations and times with " AND " in one cell. Pages carry ~50 rows with a
 * hidden pageNum form — pages 2+ are POSTs to the same URL. STATUS is
 * OPEN / CLOSED / WAITLIST / CANCELLED text; no seat counts anywhere public.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const BASE = 'https://my.gwu.edu/mod/pws'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const MAX_PAGES = 40 // defensive cap; big subjects run ~10 pages

const TERM_SEASON = { '01': 'Spring', '02': 'Summer', '03': 'Fall' }

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`gwu returned HTTP ${res.status} for ${url}`)
  return await res.text()
}

export async function getTerms() {
  return cacheMemo(
    'gwu:terms',
    async () => {
      const html = await fetchText(`${BASE}/`)
      const $ = cheerio.load(html)
      const seen = new Set()
      const out = []
      $('a[href*="subjects.cfm"]').each((_, a) => {
        const href = $(a).attr('href') || ''
        const m = href.match(/campId=1&termId=(\d{4})(\d{2})/)
        if (!m || seen.has(m[1] + m[2])) return
        const season = TERM_SEASON[m[2]]
        if (!season) return
        seen.add(m[1] + m[2])
        out.push({ code: m[1] + m[2], label: `${season} ${m[1]}` })
      })
      return out.sort((a, b) => b.code.localeCompare(a.code))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `gwu:subjects:${termCode}`,
    async () => {
      const html = await fetchText(`${BASE}/subjects.cfm?campId=1&termId=${encodeURIComponent(termCode)}`)
      const $ = cheerio.load(html)
      const out = []
      const seen = new Set()
      $('a[href*="courses.cfm"]').each((_, a) => {
        const m = ($(a).attr('href') || '').match(/subjId=([A-Z0-9&]+)/i)
        if (!m || seen.has(m[1])) return
        seen.add(m[1])
        const label = $(a).text().replace(/\s+/g, ' ').trim()
        out.push({ code: m[1], label: label || m[1] })
      })
      return out.sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

/** Multi-meeting cells join segments with a literal <br>AND<br>, and within a
 *  segment days and times sit in separate child tags/lines ("F<br>11:45AM -
 *  01:10PM") — so segments are split on the HTML separator BEFORE text
 *  extraction (a plain .text() runs everything together: "01:10PMANDF11:45AM"),
 *  and the day/time separator is optional. */
const AND_SEP = /(?:<br\s*\/?>|\s)+AND(?:<br\s*\/?>|\s)+/i
function cellSegments(cellHtml) {
  return String(cellHtml || '')
    .split(AND_SEP)
    .map((seg) => cheerio.load(`<div>${seg}</div>`)('div').text().replace(/\s+/g, ' ').trim())
}
function parseMeetings(timesHtml, placeHtml) {
  const times = cellSegments(timesHtml)
  const places = cellSegments(placeHtml)
  const out = []
  times.forEach((t, i) => {
    const m = t.trim().match(/^([MTWRFSU]+)\s*(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)$/i)
    if (!m) return
    const days = parseDays(m[1])
    const startTime = normalizeTime(m[2])
    const endTime = normalizeTime(m[3])
    if (!days.length || !startTime || !endTime) return
    const location = (places[i] || places[0] || '').trim()
    out.push({ days, startTime, endTime, location: /^tba$/i.test(location) ? '' : location })
  })
  return out
}

function parseRows(html, { termCode, termLabel, subjectCode, subjectLabel }, sections, seenCrns) {
  const $ = cheerio.load(html)
  let added = 0
  $('tr.crseRow1').each((_, tr) => {
    const tds = $(tr).find('td').toArray()
    const cells = tds.map((td) => $(td).text().replace(/\s+/g, ' ').trim())
    if (cells.length < 10) return
    const [status, crn, course, sectionNumber, title, credits, instructor] = cells
    if (!/^\d{4,6}$/.test(crn) || seenCrns.has(crn)) return
    const cm = course.match(/^([A-Z0-9&]+)\s+(\S+)$/)
    seenCrns.add(crn)
    added++
    sections.push({
      school: 'gwu',
      termCode,
      termLabel: termLabel || '',
      subjectCode,
      subjectLabel: subjectLabel || subjectCode,
      courseNumber: cm ? cm[2] : course,
      sectionNumber,
      crn,
      title,
      instructors: instructor
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^(tba|staff)$/i.test(s)),
      credits: parseCredits(credits),
      enrollment: { max: null, current: null, available: null }, // status text only
      status: /^open$/i.test(status) ? 'open' : status ? 'closed' : 'unknown',
      meetings: parseMeetings($(tds[8]).html() || '', $(tds[7]).html() || ''),
    })
  })
  const hasNext = /javascript:nextPage\(\)/.test(html)
  return { added, hasNext }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`gwu:sections:${termCode}:${subjectCode}`, async () => {
    const url = `${BASE}/courses.cfm?campId=1&termId=${encodeURIComponent(termCode)}&subjId=${encodeURIComponent(subjectCode)}`
    const sections = []
    const seenCrns = new Set()
    const ctx = { termCode, termLabel, subjectCode, subjectLabel }

    let { added, hasNext } = parseRows(await fetchText(url), ctx, sections, seenCrns)
    for (let page = 2; hasNext && added > 0 && page <= MAX_PAGES; page++) {
      const html = await fetchText(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
        body: `pageNum=${page}`,
      })
      ;({ added, hasNext } = parseRows(html, ctx, sections, seenCrns))
    }
    return sections
  })
}
