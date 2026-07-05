/**
 * University of Illinois Urbana-Champaign scraper.
 *
 * UIUC's Course Information Suite exposes a public, key-free REST/XML API
 * (courses.illinois.edu/cisapp/explorer). The hierarchy is
 * /schedule/{year}.xml -> {year}/{season}.xml (subjects) ->
 * {season}/{SUBJ}.xml. The subject endpoint's `?mode=cascade` variant embeds
 * every course's detailedSections (meetings, instructors, enrollmentStatus)
 * in one ~1 MB document, avoiding a per-course request fan-out.
 *
 * Term codes are our own "{year}/{season}" composite (e.g. "2026/fall")
 * because the API is path-addressed, not code-addressed. Sections carry an
 * enrollmentStatus *text* ("Open", "Open (Restricted)", "Closed", ...) but no
 * seat counts, so enrollment stays null and only status is real.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays, parseCredits } from './util.js'

const API = 'https://courses.illinois.edu/cisapp/explorer'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

async function apiXml(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`UIUC API returned HTTP ${res.status}`)
  return res.text()
}

/** "Fall 2026" -> "2026/fall" (the API's path segments). */
function termPathFromLabel(label) {
  const m = String(label).match(/(Fall|Spring|Summer|Winter)\s+(\d{4})/i)
  if (!m) return null
  return `${m[2]}/${m[1].toLowerCase()}`
}

export async function getTerms() {
  return cacheMemo(
    'uiuc:terms',
    async () => {
      const year = new Date().getFullYear()
      const out = []
      // Current + next calendar year; a not-yet-published year just 404s.
      for (const y of [year, year + 1]) {
        try {
          const xml = await apiXml(`/schedule/${y}.xml`)
          const $ = cheerio.load(xml, { xmlMode: true })
          $('term').each((_, el) => {
            const label = $(el).text().trim()
            const code = termPathFromLabel(label)
            if (code) out.push({ code, label })
          })
        } catch {
          // year not published yet
        }
      }
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `uiuc:subjects:${termCode}`,
    async () => {
      const xml = await apiXml(`/schedule/${termCode}.xml`)
      const $ = cheerio.load(xml, { xmlMode: true })
      const out = []
      $('subject').each((_, el) => {
        const code = $(el).attr('id')
        if (code) out.push({ code, label: $(el).text().trim() || code })
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`uiuc:sections:${termCode}:${subjectCode}`, async () => {
    const xml = await apiXml(`/schedule/${termCode}/${encodeURIComponent(subjectCode)}.xml?mode=cascade`)
    const $ = cheerio.load(xml, { xmlMode: true })
    const out = []

    $('cascadingCourse').each((_, courseEl) => {
      const course = $(courseEl)
      // id is "CS 100" -> the number part; <label> holds the course title.
      const courseNumber = String(course.attr('id') || '').replace(/^\S+\s*/, '')
      const title = course.children('label').text().trim()
      const courseCredits = parseCredits(course.children('creditHours').text())

      course.find('detailedSection').each((__, secEl) => {
        const sec = $(secEl)
        const statusText = sec.children('enrollmentStatus').text().trim()
        const instructors = []
        const meetings = []
        sec.find('meeting').each((___, mEl) => {
          const meet = $(mEl)
          meet.find('instructor').each((____, iEl) => {
            const name = $(iEl).text().trim()
            if (name && !instructors.includes(name)) instructors.push(name)
          })
          const days = parseDays(meet.children('daysOfTheWeek').text().trim())
          const startTime = normalizeTime(meet.children('start').text().trim())
          const endTime = normalizeTime(meet.children('end').text().trim())
          if (!days.length || !startTime || !endTime) return // ARRANGED / online
          meetings.push({
            days,
            startTime,
            endTime,
            location: [meet.children('buildingName').text().trim(), meet.children('roomNumber').text().trim()]
              .filter(Boolean)
              .join(' '),
          })
        })

        out.push({
          school: 'uiuc',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber,
          sectionNumber: sec.children('sectionNumber').text().trim(),
          crn: String(sec.attr('id') || ''),
          title,
          instructors,
          credits: parseCredits(sec.children('creditHours').text()) ?? courseCredits,
          enrollment: { max: null, current: null, available: null }, // not published
          status: /^open/i.test(statusText)
            ? 'open'
            : /^closed/i.test(statusText)
              ? 'closed'
              : 'unknown',
          meetings,
        })
      })
    })

    return out
  })
}
