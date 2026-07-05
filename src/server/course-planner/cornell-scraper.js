/**
 * Cornell University scraper.
 *
 * Cornell publishes its entire Class Roster through a clean, documented,
 * key-free JSON API (classes.cornell.edu/api/2.0):
 *   - /config/rosters.json               -> terms ("rosters": FA26 = Fall 2026)
 *   - /config/subjects.json?roster=FA26  -> subject list for a roster
 *   - /search/classes.json?roster=&subject= -> every class + sections
 *
 * Each class carries enrollGroups (credit units) whose classSections hold the
 * meetings (pattern "TR" + timeStart "09:05AM"), instructors, and an
 * openStatus flag (O = open, C = closed, W = waitlist). No seat counts are
 * published anywhere in the API, so enrollment stays null and only status is
 * real.
 */
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays } from './util.js'

const API = 'https://classes.cornell.edu/api/2.0'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

async function apiGet(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Cornell API returned HTTP ${res.status}`)
  const json = await res.json()
  if (json.status !== 'success') {
    throw new Error(`Cornell API error: ${json.message || json.status}`)
  }
  return json.data
}

export async function getTerms() {
  return cacheMemo(
    'cornell:terms',
    async () => {
      const data = await apiGet('/config/rosters.json')
      return (data.rosters || []).map((r) => ({ code: r.slug, label: r.descr }))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return cacheMemo(
    `cornell:subjects:${termCode}`,
    async () => {
      const data = await apiGet(`/config/subjects.json?roster=${encodeURIComponent(termCode)}`)
      return (data.subjects || []).map((s) => ({
        code: s.value,
        label: s.descrformal || s.descr || s.value,
      }))
    },
    60 * 60 * 1000
  )
}

/** "Walker Mcmillan White" from a roster instructor record. */
function instructorName(i) {
  return [i.firstName, i.lastName].filter(Boolean).join(' ').trim()
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`cornell:sections:${termCode}:${subjectCode}`, async () => {
    const data = await apiGet(
      `/search/classes.json?roster=${encodeURIComponent(termCode)}&subject=${encodeURIComponent(subjectCode)}`
    )
    const out = []
    for (const cls of data.classes || []) {
      for (const eg of cls.enrollGroups || []) {
        for (const cs of eg.classSections || []) {
          const instructors = []
          const meetings = []
          for (const m of cs.meetings || []) {
            for (const i of m.instructors || []) {
              const name = instructorName(i)
              if (name && !instructors.includes(name)) instructors.push(name)
            }
            const days = parseDays(m.pattern)
            const startTime = normalizeTime(m.timeStart)
            const endTime = normalizeTime(m.timeEnd)
            if (!days.length || !startTime || !endTime) continue // TBA / async
            meetings.push({
              days,
              startTime,
              endTime,
              location: [m.bldgDescr, m.facilityDescr].filter(Boolean).join(' ') || '',
            })
          }
          out.push({
            school: 'cornell',
            termCode,
            termLabel: termLabel || '',
            subjectCode,
            subjectLabel: subjectLabel || subjectCode,
            courseNumber: String(cls.catalogNbr || '').trim(),
            sectionNumber: `${cs.ssrComponent} ${cs.section}`.trim(),
            crn: String(cs.classNbr || ''),
            title: cls.titleLong || cls.titleShort || '',
            instructors,
            credits: Number.isFinite(eg.unitsMinimum) ? eg.unitsMinimum : null,
            enrollment: { max: null, current: null, available: null }, // not published
            status: cs.openStatus === 'O' ? 'open' : cs.openStatus ? 'closed' : 'unknown',
            meetings,
          })
        }
      }
    }
    return out
  })
}
