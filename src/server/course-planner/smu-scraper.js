/**
 * SMU scraper (public "Quick Reference Schedule" XLSX).
 *
 * SMU does not expose a sections API. Each semester, the registrar publishes a
 * weekly-refreshed Excel file at a stable URL. We discover the current file by
 * scraping the corresponding enrollment page, then parse it with `xlsx`.
 *
 * Important caveat: the Quick Reference file does NOT include enrollment counts
 * or capacity. Only meeting info + instructor. The unified shape's
 * `enrollment` fields stay null and `status` is always 'unknown'.
 *
 * Term-code convention (extracted from filenames like 1267crslist_ug_gr.xlsx):
 *   1 + 2 + <year-last-two> + <season>   where season = 2 spring | 4 summer | 7 fall
 */
import * as XLSX from 'xlsx'
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { parseDays, normalizeTime, parseCredits } from './util.js'

const SCHOOL = 'smu'
const BASE = 'https://www.smu.edu'
const UA = 'Mozilla/5.0 (compatible; Plannr/1.0)'
const SEASON_PAGES = [
  { season: 'Fall', path: '/enrollment-services/registrar/fall', seasonDigit: '7' },
  { season: 'Spring', path: '/enrollment-services/registrar/spring', seasonDigit: '2' },
  { season: 'Summer', path: '/enrollment-services/registrar/summer', seasonDigit: '4' },
]

/** Discovers the currently-published XLSX URL per season + extracts the term code. */
async function discoverTerms() {
  return cacheMemo(
    'smu:terms',
    async () => {
      const found = []
      for (const { season, path } of SEASON_PAGES) {
        try {
          const html = await (await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA } })).text()
          const m = html.match(/href="([^"]*crslist[^"]*\.xlsx)"/i)
          if (!m) continue
          const url = m[1].startsWith('http') ? m[1] : `${BASE}${m[1]}`
          const codeMatch = url.match(/\/(\d{4})crslist/i)
          if (!codeMatch) continue
          const code = codeMatch[1]
          // SMU PeopleSoft short code: "1<century-digit><year-tens><year-ones-with-term-offset>".
          // The middle two digits ARE the last two of the calendar year for the season           // e.g. 1267 → 2026, 1262 → 2026, 1264 → 2026.
          const yyyy = 2000 + Number(code.slice(1, 3))
          const label = `${season} ${yyyy}`
          if (!found.some((t) => t.code === code)) found.push({ code, label, url })
        } catch {
          // Skip seasons whose pages aren't reachable rather than failing the whole list.
        }
      }
      return found
    },
    6 * 60 * 60 * 1000 // 6 h  SMU re-publishes weekly so a long cache is fine.
  )
}

export async function getTerms() {
  const terms = await discoverTerms()
  return terms.map(({ code, label }) => ({ code, label }))
}

/** Download the XLSX once per term + parse rows into normalised sections. */
async function loadTerm(termCode) {
  return cacheMemo(
    `smu:term-sections:${termCode}`,
    async () => {
      const terms = await discoverTerms()
      const t = terms.find((x) => x.code === termCode)
      if (!t) throw new Error(`Unknown SMU term: ${termCode}`)
      const res = await fetch(t.url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`SMU XLSX fetch failed: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const wb = XLSX.read(buf, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      // header:1 = array of arrays; we find the header row ourselves because SMU's
      // sheet has a multi-line title block above the actual columns.
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
      const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === 'Class Nbr'))
      if (headerIdx < 0) throw new Error('SMU XLSX header row not found')
      const headers = rows[headerIdx].map((c) => String(c).trim())
      const out = []
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row.some((c) => String(c).trim())) continue
        const o = {}
        headers.forEach((h, j) => {
          o[h] = row[j] ?? ''
        })
        out.push(normalize(o, termCode, t.label))
      }
      return out
    },
    30 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  const sections = await loadTerm(termCode)
  const seen = new Map()
  for (const s of sections) {
    if (s.subjectCode && !seen.has(s.subjectCode)) {
      seen.set(s.subjectCode, { code: s.subjectCode, label: s.subjectCode })
    }
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export async function getSections({ termCode, subjectCode }) {
  const sections = await loadTerm(termCode)
  if (!subjectCode) return sections
  const want = String(subjectCode).toUpperCase()
  return sections.filter((s) => s.subjectCode === want)
}

function normalize(row, termCode, termLabel) {
  const meetings = []
  // SMU stores meeting day-pattern and times in separate columns. A row with
  // "TBA,To Be Announced" in Name and ARR in Pat is unschedulable  surface it
  // with empty meetings rather than a fake time block.
  const days = parseDays(String(row.Pat || '').replace(/[^A-Za-z]/g, ''))
  const startTime = normalizeTime(row['Mtg Start'])
  const endTime = normalizeTime(row['Mtg End'])
  if (days.length && startTime && endTime) {
    meetings.push({ days, startTime, endTime, location: String(row.School || '') })
  }
  return {
    school: SCHOOL,
    termCode,
    termLabel,
    subjectCode: String(row.Subject || '').toUpperCase().trim(),
    subjectLabel: String(row.Subject || '').trim(),
    courseNumber: String(row.Catalog || '').trim(),
    sectionNumber: String(row.Section || '').trim(),
    crn: String(row['Class Nbr'] || '').trim(),
    title: String(row.Descr || '').trim(),
    instructors: [String(row.Name || '').replace(/,To Be Announced$/, '').trim()].filter(Boolean),
    credits: parseCredits(row.Credits),
    enrollment: { max: null, current: null, available: null },
    status: 'unknown',
    meetings,
  }
}
