/**
 * Course-planner Express router.
 *
 * The four scrapers each expose the same contract:
 *   getTerms() -> [{ code, label }]
 *   getSubjects(termCode) -> [{ code, label }]
 *   getSections({ termCode, subjectCode, termLabel?, subjectLabel? }) -> [Section]
 *
 * All routes are PUBLIC — no auth required — because course catalogs are open
 * data and the user picked "on-demand per click" with no per-user state. The
 * scrapers themselves cache for ~5–60 min so repeat clicks don't hammer the
 * universities.
 */
import { Router } from 'express'
import * as rice from './course-planner/rice-scraper.js'
import * as ttu from './course-planner/ttu-scraper.js'
import * as tamu from './course-planner/tamu-scraper.js'
import * as smu from './course-planner/smu-scraper.js'
import * as tamuc from './course-planner/tamuc-scraper.js'

const router = Router()

const SCHOOLS = {
  rice: {
    code: 'rice',
    name: 'Rice University',
    enrollmentDataAvailable: true,
    scraper: rice,
  },
  ttu: {
    code: 'ttu',
    name: 'Texas Tech University',
    enrollmentDataAvailable: true,
    scraper: ttu,
  },
  tamu: {
    code: 'tamu',
    name: 'Texas A&M University',
    // Public search only exposes open/closed, not exact counts.
    enrollmentDataAvailable: false,
    scraper: tamu,
  },
  smu: {
    code: 'smu',
    name: 'Southern Methodist University',
    // Quick Reference Schedule has no seat data at all.
    enrollmentDataAvailable: false,
    scraper: smu,
  },
  tamuc: {
    code: 'tamuc',
    name: 'East Texas A&M University',
    // Schedule page exposes max + enrolled seats per section.
    enrollmentDataAvailable: true,
    scraper: tamuc,
  },
}

function getScraper(req, res) {
  const { school } = req.params
  const entry = SCHOOLS[school]
  if (!entry) {
    res.status(404).json({ success: false, error: `Unknown school: ${school}` })
    return null
  }
  return entry
}

/** Send a structured error rather than letting fetch failures dump stack traces. */
function handleError(res, err, what) {
  const msg = err?.message || String(err)
  console.error(`[course-planner] ${what} failed:`, msg)
  res.status(502).json({ success: false, error: `${what} failed: ${msg}` })
}

router.get('/api/course-planner/schools', (_req, res) => {
  res.json({
    success: true,
    schools: Object.values(SCHOOLS).map(({ scraper, ...rest }) => rest),
  })
})

router.get('/api/course-planner/:school/terms', async (req, res) => {
  const entry = getScraper(req, res)
  if (!entry) return
  try {
    const terms = await entry.scraper.getTerms()
    res.json({ success: true, terms })
  } catch (err) {
    handleError(res, err, `${entry.code} terms`)
  }
})

router.get('/api/course-planner/:school/subjects', async (req, res) => {
  const entry = getScraper(req, res)
  if (!entry) return
  const termCode = String(req.query.term || '').trim()
  if (!termCode) {
    return res.status(400).json({ success: false, error: 'Missing ?term=<code>' })
  }
  try {
    const subjects = await entry.scraper.getSubjects(termCode)
    res.json({ success: true, subjects })
  } catch (err) {
    handleError(res, err, `${entry.code} subjects`)
  }
})

router.get('/api/course-planner/:school/sections', async (req, res) => {
  const entry = getScraper(req, res)
  if (!entry) return
  const termCode = String(req.query.term || '').trim()
  const subjectCode = String(req.query.subject || '').trim()
  if (!termCode || !subjectCode) {
    return res
      .status(400)
      .json({ success: false, error: 'Missing ?term=<code>&subject=<code>' })
  }
  try {
    const sections = await entry.scraper.getSections({
      termCode,
      subjectCode,
      termLabel: String(req.query.termLabel || ''),
      subjectLabel: String(req.query.subjectLabel || ''),
    })
    res.json({ success: true, count: sections.length, sections })
  } catch (err) {
    handleError(res, err, `${entry.code} sections`)
  }
})

export default router
