import { sanitizeBlackboardCourseDisplayName } from './blackboardCourseName.js'

/**
 * Course label for UI: prefer denormalized courseName, then linked course.
 */
export function resolveAssignmentCourseName(assignment, getCourseById) {
  let name = ''
  if (assignment?.courseName?.trim()) name = assignment.courseName.trim()
  else if (assignment?.courseId && typeof getCourseById === 'function') {
    const c = getCourseById(assignment.courseId)
    if (c?.name) name = c.name
  }
  return name ? sanitizeBlackboardCourseDisplayName(name) : ''
}

/**
 * Solid dot color (a Tailwind class) for a course's pale accent `color.bg`.
 * Shared by the assignments course filter and the dashboard course rail so a
 * given course renders the same swatch everywhere. Falls back to gray for
 * unknown/legacy colors.
 */
const COURSE_DOT_BY_BG = {
  'bg-blue-100': 'bg-blue-500',
  'bg-green-100': 'bg-green-500',
  'bg-purple-100': 'bg-purple-500',
  'bg-orange-100': 'bg-orange-500',
  'bg-pink-100': 'bg-pink-500',
  'bg-teal-100': 'bg-teal-500',
  'bg-indigo-100': 'bg-indigo-500',
  'bg-red-100': 'bg-red-500',
}

export function courseDotColor(color) {
  return (color && COURSE_DOT_BY_BG[color.bg]) || 'bg-gray-400'
}

/** Short label for where the row came from */
export function importSourceLabel(importSource) {
  switch (importSource) {
    case 'blackboard':
      return 'Blackboard'
    case 'canvas':
      return 'Canvas'
    case 'ics':
      return 'Calendar feed'
    case 'syllabus':
      return 'Syllabus'
    default:
      return ''
  }
}
