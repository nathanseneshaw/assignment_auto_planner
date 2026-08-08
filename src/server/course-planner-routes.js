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
import { selectCurrentAndNextTerms } from './course-planner/term-window.js'
import { dedupeMeetings } from './course-planner/util.js'
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
import * as utd from './course-planner/utd-scraper.js'
import * as cornell from './course-planner/cornell-scraper.js'
import * as brown from './course-planner/brown-scraper.js'
import * as gatech from './course-planner/gatech-scraper.js'
import * as purdue from './course-planner/purdue-scraper.js'
import * as osu from './course-planner/osu-scraper.js'
import * as uiuc from './course-planner/uiuc-scraper.js'
import * as umd from './course-planner/umd-scraper.js'
import * as rutgers from './course-planner/rutgers-scraper.js'
import * as wisc from './course-planner/wisc-scraper.js'
import * as neu from './course-planner/neu-scraper.js'
import * as temple from './course-planner/temple-scraper.js'
import * as rpi from './course-planner/rpi-scraper.js'
import * as boulder from './course-planner/boulder-scraper.js'
import * as oregonstate from './course-planner/oregonstate-scraper.js'
import * as wm from './course-planner/wm-scraper.js'
import * as ncsu from './course-planner/ncsu-scraper.js'
import * as vt from './course-planner/vt-scraper.js'
import * as utah from './course-planner/utah-scraper.js'
import * as uci from './course-planner/uci-scraper.js'
import * as iowa from './course-planner/iowa-scraper.js'
import * as nd from './course-planner/nd-scraper.js'
import * as dartmouth from './course-planner/dartmouth-scraper.js'
import * as utk from './course-planner/utk-scraper.js'
import * as wvu from './course-planner/wvu-scraper.js'
import * as auburn from './course-planner/auburn-scraper.js'
import * as alabama from './course-planner/alabama-scraper.js'
import * as gwu from './course-planner/gwu-scraper.js'
import * as iastate from './course-planner/iastate-scraper.js'
import * as ku from './course-planner/ku-scraper.js'
import * as msstate from './course-planner/msstate-scraper.js'
import * as gmu from './course-planner/gmu-scraper.js'
import * as unm from './course-planner/unm-scraper.js'
import * as ballstate from './course-planner/ballstate-scraper.js'
import * as wmich from './course-planner/wmich-scraper.js'
import * as wichita from './course-planner/wichita-scraper.js'
import * as uidaho from './course-planner/uidaho-scraper.js'
import * as cofc from './course-planner/cofc-scraper.js'
import * as uncc from './course-planner/uncc-scraper.js'
import * as udel from './course-planner/udel-scraper.js'
import * as odu from './course-planner/odu-scraper.js'

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
    // PeopleSoft class-detail walk fills capacity / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: uh,
  },
  uhd: {
    code: 'uhd',
    name: 'University of Houston–Downtown',
    // Same UH-System PeopleSoft; class-detail walk fills seat counts.
    enrollmentDataAvailable: true,
    scraper: uhd,
  },
  uhcl: {
    code: 'uhcl',
    name: 'University of Houston–Clear Lake',
    // Same UH-System PeopleSoft; class-detail walk fills seat counts.
    enrollmentDataAvailable: true,
    scraper: uhcl,
  },
  uta: {
    code: 'uta',
    name: 'University of Texas at Arlington',
    // PeopleSoft class-detail walk fills capacity / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: uta,
  },
  uttyler: {
    code: 'uttyler',
    name: 'University of Texas at Tyler',
    // PeopleSoft guest class-detail walk fills capacity / enrolled / available seats.
    enrollmentDataAvailable: true,
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
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: utsa,
  },
  utep: {
    code: 'utep',
    name: 'University of Texas at El Paso',
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: utep,
  },
  stmarys: {
    code: 'stmarys',
    name: "St. Mary's University",
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
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
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: lamar,
  },
  tamuv: {
    code: 'tamuv',
    name: 'Texas A&M University–Victoria',
    // UH-System PeopleSoft; class-detail walk fills seat counts.
    enrollmentDataAvailable: true,
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
    // CourseLeaf CLSS "fose" per-section details calls fill max + available seats.
    enrollmentDataAvailable: true,
    scraper: upenn,
  },
  columbia: {
    code: 'columbia',
    name: 'Columbia University',
    // Directory of Classes exposes live enrolled + max counts; meeting times moved to Vergil (login).
    enrollmentDataAvailable: true,
    scraper: columbia,
  },
  utd: {
    code: 'utd',
    name: 'University of Texas at Dallas',
    // UTDNebula public API mirrors CourseBook data but exposes no seat counts.
    enrollmentDataAvailable: false,
    scraper: utd,
  },
  cornell: {
    code: 'cornell',
    name: 'Cornell University',
    // Class Roster API exposes open/closed per section but no seat counts.
    enrollmentDataAvailable: false,
    scraper: cornell,
  },
  brown: {
    code: 'brown',
    name: 'Brown University',
    // FOSE search gives current enrollment; per-section details fill max + available.
    enrollmentDataAvailable: true,
    scraper: brown,
  },
  gatech: {
    code: 'gatech',
    name: 'Georgia Institute of Technology',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: gatech,
  },
  purdue: {
    code: 'purdue',
    name: 'Purdue University',
    // Per-CRN detail pages rate-ban the caller and bwskfcls is login-gated,
    // so the seats walk is disabled: no enrollment data.
    enrollmentDataAvailable: false,
    scraper: purdue,
  },
  osu: {
    code: 'osu',
    name: 'The Ohio State University',
    // Public class search exposes open/closed + current enrollment, no capacity.
    enrollmentDataAvailable: false,
    scraper: osu,
  },
  uiuc: {
    code: 'uiuc',
    name: 'University of Illinois Urbana-Champaign',
    // CIS XML API exposes open/closed text only, no seat counts.
    enrollmentDataAvailable: false,
    scraper: uiuc,
  },
  umd: {
    code: 'umd',
    name: 'University of Maryland',
    // Testudo section markup carries live total + open seat counts.
    enrollmentDataAvailable: true,
    scraper: umd,
  },
  rutgers: {
    code: 'rutgers',
    name: 'Rutgers University–New Brunswick',
    // SOC API exposes open/closed per section but no seat counts.
    enrollmentDataAvailable: false,
    scraper: rutgers,
  },
  wisc: {
    code: 'wisc',
    name: 'University of Wisconsin–Madison',
    // Enrollment packages carry capacity / enrolled / open seats.
    enrollmentDataAvailable: true,
    scraper: wisc,
  },
  neu: {
    code: 'neu',
    name: 'Northeastern University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: neu,
  },
  temple: {
    code: 'temple',
    name: 'Temple University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: temple,
  },
  rpi: {
    code: 'rpi',
    name: 'Rensselaer Polytechnic Institute',
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: rpi,
  },
  boulder: {
    code: 'boulder',
    name: 'University of Colorado Boulder',
    // FOSE per-section details fill max + available seats.
    enrollmentDataAvailable: true,
    scraper: boulder,
  },
  oregonstate: {
    code: 'oregonstate',
    name: 'Oregon State University',
    // FOSE per-section details carry max / enrolled / available fields.
    enrollmentDataAvailable: true,
    scraper: oregonstate,
  },
  wm: {
    code: 'wm',
    name: 'William & Mary',
    // FOSE per-section details fill max + available seats.
    enrollmentDataAvailable: true,
    scraper: wm,
  },
  ncsu: {
    code: 'ncsu',
    name: 'NC State University',
    // Coursecat "Avail." column carries live open/total seats per section.
    enrollmentDataAvailable: true,
    scraper: ncsu,
  },
  vt: {
    code: 'vt',
    name: 'Virginia Tech',
    // Timetable shows capacity only; live enrollment needs a Hokie SPA login.
    enrollmentDataAvailable: false,
    scraper: vt,
  },
  utah: {
    code: 'utah',
    name: 'University of Utah',
    // Class schedule cards carry live "Seats Available" (no max/current).
    enrollmentDataAvailable: true,
    scraper: utah,
  },
  uci: {
    code: 'uci',
    name: 'University of California, Irvine',
    // WebSoc XML carries max enrolled + current enrollment per section.
    enrollmentDataAvailable: true,
    scraper: uci,
  },
  iowa: {
    code: 'iowa',
    name: 'University of Iowa',
    // MAUI sections API carries maxEnroll / currentEnroll per section.
    enrollmentDataAvailable: true,
    scraper: iowa,
  },
  nd: {
    code: 'nd',
    name: 'University of Notre Dame',
    // FOSE per-section details fill max + available seats.
    enrollmentDataAvailable: true,
    scraper: nd,
  },
  dartmouth: {
    code: 'dartmouth',
    name: 'Dartmouth College',
    // FOSE per-section details fill max + available seats.
    enrollmentDataAvailable: true,
    scraper: dartmouth,
  },
  utk: {
    code: 'utk',
    name: 'University of Tennessee, Knoxville',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: utk,
  },
  wvu: {
    code: 'wvu',
    name: 'West Virginia University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: wvu,
  },
  auburn: {
    code: 'auburn',
    name: 'Auburn University',
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: auburn,
  },
  alabama: {
    code: 'alabama',
    name: 'University of Alabama',
    // Public detail pages omit the seats table (login-gated in myBama).
    enrollmentDataAvailable: false,
    scraper: alabama,
  },
  gwu: {
    code: 'gwu',
    name: 'George Washington University',
    // Schedule of Classes shows OPEN/CLOSED text only, no seat counts.
    enrollmentDataAvailable: false,
    scraper: gwu,
  },
  iastate: {
    code: 'iastate',
    name: 'Iowa State University',
    // Workday API carries live open-seat counts per section (no max/current).
    enrollmentDataAvailable: true,
    scraper: iastate,
  },
  ku: {
    code: 'ku',
    name: 'University of Kansas',
    // Seats popover carries full "enrolled out of maximum" counts per section.
    enrollmentDataAvailable: true,
    scraper: ku,
  },
  msstate: {
    code: 'msstate',
    name: 'Mississippi State University',
    // Master Schedule JSON carries total + available seats per section.
    enrollmentDataAvailable: true,
    scraper: msstate,
  },
  gmu: {
    code: 'gmu',
    name: 'George Mason University',
    // Banner classic per-CRN detail pages fill capacity / enrolled / available.
    enrollmentDataAvailable: true,
    scraper: gmu,
  },
  unm: {
    code: 'unm',
    name: 'University of New Mexico',
    // Banner 9 SSB exposes max / enrolled / available seats (no instructors).
    enrollmentDataAvailable: true,
    scraper: unm,
  },
  ballstate: {
    code: 'ballstate',
    name: 'Ball State University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: ballstate,
  },
  wmich: {
    code: 'wmich',
    name: 'Western Michigan University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: wmich,
  },
  wichita: {
    code: 'wichita',
    name: 'Wichita State University',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: wichita,
  },
  uidaho: {
    code: 'uidaho',
    name: 'University of Idaho',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: uidaho,
  },
  cofc: {
    code: 'cofc',
    name: 'College of Charleston',
    // Banner 9 SSB exposes max / enrolled / available seats.
    enrollmentDataAvailable: true,
    scraper: cofc,
  },
  uncc: {
    code: 'uncc',
    name: 'UNC Charlotte',
    // Banner 9 SSB exposes max / enrolled / available seats (CS subject = ITCS).
    enrollmentDataAvailable: true,
    scraper: uncc,
  },
  udel: {
    code: 'udel',
    name: 'University of Delaware',
    // Course Search "Open seats" carries available + capacity per section.
    enrollmentDataAvailable: true,
    scraper: udel,
  },
  odu: {
    code: 'odu',
    name: 'Old Dominion University',
    // Course Search JSON carries live "current of max" enrollment per section.
    enrollmentDataAvailable: true,
    scraper: odu,
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
    // Every school's terms get the same treatment: uniform "Season YYYY" labels,
    // trimmed to just the current term plus the next one (see term-window.js).
    const terms = selectCurrentAndNextTerms(await entry.scraper.getTerms())
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
    // Central safety net for every school: some feeds emit one meeting row per
    // calendar date, which collapse to identical weekly blocks. Dedupe here so
    // no scraper can render stacked duplicate slots or skew the builder's math.
    for (const s of sections) {
      if (Array.isArray(s.meetings)) s.meetings = dedupeMeetings(s.meetings)
    }
    res.json({ success: true, count: sections.length, sections })
  } catch (err) {
    handleError(res, err, `${entry.code} sections`)
  }
})

export default router
