import assert from 'node:assert'
import { describe, it } from 'node:test'
import { syncCanvasDataWithFetcher, normalizeCanvasBaseUrl } from '../canvas-lms.js'

describe('normalizeCanvasBaseUrl', () => {
  it('adds https and returns origin', () => {
    assert.equal(normalizeCanvasBaseUrl('canvas.school.edu'), 'https://canvas.school.edu')
  })

  it('rejects empty input', () => {
    assert.throws(() => normalizeCanvasBaseUrl(''), /Canvas URL is required/)
  })
})

describe('syncCanvasDataWithFetcher', () => {
  it('normalizes courses and assignments and strips description HTML', async () => {
    const coursesJson = [
      {
        id: 1,
        name: 'Eng',
        course_code: 'ENG 101',
        term: { name: 'Spring 2026' },
        teachers: [{ display_name: 'Dr. Who' }],
      },
    ]
    const assignJson = [
      {
        id: 10,
        name: 'Essay',
        description: '<p>Hello <b>world</b></p>',
        due_at: '2026-01-15T05:59:59Z',
        workflow_state: 'published',
        points_possible: 10,
      },
    ]
    const fetcher = async (path) => {
      if (path === '/api/v1/courses') return coursesJson
      if (path === '/api/v1/courses/1/assignments') return assignJson
      throw new Error(`unexpected path ${path}`)
    }
    const out = await syncCanvasDataWithFetcher('https://school.instructure.com', fetcher)
    assert.equal(out.courses.length, 1)
    assert.equal(out.courses[0].canvasCourseId, '1')
    assert.equal(out.courses[0].instructor, 'Dr. Who')
    assert.equal('courseCode' in out.courses[0], false)
    assert.equal(out.assignments.length, 1)
    assert.equal(out.assignments[0].canvasAssignmentId, '10')
    assert.match(out.assignments[0].description || '', /Hello world/i)
  })

  it('records per-course errors without failing the whole sync', async () => {
    const coursesJson = [{ id: 1, name: 'A', course_code: '', term: null, teachers: [] }]
    const fetcher = async (path) => {
      if (path === '/api/v1/courses') return coursesJson
      if (path === '/api/v1/courses/1/assignments') throw new Error('timeout')
      throw new Error(path)
    }
    const out = await syncCanvasDataWithFetcher('https://canvas.test', fetcher)
    assert.equal(out.courses.length, 1)
    assert.equal(out.assignments.length, 0)
    assert.ok(out.errors.some((e) => e.error && e.error.includes('timeout')))
  })
})
