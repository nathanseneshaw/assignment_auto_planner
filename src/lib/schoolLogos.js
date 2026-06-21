// University logos, keyed by school `code` (e.g. 'rice', 'mit') — the same code
// the course-planner API returns. Each PNG under src/assets/school-logos/ is the
// school's brand favicon/crest. Vite resolves every match to a hashed asset URL
// at build time, so this works in the web build and the Electron (file://) build
// without any runtime network access.
// Most logos are PNG; a couple of schools only publish a JPEG favicon, so match
// both. Keying strips the extension, leaving just the school code.
const modules = import.meta.glob('../assets/school-logos/*.{png,jpg}', {
  eager: true,
  import: 'default',
})

const LOGOS = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1).replace(/\.(png|jpg)$/, ''),
    url,
  ])
)

/** Resolved logo URL for a school code, or '' when none is bundled. */
export function schoolLogo(code) {
  return (code && LOGOS[code]) || ''
}

/** Whether a bundled logo exists for the given school code. */
export function hasSchoolLogo(code) {
  return Boolean(code && LOGOS[code])
}
