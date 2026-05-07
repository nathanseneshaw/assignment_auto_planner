/**
 * Canvas LMS module/file scraper (cookie session — same auth as browser SSO).
 * Mirrors the Python canvas-scraper flow: modules → items (files, pages, assignments, URLs),
 * embedded /files/:id references in HTML, then course file list leftovers.
 */

import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import { normalizeCanvasBaseUrl } from './canvas-lms.js'

const CANVAS_ACCEPT = 'application/json+canvas-string-ids, application/json'

function sanitizeFilename(name) {
  const base = String(name ?? '').trim() || 'untitled'
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 220)
}

function extractFileIdsFromHtml(html) {
  if (!html || typeof html !== 'string') return []
  const re = /\/files\/(\d+)/gi
  const ids = new Set()
  let m
  while ((m = re.exec(html)) !== null) ids.add(m[1])
  return [...ids]
}

function appendSearchParams(u, params) {
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    if (k === 'include[]' && Array.isArray(v)) {
      v.forEach((item) => u.searchParams.append('include[]', String(item)))
    } else if (Array.isArray(v)) {
      v.forEach((item) => u.searchParams.append(k, String(item)))
    } else {
      u.searchParams.set(k, String(v))
    }
  })
}

function parseNextUrlFromLinkHeader(linkHeader) {
  if (!linkHeader || typeof linkHeader !== 'string') return null
  const parts = linkHeader.split(',')
  for (const part of parts) {
    const m = part.trim().match(/<([^>]+)>;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

async function canvasFetchJson(root, cookieHeader, path, searchParams = {}) {
  const u = new URL(path, root)
  appendSearchParams(u, searchParams)
  const urlStr = u.toString()
  const res = await fetch(urlStr, {
    headers: {
      Cookie: String(cookieHeader || '').trim(),
      Accept: CANVAS_ACCEPT,
    },
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    const err = new Error(`Canvas API ${path} failed: ${res.status} ${errText.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/**
 * Collect all pages of a Canvas paginated JSON list.
 */
async function canvasFetchAllList(root, cookieHeader, path, searchParams = {}) {
  const rows = []
  let url = new URL(path, root)
  appendSearchParams(url, { ...searchParams, per_page: searchParams.per_page || '100' })

  while (url) {
    const res = await fetch(url.toString(), {
      headers: {
        Cookie: String(cookieHeader || '').trim(),
        Accept: CANVAS_ACCEPT,
      },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const err = new Error(`Canvas API ${path} failed: ${res.status} ${errText.slice(0, 200)}`)
      err.status = res.status
      throw err
    }
    const chunk = await res.json()
    if (Array.isArray(chunk)) rows.push(...chunk)
    const next = parseNextUrlFromLinkHeader(res.headers.get('link'))
    url = next ? new URL(next) : null
  }
  return rows
}

function makeUniquePathTracker() {
  const seen = new Map()
  return function uniquePath(p) {
    const n = seen.get(p) || 0
    seen.set(p, n + 1)
    if (n === 0) return p
    const dot = p.lastIndexOf('.')
    if (dot > 0 && dot < p.length - 1) {
      const base = p.slice(0, dot)
      const ext = p.slice(dot)
      return `${base}_${n + 1}${ext}`
    }
    return `${p}_${n + 1}`
  }
}

async function getFileMeta(root, cookieHeader, fileId) {
  return canvasFetchJson(root, cookieHeader, `/api/v1/files/${fileId}`)
}

/**
 * @returns {Promise<{ stream: import('node:stream').Readable, filename: string } | null>}
 */
async function openFileDownloadStream(root, cookieHeader, fileId) {
  try {
    const meta = await getFileMeta(root, cookieHeader, fileId)
    const downloadUrl = meta.url
    const filename = sanitizeFilename(meta.display_name || meta.filename || `file_${fileId}`)
    if (!downloadUrl) return null
    const r = await fetch(downloadUrl, {
      headers: {
        Cookie: String(cookieHeader || '').trim(),
      },
    })
    if (!r.ok || !r.body) return null
    const nodeStream = Readable.fromWeb(r.body)
    return { stream: nodeStream, filename }
  } catch {
    return null
  }
}

function relativeOutputPath(courseName, relWithinCourse, openedFilename) {
  const parts = [sanitizeFilename(courseName), relWithinCourse, openedFilename].filter(
    (p) => p != null && String(p).length
  )
  return parts.join('/')
}

/**
 * @param {string | string[] | undefined} courseIds — numeric ids as string(s), or 'all'
 */
function parseCourseFilter(courseIds) {
  if (courseIds == null || courseIds === '' || courseIds === 'all') return null
  const raw = Array.isArray(courseIds) ? courseIds.join(',') : String(courseIds)
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => !Number.isNaN(n))
  return ids.length ? ids : null
}

/**
 * Core scrape: populate an archiver instance or write to disk (one of the two).
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.cookieHeader
 * @param {import('archiver').Archiver} [opts.archive]
 * @param {string} [opts.outputDir] — if set, write files to disk instead of zip
 * @param {string | string[]} [opts.courses]
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function runCanvasModuleFileScrape(opts) {
  const root = normalizeCanvasBaseUrl(opts.baseUrl)
  const cookieHeader = String(opts.cookieHeader || '').trim()
  if (!cookieHeader) throw new Error('Missing Canvas session cookies')

  const archive = opts.archive
  const outputDir = opts.outputDir ? String(opts.outputDir).replace(/[/\\]+$/, '') : null
  if (!archive && !outputDir) throw new Error('Provide archive or outputDir')

  const onProgress = opts.onProgress || (() => {})
  const filterIds = parseCourseFilter(opts.courses)

  const zipUnique = makeUniquePathTracker()

  async function emitHtml(relPath, html) {
    const body = html || ''
    if (archive) {
      const z = zipUnique(relPath)
      archive.append(body, { name: z })
    } else {
      const full = join(outputDir, relPath)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, body, 'utf8')
    }
  }

  async function emitUrlShortcut(relPath, url) {
    const content = `[InternetShortcut]\nURL=${url}\n`
    if (archive) {
      archive.append(content, { name: zipUnique(relPath) })
    } else {
      const full = join(outputDir, relPath)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
    }
  }

  async function downloadFileToOutput(courseName, relWithinCourse, fileId, filesDownloaded) {
    if (filesDownloaded.has(String(fileId))) return
    try {
      const opened = await openFileDownloadStream(root, cookieHeader, fileId)
      if (!opened) return
      const relPath = relativeOutputPath(courseName, relWithinCourse, opened.filename)
      if (archive) {
        const z = zipUnique(relPath)
        await new Promise((resolve, reject) => {
          opened.stream.on('error', reject)
          archive.append(opened.stream, { name: z })
          opened.stream.on('end', resolve)
        })
      } else {
        const extra = relWithinCourse ? [relWithinCourse, opened.filename] : [opened.filename]
        const full = join(outputDir, sanitizeFilename(courseName), ...extra)
        await mkdir(dirname(full), { recursive: true })
        const ws = createWriteStream(full)
        await pipeline(opened.stream, ws)
      }
      filesDownloaded.add(String(fileId))
    } catch {
      /* unauthorized / missing */
    }
  }

  onProgress({ phase: 'courses' })
  const rawCourses = await canvasFetchAllList(root, cookieHeader, '/api/v1/courses', {
    per_page: '100',
  })
  const seenCourse = new Set()
  const courseList = rawCourses.filter((c) => {
    if (c == null || c.id == null) return false
    const id = Number(c.id)
    if (seenCourse.has(id)) return false
    seenCourse.add(id)
    return true
  })

  const courses = filterIds
    ? courseList.filter((c) => filterIds.includes(Number(c.id)))
    : courseList

  for (const course of courses) {
    const courseName = course.name || `course_${course.id}`
    const cid = course.id
    const filesDownloaded = new Set()

    onProgress({ phase: 'course', courseId: String(cid), courseName })

    let modules = []
    try {
      modules = await canvasFetchAllList(root, cookieHeader, `/api/v1/courses/${cid}/modules`, {
        per_page: '100',
      })
    } catch (e) {
      onProgress({
        phase: 'module_error',
        courseId: String(cid),
        error: e.message || String(e),
      })
      modules = []
    }

    for (const mod of modules) {
      const modName = mod.name || 'module'
      let items = []
      try {
        items = await canvasFetchAllList(
          root,
          cookieHeader,
          `/api/v1/courses/${cid}/modules/${mod.id}/items`,
          { per_page: '100' }
        )
      } catch {
        items = []
      }

      for (const item of items) {
        const itemType = String(item.type || '').toLowerCase()
        const title = sanitizeFilename(item.title || 'item')
        const baseRel = `${sanitizeFilename(courseName)}/${sanitizeFilename(modName)}/`

        onProgress({
          phase: 'item',
          courseName,
          module: modName,
          title: item.title,
          type: itemType,
        })

        try {
          if (itemType === 'file' && item.content_id) {
            await downloadFileToOutput(
              courseName,
              `${sanitizeFilename(modName)}`,
              item.content_id,
              filesDownloaded
            )
          } else if (itemType === 'page' && item.page_url) {
            let body = ''
            try {
              const pagePath = `/api/v1/courses/${cid}/pages/${encodeURIComponent(item.page_url)}`
              const page = await canvasFetchJson(root, cookieHeader, pagePath)
              body = page.body || ''
            } catch {
              body = ''
            }
            await emitHtml(`${baseRel}${title}.html`, body)
            for (const fid of extractFileIdsFromHtml(body)) {
              if (filesDownloaded.has(fid)) continue
              await downloadFileToOutput(
                courseName,
                sanitizeFilename(modName),
                fid,
                filesDownloaded
              )
            }
          } else if (itemType === 'assignment' && item.content_id) {
            let description = ''
            try {
              const a = await canvasFetchJson(
                root,
                cookieHeader,
                `/api/v1/courses/${cid}/assignments/${item.content_id}`
              )
              description = a.description || ''
            } catch {
              description = ''
            }
            await emitHtml(`${baseRel}${title}.html`, description)
            for (const fid of extractFileIdsFromHtml(description)) {
              if (filesDownloaded.has(fid)) continue
              try {
                await downloadFileToOutput(
                  courseName,
                  sanitizeFilename(modName),
                  fid,
                  filesDownloaded
                )
              } catch {
                /* 401/403 */
              }
            }
          } else if (itemType === 'externalurl' && item.external_url) {
            await emitUrlShortcut(`${baseRel}${title}.url`, item.external_url)
          }
        } catch (e) {
          onProgress({ phase: 'item_error', message: e.message || String(e) })
        }
      }
    }

    onProgress({ phase: 'course_files', courseId: String(cid) })
    let orphanFiles = []
    try {
      orphanFiles = await canvasFetchAllList(root, cookieHeader, `/api/v1/courses/${cid}/files`, {
        per_page: '100',
      })
    } catch {
      orphanFiles = []
    }

    for (const f of orphanFiles) {
      const fid = f.id
      if (filesDownloaded.has(String(fid))) continue
      onProgress({
        phase: 'orphan_file',
        courseName,
        filename: f.display_name || f.filename || `file_${fid}`,
      })
      await downloadFileToOutput(courseName, '', fid, filesDownloaded)
    }
  }

  onProgress({ phase: 'done' })
}

/**
 * Stream a zip of scraped content to an HTTP response.
 */
export async function scrapeCanvasFilesToZipResponse(res, opts) {
  const root = normalizeCanvasBaseUrl(opts.baseUrl)
  const cookieHeader = String(opts.cookieHeader || '').trim()

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="canvas-scrape-${Date.now()}.zip"`
  )

  const archive = archiver('zip', { zlib: { level: 5 } })
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') console.warn('[Canvas scrape]', err)
  })

  const done = new Promise((resolve, reject) => {
    archive.on('error', reject)
    res.on('error', reject)
    archive.on('end', resolve)
  })

  archive.pipe(res)

  try {
    await runCanvasModuleFileScrape({
      ...opts,
      baseUrl: root,
      cookieHeader,
      archive,
      onProgress: opts.onProgress,
    })
    await archive.finalize()
    await done
  } catch (e) {
    try {
      archive.destroy()
    } catch {
      /* ignore */
    }
    throw e
  }
}

/**
 * Write scraped tree to a directory (CLI / standalone).
 */
export async function scrapeCanvasFilesToDirectory(dir, opts) {
  const root = normalizeCanvasBaseUrl(opts.baseUrl)
  await runCanvasModuleFileScrape({
    ...opts,
    baseUrl: root,
    outputDir: dir,
    onProgress: opts.onProgress,
  })
}
