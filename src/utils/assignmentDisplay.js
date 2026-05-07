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

/** Short label for where the row came from */
export function importSourceLabel(importSource) {
  switch (importSource) {
    case 'blackboard':
      return 'Blackboard'
    case 'canvas':
      return 'Canvas'
    case 'extension':
      return 'Extension'
    default:
      return ''
  }
}
