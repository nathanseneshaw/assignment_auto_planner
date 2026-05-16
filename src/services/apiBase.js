/**
 * Builds the full URL for backend API calls.
 *
 * - Vite dev (`npm run dev`): uses http://127.0.0.1:3001 directly so API works even when
 *   the page is not loaded through Vite’s proxy (e.g. Cursor preview, Live Server, file://
 *   would otherwise get index.html for /api and JSON parse fails on "<!DOCTYPE...").
 * - Production build: relative `/api/...` (same host + reverse proxy) unless VITE_API_BASE is set.
 *
 * Override: VITE_API_BASE=http://127.0.0.1:3001 or VITE_API_PORT=3002
 */
export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  const p = path.startsWith('/') ? path : `/${path}`
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
  if (base) return `${base}${p}`
  // Electron renderer: call the embedded Express server directly (both dev and prod).
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    const port = window.electronAPI.apiPort ?? 3001
    return `http://127.0.0.1:${port}${p}`
  }
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_API_PORT || '3001'
    return `http://127.0.0.1:${port}${p}`
  }
  return p
}
