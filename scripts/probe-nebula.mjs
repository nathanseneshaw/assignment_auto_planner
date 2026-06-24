/**
 * One-shot live probe of the UTD Nebula API (api.utdnebula.com).
 *
 * Purpose: answer the open design questions before we write utd-scraper.js.
 * Nebula uses an ObjectID-reference model (a Section points to its Course and
 * its Professors by ObjectID), so the only things we can't determine from the
 * published Go schema alone are:
 *   1. Does the key authenticate at all? (every endpoint 401s without one.)
 *   2. The REAL academic_session.name term format ("25f"? "Fall 2025"? ...) -
 *      drives getTerms() and term filtering.
 *   3. Does /course/sections embed course_details + professor_details so we can
 *      build the unified shape from ONE call per subject (no N+1 ObjectID
 *      resolves)? If not, how do we resolve professors?
 *   4. Pagination: page size + offset semantics (CS has hundreds of sections).
 *   5. internal_class_number - is it the closest thing to a CRN?
 *
 * Usage (PowerShell):
 *   $env:NEBULA_API_KEY="your-key"; node scripts/probe-nebula.mjs
 * or:
 *   node scripts/probe-nebula.mjs your-key
 *
 * Nothing here is wired into the server; it's a throwaway investigation tool.
 */

const BASE = 'https://api.utdnebula.com'
const KEY = process.argv[2] || process.env.NEBULA_API_KEY

if (!KEY) {
  console.error(
    'No API key. Pass it as an argument or set NEBULA_API_KEY.\n' +
      '  $env:NEBULA_API_KEY="..."; node scripts/probe-nebula.mjs'
  )
  process.exit(1)
}

/** GET a path and unwrap the { status, message, data } envelope. */
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': KEY } })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`HTTP ${res.status} non-JSON: ${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.message || text.slice(0, 200)}`)
  return json.data !== undefined ? json.data : json
}

const line = (s = '') => console.log(s)
const head = (s) => console.log(`\n===== ${s} =====`)
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).join(', ') : String(o))

async function step(label, fn) {
  head(label)
  try {
    await fn()
  } catch (err) {
    console.error(`  FAILED: ${err.message}`)
  }
}

let sampleCourseId = null
let sampleSection = null

await step('1. Auth + course shape  GET /course?subject_prefix=CS&course_number=1337', async () => {
  const data = await get('/course?subject_prefix=CS&course_number=1337')
  const arr = Array.isArray(data) ? data : [data]
  line(`  returned ${arr.length} course(s)`)
  const c = arr[0]
  if (!c) return line('  (no course returned)')
  sampleCourseId = c._id
  line(`  _id: ${c._id}`)
  line(`  fields: ${keysOf(c)}`)
  line(`  ${c.subject_prefix} ${c.course_number}  "${c.title}"  (${c.credit_hours} cr)`)
  line(`  section count (ObjectID refs): ${Array.isArray(c.sections) ? c.sections.length : 'n/a'}`)
})

await step('2. Section shape  GET /course/{id}/sections (full dump of one section)', async () => {
  if (!sampleCourseId) return line('  (skipped  no course id from step 1)')
  const data = await get(`/course/${sampleCourseId}/sections`)
  const arr = Array.isArray(data) ? data : [data]
  line(`  returned ${arr.length} section(s) for that course`)
  sampleSection = arr[0]
  if (!sampleSection) return
  line(`  section fields: ${keysOf(sampleSection)}`)
  line(`  --- full section JSON ---`)
  line(JSON.stringify(sampleSection, null, 2))
  line(`  --- key extractions ---`)
  line(`  academic_session.name (TERM FORMAT): ${JSON.stringify(sampleSection.academic_session?.name)}`)
  line(`  section_number: ${JSON.stringify(sampleSection.section_number)}`)
  line(`  internal_class_number (CRN?): ${JSON.stringify(sampleSection.internal_class_number)}`)
  line(`  instruction_mode: ${JSON.stringify(sampleSection.instruction_mode)}`)
  line(`  professors (refs): ${JSON.stringify(sampleSection.professors)}`)
  line(`  meetings[0]: ${JSON.stringify(sampleSection.meetings?.[0])}`)
})

await step('3. Bulk strategy  GET /course/sections?subject_prefix=CS&course_number=1337', async () => {
  // Does this "join" endpoint embed course_details / professor_details so we can
  // build the unified shape from ONE call per subject (no N+1 ObjectID resolves)?
  const data = await get('/course/sections?subject_prefix=CS&course_number=1337')
  const arr = Array.isArray(data) ? data : [data]
  line(`  returned ${arr.length} section(s) (PAGE SIZE signal)`)
  const s = arr[0]
  if (!s) return
  line(`  first section fields: ${keysOf(s)}`)
  line(`  course_details embedded? ${s.course_details ? 'YES  ' + JSON.stringify(s.course_details) : 'no'}`)
  line(`  professor_details embedded? ${s.professor_details ? 'YES  ' + JSON.stringify(s.professor_details) : 'no'}`)
})

await step('4. Term enumeration  distinct academic_session.name across CS sections', async () => {
  // How we'd build getTerms(): collect the distinct session names the API exposes.
  const data = await get('/course/sections?subject_prefix=CS')
  const arr = Array.isArray(data) ? data : [data]
  const terms = new Set()
  for (const s of arr) if (s.academic_session?.name) terms.add(s.academic_session.name)
  line(`  scanned ${arr.length} sections (NOTE: one page  watch for pagination)`)
  line(`  distinct terms seen: ${[...terms].sort().join(', ') || '(none)'}`)
})

await step('5. Professor resolution  GET /section/professors?academic_session.name=<term>', async () => {
  const term = sampleSection?.academic_session?.name || ''
  const data = await get('/section/professors?academic_session.name=' + encodeURIComponent(term))
  const arr = Array.isArray(data) ? data : [data]
  line(`  returned ${arr.length} professor record(s)`)
  if (arr[0]) line(`  professor fields: ${keysOf(arr[0])}  e.g. ${arr[0].first_name} ${arr[0].last_name}`)
})

line('\nDone. Paste this output back and I will finalize utd-scraper.js against the real shapes.')
