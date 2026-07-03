// Live verification: run each modified scraper end-to-end and report seat coverage.
const TARGETS = [
  { school: 'utsa', mod: '../src/server/course-planner/utsa-scraper.js', prefer: ['CS', 'ACC'] },
  { school: 'utep', mod: '../src/server/course-planner/utep-scraper.js', prefer: ['CS', 'ACCT'] },
  { school: 'stmarys', mod: '../src/server/course-planner/stmarys-scraper.js', prefer: ['EN', 'AC'] },
  { school: 'lamar', mod: '../src/server/course-planner/lamar-scraper.js', prefer: ['ACCT', 'COSC'] },
  { school: 'upenn', mod: '../src/server/course-planner/upenn-scraper.js', prefer: ['CIS'] },
  { school: 'uh', mod: '../src/server/course-planner/uh-scraper.js', prefer: ['ACCT'] },
  { school: 'uhcl', mod: '../src/server/course-planner/uhcl-scraper.js', prefer: ['ACCT'] },
  { school: 'tamuv', mod: '../src/server/course-planner/tamuv-scraper.js', prefer: ['ACCT', 'BIOL'] },
  { school: 'uta', mod: '../src/server/course-planner/uta-scraper.js', prefer: ['ACCT', 'CSE'] },
  { school: 'uttyler', mod: '../src/server/course-planner/uttyler-scraper.js', prefer: ['ACCT', 'CSCI'] },
]

const which = process.argv[2] // optional filter
for (const t of TARGETS) {
  if (which && t.school !== which) continue
  const started = Date.now()
  try {
    const scraper = await import(t.mod)
    const terms = (await scraper.getTerms()).filter((x) => !/view only/i.test(x.label))
    const term = terms[0]
    const subjects = await scraper.getSubjects(term.code)
    const subject =
      subjects.find((s) => t.prefer.includes(s.code)) || subjects[Math.min(4, subjects.length - 1)]
    const secStart = Date.now()
    const sections = await scraper.getSections({
      termCode: term.code,
      subjectCode: subject.code,
      termLabel: term.label,
      subjectLabel: subject.label,
    })
    const withSeats = sections.filter((s) => s.enrollment && s.enrollment.max != null)
    const sample = withSeats[0]
    console.log(
      `${t.school.padEnd(8)} term=${term.code} subj=${subject.code} sections=${sections.length} withSeats=${withSeats.length} secTime=${((Date.now() - secStart) / 1000).toFixed(1)}s total=${((Date.now() - started) / 1000).toFixed(1)}s`
    )
    if (sample) {
      console.log(
        `         sample: ${sample.subjectCode} ${sample.courseNumber}-${sample.sectionNumber} crn=${sample.crn} seats=${JSON.stringify(sample.enrollment)} status=${sample.status}`
      )
    }
  } catch (e) {
    console.log(`${t.school.padEnd(8)} ERROR after ${((Date.now() - started) / 1000).toFixed(1)}s: ${e.message}`)
  }
}
