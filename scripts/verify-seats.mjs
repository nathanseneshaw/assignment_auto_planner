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
  { school: 'brown', mod: '../src/server/course-planner/brown-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'gatech', mod: '../src/server/course-planner/gatech-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'umd', mod: '../src/server/course-planner/umd-scraper.js', prefer: ['CMSC', 'ECON'] },
  { school: 'wisc', mod: '../src/server/course-planner/wisc-scraper.js', prefer: ['266', '296'] },
  { school: 'neu', mod: '../src/server/course-planner/neu-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'temple', mod: '../src/server/course-planner/temple-scraper.js', prefer: ['CIS', 'ECON'] },
  { school: 'rpi', mod: '../src/server/course-planner/rpi-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'boulder', mod: '../src/server/course-planner/boulder-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'oregonstate', mod: '../src/server/course-planner/oregonstate-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'wm', mod: '../src/server/course-planner/wm-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'ncsu', mod: '../src/server/course-planner/ncsu-scraper.js', prefer: ['CSC', 'EC'] },
  { school: 'vt', mod: '../src/server/course-planner/vt-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'utah', mod: '../src/server/course-planner/utah-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'uci', mod: '../src/server/course-planner/uci-scraper.js', prefer: ['COMPSCI', 'ECON'] },
  { school: 'iowa', mod: '../src/server/course-planner/iowa-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'nd', mod: '../src/server/course-planner/nd-scraper.js', prefer: ['CSE', 'ECON'] },
  { school: 'dartmouth', mod: '../src/server/course-planner/dartmouth-scraper.js', prefer: ['COSC', 'ECON'] },
  { school: 'utk', mod: '../src/server/course-planner/utk-scraper.js', prefer: ['COSC', 'ECON'] },
  { school: 'wvu', mod: '../src/server/course-planner/wvu-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'auburn', mod: '../src/server/course-planner/auburn-scraper.js', prefer: ['COMP', 'ECON'] },
  { school: 'alabama', mod: '../src/server/course-planner/alabama-scraper.js', prefer: ['CS', 'EC'] },
  { school: 'gwu', mod: '../src/server/course-planner/gwu-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'iastate', mod: '../src/server/course-planner/iastate-scraper.js', prefer: ['COMS', 'ECON'] },
  { school: 'ku', mod: '../src/server/course-planner/ku-scraper.js', prefer: ['EECS', 'ECON'] },
  { school: 'msstate', mod: '../src/server/course-planner/msstate-scraper.js', prefer: ['CSE', 'EC'] },
  { school: 'gmu', mod: '../src/server/course-planner/gmu-scraper.js', prefer: ['CS', 'ACCT'] },
  { school: 'unm', mod: '../src/server/course-planner/unm-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'ballstate', mod: '../src/server/course-planner/ballstate-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'wmich', mod: '../src/server/course-planner/wmich-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'wichita', mod: '../src/server/course-planner/wichita-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'uidaho', mod: '../src/server/course-planner/uidaho-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'cofc', mod: '../src/server/course-planner/cofc-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'uncc', mod: '../src/server/course-planner/uncc-scraper.js', prefer: ['ITCS', 'ECON'] },
  { school: 'udel', mod: '../src/server/course-planner/udel-scraper.js', prefer: ['CISC', 'ACCT'] },
  { school: 'odu', mod: '../src/server/course-planner/odu-scraper.js', prefer: ['CS', 'ECON'] },
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
    // "Seats" = any live availability signal (Utah publishes available-only,
    // VT capacity-only).
    const withSeats = sections.filter(
      (s) => s.enrollment && (s.enrollment.max != null || s.enrollment.available != null)
    )
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
