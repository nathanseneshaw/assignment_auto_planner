/**
 * Backend payloads (and the two-line UI helpers that go with them) for the
 * Course Planner specs.
 *
 * Shapes are copied from src/server/course-planner-routes.js, not invented:
 *
 *   GET /api/course-planner/schools           -> { success, schools }
 *   GET /api/course-planner/:school/terms     -> { success, terms }
 *   GET /api/course-planner/:school/subjects  -> { success, subjects }
 *   GET /api/course-planner/:school/sections  -> { success, count, sections }
 *
 * The Section shape is the normalised one every scraper returns, documented in
 * src/server/course-planner/util.js and exercised by the store unit tests.
 *
 * The catalogue below is deliberately small but covers every branch the page
 * can render: two sections of one course (so the builder has something to
 * combine), a course that is closed, a course that is at capacity, and a course
 * with no meeting times at all.
 */

export const SCHOOL_CODE = 'rice'
export const SCHOOL_NAME = 'Rice University'
export const TERM_CODE = '202610'
export const TERM_LABEL = 'Fall 2026'

/** Substring / RegExp matchers for the `api` fixture. */
export const ENDPOINTS = {
  schools: '/api/course-planner/schools',
  terms: /\/api\/course-planner\/[^/]+\/terms/,
  subjects: /\/api\/course-planner\/[^/]+\/subjects/,
  sections: /\/api\/course-planner\/[^/]+\/sections/,
}

export const SCHOOLS = [
  { code: 'rice', name: SCHOOL_NAME, enrollmentDataAvailable: true },
  { code: 'ttu', name: 'Texas Tech University', enrollmentDataAvailable: true },
]

export const TERMS = [
  { code: TERM_CODE, label: TERM_LABEL },
  { code: '202620', label: 'Spring 2027' },
]

export const SUBJECTS = [
  { code: 'COMP', label: 'Computer Science' },
  { code: 'MATH', label: 'Mathematics' },
  { code: 'PHYS', label: 'Physics' },
]

/** Dropdown option labels, built the way CoursePlannerPage builds them. */
export const SUBJECT_OPTION = {
  COMP: 'COMP · Computer Science',
  MATH: 'MATH · Mathematics',
  PHYS: 'PHYS · Physics',
}

/** A normalised, registerable section. Override anything a test cares about. */
export function makeSection(over = {}) {
  return {
    school: SCHOOL_CODE,
    termCode: TERM_CODE,
    termLabel: TERM_LABEL,
    subjectCode: 'COMP',
    subjectLabel: 'Computer Science',
    courseNumber: '140',
    sectionNumber: '001',
    crn: '11001',
    title: 'Intro to Programming',
    instructors: ['Ada Byron'],
    credits: 3,
    enrollment: { max: 30, current: 10, available: 20 },
    status: 'open',
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '10:00', location: 'Herzstein 210' }],
    ...over,
  }
}

/** COMP 140 section 001: open, 9-10 Mon/Wed. */
export const COMP_140_001 = makeSection()

/** COMP 140 section 002: the same course at a different hour, so combos exist. */
export const COMP_140_002 = makeSection({
  crn: '11002',
  sectionNumber: '002',
  enrollment: { max: 30, current: 20, available: 10 },
  meetings: [{ days: ['M', 'W'], startTime: '11:00', endTime: '12:00', location: 'Herzstein 210' }],
})

/** COMP 182: open, Tue/Thu, so it never collides with either COMP 140 section. */
export const COMP_182_001 = makeSection({
  crn: '12001',
  courseNumber: '182',
  title: 'Algorithmic Thinking',
  instructors: ['Grace Hopper'],
  enrollment: { max: 40, current: 5, available: 35 },
  meetings: [{ days: ['T', 'R'], startTime: '09:00', endTime: '10:30', location: 'Duncan 1075' }],
})

/** COMP 215: explicitly closed, so sectionUnavailable() reports 'closed'. */
export const COMP_215_001 = makeSection({
  crn: '13001',
  courseNumber: '215',
  title: 'Data Science Tools',
  instructors: ['Alan Turing'],
  status: 'closed',
  enrollment: { max: 25, current: 25, available: 0 },
  meetings: [{ days: ['M', 'W'], startTime: '13:00', endTime: '14:00', location: 'Keck 100' }],
})

/** COMP 310: nominally open but at capacity, so sectionUnavailable() says 'full'. */
export const COMP_310_001 = makeSection({
  crn: '14001',
  courseNumber: '310',
  title: 'Advanced Program Design',
  instructors: ['Barbara Liskov'],
  enrollment: { max: 20, current: 20, available: 0 },
  meetings: [{ days: ['F'], startTime: '13:00', endTime: '14:30', location: 'Keck 100' }],
})

/** COMP 449: no meeting times and no seat data, the async / TBA case. */
export const COMP_449_001 = makeSection({
  crn: '15001',
  courseNumber: '449',
  title: 'Independent Study',
  instructors: [],
  credits: null,
  status: 'unknown',
  enrollment: { max: null, current: null, available: null },
  meetings: [],
})

/** MATH 101 overlaps COMP 140 001 on Mon/Wed: the conflict fixture. */
export const MATH_101_001 = makeSection({
  crn: '21001',
  subjectCode: 'MATH',
  subjectLabel: 'Mathematics',
  courseNumber: '101',
  title: 'Single Variable Calculus',
  instructors: ['Emmy Noether'],
  enrollment: { max: 60, current: 30, available: 30 },
  meetings: [{ days: ['M', 'W'], startTime: '09:30', endTime: '10:30', location: 'Herman Brown 227' }],
})

export const COMP_SECTIONS = [
  COMP_140_001,
  COMP_140_002,
  COMP_182_001,
  COMP_215_001,
  COMP_310_001,
  COMP_449_001,
]

/** PHYS is in the subject list but runs nothing this term: the empty-catalogue case. */
export const SECTIONS_BY_SUBJECT = {
  COMP: COMP_SECTIONS,
  MATH: [MATH_101_001],
  PHYS: [],
}

/**
 * Stub the whole catalogue in one call. Later `api` registrations win, so a
 * spec can follow this with `api.fail(ENDPOINTS.sections)` to break one leg.
 */
export function mockCatalog(
  api,
  {
    schools = SCHOOLS,
    terms = TERMS,
    subjects = SUBJECTS,
    sectionsBySubject = SECTIONS_BY_SUBJECT,
  } = {}
) {
  api.json(ENDPOINTS.schools, { success: true, schools })
  api.json(ENDPOINTS.terms, { success: true, terms })
  api.json(ENDPOINTS.subjects, { success: true, subjects })
  api.json(ENDPOINTS.sections, (request) => {
    const subject = new URL(request.url()).searchParams.get('subject') || ''
    const rows = sectionsBySubject[subject] || []
    return { success: true, count: rows.length, sections: rows }
  })
  return api
}

// --- localStorage seeds -----------------------------------------------------

/** The `coursePlanner:saved` payload: saved sections bucketed by school code. */
export function savedSeed(sections, school = SCHOOL_CODE) {
  return { [school]: sections }
}

/** A scheduleBuilder candidate, derived from a section exactly as the store does. */
export function candidateFor(section) {
  return {
    school: section.school,
    termCode: section.termCode,
    subjectCode: section.subjectCode,
    subjectLabel: section.subjectLabel,
    courseNumber: section.courseNumber,
    title: section.title,
    pinnedCrn: null,
  }
}

/** The `coursePlanner:candidates` payload, keyed `school:termCode`. */
export function candidatesSeed(sections, school = SCHOOL_CODE, termCode = TERM_CODE) {
  return { [`${school}:${termCode}`]: sections.map(candidateFor) }
}

// --- UI helpers -------------------------------------------------------------
// The page's Term / Subject controls are custom listbox dropdowns (a trigger
// button whose label is the current selection, plus role="option" rows), so
// both steps are always the same two clicks.

export async function pickTerm(page, label = TERM_LABEL) {
  await page.getByRole('button', { name: 'Select a term' }).click()
  await page.getByRole('option', { name: label }).click()
}

export async function pickSubject(page, optionLabel = SUBJECT_OPTION.COMP) {
  await page.getByRole('button', { name: 'Select a subject' }).click()
  await page.getByRole('option', { name: optionLabel }).click()
}

/** The results rail's "Filter results" box. */
export function filterBox(page) {
  return page.getByPlaceholder('Title, course #, instructor…')
}
