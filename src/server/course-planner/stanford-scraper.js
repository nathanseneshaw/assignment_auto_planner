/**
 * Stanford University scraper.
 *
 * Stanford runs the public "ExploreCourses" catalog. With the `view=xml-20200810`
 * parameter it serves a clean, no-login XML document for any keyword query; a
 * companion `?view=xml-20200810` (no query) returns the school/department index
 * used for the subject list. The site bootstraps via JavaScript, so every request
 * must carry a `jsenabled=1` cookie or it just returns a redirect stub.
 *
 * ExploreCourses exposes full enrollment (numEnrolled / maxEnrolled / enrollStatus)
 * plus meeting times and instructors, so enrollmentDataAvailable is true.
 *
 * A search returns every term in the academic year, so the term code we hand out
 * is the compound "academicYear:termId" (e.g. "20252026:1262"); getSections splits
 * it to re-query the right year and keep only sections matching that termId.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseCredits } from './util.js'

const BASE = 'https://explorecourses.stanford.edu'
const VIEW = 'xml-20200810'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const DAY_NAMES = {
  monday: 'M', tuesday: 'T', wednesday: 'W', thursday: 'R',
  friday: 'F', saturday: 'S', sunday: 'U',
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: 'jsenabled=1' } })
  if (!res.ok) throw new Error(`ExploreCourses returned HTTP ${res.status}`)
  return cheerio.load(await res.text(), { xmlMode: true })
}

function searchUrl(query, academicYear) {
  const p = new URLSearchParams({
    view: VIEW,
    q: query,
    'filter-coursestatus-Active': 'on',
  })
  if (academicYear) p.set('academicYear', academicYear)
  return `${BASE}/search?${p.toString()}`
}

/** Stanford reports "10:30:00 AM"; drop the seconds so normalizeTime can read it. */
function stanfordTime(raw) {
  return normalizeTime(String(raw || '').replace(/(\d{1,2}:\d{2}):\d{2}/, '$1'))
}

function parseDayNames(text) {
  return [
    ...new Set(
      String(text || '')
        .split(/\s+/)
        .map((w) => DAY_NAMES[w.trim().toLowerCase()])
        .filter(Boolean)
    ),
  ]
}

export async function getTerms() {
  // Harvest the academic year's terms from a department that runs every quarter.
  return cacheMemo(
    'stanford:terms',
    async () => {
      const $ = await fetchXml(searchUrl('CS', ''))
      const seen = new Map()
      $('section').each((_, s) => {
        const termId = $(s).find('termId').first().text().trim()
        const term = $(s).find('term').first().text().trim() // "2025-2026 Autumn"
        const year = $(s).find('year').first().text().trim() || term.split(' ')[0]
        if (!termId || seen.has(termId)) return
        const academicYear = year.replace(/-/g, '')
        seen.set(termId, { code: `${academicYear}:${termId}`, label: term })
      })
      const order = ['Autumn', 'Winter', 'Spring', 'Summer']
      return [...seen.values()].sort(
        (a, b) =>
          order.findIndex((q) => a.label.includes(q)) -
          order.findIndex((q) => b.label.includes(q))
      )
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  return cacheMemo(
    'stanford:subjects',
    async () => {
      const $ = await fetchXml(`${BASE}/?view=${VIEW}`)
      const out = []
      const seen = new Set()
      $('department').each((_, d) => {
        const code = $(d).attr('name')
        const label = $(d).attr('longname') || code
        if (!code || seen.has(code)) return
        seen.add(code)
        out.push({ code, label })
      })
      return out.sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  const [academicYear, termId] = String(termCode).split(':')
  return cacheMemo(`stanford:sections:${termCode}:${subjectCode}`, async () => {
    const $ = await fetchXml(searchUrl(subjectCode, academicYear))
    const out = []

    $('course').each((_, c) => {
      const $c = $(c)
      // q is a fuzzy keyword search; keep only courses the department actually owns.
      if ($c.find('subject').first().text().trim() !== subjectCode) return
      const courseNumber = $c.find('code').first().text().trim()
      const title = $c.find('title').first().text().trim()
      const credits =
        parseCredits($c.find('unitsMin').first().text()) ??
        parseCredits($c.find('unitsMax').first().text())

      $c.find('sections > section').each((__, s) => {
        const $s = $(s)
        if ($s.find('termId').first().text().trim() !== termId) return

        const meetings = []
        const instructors = new Set()
        $s.find('schedules > schedule').each((___, sch) => {
          const $sch = $(sch)
          const days = parseDayNames($sch.find('days').first().text())
          const startTime = stanfordTime($sch.find('startTime').first().text())
          const endTime = stanfordTime($sch.find('endTime').first().text())
          const location = $sch.find('location').first().text().trim()
          if (days.length && startTime && endTime) {
            meetings.push({ days, startTime, endTime, location })
          }
          $sch.find('instructor > name').each((____, n) => {
            const name = $(n).text().trim()
            if (name) instructors.add(name)
          })
        })

        const max = Number($s.find('maxEnrolled').first().text()) || null
        const current = Number($s.find('numEnrolled').first().text())
        const enrollStatus = $s.find('enrollStatus').first().text().trim().toLowerCase()

        out.push({
          school: 'stanford',
          termCode,
          termLabel: termLabel || $s.find('term').first().text().trim(),
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber,
          sectionNumber: $s.find('sectionNumber').first().text().trim(),
          crn: $s.find('classId').first().text().trim(),
          title,
          instructors: [...instructors],
          credits,
          enrollment: {
            max,
            current: Number.isFinite(current) ? current : null,
            available: max != null && Number.isFinite(current) ? Math.max(0, max - current) : null,
          },
          status: enrollStatus === 'open' ? 'open' : enrollStatus ? 'closed' : 'unknown',
          meetings,
        })
      })
    })

    return out
  })
}
