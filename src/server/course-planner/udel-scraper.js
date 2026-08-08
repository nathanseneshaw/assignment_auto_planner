/**
 * University of Delaware scraper.
 *
 * UD's public Course Search (udapps.nss.udel.edu/CoursesSearch) is a plain
 * server-rendered form + results app:
 *   GET /CoursesSearch/                                      -> term + subject
 *                                                               <select> options
 *   GET /CoursesSearch/search-results?term=NNNN&subj_area_code=CISC&...
 *                                                            -> section table
 *
 * The results table carries, per section: the course token ("CISC101010" =
 * subject+course+section) with a detail link (courseid + section params), title,
 * campus, "Open seats" as "21 OF 60" (available OF capacity), credits, and the
 * meeting day/time cells (which pack multiple meetings as <br>-separated lines).
 * There is no public CRN, so `${courseid}-${section}` is the unique id. The
 * public listing has no instructor column and no room/building, so instructors
 * is always empty and meeting.location stays blank - those are UD data limits,
 * not parser gaps.
 *
 * Term codes are PeopleSoft-style strm digits (2268 = 2026 Fall); labels arrive
 * as "2026 Fall (2268)" and the term window normalizes them to "Fall 2026".
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const BASE = 'https://udapps.nss.udel.edu/CoursesSearch'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*',
}

async function getHtml(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`UD returned HTTP ${res.status}`)
  return res.text()
}

/** Terms + subjects both live in the landing page's <select>s; fetch once. */
async function landing() {
  return cacheMemo('udel:landing', async () => getHtml(`${BASE}/`), 60 * 60 * 1000)
}

export async function getTerms() {
  const $ = cheerio.load(await landing())
  const out = []
  $('select[name="term"] option').each((_, o) => {
    const code = $(o).attr('value')
    if (!code) return
    // "2026 Fall (2268)" -> drop the trailing "(code)" for a clean label.
    const label = $(o).text().replace(/\s*\(\d+\)\s*$/, '').trim()
    out.push({ code, label: label || code })
  })
  return out
}

export async function getSubjects() {
  const $ = cheerio.load(await landing())
  const out = []
  $('select[name="subj_area_code"] option').each((_, o) => {
    const code = $(o).attr('value')
    if (!code) return
    // "Accounting (ACCT)" -> "Accounting".
    const label = $(o).text().replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim()
    out.push({ code, label: label || code })
  })
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

/** Split a day/time cell's <br>-separated lines into trimmed text lines. */
function cellLines($, td) {
  return ($(td).html() || '')
    .split(/<br\s*\/?>/i)
    .map((seg) => cheerio.load(`<x>${seg}</x>`)('x').text().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** "21 OF 60" (available OF capacity) -> { max, current, available }. */
function parseSeats(text) {
  const m = String(text || '').match(/(\d+)\s*OF\s*(\d+)/i)
  if (!m) return { max: null, current: null, available: null }
  const available = Number(m[1])
  const max = Number(m[2])
  return { max, current: Math.max(0, max - available), available }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`udel:sections:${termCode}:${subjectCode}`, async () => {
    const params = new URLSearchParams({
      term: termCode,
      search_type: 'A', // all sections (not just open)
      session: '',
      text_info: '',
      campus: 'All',
      instrtn_mode: '',
      credit: '',
      geneduc: '',
      sustainable: '',
      subj_area_code: subjectCode,
      college: '',
    })
    const $ = cheerio.load(await getHtml(`${BASE}/search-results?${params}`))
    const out = []

    $('tr').each((_, tr) => {
      const courseCell = $(tr).find('td.course').first()
      const a = courseCell.find('a.coursenum').first()
      if (!a.length) return // header / spacer row

      const token = a.text().replace(/\s+/g, '').trim() // "CISC101020L"
      const href = a.attr('href') || ''
      const section = decodeURIComponent((href.match(/[?&]section=([^&]+)/) || [])[1] || '')
      const courseid = (href.match(/[?&]courseid=(\d+)/) || [])[1] || ''

      const subjM = token.match(/^([A-Za-z]+)/)
      const subj = subjM ? subjM[1] : subjectCode
      const rest = token.slice(subj.length) // "101020L"
      const courseNumber = section && rest.endsWith(section)
        ? rest.slice(0, rest.length - section.length)
        : rest.slice(0, 3)
      const sectionNumber = section || rest.slice(courseNumber.length)

      const tds = $(tr).find('td')
      const title = tds.eq(1).text().replace(/\s+/g, ' ').trim()
      const enrollment = parseSeats($(tr).find('td.openseats').text())
      const credits = parseCredits(tds.eq(4).text())

      // Day/time cells pack multi-meeting sections as <br>-separated lines.
      const dayLines = cellLines($, $(tr).find('td.day').first())
      const timeLines = cellLines($, $(tr).find('td.time').first())
      const meetings = []
      for (let i = 0; i < Math.max(dayLines.length, timeLines.length); i++) {
        const days = parseDays(dayLines[i] || '')
        const tm = String(timeLines[i] || '').match(
          /(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i
        )
        if (!days.length || !tm) continue
        const startTime = normalizeTime(tm[1])
        const endTime = normalizeTime(tm[2])
        if (startTime && endTime) meetings.push({ days, startTime, endTime, location: '' })
      }

      out.push({
        school: 'udel',
        termCode,
        termLabel: termLabel || '',
        subjectCode: subj || subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber,
        sectionNumber,
        crn: `${courseid}-${sectionNumber}`,
        title,
        instructors: [],
        credits,
        enrollment,
        status:
          enrollment.available === null
            ? 'unknown'
            : enrollment.available > 0
              ? 'open'
              : 'closed',
        meetings,
      })
    })

    return out
  })
}
