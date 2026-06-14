/**
 * Live verification harness for the course-planner scrapers.
 *
 * For each school it runs the real three-call contract against the live
 * university endpoints — getTerms -> getSubjects -> getSections — picking a
 * plausible upcoming term and a common subject, and reports where (if anywhere)
 * the chain breaks plus a sample section so we can eyeball data quality.
 *
 *   node scripts/verify-course-scrapers.mjs [school ...]
 *
 * With no args it tests every known school. Each school is wrapped in an overall
 * timeout so one hung scraper can't stall the run.
 */

const SCRAPERS = {
  rice: '../src/server/course-planner/rice-scraper.js',
  ttu: '../src/server/course-planner/ttu-scraper.js',
  tamu: '../src/server/course-planner/tamu-scraper.js',
  smu: '../src/server/course-planner/smu-scraper.js',
  tamuc: '../src/server/course-planner/tamuc-scraper.js',
  txst: '../src/server/course-planner/txst-scraper.js',
  baylor: '../src/server/course-planner/baylor-scraper.js',
  uh: '../src/server/course-planner/uh-scraper.js',
  uhd: '../src/server/course-planner/uhd-scraper.js',
  uhcl: '../src/server/course-planner/uhcl-scraper.js',
  tamuv: '../src/server/course-planner/tamuv-scraper.js',
  lamar: '../src/server/course-planner/lamar-scraper.js',
  msutexas: '../src/server/course-planner/msutexas-scraper.js',
  uta: '../src/server/course-planner/uta-scraper.js',
  uttyler: '../src/server/course-planner/uttyler-scraper.js',
  utrgv: '../src/server/course-planner/utrgv-scraper.js',
  utsa: '../src/server/course-planner/utsa-scraper.js',
  utep: '../src/server/course-planner/utep-scraper.js',
  stmarys: '../src/server/course-planner/stmarys-scraper.js',
  tcu: '../src/server/course-planner/tcu-scraper.js',
  twu: '../src/server/course-planner/twu-scraper.js',
}

// Some scrapers do many sequential postbacks (PeopleSoft) or pull huge payloads
// (TAMU ~30MB/term); give the slow ones more headroom.
const TIMEOUT_MS = {
  default: 150_000,
  uta: 220_000,
  uttyler: 300_000,
  // UH-System PeopleSoft does many sequential postbacks per search.
  uhd: 220_000,
  uhcl: 220_000,
  tamuv: 220_000,
  tamu: 200_000,
  // ASP.NET search bounces intermittently; each section call may retry ~5×.
  tcu: 240_000,
  // Colleague paginates 30 sections/page with sequential POSTs.
  twu: 200_000,
}

const COMMON_SUBJECTS = [
  'MATH', 'ENGL', 'HIST', 'BIOL', 'CHEM', 'PSYC', 'PHYS', 'ACCT',
  'CS', 'CSCI', 'COSC', 'COMP', 'POLS', 'ECON', 'BIO',
]

function termScore(label = '') {
  const s = String(label).toLowerCase()
  let score = 0
  if (s.includes('2026')) score += 100
  else if (s.includes('2027')) score += 90
  else if (s.includes('2025')) score += 40
  if (/\bfall\b/.test(s)) score += 8
  else if (/\bspring\b/.test(s)) score += 6
  else if (/\bsummer\b/.test(s)) score += 4
  // Avoid view-only / School-of-Medicine / podiatry / special cohort terms when a
  // general registration term exists.
  if (/view only/.test(s)) score -= 60
  if (/\b(som|sopm|med|medicine|podiatr|dental|pharm|law|continuing|mini|module)\b/.test(s)) score -= 40
  return score
}

function orderTerms(terms) {
  return [...terms].sort((a, b) => termScore(b.label) - termScore(a.label))
}

function orderSubjects(subjects) {
  const common = []
  const rest = []
  for (const sub of subjects) {
    if (COMMON_SUBJECTS.includes(String(sub.code).toUpperCase())) common.push(sub)
    else rest.push(sub)
  }
  return [...common, ...rest]
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms at ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function verifyOne(code) {
  const result = {
    school: code,
    ok: false,
    terms: 0,
    subjects: 0,
    sections: 0,
    pickedTerm: null,
    pickedSubject: null,
    sample: null,
    enrollmentSeen: false,
    meetingsSeen: false,
    stage: 'import',
    error: null,
  }
  const started = Date.now()
  try {
    const mod = await import(SCRAPERS[code])

    result.stage = 'getTerms'
    const terms = await mod.getTerms()
    result.terms = Array.isArray(terms) ? terms.length : 0
    if (!result.terms) throw new Error('no terms returned')

    const orderedTerms = orderTerms(terms).slice(0, 3)

    // Walk candidate terms until one yields subjects, then sections.
    let lastErr = null
    for (const term of orderedTerms) {
      try {
        result.stage = `getSubjects(${term.code})`
        const subjects = await mod.getSubjects(term.code)
        if (!Array.isArray(subjects) || !subjects.length) {
          lastErr = new Error(`no subjects for term ${term.code}`)
          continue
        }
        result.terms = result.terms // unchanged
        result.subjects = subjects.length
        result.pickedTerm = term

        const candidates = orderSubjects(subjects).slice(0, 4)
        for (const subject of candidates) {
          result.stage = `getSections(${term.code},${subject.code})`
          const sections = await mod.getSections({
            termCode: term.code,
            subjectCode: subject.code,
            termLabel: term.label,
            subjectLabel: subject.label,
          })
          if (Array.isArray(sections) && sections.length) {
            result.sections = sections.length
            result.pickedSubject = subject
            const s = sections[0]
            result.sample = {
              course: `${s.subjectCode} ${s.courseNumber}-${s.sectionNumber}`,
              title: s.title,
              crn: s.crn,
              instructors: s.instructors,
              credits: s.credits,
              status: s.status,
              enrollment: s.enrollment,
              meetings: s.meetings,
            }
            result.enrollmentSeen = sections.some(
              (x) => x.enrollment && (x.enrollment.max != null || x.enrollment.current != null)
            )
            result.meetingsSeen = sections.some((x) => x.meetings && x.meetings.length)
            result.ok = true
            break
          }
        }
        if (result.ok) break
        lastErr = new Error(`subjects loaded but 0 sections across ${candidates.length} common subjects`)
      } catch (e) {
        lastErr = e
      }
    }
    if (!result.ok && lastErr) throw lastErr
  } catch (e) {
    result.error = e?.message || String(e)
  }
  result.ms = Date.now() - started
  return result
}

async function pLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const schools = args.length ? args : Object.keys(SCRAPERS)
  console.log(`Verifying ${schools.length} scraper(s): ${schools.join(', ')}\n`)

  const results = await pLimit(schools, 4, (code) =>
    withTimeout(verifyOne(code), TIMEOUT_MS[code] || TIMEOUT_MS.default, code).catch((e) => ({
      school: code,
      ok: false,
      error: e?.message || String(e),
      stage: 'timeout/crash',
      ms: TIMEOUT_MS[code] || TIMEOUT_MS.default,
    }))
  )

  console.log('\n================ RESULTS ================\n')
  for (const r of results) {
    const tag = r.ok ? '✅ WORKS' : '❌ FAILS'
    console.log(`${tag}  ${r.school}   (${Math.round((r.ms || 0) / 1000)}s)`)
    if (r.ok) {
      console.log(`   terms=${r.terms} subjects=${r.subjects} sections=${r.sections}`)
      console.log(`   term="${r.pickedTerm?.label}" subject="${r.pickedSubject?.code}/${r.pickedSubject?.label}"`)
      console.log(`   sample: ${r.sample.course} "${r.sample.title}" crn=${r.sample.crn} status=${r.sample.status} credits=${r.sample.credits}`)
      console.log(`   instructors=${JSON.stringify(r.sample.instructors)} enrollment=${JSON.stringify(r.sample.enrollment)}`)
      console.log(`   meetings=${JSON.stringify(r.sample.meetings)}`)
      console.log(`   flags: enrollmentData=${r.enrollmentSeen} meetingsData=${r.meetingsSeen}`)
    } else {
      console.log(`   stage=${r.stage} error=${r.error}`)
    }
    console.log('')
  }

  const works = results.filter((r) => r.ok).map((r) => r.school)
  const fails = results.filter((r) => !r.ok).map((r) => r.school)
  console.log('========================================')
  console.log(`WORKS (${works.length}): ${works.join(', ') || '—'}`)
  console.log(`FAILS (${fails.length}): ${fails.join(', ') || '—'}`)
  console.log(JSON.stringify({ summary: results.map(({ school, ok, terms, subjects, sections, stage, error }) => ({ school, ok, terms, subjects, sections, stage, error })) }))
}

main()
