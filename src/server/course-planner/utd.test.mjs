/**
 * Ad-hoc test runner: `node src/server/course-planner/utd.test.mjs`
 * Exits non-zero on failure so the parent process can detect it.
 */
import * as utd from './utd.js'

const log = (...a) => console.log('[utd-test]', ...a)

async function main() {
  log('1) getTerms()')
  const terms = await utd.getTerms()
  if (!terms.length) throw new Error('no terms returned')
  log(`   ${terms.length} terms; first 3:`, terms.slice(0, 3))

  log('2) getSubjects()')
  const subjects = await utd.getSubjects()
  if (!subjects.length) throw new Error('no subjects returned')
  log(`   ${subjects.length} subjects; first 3:`, subjects.slice(0, 3))

  // Pick a current-ish term (skip term_all-style sentinels). Prefer a Fall/
  // Spring rather than a summer mini-session for a richer result set.
  const target = terms.find((t) => /26f|25f|26s|25s/.test(t.code)) || terms[0]
  log(`3) getSections() for ${target.code} CS — this will spin up Chromium…`)

  const t0 = Date.now()
  const sections = await utd.getSections({
    termCode: target.code,
    termLabel: target.label,
    subjectCode: 'CS',
    subjectLabel: 'Computer Science',
  })
  log(`   got ${sections.length} sections in ${Date.now() - t0}ms`)

  if (!sections.length) {
    console.warn('[utd-test] WARNING: 0 sections returned — selector or wait logic may need adjustment')
  } else {
    log('   first section sample:')
    console.dir(sections[0], { depth: 4 })
    log('   second section sample:')
    console.dir(sections[1], { depth: 4 })
  }

  await utd.close()
  log('done')
}

main().catch((e) => {
  console.error('[utd-test] FAIL:', e)
  utd.close().finally(() => process.exit(1))
})
