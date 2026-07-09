/**
 * UC Irvine scraper.
 *
 * WebSoc (www.reg.uci.edu/perl/WebSoc) is UCI's venerable public Schedule of
 * Classes. The search form carries the YearTerm and Dept dropdowns, and
 * requesting `Submit=Display XML Results` returns a clean XML document per
 * department with FULL live enrollment (<sec_max_enroll>, <sec_enrolled>) and
 * status (<sec_status>OPEN/Waitl/FULL/NewOnly</sec_status>) per section.
 *
 * Times arrive in WebSoc's compact 12-hour style: " 3:30- 4:50p" (trailing
 * "p" = the END time is PM; the start shares it unless that would make the
 * meeting run backwards) or " 8:00- 9:50" with no suffix (= AM).
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays } from './util.js'

const BASE = 'https://www.reg.uci.edu/perl/WebSoc'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }

/** Load + cache the search form page (carries YearTerm and Dept selects). */
async function loadFormPage() {
  return cacheMemo(
    'uci:form',
    async () => {
      const res = await fetch(BASE, { headers: HEADERS })
      if (!res.ok) throw new Error(`UCI WebSoc returned HTTP ${res.status}`)
      return res.text()
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const $ = cheerio.load(await loadFormPage())
  const out = []
  const seen = new Set()
  $('select[name="YearTerm"] option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim() // "2026-92"
    const label = $(o).text().replace(/\s+/g, ' ').trim() // "2026 Fall Quarter"
    if (!/^\d{4}-\w{2}$/.test(code) || seen.has(code)) return
    seen.add(code)
    out.push({ code, label })
  })
  return out
}

export async function getSubjects() {
  const $ = cheerio.load(await loadFormPage())
  const out = []
  const seen = new Set()
  $('select[name="Dept"] option').each((_, o) => {
    const code = ($(o).attr('value') || '').trim()
    if (!code || code === 'ALL' || seen.has(code)) return
    seen.add(code)
    // Labels render as "COMPSCI . . . . . .Computer Science" — strip the dot leader.
    const label = $(o)
      .text()
      .replace(/\s+/g, ' ')
      .replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
      .replace(/^[\s.]+/, '')
      .trim()
    out.push({ code, label: label || code })
  })
  return out
}

/** " 3:30- 4:50p" -> { startTime, endTime } in 24h, or null for TBA. */
export function parseWebSocTime(raw) {
  const m = String(raw || '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(p)?/i)
  if (!m) return null
  let [, sh, sm, eh, em, pm] = m
  let startH = Number(sh)
  let endH = Number(eh)
  if (pm) {
    if (endH !== 12) endH += 12
    // Start shares PM unless that would put it after the end (e.g. "11:00-12:50p").
    const startPm = startH === 12 ? 12 : startH + 12
    if (startPm * 60 + Number(sm) <= endH * 60 + Number(em)) startH = startPm
  }
  const pad = (n) => String(n).padStart(2, '0')
  return { startTime: `${pad(startH)}:${sm}`, endTime: `${pad(endH)}:${em}` }
}

const STATUS_MAP = { OPEN: 'open', NEWONLY: 'open', WAITL: 'closed', FULL: 'closed' }

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`uci:sections:${termCode}:${subjectCode}`, async () => {
    const params = new URLSearchParams({
      Submit: 'Display XML Results',
      YearTerm: termCode,
      ShowComments: 'on',
      ShowFinals: 'on',
      Breadth: 'ANY',
      Dept: subjectCode,
      CourseNum: '',
      Division: 'ANY',
      CourseCodes: '',
      InstrName: '',
      CourseTitle: '',
      ClassType: 'ALL',
      Units: '',
      Days: '',
      StartTime: '',
      EndTime: '',
      MaxCap: '',
      FullCourses: 'ANY',
      FontSize: '100',
      CancelledCourses: 'Exclude',
      Bldg: '',
      Room: '',
    })
    const res = await fetch(`${BASE}?${params}`, { headers: HEADERS })
    if (!res.ok) throw new Error(`UCI WebSoc returned HTTP ${res.status}`)
    const xml = await res.text()
    const $ = cheerio.load(xml, { xmlMode: true })

    const out = []
    $('course').each((_, course) => {
      const courseNumber = String($(course).attr('course_number') || '').trim()
      const title = String($(course).attr('course_title') || '').replace(/\s+/g, ' ').trim()
      $(course)
        .find('section')
        .each((__, sec) => {
          const s = (sel) => $(sec).find(sel).first().text().trim()
          const crn = s('course_code')
          if (!crn) return
          const instructors = []
          $(sec)
            .find('sec_instructors instructor')
            .each((___, ins) => {
              const name = $(ins).text().replace(/\s+/g, ' ').trim()
              if (name && name !== 'STAFF' && !instructors.includes(name)) instructors.push(name)
            })
          const meetings = []
          $(sec)
            .find('sec_meetings sec_meet')
            .each((___, meet) => {
              const days = parseDays($(meet).find('sec_days').first().text().trim())
              const time = parseWebSocTime($(meet).find('sec_time').first().text())
              if (!days.length || !time) return // "TBA" meeting
              const bldg = $(meet).find('sec_bldg').first().text().trim()
              const room = $(meet).find('sec_room').first().text().trim()
              meetings.push({
                days,
                ...time,
                location: [bldg, room].filter((x) => x && x !== 'TBA').join(' '),
              })
            })
          const max = Number(s('sec_max_enroll'))
          const current = Number(s('sec_enrolled'))
          const hasSeats = Number.isFinite(max) && s('sec_max_enroll') !== ''
          const hasCur = Number.isFinite(current) && s('sec_enrolled') !== ''
          out.push({
            school: 'uci',
            termCode,
            termLabel: termLabel || '',
            subjectCode,
            subjectLabel: subjectLabel || subjectCode,
            courseNumber,
            sectionNumber: s('sec_num'),
            crn,
            title,
            instructors,
            credits: (() => {
              const m = s('sec_units').match(/^(\d+(?:\.\d+)?)/)
              return m ? Number(m[1]) : null
            })(),
            enrollment: {
              max: hasSeats ? max : null,
              current: hasCur ? current : null,
              available: hasSeats && hasCur ? Math.max(0, max - current) : null,
            },
            status: STATUS_MAP[s('sec_status').toUpperCase()] || 'unknown',
            meetings,
          })
        })
    })
    return out
  })
}
