/**
 * Standardises the term lists every scraper hands back.
 *
 * Each school exposes terms in its own dialect: "Fall 2026", "FALL 2026",
 * "2026 Fall", "26 Fall", "Fall2025", "2025-2026 Autumn" (Stanford quarters),
 * "IAP 2026" (MIT), plus trailing noise like "(View Only)", "(UGRD)" or a campus
 * name. Some lists also run back to ~2004. The course planner only wants two
 * clean, uniformly-named terms: the one in progress now and the next one.
 *
 * This module is applied once at the /terms route, so the fix lands for all
 * schools without touching a single scraper. Term *codes* are passed through
 * untouched — only the human label is rewritten — so subjects/sections still
 * query the school with the exact code it expects.
 */

// Every season word any school uses, folded onto the four standard names the
// user picked. Autumn → Fall, IAP/Wintersession/intersession → Winter,
// Maymester (a mid-May intensive grouped with summer sessions) → Summer.
const SEASON_CANON = {
  fall: 'Fall',
  autumn: 'Fall',
  spring: 'Spring',
  summer: 'Summer',
  maymester: 'Summer',
  winter: 'Winter',
  wintersession: 'Winter',
  intersession: 'Winter',
  iap: 'Winter',
}

// Chronological order within a calendar year. Winter (Jan intersession / quarter
// schools' Jan–Mar term) comes first, Fall last.
const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 }

// Longest-first so "wintersession" wins over "winter" and "autumn" is caught.
const SEASON_RE =
  /(wintersession|intersession|maymester|autumn|winter|spring|summer|fall|iap)/i

/**
 * Parse one raw `{ code, label }` into `{ code, label, year, order, key }` with
 * a clean "Season YYYY" label, or null when no season + year can be recovered.
 */
export function parseTerm(term) {
  const raw = String(term?.label ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return null

  const sm = raw.match(SEASON_RE)
  if (!sm) return null
  const season = SEASON_CANON[sm[1].toLowerCase()]

  let year = null
  // Academic-year range like "2025-2026" or "2025-26" (Stanford). Fall belongs
  // to the first calendar year (Sep–Dec); Winter/Spring/Summer to the second.
  const range = raw.match(/\b(20\d{2})\s*[-/–]\s*(20\d{2}|\d{2})\b/)
  if (range) {
    const y1 = Number(range[1])
    const y2 =
      range[2].length === 2 ? Number(String(y1).slice(0, 2) + range[2]) : Number(range[2])
    year = season === 'Fall' ? y1 : y2
  } else {
    // Lookarounds (not \b) so a letter can abut the digits: "FALL2026".
    const full = raw.match(/(?<!\d)(19|20)\d{2}(?!\d)/)
    if (full) {
      year = Number(full[0])
    } else {
      // Last resort: a bare two-digit year ("26 Fall" → 2026).
      const two = raw.match(/(?<!\d)(\d{2})(?!\d)/)
      if (two) year = 2000 + Number(two[1])
    }
  }
  if (!year) return null

  const order = SEASON_ORDER[season]
  return { code: term.code, label: `${season} ${year}`, year, order, key: year * 10 + order }
}

/** A sortable key for "now", matched to the same year*10 + season scheme. */
export function nowTermKey(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 1–12
  // Jan–Apr = Spring, May–Jul = Summer, Aug–Dec = Fall. The in-progress term.
  const order = month <= 4 ? SEASON_ORDER.Spring : month <= 7 ? SEASON_ORDER.Summer : SEASON_ORDER.Fall
  return year * 10 + order
}

/**
 * Reduce a school's full term list to the current term plus the next one, with
 * uniform "Season YYYY" labels. Falls back gracefully: if nothing is current or
 * upcoming, returns the latest term(s) available; if no term can be parsed at
 * all, returns the raw list trimmed so the dropdown is never empty.
 */
export function selectCurrentAndNextTerms(rawTerms, { now = new Date(), count = 2 } = {}) {
  const list = Array.isArray(rawTerms) ? rawTerms : []

  const parsed = []
  const seenKeys = new Set()
  for (const t of list) {
    const p = parseTerm(t)
    if (!p) continue
    // Collapse duplicates that clean to the same season+year (e.g. summer
    // sub-sessions), keeping the first the school listed.
    if (seenKeys.has(p.key)) continue
    seenKeys.add(p.key)
    parsed.push(p)
  }

  if (!parsed.length) {
    return list.slice(0, count).map((t) => ({ code: t.code, label: t.label }))
  }

  parsed.sort((a, b) => a.key - b.key)
  const nk = nowTermKey(now)
  let chosen = parsed.filter((p) => p.key >= nk).slice(0, count)
  if (!chosen.length) chosen = parsed.slice(-count) // every term is in the past
  return chosen.map((p) => ({ code: p.code, label: p.label }))
}
