/**
 * Shared helpers for the four school scrapers.
 *
 * The normalised Section shape returned from every scraper:
 *
 *   {
 *     school: 'rice' | 'ttu' | 'tamu' | 'smu',
 *     termCode, termLabel,
 *     subjectCode, subjectLabel,
 *     courseNumber, sectionNumber,
 *     crn,                          // unique-per-term section id
 *     title,
 *     instructors: [str],
 *     credits: number | null,
 *     enrollment: { max, current, available }  // any field null = school hides it
 *     status: 'open' | 'closed' | 'unknown',
 *     meetings: [{ days: ['M','T','W','R','F','S','U'], startTime: 'HH:MM', endTime: 'HH:MM', location: str }]
 *   }
 */

/** Parses "1:00PM" / "01:00 PM" / "0900" / "900" into a 24h "HH:MM" string. */
export function normalizeTime(raw) {
  if (!raw) return null
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '')
  // 4-digit military like "0900" or "1430"
  let m = s.match(/^(\d{3,4})$/)
  if (m) {
    const v = m[1].padStart(4, '0')
    return `${v.slice(0, 2)}:${v.slice(2)}`
  }
  // "1:00PM", "12:30AM", etc.
  m = s.match(/^(\d{1,2}):?(\d{2})\s*(AM|PM)$/)
  if (m) {
    let h = Number(m[1])
    const mins = m[2]
    if (m[3] === 'PM' && h !== 12) h += 12
    if (m[3] === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${mins}`
  }
  // Already HH:MM
  m = s.match(/^(\d{2}):(\d{2})$/)
  if (m) return s
  return null
}

/** Splits "MWF" or "TR" or "MoWeFr" into ['M','W','F']. */
export function parseDays(raw) {
  if (!raw) return []
  const s = String(raw).toUpperCase()
  const out = []
  // Try compact single-letter form first (M T W R F S U)
  // R is the canonical Banner code for Thursday; some schools use 'TH'.
  const map = [
    ['SU', 'U'], ['MO', 'M'], ['TU', 'T'], ['WE', 'W'],
    ['TH', 'R'], ['FR', 'F'], ['SA', 'S'],
  ]
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    const pair = map.find(([k]) => k === two)
    if (pair) {
      out.push(pair[1])
      i += 2
      continue
    }
    const ch = s[i]
    if ('MTWRFSU'.includes(ch)) out.push(ch)
    i += 1
  }
  return [...new Set(out)]
}

/** Banner-style boolean days (mon: true / tue: false / ...) → ['M','T',...] */
export function daysFromBooleans({
  monday,
  tuesday,
  wednesday,
  thursday,
  friday,
  saturday,
  sunday,
} = {}) {
  const out = []
  if (sunday) out.push('U')
  if (monday) out.push('M')
  if (tuesday) out.push('T')
  if (wednesday) out.push('W')
  if (thursday) out.push('R')
  if (friday) out.push('F')
  if (saturday) out.push('S')
  return out
}

/** Coerces "12", "12.0", "1 TO 3" → 12 / 1 / null. Returns null for non-numeric. */
export function parseCredits(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** Parses a CSV (handles quoted fields with commas + escaped quotes). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // Skip blank lines
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Convert parsed CSV rows (first row = header) into objects keyed by header name.
 */
export function csvToObjects(rows) {
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const o = {}
    headers.forEach((h, i) => {
      o[h] = r[i] ?? ''
    })
    return o
  })
}
