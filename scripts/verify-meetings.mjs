// Live verification: run every scraper end-to-end and report meeting day/time coverage.
// Usage: node scripts/verify-meetings.mjs [school]
import '../src/server/load-env.js'
import { selectCurrentAndNextTerms } from '../src/server/course-planner/term-window.js'

const TARGETS = [
  { school: 'rice', mod: '../src/server/course-planner/rice-scraper.js', prefer: ['COMP', 'ECON'] },
  { school: 'ttu', mod: '../src/server/course-planner/ttu-scraper.js', prefer: ['CS', 'ECO'] },
  { school: 'tamu', mod: '../src/server/course-planner/tamu-scraper.js', prefer: ['CSCE', 'ECON'] },
  { school: 'smu', mod: '../src/server/course-planner/smu-scraper.js', prefer: ['CS', 'ECO'] },
  { school: 'tamuc', mod: '../src/server/course-planner/tamuc-scraper.js', prefer: ['CSCI', 'ECO'] },
  { school: 'txst', mod: '../src/server/course-planner/txst-scraper.js', prefer: ['CS', 'ECO'] },
  { school: 'baylor', mod: '../src/server/course-planner/baylor-scraper.js', prefer: ['CSI', 'ECO'] },
  { school: 'uh', mod: '../src/server/course-planner/uh-scraper.js', prefer: ['ACCT'] },
  { school: 'uhd', mod: '../src/server/course-planner/uhd-scraper.js', prefer: ['ACCT'] },
  { school: 'uhcl', mod: '../src/server/course-planner/uhcl-scraper.js', prefer: ['ACCT'] },
  { school: 'uta', mod: '../src/server/course-planner/uta-scraper.js', prefer: ['ACCT', 'CSE'] },
  { school: 'uttyler', mod: '../src/server/course-planner/uttyler-scraper.js', prefer: ['ACCT', 'CSCI'] },
  { school: 'utrgv', mod: '../src/server/course-planner/utrgv-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'utsa', mod: '../src/server/course-planner/utsa-scraper.js', prefer: ['CS', 'ACC'] },
  { school: 'utep', mod: '../src/server/course-planner/utep-scraper.js', prefer: ['CS', 'ACCT'] },
  { school: 'stmarys', mod: '../src/server/course-planner/stmarys-scraper.js', prefer: ['EN', 'AC'] },
  { school: 'tcu', mod: '../src/server/course-planner/tcu-scraper.js', prefer: ['COSC', 'CS'] },
  { school: 'msutexas', mod: '../src/server/course-planner/msutexas-scraper.js', prefer: ['CMPS', 'ECON'] },
  { school: 'lamar', mod: '../src/server/course-planner/lamar-scraper.js', prefer: ['ACCT', 'COSC'] },
  { school: 'tamuv', mod: '../src/server/course-planner/tamuv-scraper.js', prefer: ['ACCT', 'BIOL'] },
  { school: 'twu', mod: '../src/server/course-planner/twu-scraper.js', prefer: ['CSCI', 'BIOL'] },
  { school: 'mit', mod: '../src/server/course-planner/mit-scraper.js', prefer: ['6'] },
  { school: 'stanford', mod: '../src/server/course-planner/stanford-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'yale', mod: '../src/server/course-planner/yale-scraper.js', prefer: ['CPSC', 'ECON'] },
  { school: 'upenn', mod: '../src/server/course-planner/upenn-scraper.js', prefer: ['CIS'] },
  { school: 'columbia', mod: '../src/server/course-planner/columbia-scraper.js', prefer: ['COMS', 'ECON'] },
  { school: 'utd', mod: '../src/server/course-planner/utd-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'cornell', mod: '../src/server/course-planner/cornell-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'brown', mod: '../src/server/course-planner/brown-scraper.js', prefer: ['CSCI', 'ECON'] },
  { school: 'gatech', mod: '../src/server/course-planner/gatech-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'purdue', mod: '../src/server/course-planner/purdue-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'osu', mod: '../src/server/course-planner/osu-scraper.js', prefer: ['cse', 'econ'] },
  { school: 'uiuc', mod: '../src/server/course-planner/uiuc-scraper.js', prefer: ['CS', 'ECON'] },
  { school: 'umd', mod: '../src/server/course-planner/umd-scraper.js', prefer: ['CMSC', 'ECON'] },
  { school: 'rutgers', mod: '../src/server/course-planner/rutgers-scraper.js', prefer: ['198', '220'] },
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
  { school: 'gmu', mod: '../src/server/course-planner/gmu-scraper.js', prefer: ['CS', 'ECON'] },
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

const hasDays = (d) => (Array.isArray(d) ? d.length > 0 : !!(d && String(d).trim()))

async function probe(t) {
  const started = Date.now()
  const scraper = await import(t.mod)
  const rawTerms = await scraper.getTerms()
  // Probe the same term the app would show (current+next window), preferring Fall.
  const windowTerms = selectCurrentAndNextTerms(rawTerms)
  const term =
    windowTerms.find((x) => /fall/i.test(x.label)) ||
    windowTerms[windowTerms.length - 1] ||
    rawTerms[0]
  const subjects = await scraper.getSubjects(term.code)
  const wanted = t.prefer.map((p) => p.toLowerCase())
  const COMMON = ['cs', 'csci', 'cse', 'comp', 'cosc', 'econ', 'acct', 'math', 'biol']
  const subject =
    subjects.find((s) => wanted.includes(String(s.code).trim().toLowerCase())) ||
    subjects.find((s) => COMMON.includes(String(s.code).trim().toLowerCase())) ||
    subjects[Math.min(4, subjects.length - 1)]
  const sections = await scraper.getSections({
    termCode: term.code,
    subjectCode: subject.code,
    termLabel: term.label,
    subjectLabel: subject.label,
  })
  const withMeetings = sections.filter((s) => (s.meetings || []).length > 0)
  // "Full" = at least one meeting carries BOTH a day pattern and start+end times.
  const withDayTime = sections.filter((s) =>
    (s.meetings || []).some((m) => hasDays(m.days) && m.startTime && m.endTime)
  )
  const dayNoTime = sections.filter(
    (s) =>
      (s.meetings || []).length > 0 &&
      !(s.meetings || []).some((m) => hasDays(m.days) && m.startTime && m.endTime)
  )
  const sample = withDayTime[0]?.meetings?.find((m) => hasDays(m.days) && m.startTime) ||
    withMeetings[0]?.meetings?.[0]
  const lines = [
    `${t.school.padEnd(11)} term=${term.code} subj=${subject.code} sections=${sections.length} withMeetings=${withMeetings.length} withDay+Time=${withDayTime.length} meetingsButIncomplete=${dayNoTime.length} time=${((Date.now() - started) / 1000).toFixed(1)}s`,
  ]
  if (sample) lines.push(`            sample: ${JSON.stringify(sample)}`)
  return lines.join('\n')
}

const which = process.argv[2]
const queue = TARGETS.filter((t) => !which || t.school === which)
const CONCURRENCY = which ? 1 : 4
const TIMEOUT_MS = 300_000

async function worker() {
  for (;;) {
    const t = queue.shift()
    if (!t) return
    const started = Date.now()
    try {
      const out = await Promise.race([
        probe(t),
        new Promise((_, rej) => setTimeout(() => rej(new Error('school timeout')), TIMEOUT_MS)),
      ])
      console.log(out)
    } catch (e) {
      console.log(
        `${t.school.padEnd(11)} ERROR after ${((Date.now() - started) / 1000).toFixed(1)}s: ${e.message}`
      )
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
