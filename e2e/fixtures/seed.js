/**
 * Domain data builders and seeding helpers for the end-to-end suite.
 *
 * Two rules keep these tests stable:
 *
 *  1. Dates are always derived from `dayOffset(n)` rather than hard-coded, so a
 *     spec that means "due tomorrow" keeps meaning that next March. The app
 *     buckets assignments into overdue / next-7-days / completed by comparing
 *     against the local date, so fixed dates would rot into the wrong bucket.
 *
 *  2. Seeding goes through the real store actions (`addCourse`, `addAssignment`,
 *     `addTask`), not a raw `$patch` of the array. The actions fill in ids,
 *     colours, `createdAt`, and default status, so seeded rows are shaped
 *     exactly like rows the UI would have created.
 */

/** Local YYYY-MM-DD for today plus `offset` days. Matches the app's date keys. */
export function dayOffset(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A course as `coursesStore.addCourse` expects it. `color` is assigned by the store. */
export function makeCourse(overrides = {}) {
  return {
    name: 'Intro to Testing',
    code: 'TEST 101',
    instructor: 'Dr. Ada Lovelace',
    ...overrides,
  }
}

/** An assignment as `assignmentsStore.addAssignment` expects it. */
export function makeAssignment(overrides = {}) {
  return {
    title: 'Problem Set 1',
    description: '',
    courseId: null,
    courseName: '',
    dueDate: dayOffset(3),
    ...overrides,
  }
}

/** A task as `tasksStore.addTask` expects it. */
export function makeTask(overrides = {}) {
  return {
    title: 'Read chapter 1',
    scheduledDate: dayOffset(1),
    priorityLevel: 'normal',
    assignmentId: null,
    courseId: null,
    courseName: null,
    group: null,
    ...overrides,
  }
}

/**
 * Seed courses, then assignments, then tasks, wiring child rows to their parent
 * by array index so a spec can write the whole fixture in one call:
 *
 *   const { courses, assignments } = await seedPlannerData(app, {
 *     courses: [makeCourse({ name: 'CS 101' })],
 *     assignments: [makeAssignment({ title: 'Lab 1', courseIndex: 0 })],
 *     tasks: [makeTask({ title: 'Outline', assignmentIndex: 0 })],
 *   })
 *
 * `courseIndex` / `assignmentIndex` are resolved here and stripped before the
 * row reaches the store. Returns the created rows with their real ids.
 */
export async function seedPlannerData(app, { courses = [], assignments = [], tasks = [] } = {}) {
  const coursesStore = app.store('courses')
  const assignmentsStore = app.store('assignments')
  const tasksStore = app.store('tasks')

  const createdCourses = []
  for (const course of courses) {
    createdCourses.push(await coursesStore.invoke('addCourse', course))
  }

  const createdAssignments = []
  for (const assignment of assignments) {
    const { courseIndex, ...rest } = assignment
    const parent = courseIndex == null ? null : createdCourses[courseIndex]
    createdAssignments.push(
      await assignmentsStore.invoke('addAssignment', {
        ...rest,
        courseId: parent ? parent.id : rest.courseId,
        courseName: parent ? parent.name : rest.courseName,
      })
    )
  }

  const createdTasks = []
  for (const task of tasks) {
    const { courseIndex, assignmentIndex, ...rest } = task
    const parentAssignment = assignmentIndex == null ? null : createdAssignments[assignmentIndex]
    const parentCourse =
      courseIndex != null
        ? createdCourses[courseIndex]
        : parentAssignment
          ? createdCourses.find((c) => c.id === parentAssignment.courseId)
          : null
    createdTasks.push(
      await tasksStore.invoke('addTask', {
        ...rest,
        assignmentId: parentAssignment ? parentAssignment.id : rest.assignmentId,
        courseId: parentCourse ? parentCourse.id : rest.courseId,
        courseName: parentCourse ? parentCourse.name : rest.courseName,
      })
    )
  }

  return { courses: createdCourses, assignments: createdAssignments, tasks: createdTasks }
}

/**
 * localStorage payload the profile store reads on boot (`profile` + `theme`).
 * Pass to `app.seedLocalStorage(...)` BEFORE `app.goto(...)`, because the store
 * reads these keys once at construction time.
 */
export function profileSeed({ name = 'Test Student', email = 'student@example.edu', school = '', darkMode = false } = {}) {
  return {
    profile: { name, email, avatar: null, school },
    theme: darkMode ? '1' : '0',
  }
}
