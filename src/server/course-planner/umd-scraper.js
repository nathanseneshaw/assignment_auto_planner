/**
 * University of Maryland scraper.
 *
 * UMD's Schedule of Classes ("Testudo", app.testudo.umd.edu/soc) is plain
 * public server-rendered HTML:
 *   - /soc/                     -> term <select> (202608 = Fall 2026)
 *   - /soc/{term}               -> course-prefix list (dept codes + names)
 *   - /soc/{term}/{SUBJ}        -> course blocks (id, title, credits)
 *   - /soc/{term}/sections?courseIds=a,b,... -> per-course section markup
 *
 * The sections fragment carries LIVE seat data: span.total-seats-count
 * (capacity) and span.open-seats-count (available) per section, plus
 * instructors and meeting rows ("MWF 10:00am - 10:50am" + building/room).
 * courseIds are batched ~25 per request so a big department costs a handful
 * of calls. current = total - open (waitlist not counted as enrolled).
 * Sections have no public CRN, so "{courseId}-{sectionId}" is the unique id.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays, parseCredits } from './util.js'

const BASE = 'https://app.testudo.umd.edu/soc'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const BATCH_SIZE = 25
const BATCH_CONCURRENCY = 4

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`UMD Testudo returned HTTP ${res.status}`)
  return res.text()
}

export async function getTerms() {
  return cacheMemo(
    'umd:terms',
    async () => {
      const html = await getHtml(`${BASE}/`)
      const $ = cheerio.load(html)
      const out = []
      $('select[name="termId"] option').each((_, o) => {
        const code = $(o).attr('value')
        if (code && /^\d{6}$/.test(code)) {
          out.push({ code, label: $(o).text().trim() })
        }
      })
      return out
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `umd:subjects:${termCode}`,
    async () => {
      const html = await getHtml(`${BASE}/${encodeURIComponent(termCode)}`)
      const $ = cheerio.load(html)
      const out = []
      $('.course-prefix').each((_, row) => {
        const code = $(row).find('.prefix-abbrev').text().trim()
        const label = $(row).find('.prefix-name').text().trim()
        if (/^[A-Z]{4}$/.test(code)) out.push({ code, label: label || code })
      })
      return out
    },
    60 * 60 * 1000
  )
}

/** Parse one sections?courseIds= fragment into { courseId: [section...] }. */
function parseSectionsFragment(html) {
  const $ = cheerio.load(html)
  const byCourse = new Map()
  $('.course-sections').each((_, csEl) => {
    const courseId = $(csEl).attr('id') || ''
    const sections = []
    $(csEl)
      .find('.section')
      .each((__, sEl) => {
        const sec = $(sEl)
        const sectionId = sec.find('.section-id').first().text().trim()
        if (!sectionId) return
        const instructors = []
        sec.find('.section-instructor').each((___, iEl) => {
          // TBA rows render as "Instructor: TBA" inside the same span.
          const name = $(iEl).text().trim().replace(/^Instructor:\s*/i, '')
          if (name && !/^TBA$/i.test(name) && !instructors.includes(name)) {
            instructors.push(name)
          }
        })
        const total = Number(sec.find('.total-seats-count').first().text().trim())
        const open = Number(sec.find('.open-seats-count').first().text().trim())
        const meetings = []
        sec.find('.class-days-container .row').each((___, rowEl) => {
          const row = $(rowEl)
          const days = parseDays(row.find('.section-days').first().text().trim())
          const startTime = normalizeTime(row.find('.class-start-time').first().text().trim())
          const endTime = normalizeTime(row.find('.class-end-time').first().text().trim())
          if (!days.length || !startTime || !endTime) return // TBA / online-async
          const location = [
            row.find('.building-code').first().text().trim(),
            row.find('.class-room').first().text().trim(),
          ]
            .filter(Boolean)
            .join(' ')
          meetings.push({ days, startTime, endTime, location })
        })
        sections.push({
          sectionId,
          instructors,
          total: Number.isFinite(total) ? total : null,
          open: Number.isFinite(open) ? open : null,
          meetings,
        })
      })
    byCourse.set(courseId, sections)
  })
  return byCourse
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`umd:sections:${termCode}:${subjectCode}`, async () => {
    const html = await getHtml(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(subjectCode)}`)
    const $ = cheerio.load(html)

    // Course id -> { title, credits } from the department page.
    const courses = []
    $('.course').each((_, cEl) => {
      const el = $(cEl)
      const id = el.attr('id') || el.find('.course-id').first().text().trim()
      if (!id) return
      courses.push({
        id,
        title: el.find('.course-title').first().text().trim(),
        credits: parseCredits(el.find('.course-min-credits').first().text().trim()),
      })
    })

    // Batched section fetches, a few in flight at a time.
    const batches = []
    for (let i = 0; i < courses.length; i += BATCH_SIZE) {
      batches.push(courses.slice(i, i + BATCH_SIZE))
    }
    const sectionsByCourse = new Map()
    const queue = [...batches]
    async function worker() {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        const ids = batch.map((c) => c.id).join(',')
        try {
          const frag = await getHtml(
            `${BASE}/${encodeURIComponent(termCode)}/sections?courseIds=${encodeURIComponent(ids)}`
          )
          for (const [courseId, secs] of parseSectionsFragment(frag)) {
            sectionsByCourse.set(courseId, secs)
          }
        } catch {
          // One failed batch drops those courses' sections, not the whole subject.
        }
      }
    }
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker))

    const out = []
    for (const course of courses) {
      for (const s of sectionsByCourse.get(course.id) || []) {
        const max = s.total
        const available = s.open
        const current = max !== null && available !== null ? max - available : null
        out.push({
          school: 'umd',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber: course.id.replace(/^[A-Z]{4}/, ''),
          sectionNumber: s.sectionId,
          crn: `${course.id}-${s.sectionId}`,
          title: course.title,
          instructors: s.instructors,
          credits: course.credits,
          enrollment: { max, current, available },
          status: available === null ? 'unknown' : available > 0 ? 'open' : 'closed',
          meetings: s.meetings,
        })
      }
    }
    return out
  })
}
