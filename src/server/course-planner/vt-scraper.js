/**
 * Virginia Tech scraper.
 *
 * VT's public Timetable of Classes (selfservice.banner.vt.edu/ssb/HZSKVTSC.*)
 * is a Banner-adjacent custom app, no login required:
 *   GET  HZSKVTSC.P_DispRequest  -> TERMYEAR <select> + per-term subject lists
 *                                   embedded in JS `new Option("CS - ...","CS")`
 *   POST HZSKVTSC.P_ProcRequest  -> results table (one row per section)
 *
 * Each section row carries CRN, course, title, type, modality, credits,
 * CAPACITY, instructor, days, begin/end times, and location. Live enrollment
 * counts are login-gated ("You must be logged into Hokie SPA to view
 * enrollment information"), so only enrollment.max is filled. Open/closed IS
 * public though: the same POST with open_only=on returns just the open
 * sections, so getSections queries twice and diffs the CRN sets.
 *
 * Multi-meeting sections render an extra "* Additional Times *" row right
 * after the main row; comment rows ("Comments for CRN ...") are skipped.
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const BASE = 'https://selfservice.banner.vt.edu/ssb'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }

async function loadFormPage() {
  return cacheMemo(
    'vt:form',
    async () => {
      const res = await fetch(`${BASE}/HZSKVTSC.P_DispRequest`, { headers: HEADERS })
      if (!res.ok) throw new Error(`VT timetable returned HTTP ${res.status}`)
      return res.text()
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  const html = await loadFormPage()
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<OPTION VALUE="(\d{6})"[^>]*>([^<]+)</gi)) {
    const [, code, rawLabel] = m
    const label = rawLabel.trim()
    // The first option repeats a real code with the label "Select Term".
    if (seen.has(code) || /select term/i.test(label)) continue
    seen.add(code)
    out.push({ code, label })
  }
  return out
}

export async function getSubjects(termCode) {
  const html = await loadFormPage()
  // Subjects are populated by JS, one `case "202609" : ...` block per term
  // full of `new Option("CS - Computer Science","CS",...)` calls.
  const caseRe = new RegExp(`case\\s*"${termCode}"\\s*:([\\s\\S]*?)(?:case\\s*"|break)`, 'i')
  const block = (html.match(caseRe) || [])[1] || ''
  const out = []
  const seen = new Set()
  for (const m of block.matchAll(/new Option\("([^"]+)","([^"]+)"/g)) {
    const [, rawLabel, code] = m
    if (code === '%' || seen.has(code)) continue
    seen.add(code)
    const label = rawLabel.replace(new RegExp(`^${code}\\s*-\\s*`), '').trim()
    out.push({ code, label: label || code })
  }
  if (!out.length) throw new Error(`VT subject list not found for term ${termCode}`)
  return out
}

function searchBody(termCode, subjectCode, openOnly) {
  return new URLSearchParams({
    CAMPUS: '0', // Blacksburg
    TERMYEAR: termCode,
    CORE_CODE: 'AR%',
    subj_code: subjectCode,
    SCHDTYPE: '%',
    CRSE_NUMBER: '',
    crn: '',
    open_only: openOnly ? 'on' : '',
    disp_comments_in: 'Y',
    sess_code: '%',
    BTN_PRESSED: 'FIND class sections',
    inst_name: '',
  }).toString()
}

async function fetchListing(termCode, subjectCode, openOnly) {
  const res = await fetch(`${BASE}/HZSKVTSC.P_ProcRequest`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE}/HZSKVTSC.P_DispRequest`,
    },
    body: searchBody(termCode, subjectCode, openOnly),
  })
  if (!res.ok) throw new Error(`VT timetable returned HTTP ${res.status}`)
  return res.text()
}

/** Days/begin/end/location cells -> a meeting, or null for (ARR)/TBA rows. */
function meetingFromCells(dayText, beginText, endText, locText) {
  const days = parseDays(dayText.replace(/\(ARR\)/i, ''))
  const startTime = normalizeTime(beginText)
  const endTime = normalizeTime(endText)
  if (!days.length || !startTime || !endTime) return null
  const location = /^tba$/i.test(locText.trim()) ? '' : locText.replace(/\s+/g, ' ').trim()
  return { days, startTime, endTime, location }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`vt:sections:${termCode}:${subjectCode}`, async () => {
    const [allHtml, openHtml] = await Promise.all([
      fetchListing(termCode, subjectCode, false),
      fetchListing(termCode, subjectCode, true),
    ])
    const openCrns = new Set(
      [...openHtml.matchAll(/P_ProcComments\?CRN=(\d+)&/g)].map((m) => m[1])
    )

    const $ = cheerio.load(allHtml)
    const out = []
    $('table.dataentrytable tr').each((_, tr) => {
      const tds = $(tr).find('td')
      const rowText = $(tr).text()

      // "* Additional Times *" rows extend the previous section's meetings.
      if (/\*\s*Additional Times\s*\*/i.test(rowText)) {
        const prev = out[out.length - 1]
        if (!prev || tds.length < 5) return
        const cells = tds.toArray().map((td) => $(td).text())
        // The marker cell is followed by days / begin / end / location.
        const idx = cells.findIndex((c) => /Additional Times/i.test(c))
        if (idx < 0 || idx + 4 >= cells.length) return
        const meeting = meetingFromCells(cells[idx + 1], cells[idx + 2], cells[idx + 3], cells[idx + 4])
        if (meeting) prev.meetings.push(meeting)
        return
      }

      if (/Comments for CRN/i.test(rowText)) return
      if (tds.length < 12) return
      const crn = $(tds[0]).text().trim()
      if (!/^\d{4,6}$/.test(crn)) return
      const courseM = $(tds[1]).text().trim().match(/^([A-Z]+)-(\S+)$/)
      if (!courseM) return
      const [, subj, courseNumber] = courseM
      const title = $(tds[2]).text().replace(/\s+/g, ' ').trim()
      const credits = parseCredits($(tds[5]).text().trim())
      const capacity = Number($(tds[6]).text().trim())
      const instructor = $(tds[7]).text().replace(/\s+/g, ' ').trim()
      const meeting = meetingFromCells(
        $(tds[8]).text(),
        $(tds[9]).text(),
        $(tds[10]).text(),
        $(tds[11]).text()
      )

      out.push({
        school: 'vt',
        termCode,
        termLabel: termLabel || '',
        subjectCode: subj,
        subjectLabel: subjectLabel || subj,
        courseNumber,
        // VT has no separate section number; the timetable is CRN-keyed.
        sectionNumber: '',
        crn,
        title,
        instructors:
          instructor && !/^(n\/a|tba|staff)$/i.test(instructor) ? [instructor] : [],
        credits,
        enrollment: {
          max: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
          current: null, // login-gated ("Hokie SPA") — capacity is public, enrollment isn't
          available: null,
        },
        status: openCrns.has(crn) ? 'open' : 'closed',
        meetings: meeting ? [meeting] : [],
      })
    })
    return out
  })
}
