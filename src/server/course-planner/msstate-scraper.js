/**
 * Mississippi State University scraper.
 *
 * MSU's public "Master Schedule" is an Ellucian Banner Extensibility page
 * (mybanner.msstate.edu/BannerExtensibility/customPage/page/msuPublicMasterSchedule)
 * whose data rides key-free "virtual domain" JSON endpoints under
 * /BannerExtensibility/internalPb:
 *   virtualDomains.msuStudentSZUWCNT?p_type=STVTERM&...   -> terms (202630 = Fall 2026)
 *   virtualDomains.msuStudentSTVSUBJ                      -> subjects
 *   virtualDomains.msuStudentMasterScheduleJSON?term&subject&ssts=A&type=PUBLIC
 *
 * The schedule endpoint returns one row per section-meeting as a positional
 * array (schema pinned from the page's own DataTable builder): [0] subject,
 * [1] course number, [2] section, [3] CRN, [4] campus, [5] part of term,
 * [6] title, [9] type, [10] delivery, [12] TOTAL seats, [13] AVAILABLE seats,
 * [16]/[17] start/end date, [18] days HTML, [19] "06:30PM - 08:20PM",
 * [20] location. Instructor/credits aren't in this payload (they live behind
 * per-section detail domains). Rows repeat the CRN for multi-meeting
 * sections — merged here. The host drops connections now and then, so every
 * call retries once.
 */
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime } from './util.js'

const BASE = 'https://mybanner.msstate.edu/BannerExtensibility/internalPb'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function cleanText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** GET a virtual-domain endpoint, retrying once — the host is connection-flaky. */
async function fetchJson(url) {
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!res.ok) throw new Error(`msstate returned HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

export async function getTerms() {
  return cacheMemo(
    'msstate:terms',
    async () => {
      const rows = await fetchJson(
        `${BASE}/virtualDomains.msuStudentSZUWCNT?p_package=PB-MSUPUBLICMASTERSCHEDULE&p_type=STVTERM&p_orderby=VCODE&p_direction=D`
      )
      // value_desc is "Fall Semester 2026".
      return (Array.isArray(rows) ? rows : []).map((r) => ({
        code: String(r.value_code),
        label: String(r.value_desc || r.value_code),
      }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects() {
  return cacheMemo(
    'msstate:subjects',
    async () => {
      const rows = await fetchJson(`${BASE}/virtualDomains.msuStudentSTVSUBJ`)
      return (Array.isArray(rows) ? rows : [])
        .map((r) => {
          const code = String(r.subj_code || '').trim()
          // subj_desc is "CSE - Computer Science & Engineering".
          const label = String(r.subj_desc || '')
            .replace(new RegExp(`^${code}\\s*-\\s*`), '')
            .trim()
          return { code, label: label || code }
        })
        .filter((s) => s.code)
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    60 * 60 * 1000
  )
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`msstate:sections:${termCode}:${subjectCode}`, async () => {
    const payload = await fetchJson(
      `${BASE}/virtualDomains.msuStudentMasterScheduleJSON?term=${encodeURIComponent(termCode)}&subject=${encodeURIComponent(subjectCode)}&ssts=A&type=PUBLIC`
    )
    let rows = []
    try {
      rows = JSON.parse(payload?.[0]?.json_data || '{}').data || []
    } catch {
      throw new Error('msstate master schedule returned unparseable json_data')
    }

    // One row per section-MEETING: merge rows sharing a CRN.
    const byCrn = new Map()
    for (const r of rows) {
      const crn = String(r[3] || '').trim()
      if (!crn) continue
      const total = Number(cleanText(r[12]))
      const avail = Number(cleanText(r[13]))
      const max = Number.isFinite(total) ? total : null
      const available = Number.isFinite(avail) ? avail : null
      if (!byCrn.has(crn)) {
        byCrn.set(crn, {
          school: 'msstate',
          termCode,
          termLabel: termLabel || '',
          subjectCode,
          subjectLabel: subjectLabel || subjectCode,
          courseNumber: cleanText(r[1]),
          sectionNumber: cleanText(r[2]),
          crn,
          title: cleanText(r[6]),
          instructors: [], // not in the public master-schedule payload
          credits: null, // ditto
          enrollment: {
            max,
            current: max !== null && available !== null ? Math.max(0, max - available) : null,
            available,
          },
          status: available === null ? 'unknown' : available > 0 ? 'open' : 'closed',
          meetings: [],
        })
      }
      const section = byCrn.get(crn)
      const days = parseDays(cleanText(r[18]).replace(/tba/i, ''))
      const tm = cleanText(r[19]).match(/(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)/i)
      if (!days.length || !tm) continue
      const startTime = normalizeTime(tm[1])
      const endTime = normalizeTime(tm[2])
      if (!startTime || !endTime) continue
      const where = cleanText(r[20])
      section.meetings.push({
        days,
        startTime,
        endTime,
        location: /^tba$/i.test(where) ? '' : where,
      })
    }
    return [...byCrn.values()]
  })
}
