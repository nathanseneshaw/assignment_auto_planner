/**
 * In-memory TTL cache shared across scrapers.
 *
 * The user picked "on-demand scraping"  but firing 4 universities' worth of
 * HTML/CSV/XLSX on every keystroke would be both slow and rude. A 5-minute
 * cache flattens repeat clicks without making the data feel stale.
 */
const store = new Map()

export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

export function cacheSet(key, value, ttlMs = 5 * 60 * 1000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Flush a single key (or the entire store + pending map if no key given). For tests only. */
export function cacheFlush(key) {
  if (key === undefined) { store.clear(); pending.clear() }
  else { store.delete(key); pending.delete(key) }
}

/** Memoize an async loader by cache key. Pending requests are de-duplicated. */
const pending = new Map()
export async function cacheMemo(key, loader, ttlMs) {
  const cached = cacheGet(key)
  if (cached !== null) return cached
  if (pending.has(key)) return pending.get(key)
  const promise = (async () => {
    try {
      const value = await loader()
      cacheSet(key, value, ttlMs)
      return value
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, promise)
  return promise
}
