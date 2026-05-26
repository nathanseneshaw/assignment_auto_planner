/**
 * Rice University scraper.
 *
 * Two endpoints, joined by CRN:
 *   1. `!swkenrc.main` (Enrollment Counts) — bulk CSV with max / current / available
 *      seats per section. Does NOT include meeting times.
 *   2. `!SWKSCAT.cat` (Schedule) — HTML list of all sections for a subject with
 *      meeting times, instructor, etc. No enrollment counts in the list view.
 *
 * We fire both in parallel and merge so the unified Section shape has both
 * meeting times and seat counts.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import {
  csvToObjects,
  parseCsv,
  parseCredits,
  parseDays,
  normalizeTime,
} from './util.js'

const SCHOOL = 'rice'
const BASE = 'https://courses.rice.edu'
const FORM_URL = `${BASE}/admweb/!swkenrc.main`
const SCHED_URL = `${BASE}/courses/!SWKSCAT.cat`
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'

/** Fetch the enrollment form once + extract the as_fid token, terms, subjects. */
async function loadForm() {
  return cacheMemo(
    'rice:form',
    async () => {
      const res = await fetch(FORM_URL, { headers: { 'User-Agent': UA } })
      const html = await res.text()
      const $ = cheerio.load(html)
      const asFid = $('input[name="as_fid"]').attr('value') || ''

      const terms = []
      $('select[name="term"] option').each((_, el) => {
        const code = $(el).attr('value')
        const label = $(el).text().trim()
        if (code) terms.push({ code, label })
      })

      const subjects = []
      $('select[name="subj"] option').each((_, el) => {
        const code = $(el).attr('value')
        const text = $(el).text().trim()
        if (!code) return
        // "Computer Science (COMP)" → label "Computer Science"
        const label = text.replace(/\s*\([^)]+\)\s*$/, '').trim() || code
        subjects.push({ code, label })
      })
      return { asFid, terms, subjects }
    },
    60 * 60 * 1000 // 1 hour — terms/subjects barely change
  )
}

export async function getTerms() {
  const { terms } = await loadForm()
  return terms
}

export async function getSubjects() {
  const { subjects } = await loadForm()
  return subjects
}

/** Fetch the bulk enrollment CSV for one (term, subject). */
async function fetchEnrollmentCsv(termCode, subjectCode) {
  const { asFid } = await loadForm()
  const params = new URLSearchParams({
    term: termCode,
    subj: subjectCode,
    nonav: 'Y',
    export: 'CSV',
    as_fid: asFid,
  })
  const res = await fetch(`${FORM_URL}?${params}`, { headers: { 'User-Agent': UA } })
  const text = await res.text()
  if (!res.ok) throw new Error(`Rice enrollment fetch failed: HTTP ${res.status}`)
  const rows = parseCsv(text)
  return csvToObjects(rows)
}

/** Fetch the schedule HTML and parse meeting times keyed by CRN. */
async function fetchScheduleByCrn(termCode, subjectCode) {
  const url = `${SCHED_URL}?p_action=QUERY&p_term=${termCode}&p_subj=${subjectCode}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  const html = await res.text()
  if (!res.ok) throw new Error(`Rice schedule fetch failed: HTTP ${res.status}`)
  const $ = cheerio.load(html)
  const byCrn = new Map()
  $('tr').each((_, tr) => {
    const $tr = $(tr)
    const crn = $tr.find('.cls-crn').text().trim()
    if (!/^\d+$/.test(crn)) return
    const meetings = []
    $tr
      .find('.cls-mtg .mtg-clas div')
      .each((_, d) => {
        const txt = $(d).text().trim().replace(/\s+/g, ' ')
        // "1:00PM - 2:15PM TR" or "1:00PM - 2:15PM MWF"
        const m = txt.match(/^(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)\s*([A-Z]+)?/i)
        if (m) {
          meetings.push({
            days: parseDays(m[3] || ''),
            startTime: normalizeTime(m[1]),
            endTime: normalizeTime(m[2]),
            location: '',
          })
        }
      })
    byCrn.set(crn, meetings)
  })
  return byCrn
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  const cacheKey = `rice:sections:${termCode}:${subjectCode}`
  return cacheMemo(cacheKey, async () => {
    const [enrollRows, meetingsByCrn] = await Promise.all([
      fetchEnrollmentCsv(termCode, subjectCode),
      fetchScheduleByCrn(termCode, subjectCode),
    ])
    return enrollRows
      .filter((r) => r.CRN && /^\d+$/.test(r.CRN))
      .map((r) => {
        const max = toInt(r['SECT MAX'])
        const current = toInt(r['SECT ENRL'] ?? r['TTL ENRL'])
        const avail = toInt(r['TTL SEATS AVAIL'])
        const status = decideStatus({ max, avail })
        return {
          school: SCHOOL,
          termCode,
          termLabel: termLabel || r.TERM || '',
          subjectCode: r.SUBJ || subjectCode,
          subjectLabel: subjectLabel || r.DEPARTMENT || '',
          courseNumber: String(r.COURSE || '').trim(),
          sectionNumber: String(r.SECTION || '').trim(),
          crn: r.CRN,
          title: r.TITLE || '',
          instructors: splitInstructors(r['INSTRUCTOR NAME(S)']),
          credits: parseCredits(r.CREDITS),
          enrollment: { max, current, available: avail },
          status,
          meetings: meetingsByCrn.get(r.CRN) || [],
        }
      })
  })
}

function toInt(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s || s === 'N/A' || s === 'Perm') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function splitInstructors(raw) {
  if (!raw) return []
  // Rice usually has "Last, First" — comma is inside the name so split on ';' or ' / '.
  return String(raw)
    .split(/\s*;\s*|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function decideStatus({ max, avail }) {
  if (avail === null || max === null) return 'unknown'
  if (avail <= 0) return 'closed'
  return 'open'
}
