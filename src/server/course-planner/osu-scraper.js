/**
 * Ohio State University scraper.
 *
 * classes.osu.edu is a thin front-end over a fully public JSON API at
 * content.osu.edu/v2/classes/search (no key, no cookies). Query params:
 * q (text), campus=col (Columbus), term, subject, p (page). The response
 * carries the matching courses (each with its sections inline) plus faceted
 * "filters" - the Term and Subject facets of an unfiltered search double as
 * our term and subject lists, so one cached call serves both getTerms and
 * getSubjects.
 *
 * Sections expose enrollmentStatus (Open/Closed) and enrollmentTotal (current
 * enrollment) but NO capacity anywhere (facilityCapacity is the room's size,
 * not the class cap), so like Yale it's status + current only. Meetings use
 * per-day booleans + "11:30 am" strings; instructors hang off each meeting.
 * Pages hold 200 courses; big subjects loop p=1..totalPages.
 *
 * There is NO subject-list endpoint (verified against the SPA bundle and the
 * community API docs): the UI only ever shows the top-10 subject facet. So
 * getSubjects sweeps the whole term's course pages sorted by subject and
 * collects the distinct codes. Any single query is capped at 10,000 items /
 * 50 pages, so the sweep partitions by academic-career and, for careers over
 * the cap (ugrd/grad), sweeps ascending to the cap and descending for the
 * remainder - together touching every course exactly once (~130 requests,
 * 8-way concurrent, cached 6 h per term).
 */
import { cacheMemo } from './cache.js'
import { daysFromBooleans, normalizeTime, parseCredits } from './util.js'

const API = 'https://content.osu.edu/v2/classes/search'
const CAMPUS = 'col'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

async function apiGet(params) {
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Ohio State API returned HTTP ${res.status}`)
  const json = await res.json()
  if (!json?.data) throw new Error('Ohio State API returned no data')
  return json.data
}

export async function getTerms() {
  return cacheMemo(
    'osu:terms',
    async () => {
      const data = await apiGet(`q=&campus=${CAMPUS}`)
      const items =
        (data.filters || []).find((f) => f.slug === 'term')?.items || []
      return items.map((i) => ({ code: i.term, label: i.title }))
    },
    60 * 60 * 1000
  )
}

const PAGE_ITEMS = 200 // fixed server page size
const QUERY_CAP = 10_000 // hard cap on items/pages any one query exposes
const SWEEP_CONCURRENCY = 8

/** Collect distinct subjects from one sorted career sweep. */
function collectSubjects(data, into) {
  for (const wrapper of data.courses || []) {
    const code = String(wrapper.course?.subject || '').toLowerCase() // param is lowercase
    if (!code || into.has(code)) continue
    into.set(code, wrapper.sections?.[0]?.subjectDesc || wrapper.course.subject)
  }
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `osu:subjects:${termCode}`,
    async () => {
      // Career counts must come from THIS term or the sweep could under-cover.
      const termData = await apiGet(`q=&campus=${CAMPUS}&term=${encodeURIComponent(termCode)}`)
      const careers = (
        (termData.filters || []).find((f) => f.slug === 'academic-career')?.items || []
      ).map((i) => ({ code: i.term, count: i.count }))
      // Every (career, sort-direction, page) tuple to fetch. Careers above the
      // query cap get the tail via a descending sweep of the remainder.
      const jobs = []
      for (const c of careers) {
        const ascPages = Math.ceil(Math.min(c.count, QUERY_CAP) / PAGE_ITEMS)
        for (let p = 1; p <= ascPages; p++) jobs.push({ career: c.code, sort: 'subject', p })
        if (c.count > QUERY_CAP) {
          const descPages = Math.ceil((c.count - QUERY_CAP) / PAGE_ITEMS)
          for (let p = 1; p <= descPages; p++) jobs.push({ career: c.code, sort: '-subject', p })
        }
      }
      const subjects = new Map()
      const queue = [...jobs]
      async function worker() {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const data = await apiGet(
            `q=&campus=${CAMPUS}&term=${encodeURIComponent(termCode)}&academic-career=${encodeURIComponent(job.career)}&sort=${job.sort}&p=${job.p}`
          )
          collectSubjects(data, subjects)
        }
      }
      await Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, worker))
      return [...subjects.entries()]
        .map(([code, label]) => ({ code, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    },
    6 * 60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`osu:sections:${termCode}:${subjectCode}`, async () => {
    const out = []
    let page = 1
    let totalPages = 1
    while (page <= totalPages) {
      const data = await apiGet(
        `q=&campus=${CAMPUS}&term=${encodeURIComponent(termCode)}&subject=${encodeURIComponent(subjectCode)}&p=${page}`
      )
      totalPages = Number(data.totalPages) || 1
      for (const wrapper of data.courses || []) {
        const course = wrapper.course || {}
        for (const s of wrapper.sections || []) {
          out.push(normalize(course, s, { termCode, termLabel, subjectCode, subjectLabel }))
        }
      }
      page += 1
    }
    return out
  })
}

function normalize(course, s, { termCode, termLabel, subjectCode, subjectLabel }) {
  const instructors = []
  const meetings = []
  for (const m of s.meetings || []) {
    for (const i of m.instructors || []) {
      if (i?.displayName && !instructors.includes(i.displayName)) {
        instructors.push(i.displayName)
      }
    }
    const days = daysFromBooleans(m)
    const startTime = normalizeTime(m.startTime)
    const endTime = normalizeTime(m.endTime)
    if (!days.length || !startTime || !endTime) continue // async / TBA
    meetings.push({
      days,
      startTime,
      endTime,
      location: m.buildingDescription || m.facilityDescription || '',
    })
  }
  const current = Number(s.enrollmentTotal)
  return {
    school: 'osu',
    termCode,
    termLabel: termLabel || s.term || '',
    subjectCode,
    subjectLabel: subjectLabel || s.subjectDesc || subjectCode,
    courseNumber: String(course.catalogNumber || s.catalogNumber || '').trim(),
    sectionNumber: String(s.section || '').trim(),
    crn: String(s.classNumber || ''),
    title: course.title || s.courseTitle || '',
    instructors,
    credits: parseCredits(course.maxUnits ?? course.minUnits),
    enrollment: {
      max: null, // OSU publishes no class capacity
      current: Number.isFinite(current) ? current : null,
      available: null,
    },
    status:
      s.enrollmentStatus === 'Open'
        ? 'open'
        : s.enrollmentStatus === 'Closed'
          ? 'closed'
          : 'unknown',
    meetings,
  }
}
