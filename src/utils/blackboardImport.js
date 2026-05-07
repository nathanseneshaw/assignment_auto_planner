import { sanitizeBlackboardCourseDisplayName, blackboardCourseTitlesLooselyEqual } from './blackboardCourseName.js'

function courseNameMatchesHint(hint, courseName, courseFullName) {
  if (!hint) return false
  if (courseName === hint || courseFullName === hint) return true
  if (courseName && blackboardCourseTitlesLooselyEqual(hint, courseName)) return true
  if (courseFullName && blackboardCourseTitlesLooselyEqual(hint, courseFullName)) return true
  return false
}

/**
 * Find or create a local course for a Blackboard-synced assignment.
 * @param {object} coursesStore Pinia courses store ({ courses, addCourse })
 * @param {Array<{ id: string, name?: string, fullName?: string, code?: string, instructor?: string, term?: string }>} syncCourses Courses from the same sync payload
 * @param {{ courseId: string, courseName?: string }} assignment
 * @param {'blackboard'|'extension'} [lmsSource='blackboard'] Source for Supabase when creating a new course
 * @returns {{ course: object | null, created: boolean }}
 */
export function ensureCourseForBlackboardItem(
  coursesStore,
  syncCourses,
  assignment,
  lmsSource = 'blackboard'
) {
  const bbId = String(assignment.courseId ?? '').trim()
  const nameHint = assignment.courseName?.trim()

  let course = coursesStore.courses.find(
    (c) =>
      (bbId && c.blackboardId === bbId) ||
      (nameHint && courseNameMatchesHint(nameHint, c.name, c.fullName))
  )
  if (course) return { course, created: false }

  const meta = (syncCourses || []).find(
    (c) =>
      (bbId && String(c.id) === bbId) ||
      (nameHint &&
        courseNameMatchesHint(nameHint, c.name, c.fullName))
  )

  if (meta) {
    const existing = coursesStore.courses.find((c) => c.blackboardId === meta.id)
    if (existing) return { course: existing, created: false }
    course = coursesStore.addCourse({
      name: sanitizeBlackboardCourseDisplayName(
        meta.name || meta.fullName || nameHint || `Course ${meta.id}`
      ),
      code: meta.code || '',
      instructor: meta.instructor || '',
      term: meta.term || '',
      blackboardId: meta.id,
      lmsSource,
    })
    return { course, created: true }
  }

  if (!bbId && !nameHint) return { course: null, created: false }

  course = coursesStore.addCourse({
    name: sanitizeBlackboardCourseDisplayName(
      nameHint || `Blackboard course ${bbId}`
    ),
    code: '',
    instructor: '',
    term: '',
    blackboardId: bbId || undefined,
    lmsSource,
  })
  return { course, created: true }
}
