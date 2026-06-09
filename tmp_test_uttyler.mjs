import * as uttyler from './src/server/course-planner/uttyler-scraper.js'

const t0 = Date.now()
const log = (...a) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const terms = await uttyler.getTerms()
log('TERMS:', terms.length)
console.log('  ', terms.map((t) => `${t.code}=${t.label}`).join('  |  '))

// Near-term general (non-SOM) terms most likely to have posted sections.
for (const termCode of ['2265', '2268']) {
  const term = terms.find((t) => t.code === termCode)
  log(`\n===== TERM ${termCode} (${term?.label || '?'}) =====`)
  let subjects
  try {
    subjects = await uttyler.getSubjects(termCode)
  } catch (e) {
    log('getSubjects ERROR:', e.message)
    continue
  }
  log('SUBJECTS:', subjects.length, '->', subjects.slice(0, 25).map((s) => s.code).join(','))
  if (!subjects.length) continue

  // Probe subjects until one returns sections (cap the probing).
  const probe = ['COSC', 'CSCI', 'MATH', 'ENGL', 'BIOL', 'ACCT', 'PSYC', 'NURS', 'KINE', 'HIST']
    .filter((c) => subjects.some((s) => s.code === c))
  const order = [...probe, ...subjects.map((s) => s.code).filter((c) => !probe.includes(c))]

  let found = 0
  for (const subjectCode of order.slice(0, 8)) {
    try {
      const sections = await uttyler.getSections({ termCode, subjectCode, termLabel: term?.label })
      log(`  ${subjectCode}: ${sections.length} sections`)
      if (sections.length) {
        found += sections.length
        sections.slice(0, 5).forEach((s) =>
          console.log(
            '      ',
            JSON.stringify({
              crn: s.crn,
              course: `${s.subjectCode} ${s.courseNumber}-${s.sectionNumber}`,
              title: s.title,
              instr: s.instructors.join(', '),
              status: s.status,
              meetings: s.meetings.map((m) => `${m.days.join('')} ${m.startTime}-${m.endTime} ${m.location}`),
            })
          )
        )
        break // got proof of real section data for this term
      }
    } catch (e) {
      log(`  ${subjectCode}: ERROR ${e.message}`)
    }
  }
  log(`term ${termCode} total sample sections: ${found}`)
}
log('\nDONE')
