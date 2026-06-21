/**
 * MIT scraper.
 *
 * MIT publishes its entire course catalog for the active term as a single public
 * JSON file at hydrant.mit.edu/latest.json — the data backend for the
 * student-built Hydrant scheduler. One file holds every subject, with meeting
 * times encoded in MIT's compact "room/days/evening/time" raw-section string.
 *
 * Hydrant is *catalog* data, not live registration: there are no real-time seat
 * counts and no open/closed flag, so enrollment.* stays null and status is
 * 'unknown'. Meeting times, rooms, instructors and units are all present.
 *
 * MIT identifies subjects by number ("6.1010"), not CRN, and groups them by
 * course/department number — the part before the dot ("6" = EECS). We expose
 * those department numbers as the "subject" list. Because latest.json only ever
 * carries one term, getTerms returns that single term and the term code is
 * accepted but not used to vary the query.
 */
import { cacheMemo } from './cache.js'
import { parseDays } from './util.js'

const HYDRANT_URL = 'https://hydrant.mit.edu/latest.json'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// MIT course/department numbers → human names. Best-effort; unknown codes fall
// back to the bare number so a newly-added department still lists (just unlabeled).
const DEPARTMENTS = {
  1: 'Civil and Environmental Engineering',
  2: 'Mechanical Engineering',
  3: 'Materials Science and Engineering',
  4: 'Architecture',
  5: 'Chemistry',
  6: 'Electrical Engineering and Computer Science',
  7: 'Biology',
  8: 'Physics',
  9: 'Brain and Cognitive Sciences',
  10: 'Chemical Engineering',
  11: 'Urban Studies and Planning',
  12: 'Earth, Atmospheric and Planetary Sciences',
  14: 'Economics',
  15: 'Management (Sloan)',
  16: 'Aeronautics and Astronautics',
  17: 'Political Science',
  18: 'Mathematics',
  20: 'Biological Engineering',
  21: 'Humanities',
  '21A': 'Anthropology',
  '21G': 'Global Languages',
  '21H': 'History',
  '21L': 'Literature',
  '21M': 'Music and Theater Arts',
  '21T': 'Theater Arts',
  '21W': 'Writing',
  22: 'Nuclear Science and Engineering',
  24: 'Linguistics and Philosophy',
  AS: 'Aerospace Studies (AFROTC)',
  CC: 'Concourse',
  CMS: 'Comparative Media Studies',
  CSB: 'Computational and Systems Biology',
  CSE: 'Computational Science and Engineering',
  EC: 'Edgerton Center',
  EM: 'Engineering Management',
  ES: 'Experimental Study Group',
  HST: 'Health Sciences and Technology',
  IDS: 'Data, Systems, and Society',
  MAD: 'Morningside Academy for Design',
  MAS: 'Media Arts and Sciences',
  MS: 'Military Science (Army ROTC)',
  NS: 'Naval Science (NROTC)',
  SCM: 'Supply Chain Management',
  SP: 'Special Programs',
  STS: 'Science, Technology and Society',
  SWE: 'Solar Electric Vehicle Team',
  WGS: "Women's and Gender Studies",
}

/** GET + parse latest.json once, cached 30 min. */
async function loadCatalog() {
  return cacheMemo(
    'mit:catalog',
    async () => {
      const res = await fetch(HYDRANT_URL, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`Hydrant returned HTTP ${res.status}`)
      return res.json()
    },
    30 * 60 * 1000
  )
}

/** "f26" -> { code:'f26', label:'Fall 2026' }. */
function termFromUrlName(urlName) {
  const m = String(urlName || '').match(/^(su|ia|f|s)(\d{2})$/i)
  if (!m) return { code: String(urlName || ''), label: String(urlName || '') }
  const season = { su: 'Summer', ia: 'IAP', f: 'Fall', s: 'Spring' }[m[1].toLowerCase()]
  return { code: urlName, label: `${season} 20${m[2]}` }
}

export async function getTerms() {
  const cat = await loadCatalog()
  return [termFromUrlName(cat.termInfo?.urlName)]
}

export async function getSubjects() {
  const cat = await loadCatalog()
  const seen = new Set()
  for (const cls of Object.values(cat.classes || {})) {
    if (cls.course) seen.add(cls.course)
  }
  return [...seen]
    .map((code) => ({ code, label: DEPARTMENTS[code] || `Course ${code}` }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/**
 * Decode one "room/days/evening/time" raw-section string into a meeting.
 * e.g. "2-132/TR/0/1-2.30" -> { days:['T','R'], startTime:'13:00', endTime:'14:30', location:'2-132' }
 * MIT writes minutes after a dot ("2.30" = 2:30) and leaves AM/PM implicit: hours
 * 8–12 are morning, 1–7 are afternoon, and the middle field (1) forces evening PM.
 */
function parseRawSection(raw) {
  const parts = String(raw || '').split('/')
  if (parts.length < 4) return null
  const [location, dayStr, eveningFlag, timeStr] = parts
  const days = parseDays(dayStr)
  if (!days.length) return null
  const evening = eveningFlag === '1'
  const tm = String(timeStr).match(/^(\d{1,2})(?:\.(\d{2}))?-(\d{1,2})(?:\.(\d{2}))?$/)
  if (!tm) return null
  const to24 = (hStr) => {
    let h = Number(hStr)
    if (evening) return h === 12 ? 12 : h + 12
    if (h >= 1 && h <= 7) return h + 12 // 1–7 o'clock means PM at MIT
    return h // 8–12 stay as morning / noon
  }
  const startTime = `${String(to24(tm[1])).padStart(2, '0')}:${tm[2] || '00'}`
  const endTime = `${String(to24(tm[3])).padStart(2, '0')}:${tm[4] || '00'}`
  return { days, startTime, endTime, location: location || '' }
}

function parseInstructors(inCharge) {
  return String(inCharge || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(staff|tba|to be announced)$/i.test(s))
}

export async function getSections({ termCode, subjectCode, termLabel, subjectLabel }) {
  const cat = await loadCatalog()
  const out = []
  const label = subjectLabel || DEPARTMENTS[subjectCode] || subjectCode
  for (const cls of Object.values(cat.classes || {})) {
    if (cls.course !== subjectCode) continue

    const meetings = [
      ...(cls.lectureRawSections || []),
      ...(cls.recitationRawSections || []),
      ...(cls.labRawSections || []),
      ...(cls.designRawSections || []),
    ]
      .map(parseRawSection)
      .filter(Boolean)

    const totalUnits =
      (cls.lectureUnits || 0) + (cls.labUnits || 0) + (cls.preparationUnits || 0)

    // Hydrant's `course` is the part before the dot ("6" of "6.1010"); drop it from
    // courseNumber so the UI's "{subjectCode} {courseNumber}" shows "6 1010", not "6 6.1010".
    const courseNumber = cls.number?.startsWith(`${cls.course}.`)
      ? cls.number.slice(cls.course.length + 1)
      : cls.number

    out.push({
      school: 'mit',
      termCode,
      termLabel: termLabel || termFromUrlName(cat.termInfo?.urlName).label,
      subjectCode,
      subjectLabel: label,
      courseNumber,
      sectionNumber: '',
      crn: cls.number, // MIT has no CRN; the full subject number is the unique per-term id
      title: cls.name || '',
      instructors: parseInstructors(cls.inCharge),
      credits: cls.isVariableUnits || !totalUnits ? null : totalUnits,
      enrollment: { max: null, current: null, available: null },
      status: 'unknown', // Hydrant is catalog data — no live seat / open-closed info
      meetings,
    })
  }
  return out.sort((a, b) =>
    a.courseNumber.localeCompare(b.courseNumber, undefined, { numeric: true })
  )
}
