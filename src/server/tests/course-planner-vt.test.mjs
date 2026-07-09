/**
 * Tests for vt-scraper.js (Virginia Tech — public Timetable of Classes).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as vt from '../course-planner/vt-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const FORM_HTML = `<html><body>
<select name="TERMYEAR">
  <OPTION VALUE="202609" SELECTED>Select Term</OPTION>
  <OPTION VALUE="202606">Summer 2026</OPTION>
  <OPTION VALUE="202609">Fall 2026</OPTION>
  <OPTION VALUE="202612">Winter 26-27</OPTION>
</select>
<script>
switch (listindex) {
case "202606" :
document.ttform.subj_code.options[0]=new Option("All Subjects","%",false, false);
document.ttform.subj_code.options[1]=new Option("ACIS - Accounting and Information Systems","ACIS",false, false);
break;
case "202609" :
document.ttform.subj_code.options[0]=new Option("All Subjects","%",false, false);
document.ttform.subj_code.options[1]=new Option("CS - Computer Science","CS",false, false);
document.ttform.subj_code.options[2]=new Option("MATH - Mathematics","MATH",false, false);
break;
}
</script>
</body></html>`

// One normal section + its Additional Times row + a comment row, then an
// arranged-time online section.
function listingHtml() {
  return `<table class="dataentrytable">
  <tr><td class="delabel">CRN</td><td class="delabel">Course</td></tr>
  <tr>
    <TD CLASS="dedefault"><A HREF='javascript:flexibleWindow("HZSKVTSC.P_ProcComments?CRN=83502&TERM=09&YEAR=2026&SUBJ=CS&CRSE=1114")'><b>83502</b></A></TD>
    <TD class="deleft"><font size="1">CS-1114</font></TD>
    <td class="deleft">Intro to Software Design</td>
    <TD CLASS="dedefault">L</TD>
    <TD CLASS="dedefault">Face-to-Face Instruction</TD>
    <TD CLASS="dedefault">3</TD>
    <td CLASS="dedefault">30</td>
    <td class="deleft">D. McPherson</td>
    <td CLASS="dedefault">M W </td>
    <td class="deright">11:15AM</td>
    <td class="deright">12:05PM</td>
    <td class="deleft">DDS 130</td>
    <TD CLASS="dedefault">15T</TD>
  </tr>
  <tr>
    <td CLASS="dedefault">&nbsp;</td>
    <td CLASS="dedefault">&nbsp;</td>
    <td CLASS="dedefault">&nbsp;</td>
    <td CLASS="dedefault">&nbsp;</td>
    <td colspan="4" CLASS="dedefault"><b class="blue_msg">* Additional Times *</b></td>
    <td CLASS="dedefault">T </td>
    <td class="deright">2:00PM</td>
    <td class="deright">4:30PM</td>
    <td class="deleft">MCB 238</td>
    <td CLASS="dedefault">&nbsp;</td>
  </tr>
  <tr>
    <TD COLSPAN="2" CLASS="dedefault"><b>Comments for CRN 83502: </b></TD>
    <TD class="deleft" colspan="9"><b>Combined lecture and lab.</b></TD>
  </tr>
  <tr>
    <TD CLASS="dedefault"><A HREF='javascript:flexibleWindow("HZSKVTSC.P_ProcComments?CRN=90001&TERM=09&YEAR=2026&SUBJ=CS&CRSE=2064")'><b>90001</b></A></TD>
    <TD class="deleft"><font size="1">CS-2064</font></TD>
    <td class="deleft">Intro to Programming</td>
    <TD CLASS="dedefault">ONL</TD>
    <TD CLASS="dedefault">Online: Asynchronous</TD>
    <TD CLASS="dedefault">1</TD>
    <td CLASS="dedefault">0</td>
    <td class="deleft">N/A</td>
    <td CLASS="dedefault">(ARR)</td>
    <td class="deright">-----</td>
    <td class="deright">-----</td>
    <td class="deleft">ONLINE</td>
    <TD CLASS="dedefault">CTE</TD>
  </tr>
</table>`
}

// The open-only listing carries only CRN 83502.
const OPEN_HTML = `<table class="dataentrytable"><tr><td>
<A HREF='javascript:flexibleWindow("HZSKVTSC.P_ProcComments?CRN=83502&TERM=09&YEAR=2026&SUBJ=CS&CRSE=1114")'>83502</A>
</td></tr></table>`

function dispatch(url, opts) {
  const u = String(url)
  if (u.includes('P_ProcRequest')) {
    const open = String(opts?.body || '').includes('open_only=on')
    return { ok: true, status: 200, text: async () => (open ? OPEN_HTML : listingHtml()) }
  }
  return { ok: true, status: 200, text: async () => FORM_HTML }
}

describe('vt.getTerms', () => {
  it('parses TERMYEAR options and drops the "Select Term" placeholder', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    assert.deepEqual(await vt.getTerms(), [
      { code: '202606', label: 'Summer 2026' },
      { code: '202609', label: 'Fall 2026' },
      { code: '202612', label: 'Winter 26-27' },
    ])
  })
})

describe('vt.getSubjects', () => {
  it('parses the per-term JS Option() block', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    assert.deepEqual(await vt.getSubjects('202609'), [
      { code: 'CS', label: 'Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })

  it('throws for a term with no subject block', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    await assert.rejects(() => vt.getSubjects('209912'), /subject list not found/)
  })
})

describe('vt.getSections', () => {
  it('parses rows, merges Additional Times, and diffs open/closed', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    const sections = await vt.getSections({
      termCode: '202609', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.crn, '83502')
    assert.equal(s0.courseNumber, '1114')
    assert.equal(s0.title, 'Intro to Software Design')
    assert.equal(s0.credits, 3)
    assert.deepEqual(s0.instructors, ['D. McPherson'])
    // capacity is public, live enrollment is Hokie-SPA-gated
    assert.deepEqual(s0.enrollment, { max: 30, current: null, available: null })
    assert.equal(s0.status, 'open') // present in the open-only listing
    assert.deepEqual(s0.meetings, [
      { days: ['M', 'W'], startTime: '11:15', endTime: '12:05', location: 'DDS 130' },
      { days: ['T'], startTime: '14:00', endTime: '16:30', location: 'MCB 238' },
    ])

    const s1 = sections[1]
    assert.equal(s1.crn, '90001')
    assert.equal(s1.status, 'closed') // absent from the open-only listing
    assert.deepEqual(s1.meetings, []) // (ARR) online section
    assert.deepEqual(s1.enrollment, { max: null, current: null, available: null }) // capacity 0 -> null
  })
})
