import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseDueDateFromText,
  isGradesPageInaccessible,
  parseBlackboardGradesHtml,
  parseCanvasGradesHtml,
} from '../lms-grades-parse.js';
import {
  getBlackboardOutlineUrlCandidates,
  getBlackboardCourseListUrlCandidates,
} from '../blackboard-ultra-navigation.js';

describe('parseDueDateFromText', () => {
  it('parses DUE: JAN 28, 2026', () => {
    const iso = parseDueDateFromText(' Assignment\nDUE: JAN 28, 2026\nAssignment ');
    assert.ok(iso);
    assert.match(iso, /^2026-01-28/);
  });

  it('parses slash format', () => {
    const iso = parseDueDateFromText('DUE: 1/28/2026');
    assert.ok(iso);
    assert.match(iso, /^2026-01-28/);
  });
});

describe('isGradesPageInaccessible', () => {
  it('detects denial copy', () => {
    assert.equal(isGradesPageInaccessible('<html>Access Denied</html>'), true);
    assert.equal(isGradesPageInaccessible('<html>Grade for hw</html>'), false);
  });

  it('detects locked course wording', () => {
    assert.equal(isGradesPageInaccessible('<html><body>This course is locked</body></html>'), true);
  });

  it('does not treat generic marketing/footer text as inaccessible', () => {
    assert.equal(
      isGradesPageInaccessible(
        '<html><body>Grades DUE: JAN 28, 2026 not currently available in offline mode</body></html>'
      ),
      false
    );
  });
});

describe('parseBlackboardGradesHtml', () => {
  const sample = `
<!DOCTYPE html><html><body>
  <div class="grade-row">
    <a href="/ultra/course/_1_1/gradebook/student/foo?assignment=1">hw_01</a>
    <span>Assignment</span>
    <span>DUE: JAN 28, 2026</span>
  </div>
</body></html>`;

  it('pulls assignment title and due from grades-like HTML', () => {
    const rows = parseBlackboardGradesHtml(sample, '_1_1', 'Test Course', 'https://lms.edu');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'hw_01');
    assert.match(rows[0].dueDate, /^2026-01-28/);
    assert.equal(rows[0].courseId, '_1_1');
  });

  it('handles sibling table cells (title column + DUE column)', () => {
    const table = `<!DOCTYPE html><html><body><table><tr>
      <td><a href="/launch">hw_03</a></td>
      <td>Assignment</td>
      <td>DUE: MAR 3, 2026</td>
    </tr></table></body></html>`;
    const rows = parseBlackboardGradesHtml(table, '_1_1', 'Test', 'https://lms.edu');
    assert.equal(rows.length >= 1, true);
    const hw = rows.find((r) => r.title.includes('hw_03'));
    assert.ok(hw);
    assert.match(hw.dueDate, /^2026-03-03/);
  });

  it('returns empty for denied page', () => {
    const rows = parseBlackboardGradesHtml(
      '<html>access denied</html>',
      'x',
      'y',
      'https://lms.edu'
    );
    assert.deepEqual(rows, []);
  });
});

describe('parseCanvasGradesHtml', () => {
  const sample = `
<table>
  <tr>
    <td><a href="/courses/12/assignments/99">Paper draft</a></td>
    <td>DUE: Feb 14, 2026</td>
    <td>—</td>
  </tr>
</table>`;

  it('extracts Canvas assignment IDs and dues', () => {
    const rows = parseCanvasGradesHtml(sample, '12', 'Eng 101', 'https://canvas.test');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '99');
    assert.equal(rows[0].title, 'Paper draft');
    assert.ok(rows[0].dueDate.includes('2026'));
  });
});

describe('getBlackboardOutlineUrlCandidates', () => {
  it('emits plural then singular ultra/.../course(s)/{id}/cl/outline', () => {
    const u = getBlackboardOutlineUrlCandidates('https://elearning.utdallas.edu/', '_410313_1');
    assert.equal(u.length, 2);
    assert.match(u[0], /\/ultra\/courses\/_410313_1\/cl\/outline$/);
    assert.match(u[1], /\/ultra\/course\/_410313_1\/cl\/outline$/);
  });
});

describe('getBlackboardCourseListUrlCandidates', () => {
  it('emits /ultra/course then /ultra/courses list URLs', () => {
    const u = getBlackboardCourseListUrlCandidates('https://elearning.utdallas.edu');
    assert.deepEqual(u, [
      'https://elearning.utdallas.edu/ultra/course',
      'https://elearning.utdallas.edu/ultra/courses',
    ]);
  });
});
