/**
 * Parse assignment titles + due dates from LMS HTML (Blackboard Ultra course shell / outline / grades).
 * Used by the Blackboard HTTP scraper when parsing course / grades HTML.
 */

import * as cheerio from 'cheerio';

/** @param {string} text */
export function parseDueDateFromText(text) {
  if (!text) return null;
  const flat = String(text).replace(/\s+/g, ' ').trim();

  const patterns = [
    /DUE\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i,
    /Due\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/i,
    /DUE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Due\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];

  for (const re of patterns) {
    const m = flat.match(re);
    if (!m) continue;
    const raw = m[1].trim();
    let d = Date.parse(raw);
    if (!Number.isNaN(d)) return new Date(d).toISOString();
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      const y = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
      d = new Date(`${y}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

/**
 * @param {string} html
 * @returns {boolean} True if page body suggests the course is locked, denied, or unavailable.
 */
export function isGradesPageInaccessible(html) {
  if (!html) return true;
  const t = html.toLowerCase();
  // Prefer specific denial / course-closure copy. Avoid generic phrases ("not currently available")
  // that appear in footers, cookie banners, or product text on otherwise valid pages.
  const phrases = [
    'access denied',
    'you do not have access to this',
    'you do not have access to the',
    'you do not have access</',
    'not authorized',
    '401 unauthorized',
    '403 forbidden',
    'this course is unavailable',
    'course is unavailable',
    'the course is unavailable',
    'course unavailable to students',
    'not available to students',
    'this course is closed',
    'course has ended',
    'the course has ended',
  ];
  if (phrases.some((p) => t.includes(p))) return true;
  if (/\blocked\s+course\b/i.test(t) || /\bcourse\s+is\s+locked\b/i.test(t) || /\blocked\s+to\s+students\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Blackboard Ultra / mixed: table/row blocks with DUE: text + optional regex fallback on body.
 * @param {string} html
 * @param {string} courseId
 * @param {string} courseName
 * @param {string} baseUrl
 */
export function parseBlackboardGradesHtml(html, courseId, courseName, baseUrl) {
  const $ = cheerio.load(html);
  const assignments = [];
  const seen = new Set();

  if (isGradesPageInaccessible(html)) {
    return [];
  }

  /** @param {string} title */
  function titleOk(title) {
    const t = title.trim();
    if (t.length < 2 || t.length > 500) return false;
    const low = t.toLowerCase();
    if (
      [
        'grades',
        'my grades',
        'course grades',
        'return',
        'home',
        'course content',
        'assignments',
      ].includes(low)
    )
      return false;
    if (/^(click|here|next|prev|close)$/i.test(t)) return false;
    return true;
  }

  /** Row-based: Ultra often puts title and "DUE:" in sibling columns under one row — parent-walk from <a> can miss the due cell. */
  function pushFromRow(rowText, titleHint, href) {
    const block = String(rowText).replace(/\s+/g, ' ');
    if (!/DUE\s*:/i.test(block) && !/\bDue\s+\w{3,9}\s+\d{1,2}/i.test(block)) return;
    const dueDate = parseDueDateFromText(block);
    if (!dueDate) return;
    let title = (titleHint || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length > 500) {
      const tm = block.match(/^(.+?)(?=DUE\s*:|Due\s*:)/is);
      title = tm ? tm[1].trim().slice(0, 200) : '';
    }
    if (!titleOk(title)) return;
    const key = `${title}|${dueDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    const lower = title.toLowerCase();
    let type = 'assignment';
    if (lower.includes('quiz')) type = 'quiz';
    else if (lower.includes('exam') || lower.includes('midterm') || lower.includes('final')) type = 'exam';
    else if (lower.includes('homework') || /\bhw[\s_]?/i.test(lower)) type = 'homework';
    else if (lower.includes('project')) type = 'project';
    else if (lower.includes('lab')) type = 'lab';
    else if (lower.includes('discussion')) type = 'discussion';
    assignments.push({
      id: `${courseId}_${title.replace(/\s+/g, '_').slice(0, 48)}_${dueDate.slice(0, 10)}`,
      title,
      description: '',
      dueDate,
      courseId,
      courseName,
      images: [],
      type,
      sourceUrl: href
        ? href.startsWith('http')
          ? href
          : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`
        : '',
    });
  }

  $(
    '[role="row"], tr, [data-testid*="grade"], [class*="GradeItem"], [class*="gradebook"] tr, [class*="student-grade"] [class*="row"], li[class*="grade"], [class*="grade-row"]'
  ).each((_, row) => {
    const $row = $(row);
    const rowText = $row.text();
    const link = $row.find('a[href]').first();
    const hint = link.length ? link.text() : '';
    pushFromRow(rowText, hint, link.attr('href') || '');
  });

  // Fallback: full-page regex for DUE lines paired with preceding link text (sparse pages)
  if (assignments.length === 0) {
    const body = $('body').text().replace(/\s+/g, ' ');
    const dueRegex = /DUE\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/gi;
    let m;
    while ((m = dueRegex.exec(body)) !== null) {
      const dueDate = parseDueDateFromText(`DUE: ${m[1]}`);
      if (!dueDate) continue;
      const snippet = body.slice(Math.max(0, m.index - 120), m.index + m[0].length);
      const titleMatch = snippet.match(/([A-Za-z0-9_\-.]{2,})\s+DUE\s*:/i);
      const titleGuess = titleMatch ? titleMatch[1].trim() : null;
      if (titleGuess && titleOk(titleGuess)) {
        const key = `${titleGuess}|${dueDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({
          id: `${courseId}_${titleGuess.replace(/\s+/g, '_').slice(0, 48)}_${dueDate.slice(0, 10)}`,
          title: titleGuess,
          description: '',
          dueDate,
          courseId,
          courseName,
          images: [],
          type: 'assignment',
          sourceUrl: '',
        });
      }
    }
  }

  return assignments;
}

/**
 * Canvas student grades: rows often contain assignment links + due text.
 */
export function parseCanvasGradesHtml(html, courseId, courseName, _baseUrl) {
  const $ = cheerio.load(html);
  const assignments = [];
  const seen = new Set();

  if (isGradesPageInaccessible(html)) {
    return [];
  }

  const cidRe = new RegExp(`/courses/${String(courseId)}/assignments/(\\d+)`);

  $(`a[href*="/courses/${courseId}/assignments/"]`).each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const cm = href.match(cidRe);
    if (!cm) return;
    const aid = cm[1];
    const title = $a.text().replace(/\s+/g, ' ').trim();
    if (!title || /^assignments$/i.test(title)) return;

    let row =
      $a.closest('tr').length > 0
        ? $a.closest('tr')
        : $a.closest('[role="row"]').length > 0
          ? $a.closest('[role="row"]')
          : $a.closest('tbody tr, table tr, div.assignment-row, .assignment_score');

    const rowText = row.length ? row.text().replace(/\s+/g, ' ') : $a.parent().text().replace(/\s+/g, ' ');

    let dueDate = parseDueDateFromText(rowText);
    if (!dueDate) {
      // Canvas sometimes uses "due" column without "DUE:" prefix
      const alt = rowText.match(
        /\b(?:due|due\s+date)\s*[:]?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})/i
      );
      if (alt) dueDate = parseDueDateFromText(`DUE: ${alt[1]}`);
    }
    if (!dueDate) return;

    const key = `${aid}|${dueDate}`;
    if (seen.has(key)) return;
    seen.add(key);

    const lower = title.toLowerCase();
    let type = 'assignment';
    if (lower.includes('quiz')) type = 'quiz';
    else if (lower.includes('exam')) type = 'exam';
    else if (lower.includes('discussion')) type = 'discussion';

    assignments.push({
      id: aid,
      title,
      description: '',
      dueDate,
      courseId: String(courseId),
      courseName,
      images: [],
      type,
    });
  });

  return assignments;
}
