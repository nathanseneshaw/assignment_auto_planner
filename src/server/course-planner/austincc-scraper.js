/**
 * Austin Community College scraper.
 *
 * ACC's Colleague Self-Service (selfservice.austincc.edu) is login-walled, but
 * the registrar publishes the whole credit schedule as a plain, GET-driven PHP
 * app at www6.austincc.edu/schedule:
 *
 *   index.php?op=browse&opclass=ViewSched&ct=CC   -> "Credit Terms" menu + discipline links
 *   ...&term=226F000&disciplineid=PCACC&ct=CC     -> one discipline's sections
 *
 * Two things to know about the shape of this source:
 *
 *   1. ACC browses by DISCIPLINE ("Accounting", "Computer Science"), not by
 *      course prefix, and one discipline can hold several TCCNS prefixes (the
 *      Accounting page carries both ACCT and ACNT). So `subjectCode` here is
 *      ACC's discipline id, while each section reports the real prefix it
 *      prints. A handful of interdisciplinary programs share the id TFIND and
 *      are told apart only by their opclass (ViewSched_ADS, ViewSched_AMS, ...),
 *      so those key off the opclass suffix instead.
 *   2. The public listing has no instructor column and no credit-hours column,
 *      so `instructors` is always empty and `credits` stays null. Seats are
 *      live: every row prints "[enrolled/capacity/waitlisted]".
 */
import * as cheerio from 'cheerio'
import { cacheMemo } from './cache.js'
import { normalizeTime, parseDays } from './util.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const SCHOOL = 'austincc'
const ORIGIN = 'https://www6.austincc.edu'
const INDEX = `${ORIGIN}/schedule/index.php`

function abs(href) {
  return href.startsWith('http') ? href : `${ORIGIN}${href}`
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`ACC schedule returned HTTP ${res.status}`)
  return cheerio.load(await res.text())
}

/** The landing page's "Credit Terms" menu: [{ code, label, url }]. */
async function termIndex() {
  return cacheMemo(
    `${SCHOOL}:terms`,
    async () => {
      const $ = await getHtml(`${ORIGIN}/schedule/`)
      const out = []
      // The sidebar has one .menu block per group; only "Credit Terms" holds the
      // academic terms (the others are Continuing Ed / campus links).
      $('div.menu').each((_, block) => {
        // Exactly "Credit Terms": the sidebar also has "Future Credit Terms"
        // and "Past Credit Terms" blocks, whose links are browse modes
        // ("Discipline", "Location", ...) rather than terms.
        if (!/^credit terms$/i.test($(block).children('h2').first().text().trim())) return
        $(block)
          .find('a')
          .each((__, a) => {
            const href = ($(a).attr('href') || '').replace(/&amp;/g, '&')
            const code = (href.match(/[?&]term=([^&]+)/) || [])[1]
            const label = $(a).text().replace(/\s+/g, ' ').trim()
            if (code && label) out.push({ code, label, url: abs(href) })
          })
      })
      if (!out.length) throw new Error('ACC term menu returned no credit terms')
      return out
    },
    60 * 60 * 1000
  )
}

export async function getTerms() {
  return (await termIndex()).map(({ code, label }) => ({ code, label }))
}

/** Discipline links for one term: [{ code, label, url }]. */
async function disciplineIndex(termCode) {
  return cacheMemo(
    `${SCHOOL}:disciplines:${termCode}`,
    async () => {
      const terms = await termIndex()
      const term = terms.find((t) => t.code === termCode)
      const fallback = `${INDEX}?op=browse&opclass=ViewSched&term=${encodeURIComponent(termCode)}&ct=CC`
      const $ = await getHtml(term ? term.url : fallback)
      const out = []
      const seen = new Set()
      $('a[href*="disciplineid="]').each((_, a) => {
        const href = ($(a).attr('href') || '').replace(/&amp;/g, '&')
        const opclass = (href.match(/[?&]opclass=([^&]+)/) || [])[1] || ''
        const disciplineId = (href.match(/[?&]disciplineid=([^&]+)/) || [])[1] || ''
        const label = $(a).text().replace(/\s+/g, ' ').trim()
        if (!disciplineId || !label) return
        // TFIND is shared by several interdisciplinary programs, so those key
        // off their opclass suffix to stay unique.
        const code =
          opclass === 'ViewSched'
            ? disciplineId
            : opclass.replace(/^ViewSched_?/, '') || disciplineId
        if (seen.has(code)) return
        seen.add(code)
        out.push({ code, label, url: abs(href) })
      })
      return out.sort((a, b) => a.label.localeCompare(b.label))
    },
    60 * 60 * 1000
  )
}

export async function getSubjects(termCode) {
  return (await disciplineIndex(termCode)).map(({ code, label }) => ({ code, label }))
}

/** "[17/23/0]" -> { max: 23, current: 17, available: 6 }. */
function parseSeats(text) {
  const m = String(text || '').match(/\[\s*(-?\d+)\s*\/\s*(-?\d+)\s*\/\s*(-?\d+)?\s*\]/)
  if (!m) return { max: null, current: null, available: null }
  const current = Number(m[1])
  const max = Number(m[2])
  return { max, current, available: max - current }
}

/** " 10:30am- 11:45am" + "TTh" -> one meeting. */
function parseMeeting(timeText, dayText, location) {
  const m = String(timeText || '')
    .replace(/\s+/g, '')
    .match(/^(\d{1,2}:\d{2}[ap]m)-(\d{1,2}:\d{2}[ap]m)$/i)
  const days = parseDays(dayText)
  if (!m || !days.length) return null
  const startTime = normalizeTime(m[1])
  const endTime = normalizeTime(m[2])
  if (!startTime || !endTime) return null
  return { days, startTime, endTime, location }
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  return cacheMemo(`${SCHOOL}:sections:${termCode}:${subjectCode}`, async () => {
    const disciplines = await disciplineIndex(termCode)
    const discipline = disciplines.find((d) => d.code === subjectCode)
    if (!discipline) throw new Error(`ACC has no discipline "${subjectCode}" in term ${termCode}`)

    const $ = await getHtml(discipline.url)
    const out = []
    // Sections sit under a per-course <h4> header, walked in document order:
    // "ACCT 2301 Principles of Accounting I - Financial".
    let course = null
    $('h4, tr').each((_, el) => {
      if (el.tagName === 'h4') {
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        const m = text.match(/^([A-Z]{2,5})\s+(\w+)\s+(.*)$/)
        course = m ? { subject: m[1], number: m[2], title: m[3].trim() } : null
        return
      }
      if (!course) return
      const cells = $(el)
        .find('td')
        .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get()
      if (cells.length < 12) return
      const crn = cells[4]
      if (!/^\d{4,7}$/.test(crn)) return

      const location = [cells[8], cells[9]].filter(Boolean).join(' ')
      const meeting = parseMeeting(cells[11], cells[10], location)
      const enrollment = parseSeats(cells[3])

      out.push({
        school: SCHOOL,
        termCode,
        termLabel: termLabel || '',
        subjectCode: course.subject,
        subjectLabel: subjectLabel || subjectCode,
        courseNumber: course.number,
        sectionNumber: cells[6],
        crn,
        title: course.title,
        // No instructor column anywhere in the public listing.
        instructors: [],
        // No credit-hours column either.
        credits: null,
        enrollment,
        status:
          enrollment.available == null ? 'unknown' : enrollment.available > 0 ? 'open' : 'closed',
        meetings: meeting ? [meeting] : [],
      })
    })
    return out
  })
}
