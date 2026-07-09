/**
 * University of Utah scraper.
 *
 * Utah publishes its class schedule as static-ish server-rendered pages at
 * class-schedule.app.utah.edu/main/{strm}/:
 *   index.html                    -> subject links (class_list.html?subject=CS)
 *   class_list.html?subject=CS    -> one div.class-info card per section
 *
 * There is no term-list endpoint; strm codes follow PeopleSoft's
 * "1" + YY + semester-digit scheme (semester: 4 = Spring, 6 = Summer,
 * 8 = Fall — e.g. 1268 = Fall 2026; nonexistent terms 404), so getTerms
 * synthesizes this year's + next year's candidates and keeps the ones whose
 * index page exists.
 *
 * Cards carry class number (the unique id), component, units, live "Seats
 * Available" (a d-none li, but present in the markup) and a card-footer
 * time-table with <span data-day="MoWe"> + "03:00PM-04:20PM" rows. No max
 * enrollment and no instructors are published (feedback links only).
 * The host is occasionally flaky (5xx under quick repeat hits) — fetches
 * retry once.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime } from './util.js'

const BASE = 'https://class-schedule.app.utah.edu/main'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }

/** GET with one retry — the host intermittently 5xxes or serves stub pages. */
async function fetchPage(url) {
  let last
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: HEADERS })
    last = res
    if (res.ok) {
      const text = await res.text()
      if (text.length > 2000) return text
    }
  }
  if (last && !last.ok) return null // 404 = term/subject doesn't exist
  throw new Error('Utah class schedule returned an empty page')
}

const SEASON_DIGIT = { 4: 'Spring', 6: 'Summer', 8: 'Fall' }

export async function getTerms() {
  return cacheMemo(
    'utah:terms',
    async () => {
      const year = new Date().getFullYear()
      const candidates = []
      for (const y of [year, year + 1]) {
        for (const [digit, season] of Object.entries(SEASON_DIGIT)) {
          candidates.push({
            code: `1${String(y).slice(-2)}${digit}`,
            label: `${season} ${y}`,
          })
        }
      }
      const out = []
      for (const c of candidates) {
        try {
          const html = await fetchPage(`${BASE}/${c.code}/index.html`)
          if (html && html.includes('class_list.html')) out.push(c)
        } catch {
          // flaky host — skip this candidate rather than failing the list
        }
      }
      if (!out.length) throw new Error('Utah class schedule: no term index pages found')
      return out
    },
    6 * 60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `utah:subjects:${termCode}`,
    async () => {
      const html = await fetchPage(`${BASE}/${termCode}/index.html`)
      if (!html) throw new Error(`Utah term ${termCode} not found`)
      const $ = cheerio.load(html)
      const out = []
      const seen = new Set()
      $('a[href*="class_list.html?subject="]').each((_, a) => {
        const href = $(a).attr('href') || ''
        const code = decodeURIComponent((href.split('subject=')[1] || '').split('&')[0]).trim()
        if (!code || seen.has(code)) return
        seen.add(code)
        // Link text is "ACCTG - Accounting" (sometimes just the code).
        const label = $(a)
          .text()
          .replace(/\s+/g, ' ')
          .replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-\\s*`), '')
          .trim()
        out.push({ code, label: label || code })
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`utah:sections:${termCode}:${subjectCode}`, async () => {
    const html = await fetchPage(
      `${BASE}/${termCode}/class_list.html?subject=${encodeURIComponent(subjectCode)}`
    )
    if (!html) throw new Error(`Utah subject ${subjectCode} not found in term ${termCode}`)
    const $ = cheerio.load(html)

    const out = []
    $('div.class-info').each((_, card) => {
      const h3 = $(card).find('h3').first()
      const spans = h3.find('span')
      // <h3><a>CS 1400</a> - <span>001</span> <span>Intro Comp Programming</span></h3>
      const courseText = h3.find('a').first().text().replace(/\s+/g, ' ').trim()
      const courseM = courseText.match(/^([A-Z&\d ]+?)\s+(\S+)$/)
      if (!courseM) return
      const courseNumber = courseM[2]
      const sectionNumber = spans.eq(0).text().trim()
      const title = spans.eq(1).text().replace(/\s+/g, ' ').trim()

      let crn = ''
      let credits = null
      let available = null
      $(card)
        .find('li')
        .each((__, li) => {
          const text = $(li).text().replace(/\s+/g, ' ').trim()
          let m
          if ((m = text.match(/^Class Number:\s*(\d+)/))) crn = m[1]
          else if ((m = text.match(/^Units:\s*([\d.]+)/))) credits = Number(m[1])
          else if ((m = text.match(/^Seats Available:\s*(\d+)/))) available = Number(m[1])
        })
      if (!crn) return

      const meetings = []
      $(card)
        .find('span[data-day]')
        .each((__, daySpan) => {
          const days = parseDays($(daySpan).attr('data-day') || '')
          const timeText = $(daySpan)
            .closest('th')
            .find('span[data-time]')
            .first()
            .text()
            .trim() // "03:00PM-04:20PM"
          const tm = timeText.match(/(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)/i)
          if (!days.length || !tm) return
          const startTime = normalizeTime(tm[1])
          const endTime = normalizeTime(tm[2])
          if (!startTime || !endTime) return
          const location = $(daySpan)
            .closest('tr')
            .find('th')
            .last()
            .text()
            .replace(/\s+/g, ' ')
            .trim()
          meetings.push({ days, startTime, endTime, location })
        })

      out.push({
        school: 'utah',
        termCode,
        termLabel: termLabel || '',
        subjectCode,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber,
        sectionNumber,
        crn,
        title,
        instructors: [], // not published on the public schedule
        credits,
        enrollment: { max: null, current: null, available },
        status: available === null ? 'unknown' : available > 0 ? 'open' : 'closed',
        meetings,
      })
    })
    return out
  })
}
