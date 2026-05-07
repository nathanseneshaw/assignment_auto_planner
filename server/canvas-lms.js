/**
 * Canvas LMS API helpers (course sync via token or browser cookie session).
 */

import * as cheerio from 'cheerio'

export function normalizeCanvasBaseUrl(input) {
  if (!input || typeof input !== 'string') throw new Error('Canvas URL is required')
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  if (!parsed.hostname) throw new Error('Invalid Canvas URL')
  return `${parsed.origin}`
}

function appendCanvasSearchParams(u, searchParams) {
  Object.entries(searchParams || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    if (k === 'include[]' && Array.isArray(v)) {
      v.forEach(item => u.searchParams.append('include[]', String(item)))
    } else if (Array.isArray(v)) {
      v.forEach(item => u.searchParams.append(k, String(item)))
    } else {
      u.searchParams.set(k, String(v))
    }
  })
}

async function canvasFetch(baseUrl, accessToken, path, searchParams = {}) {
  const u = new URL(path, baseUrl)
  appendCanvasSearchParams(u, searchParams)
  const res = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json+canvas-string-ids, application/json'
    }
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Canvas API ${path} failed: ${res.status} ${errText.slice(0, 200)}`)
  }
  return res.json()
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  try {
    const $ = cheerio.load(`<div id="root">${html}</div>`)
    return $('#root').text().replace(/\s+/g, ' ').trim()
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

function teacherNamesFromCourse(course) {
  const teachers = course.teachers
  if (!teachers || !teachers.length) return ''
  return teachers
    .map(t => t.display_name || t.short_name || t.name)
    .filter(Boolean)
    .join(', ')
}

/**
 * Read-only Canvas API using browser session cookies (after SSO / web login).
 */
async function canvasFetchWithCookies(baseUrl, cookieHeader, path, searchParams = {}) {
  const u = new URL(path, baseUrl)
  appendCanvasSearchParams(u, searchParams)
  const res = await fetch(u.toString(), {
    headers: {
      Cookie: String(cookieHeader || '').trim(),
      Accept: 'application/json+canvas-string-ids, application/json'
    }
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Canvas API ${path} failed: ${res.status} ${errText.slice(0, 200)}`)
  }
  return res.json()
}

/**
 * Verify that a Canvas web session cookie jar can call the API (profile probe).
 */
export async function verifyCanvasCookieSession(baseUrl, cookieHeader) {
  const root = normalizeCanvasBaseUrl(baseUrl)
  if (!String(cookieHeader || '').trim()) return false
  const u = new URL('/api/v1/users/self/profile', root)
  const res = await fetch(u.toString(), {
    headers: {
      Cookie: String(cookieHeader).trim(),
      Accept: 'application/json+canvas-string-ids, application/json'
    }
  })
  return res.ok
}

/**
 * @param {string} root
 * @param {(path: string, sp?: object) => Promise<any>} jsonFetcher
 */
export async function syncCanvasDataWithFetcher(root, jsonFetcher) {
  const courseListRaw = await jsonFetcher('/api/v1/courses', {
    enrollment_state: 'active',
    per_page: '100',
    'include[]': ['term', 'teachers']
  })
  const courseList = Array.isArray(courseListRaw) ? courseListRaw : []

  const normalizedCourses = courseList.map(c => ({
    canvasCourseId: String(c.id),
    name: c.name || 'Untitled course',
    term: c.term?.name || '',
    instructor: teacherNamesFromCourse(c),
    htmlUrl: c.html_url || ''
  }))

  const assignments = []
  const errors = []

  for (const course of courseList) {
    const cid = course.id
    try {
      const raw = await jsonFetcher(`/api/v1/courses/${cid}/assignments`, {
        per_page: '100'
      })
      const list = Array.isArray(raw) ? raw : []
      for (const a of list) {
        if (a.workflow_state === 'unpublished') continue
        const due = a.due_at || a.lock_at
        if (!due) continue
        const dueDate = String(due).slice(0, 10)
        assignments.push({
          canvasAssignmentId: String(a.id),
          canvasCourseId: String(cid),
          courseName: course.name || '',
          title: a.name || 'Untitled assignment',
          description: stripHtml(a.description || ''),
          dueDate,
          dueAt: due || a.lock_at || null,
          htmlUrl: a.html_url || '',
          points: a.points_possible ?? null
        })
      }
    } catch (e) {
      const msg = e.message || String(e)
      console.warn(`[Canvas] assignments for course ${cid}:`, msg)
      errors.push({ courseId: String(cid), courseName: course.name || '', error: msg })
    }
  }

  if (normalizedCourses.length === 0 && errors.length) {
    errors.unshift({
      courseId: '',
      courseName: '',
      error: 'No courses returned from Canvas. Check that you are enrolled in active courses.',
    })
  } else if (normalizedCourses.length > 0 && assignments.length === 0 && errors.length === 0) {
    errors.push({
      courseId: '',
      courseName: '',
      error: 'No dated assignments found in active courses.',
    })
  }

  return {
    courses: normalizedCourses,
    assignments,
    errors,
    syncedAt: new Date().toISOString()
  }
}

/**
 * Full sync: active courses + assignments (personal access token from sync-token route).
 */
export async function syncCanvasData(baseUrl, accessToken) {
  const root = normalizeCanvasBaseUrl(baseUrl)
  return syncCanvasDataWithFetcher(root, (path, params) => canvasFetch(root, accessToken, path, params))
}

/**
 * Same as syncCanvasData but uses a browser SSO / web session cookie header.
 */
export async function syncCanvasDataWithCookies(baseUrl, cookieHeader) {
  const root = normalizeCanvasBaseUrl(baseUrl)
  const ch = String(cookieHeader || '').trim()
  if (!ch) throw new Error('Missing Canvas session cookies')
  return syncCanvasDataWithFetcher(root, (path, params) =>
    canvasFetchWithCookies(root, ch, path, params)
  )
}
