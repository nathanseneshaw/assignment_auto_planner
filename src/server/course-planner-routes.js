/**
 * Course-planner Express router.
 *
 * The four scrapers each expose the same contract:
 *   getTerms() -> [{ code, label }]
 *   getSubjects(termCode) -> [{ code, label }]
 *   getSections({ termCode, subjectCode, termLabel?, subjectLabel? }) -> [Section]
 *
 * All routes are PUBLIC  no auth required  because course catalogs are open
 * data and the user picked "on-demand per click" with no per-user state. The
 * scrapers themselves cache for ~5–60 min so repeat clicks don't hammer the
 * universities.
 */
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import * as rice from './course-planner/rice-scraper.js'
import * as ttu from './course-planner/ttu-scraper.js'
import * as tamu from './course-planner/tamu-scraper.js'
import * as smu from './course-planner/smu-scraper.js'
import * as tamuc from './course-planner/tamuc-scraper.js'
import * as txst from './course-planner/txst-scraper.js'
import * as baylor from './course-planner/baylor-scraper.js'
import * as uh from './course-planner/uh-scraper.js'
import * as uhd from './course-planner/uhd-scraper.js'
import * as uhcl from './course-planner/uhcl-scraper.js'
import * as tamuv from './course-planner/tamuv-scraper.js'
import * as lamar from './course-planner/lamar-scraper.js'
import * as msutexas from './course-planner/msutexas-scraper.js'
import * as uta from './course-planner/uta-scraper.js'
import * as uttyler from './course-planner/uttyler-scraper.js'
import * as utrgv from './course-planner/utrgv-scraper.js'
import * as utsa from './course-planner/utsa-scraper.js'
import * as utep from './course-planner/utep-scraper.js'
import * as stmarys from './course-planner/stmarys-scraper.js'
import * as tcu from './course-planner/tcu-scraper.js'
import * as twu from './course-planner/twu-scraper.js'
import * as mit from './course-planner/mit-scraper.js'
import * as stanford from './course-planner/stanford-scraper.js'
import * as yale from './course-planner/yale-scraper.js'
import * as upenn from './course-planner/upenn-scraper.js'
import * as columbia from './course-planner/columbia-scraper.js'

const router = Router()

// 30 requests/min per IP. Generous enough for normal browsing (schools →
// terms → subjects → sections = 4 req/click), tight enough to stop a loop
// from hammering TAMU/Rice and getting the Render dyno IP banned.
const coursePlannerLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests  please wait a moment and try again.' },
})

router.use('/api/course-planner', coursePlannerLimiter)

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
  txst: {
    code: 'txst',
    name: 'Texas State University',
    // Banner SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: txst,
  },
  baylor: {
    code: 'baylor',
    name: 'Baylor University',
    // Banner SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: baylor,
  },
  uh: {
    code: 'uh',
    name: 'University of Houston',
    // PeopleSoft public class search shows only open/closed, not seat counts.
    enrollmentDataAvailable: false,
    scraper: uh,
  },
  uhd: {
    code: 'uhd',
    name: 'University of Houston–Downtown',
    // Same UH-System PeopleSoft class search; only open/closed, no seat counts.
    enrollmentDataAvailable: false,
    scraper: uhd,
  },
  uhcl: {
    code: 'uhcl',
    name: 'University of Houston–Clear Lake',
    // Same UH-System PeopleSoft class search; only open/closed, no seat counts.
    enrollmentDataAvailable: false,
    scraper: uhcl,
  },
  uta: {
    code: 'uta',
    name: 'University of Texas at Arlington',
    // PeopleSoft public class search shows only open/closed, not seat counts.
    enrollmentDataAvailable: false,
    scraper: uta,
  },
  uttyler: {
    code: 'uttyler',
    name: 'University of Texas at Tyler',
    // PeopleSoft guest class search shows only open/closed, not seat counts.
    enrollmentDataAvailable: false,
    scraper: uttyler,
  },
  utrgv: {
    code: 'utrgv',
    name: 'University of Texas Rio Grande Valley',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: utrgv,
  },
  utsa: {
    code: 'utsa',
    name: 'University of Texas at San Antonio',
    // Banner classic schedule listing has meeting times but no seat counts.
    enrollmentDataAvailable: false,
    scraper: utsa,
  },
  utep: {
    code: 'utep',
    name: 'University of Texas at El Paso',
    // Banner classic schedule listing has meeting times but no seat counts.
    enrollmentDataAvailable: false,
    scraper: utep,
  },
  stmarys: {
    code: 'stmarys',
    name: "St. Mary's University",
    // Banner classic schedule listing has meeting times but no seat counts.
    enrollmentDataAvailable: false,
    scraper: stmarys,
  },
  tcu: {
    code: 'tcu',
    name: 'Texas Christian University',
    // ASP.NET class search exposes enrolled + max seats per section.
    enrollmentDataAvailable: true,
    scraper: tcu,
  },
  msutexas: {
    code: 'msutexas',
    name: 'Midwestern State University (MSU Texas)',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: msutexas,
  },
  lamar: {
    code: 'lamar',
    name: 'Lamar University',
    // Banner classic schedule listing has meeting times but no seat counts.
    enrollmentDataAvailable: false,
    scraper: lamar,
  },
  tamuv: {
    code: 'tamuv',
    name: 'Texas A&M University–Victoria',
    // UH-System PeopleSoft class search; only open/closed, no seat counts.
    enrollmentDataAvailable: false,
    scraper: tamuv,
  },
  twu: {
    code: 'twu',
    name: "Texas Woman's University",
    // Colleague Self-Service exposes capacity / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: twu,
  },
  mit: {
    code: 'mit',
    name: 'Massachusetts Institute of Technology',
    // Hydrant catalog JSON has meeting times but no live seat / open-closed data.
    enrollmentDataAvailable: false,
    scraper: mit,
  },
  stanford: {
    code: 'stanford',
    name: 'Stanford University',
    // ExploreCourses XML exposes numEnrolled / maxEnrolled + open/closed status.
    enrollmentDataAvailable: true,
    scraper: stanford,
  },
  yale: {
    code: 'yale',
    name: 'Yale University',
    // FOSE search exposes current enrollment + open/closed but no section capacity.
    enrollmentDataAvailable: false,
    scraper: yale,
  },
  upenn: {
    code: 'upenn',
    name: 'University of Pennsylvania',
    // CourseLeaf CLSS "fose" search exposes open/closed + meeting times but no seat counts.
    enrollmentDataAvailable: false,
    scraper: upenn,
  },
  columbia: {
    code: 'columbia',
    name: 'Columbia University',
    // Directory of Classes exposes live enrolled + max counts; meeting times moved to Vergil (login).
    enrollmentDataAvailable: true,
    scraper: columbia,
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
