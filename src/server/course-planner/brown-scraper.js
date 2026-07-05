/**
 * Brown University scraper.
 *
 * Courses@Brown (cab.brown.edu) runs the same public "FOSE" JSON API as Yale
 * and UPenn. One POST to /api/?page=fose&route=search with {other:{srcdb},
 * criteria:[{field:'subject'...}]} returns every section for a subject.
 *
 * Brown sits behind an Imperva-style edge that answers bare clients with an
 * empty HTTP 202, so every request sends full browser-ish headers
 * (UA + Origin + Referer) - with those, both the home page and the API are
 * reliably reachable.
 *
 * Unlike Yale, Brown's per-section `route=details` call DOES carry capacity:
 * its `seats` field is an HTML snippet with span.seats_max / span.seats_avail
 * (exactly like UPenn), and the search payload's `total` is live current
 * enrollment - so Brown gets the full max/current/available triple. Details
 * are fetched with bounded concurrency after the search.
 *
 * Terms (srcdb, e.g. 202610 = Fall 2026) and the ~180-subject list both live
 * in <option> tags on the search home page.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime } from './util.js'

const BASE = 'https://cab.brown.edu'
const SEARCH_API = `${BASE}/api/?page=fose&route=search`
const DETAILS_API = `${BASE}/api/?page=fose&route=details`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Browser-ish headers; Brown's edge rejects bare scripted clients. */
const HEADERS = {
  'User-Agent': UA,
  Origin: BASE,
  Referer: `${BASE}/`,
  'Accept-Language': 'en-US,en;q=0.9',
}

/** Parallel details calls per search - same bound UPenn uses. */
const DETAIL_CONCURRENCY = 10

// FOSE meetingTimes meet_day index -> canonical day code.
const MEET_DAY = ['M', 'T', 'W', 'R', 'F', 'S', 'U']

/** Load + cache the search home page (carries both term and subject <option>s). */
async function loadHomePage() {
  return cacheMemo(
    'brown:home',
    async () => {
      const res = await fetch(`${BASE}/`, { headers: HEADERS })
      if (!res.ok) throw new Error(`Courses@Brown returned HTTP ${res.status}`)
      const html = await res.text()
      if (!html) throw new Error('Courses@Brown returned an empty page (edge blocked the request)')
      return html
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const html = await loadHomePage()
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<option[^>]*value=["'](\d{6})["'][^>]*>([^<]+)</g)) {
    const [, code, rawLabel] = m
    const label = rawLabel.trim()
    if (seen.has(code) || !/(Fall|Spring|Summer|Winter)/i.test(label)) continue
    seen.add(code)
    out.push({ code, label })
  }
  return out
}

export async function getSubjects() {
  const html = await loadHomePage()
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<option[^>]*value=["']([A-Z]{2,5})["'][^>]*>([^<]+)</g)) {
    const [, code, rawLabel] = m
    if (seen.has(code)) continue
    seen.add(code)
    out.push({ code, label: rawLabel.trim() || code })
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

/** Fetch one section's details and pull max/available out of the seats HTML snippet. */
async function fetchSeats(termCode, result) {
  const res = await fetch(DETAILS_API, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group: `code:${result.code}`,
      key: `crn:${result.crn}`,
      srcdb: termCode,
      matched: `crn:${result.crn}`,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const maxM = String(data.seats || '').match(/seats_max["'][^>]*>\s*(\d+)/)
  const availM = String(data.seats || '').match(/seats_avail["'][^>]*>\s*(\d+)/)
  if (!maxM || !availM) return null
  return { max: Number(maxM[1]), available: Number(availM[1]) }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`brown:sections:${termCode}:${subjectCode}`, async () => {
    const res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        other: { srcdb: termCode },
        criteria: [{ field: 'subject', value: subjectCode }],
      }),
    })
    if (!res.ok) throw new Error(`Brown search returned HTTP ${res.status}`)
    const data = await res.json()
    const results = Array.isArray(data.results) ? data.results : []

    const sections = results.map((r) => {
      const parts = String(r.code || '').split(/\s+/)
      const courseNumber = parts.slice(1).join(' ') || r.code
      const current = Number(r.total)
      const cancelled = r.isCancelled && r.isCancelled !== ''
      return {
        school: 'brown',
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
          .filter((s) => s && s !== 'Staff' && s !== 'TBD'),
        credits: null, // not in the FOSE search payload
        enrollment: {
          max: null,
          current: Number.isFinite(current) ? current : null,
          available: null,
        },
        status: cancelled ? 'closed' : r.stat === 'A' ? 'open' : 'closed',
        meetings: parseMeetings(r.meetingTimes),
        _result: r, // for the details walk below; deleted before return
      }
    })

    // Fill max/available from per-section details, N at a time. A failed
    // detail call leaves that section's nulls in place rather than throwing.
    const queue = [...sections]
    async function worker() {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const seats = await fetchSeats(termCode, s._result)
          if (seats) {
            s.enrollment.max = seats.max
            s.enrollment.available = seats.available
            if (s.enrollment.current === null) {
              s.enrollment.current = seats.max - seats.available
            }
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
