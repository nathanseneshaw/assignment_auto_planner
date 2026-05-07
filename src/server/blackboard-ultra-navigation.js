/**
 * Blackboard Ultra: Outline `.../cl/outline` → click **My Grades** (same path as UT Dallas eLearning Ultra).
 */

/**
 * Ultra course list — try canonical `/ultra/course` first, then `/ultra/courses` (tenant-dependent).
 */
export function getBlackboardCourseListUrlCandidates(baseUrl) {
  const origin = baseUrl.replace(/\/$/, '');
  return [`${origin}/ultra/course`, `${origin}/ultra/courses`];
}

/**
 * Ultra course shell outline (UT Dallas eLearning): `…/ultra/courses/{courseId}/cl/outline`.
 * @param {string} baseUrl LMS origin
 * @param {string} courseId Blackboard id (e.g. _410313_1)
 * @returns {string[]}
 */
export function getBlackboardOutlineUrlCandidates(baseUrl, courseId) {
  const origin = baseUrl.replace(/\/$/, '');
  const enc = encodeURI(courseId);
  // UT Dallas commonly uses …/ultra/courses/{id}/…; some tenants use singular …/ultra/course/{id}/….
  return [`${origin}/ultra/courses/${enc}/cl/outline`, `${origin}/ultra/course/${enc}/cl/outline`];
}

/**
 * In-page: click the first visible course anchor whose href contains `courseId` (Ultra course cards on the list page).
 * @returns {boolean}
 */
export function ultraClickCourseLinkByIdInPage(courseId) {
  const id = String(courseId || '');
  if (!id) return false;
  const nodes = document.querySelectorAll('a[href]');
  for (const el of nodes) {
    const h = el.getAttribute('href') || '';
    if (!h.includes(id)) continue;
    const r = el.getBoundingClientRect?.() || {};
    const st = window.getComputedStyle?.(el) || {};
    if (Number(r.width) <= 1 || Number(r.height) <= 1) continue;
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        break;
      }
    }
  }
  return false;
}

/**
 * In-page: activate top-level navigation link whose label is exactly "Courses" (brings list into view).
 * @returns {boolean}
 */
export function ultraClickCoursesNavLinkInPage() {
  const links = document.querySelectorAll('a');
  for (const a of links) {
    const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^courses$/i.test(t)) continue;
    const r = a.getBoundingClientRect?.() || {};
    if (Number(r.width) > 1 && Number(r.height) > 1) {
      try {
        a.click();
        return true;
      } catch {
        try {
          a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        } catch {
          return false;
        }
      }
    }
  }
  return false;
}

/**
 * In-page: click a **single-row** left-menu item labeled exactly "My Grades" (nav / aside / palette).
 * Matches UT Dallas-style vertical lists where the row is an `<a>` or focusable shell.
 * @returns {boolean}
 */
export function ultraClickMyGradesSidebarRowInPage() {
  function lineNorm(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function isMyGradesRowLabel(s) {
    return /^my\s+grades$/i.test((s || '').replace(/\u200b/g, '').trim());
  }
  function roughlyVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect?.() || {};
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle?.(el) || {};
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    return true;
  }
  function fireClick(el) {
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    }
  }

  const roots = [
    '#courseMenuPalette_contents',
    '[id*="courseMenuPalette" i]',
    '[role="navigation"]',
    'nav',
    'aside',
    '[class*="sidebar" i]',
    '[class*="left-panel" i]',
  ];
  const interactive = 'a, button, [role="menuitem"], [role="link"], li, div[role="button"], div[tabindex="0"]';

  for (const rootSel of roots) {
    for (const root of document.querySelectorAll(rootSel)) {
      for (const el of root.querySelectorAll(interactive)) {
        if (!roughlyVisible(el)) continue;
        if (!isMyGradesRowLabel(lineNorm(el))) continue;
        if (fireClick(el)) return true;
      }
    }
  }
  return false;
}

/**
 * In-page: activate **My Grades**.
 * Prefer `<span title="My Grades">My Grades</span>`, then course palette / aria / sidebar / tabs.
 * @returns {boolean}
 */
export function ultraClickMyGradesTabInPage() {
  function clickEl(el) {
    if (!(el instanceof HTMLElement)) return false;
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    }
  }

  function roughlyVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle?.(el);
    if (st?.visibility === 'hidden' || st?.display === 'none') return false;
    return true;
  }

  /** Click target or a visible ancestor (tab shell often wraps the label span). */
  function tryClickWithAncestors(el) {
    let cur = el;
    for (let depth = 0; depth < 8 && cur; depth++) {
      if (roughlyVisible(cur) && clickEl(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function labelIsMyGrades(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t === 'my grades';
  }

  function normalizedAria(el) {
    return (el?.getAttribute?.('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Prefer `<span title="My Grades">` exactly (UT Dallas course palette). */
  function clickSpanTitleMyGrades() {
    for (const span of document.querySelectorAll('span[title]')) {
      const t = (span.getAttribute('title') || '').trim().toLowerCase();
      if (t !== 'my grades') continue;
      if (tryClickWithAncestors(span)) return true;
      if (roughlyVisible(span) && clickEl(span)) return true;
    }
    return false;
  }

  if (clickSpanTitleMyGrades()) return true;

  /** Blackboard Ultra course left menu: `#courseMenuPalette_contents` vertical list under course title */
  function clickInCourseMenuPaletteOrSimilar() {
    const paletteSelector = [
      '#courseMenuPalette_contents',
      '[id*="courseMenuPalette" i]',
      '[id*="Palette_contents" i]',
      '[class*="courseMenuPalette" i]',
      '[class*="course-menu" i]',
    ].join(',');
    for (const root of document.querySelectorAll(paletteSelector)) {
      const items = root.querySelectorAll(
        'li, [role="listitem"], a, span[title], span, [role="link"], div[role="button"], div[tabindex], button'
      );
      for (const el of items) {
        const titleAttr = (el.getAttribute?.('title') || '').trim().toLowerCase();
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (titleAttr !== 'my grades' && txt !== 'my grades') continue;
        if (tryClickWithAncestors(el)) return true;
        if (roughlyVisible(el) && clickEl(el)) return true;
      }
      /* Some themes use one li per line; trimmed text fits this row only */
      for (const li of root.querySelectorAll('li')) {
        const line = li.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
        if (line !== 'my grades') continue;
        if (tryClickWithAncestors(li)) return true;
      }
    }
    return false;
  }

  if (clickInCourseMenuPaletteOrSimilar()) return true;

  // aria-label

  for (const sel of ['[aria-label="My Grades" i]', '[aria-label="my grades" i]']) {
    for (const el of document.querySelectorAll(sel)) {
      if (tryClickWithAncestors(el)) return true;
    }
  }
  for (const el of document.querySelectorAll('[aria-label]')) {
    if (normalizedAria(el) !== 'my grades') continue;
    if (tryClickWithAncestors(el)) return true;
  }

  // Other elements with title="My Grades" (not span — span handled above)
  for (const el of document.querySelectorAll('[title]')) {
    if (el.tagName === 'SPAN') continue;
    const title = (el.getAttribute('title') || '').trim().toLowerCase();
    if (title !== 'my grades') continue;
    if (tryClickWithAncestors(el)) return true;
  }

  // 2) Course left nav / sidebar (My Grades appears here on many Ultra themes)
  const regionSelector = [
    '[role="navigation"]',
    'nav',
    'aside',
    '[class*="sidebar" i]',
    '[class*="side-panel" i]',
    '[class*="left-nav" i]',
    '[class*="course-menu" i]',
    '[data-testid*="nav" i]',
  ].join(',');
  for (const root of document.querySelectorAll(regionSelector)) {
    const inner = root.querySelectorAll(
      'a, button, [role="menuitem"], [role="link"], [role="tab"], li, div[role="button"], span'
    );
    for (const el of inner) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!(t === 'my grades' || normalizedAria(el) === 'my grades')) continue;
      if (tryClickWithAncestors(el)) return true;
      if (roughlyVisible(el) && clickEl(el)) return true;
    }
  }

  // 3) span or tab strip label without [title] in some skins
  for (const el of document.querySelectorAll('span, [role="tab"]')) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!labelIsMyGrades(t)) continue;
    if (tryClickWithAncestors(el)) return true;
  }

  // 4) Classic interactive controls (whole document)
  const nodes = document.querySelectorAll(
    'a, button, [role="tab"], [role="menuitem"], [role="link"]'
  );
  for (const el of nodes) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (t === 'my grades' || normalizedAria(el) === 'my grades') {
      if (roughlyVisible(el) && clickEl(el)) return true;
    }
  }
  return false;
}
