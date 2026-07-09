/**
 * Factory for CourseLeaf "FOSE" course-search scrapers.
 *
 * Brown, Yale and UPenn each got a hand-rolled FOSE scraper before the shape
 * was obviously common; this factory powers the schools added later (CU
 * Boulder, Oregon State, William & Mary) without another round of copy-paste.
 * The flow is always:
 *
 *   GET  {base}/                                  -> terms + subjects in <option> tags
 *   POST {base}/api/?page=fose&route=search       -> every section for a subject
 *   POST {base}/api/?page=fose&route=details      -> per-section seat counts
 *
 * Per-school differences the options cover:
 *  - subjectValuePrefix: W&M prefixes its subject option values with
 *    "subject_attributes_" (its dropdown doubles as an attribute filter).
 *  - seats: how the details call reports availability.
 *      'html'   -> a `seats` HTML snippet ("Maximum Enrollment: 140 / Seats
 *                  Avail: 58") — Boulder, W&M, Notre Dame and Dartmouth
 *                  (bold-tag markup, unlike the span.seats_max markup
 *                  Brown/UPenn use; Dartmouth abbreviates to "Max Enrollment"
 *                  and spells out "Seats Available" — the regexes cover both).
 *      'fields' -> plain JSON fields max_enroll / enrollment /
 *                  ssbsect_seats_avail — Oregon State.
 *  - termRe: what a real term label looks like. Defaults to plain
 *    "Season YYYY"; Notre Dame's dropdown says "Fall Semester 2026" /
 *    "Summer Session 2026" so it passes its own pattern.
 *
 * Terms are kept only when the label is a plain "Season YYYY" — these
 * dropdowns also carry compound entries ("Summer & Fall 2026", "Academic Year
 * 2025-2026", "All Terms") that would shadow the real term in the term-window
 * dedup.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime } from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Parallel details calls per search — same bound Brown/UPenn use. */
const DETAIL_CONCURRENCY = 10

// FOSE meetingTimes meet_day index -> canonical day code.
const MEET_DAY = ['M', 'T', 'W', 'R', 'F', 'S', 'U']

const PLAIN_TERM_RE = /^(Winter|Spring|Summer|Fall)\s+\d{4}$/i

export function createFoseScraper({
  school,
  base,
  subjectValuePrefix = '',
  seats = 'html',
  termRe = PLAIN_TERM_RE,
}) {
  const headers = {
    'User-Agent': UA,
    Origin: base,
    Referer: `${base}/`,
    'Accept-Language': 'en-US,en;q=0.9',
  }

  async function loadHomePage() {
    return cacheMemo(
      `${school}:home`,
      async () => {
        const res = await fetch(`${base}/`, { headers })
        if (!res.ok) throw new Error(`${school} search home returned HTTP ${res.status}`)
        const html = await res.text()
        if (!html) throw new Error(`${school} search home returned an empty page`)
        return html
      },
      60 * 60 * 1000
    )
  }

  async function getTerms() {
    const $ = cheerio.load(await loadHomePage())
    // The CourseLeaf UI renders the term picker as select#crit-srcdb; fall back
    // to any numeric-coded option with a plain season label if the id changes.
    let opts = $('#crit-srcdb option').toArray()
    if (!opts.length) {
      opts = $('option').toArray().filter((o) => /^\d{4,6}$/.test($(o).attr('value') || ''))
    }
    const out = []
    const seen = new Set()
    for (const o of opts) {
      const code = ($(o).attr('value') || '').trim()
      const label = $(o).text().trim()
      if (!/^\d{4,6}$/.test(code) || seen.has(code)) continue
      if (!termRe.test(label)) continue
      seen.add(code)
      out.push({ code, label })
    }
    return out
  }

  async function getSubjects() {
    const $ = cheerio.load(await loadHomePage())
    let opts = $('#crit-subject option').toArray()
    if (!opts.length) {
      opts = $('option').toArray().filter((o) => /^[A-Z][A-Z&\d]{1,7}$/.test($(o).attr('value') || ''))
    }
    // Some skins (W&M) render #crit-subject with bare-code labels ("CSCI") and
    // keep the human names in a parallel attribute-filter select whose option
    // values are "<prefix>CSCI" — harvest those as a label map.
    const prettyLabels = new Map()
    if (subjectValuePrefix) {
      $('option').each((_, o) => {
        const v = $(o).attr('value') || ''
        if (v.startsWith(subjectValuePrefix)) {
          prettyLabels.set(v.slice(subjectValuePrefix.length), $(o).text().trim())
        }
      })
    }
    const out = []
    const seen = new Set()
    for (const o of opts) {
      const code = ($(o).attr('value') || '').trim()
      if (!/^[A-Z][A-Z&\d]{1,7}$/.test(code) || seen.has(code)) continue
      seen.add(code)
      // "Accounting (ACCT)" and "ACTG - Accounting" both clean to the bare name.
      const label = (prettyLabels.get(code) || $(o).text())
        .trim()
        .replace(/\s*\([A-Z&\d]+\)\s*$/, '')
        .replace(new RegExp(`^${code}\\s*-\\s*`), '')
        .trim()
      out.push({ code, label: label || code })
    }
    return out.sort((a, b) => a.code.localeCompare(b.code))
  }

  /** Parse the JSON-encoded meetingTimes string into grouped { days, start, end } meetings. */
  function parseMeetings(meetingTimesJson) {
    let raw
    try {
      raw = JSON.parse(meetingTimesJson || '[]')
    } catch {
      return []
    }
    const byTime = new Map()
    for (const t of raw) {
      const startTime = normalizeTime(t.start_time)
      const endTime = normalizeTime(t.end_time)
      const day = MEET_DAY[Number(t.meet_day)]
      if (!startTime || !endTime || !day) continue
      const key = `${startTime}-${endTime}`
      if (!byTime.has(key)) byTime.set(key, { days: [], startTime, endTime, location: '' })
      const slot = byTime.get(key)
      if (!slot.days.includes(day)) slot.days.push(day)
    }
    return [...byTime.values()]
  }

  /** Fetch one section's details and extract { max, available } (or null). */
  async function fetchSeats(termCode, result) {
    const res = await fetch(`${base}/api/?page=fose&route=details`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group: `code:${result.code}`,
        key: `crn:${result.crn}`,
        srcdb: termCode,
        matched: `crn:${result.crn}`,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (seats === 'fields') {
      const max = Number(data.max_enroll)
      const current = Number(data.enrollment)
      const avail = Number(data.ssbsect_seats_avail)
      if (!Number.isFinite(max)) return null
      return {
        max,
        available: Number.isFinite(avail) ? avail : null,
        current: Number.isFinite(current) ? current : null,
      }
    }
    // 'html': "<b>Maximum Enrollment:</b> 140 / <b>Seats Avail:</b> 58"
    // (Dartmouth says "Max Enrollment" / "Seats Available" — same numbers)
    const s = String(data.seats || '')
    const maxM = s.match(/Max(?:imum)? Enrollment[^0-9]*(\d+)/i)
    const availM = s.match(/Seats Avail(?:able)?[^0-9]*(\d+)/i)
    if (!maxM || !availM) return null
    return { max: Number(maxM[1]), available: Number(availM[1]), current: null }
  }

  async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
    return cacheMemo(`${school}:sections:${termCode}:${subjectCode}`, async () => {
      const res = await fetch(`${base}/api/?page=fose&route=search`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          other: { srcdb: termCode },
          criteria: [{ field: 'subject', value: subjectCode }],
        }),
      })
      if (!res.ok) throw new Error(`${school} search returned HTTP ${res.status}`)
      const data = await res.json()
      const results = Array.isArray(data.results) ? data.results : []

      const sections = results.map((r) => {
        const parts = String(r.code || '').split(/\s+/)
        const courseNumber = parts.slice(1).join(' ') || r.code
        const cancelled = r.isCancelled && r.isCancelled !== ''
        return {
          school,
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber,
          sectionNumber: r.no || '',
          crn: r.crn || '',
          title: r.title || '',
          instructors: String(r.instr || '')
            .split('/')
            .map((s) => s.trim())
            .filter((s) => s && s !== 'Staff' && s !== 'TBD' && s !== 'TBA'),
          credits: null, // not in the FOSE search payload
          enrollment: { max: null, current: null, available: null },
          status: cancelled ? 'closed' : r.stat === 'A' ? 'open' : 'closed',
          meetings: parseMeetings(r.meetingTimes),
          _result: r, // for the details walk below; deleted before return
        }
      })

      // Fill seats from per-section details, N at a time. A failed detail call
      // leaves that section's nulls in place rather than throwing. Unlike
      // Brown, these schools' search `total` is a result-group count, not live
      // enrollment, so current is derived as max - available when absent.
      const queue = [...sections]
      async function worker() {
        for (let s = queue.shift(); s; s = queue.shift()) {
          try {
            const got = await fetchSeats(termCode, s._result)
            if (got) {
              s.enrollment.max = got.max
              s.enrollment.available = got.available
              s.enrollment.current =
                got.current !== null
                  ? got.current
                  : got.available !== null
                    ? Math.max(0, got.max - got.available)
                    : null
            }
          } catch {
            // leave nulls
          }
        }
      }
      await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker))
      for (const s of sections) delete s._result

      return sections
    })
  }

  return { getTerms, getSubjects, getSections }
}
