<script setup>
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import MainLayout from './layouts/MainLayout.vue'
import ToastContainer from './components/ui/ToastContainer.vue'
import { useCoursesStore } from './stores/courses'
import { useAssignmentsStore } from './stores/assignments'
import { useTasksStore } from './stores/tasks'
import { useAuthStore } from './stores/auth'
import { isSupabaseConfigured } from './lib/supabase'
import { hydrateLmsStoresFromSupabase } from './services/lmsSupabaseHydration'
import { useSupabaseStoreSync } from './composables/useSupabaseStoreSync'

const route = useRoute()

const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()
const tasksStore = useTasksStore()
const authStore = useAuthStore()

useSupabaseStoreSync()

onMounted(async () => {
  if (isSupabaseConfigured && authStore.user) {
    await hydrateLmsStoresFromSupabase()
  }
  if (!authStore.user && coursesStore.courses.length === 0) {
    initializeDemoData()
  }
})

watch(
  () => authStore.user,
  async (user, previous) => {
    if (user && isSupabaseConfigured) {
      await hydrateLmsStoresFromSupabase()
    } else if (!user && previous) {
      coursesStore.replaceFromHydration([])
      assignmentsStore.replaceFromHydration([])
      tasksStore.clearAll()
      if (coursesStore.courses.length === 0) {
        initializeDemoData()
      }
    }
  }
)

function initializeDemoData() {
  if (coursesStore.courses.length > 0) return

  // Create 7 courses for variety
  const course1 = coursesStore.addCourse({
    name: 'Introduction to Computer Science',
    code: 'CS101',
    instructor: 'Dr. Smith'
  })

  const course2 = coursesStore.addCourse({
    name: 'Calculus II',
    code: 'MATH201',
    instructor: 'Prof. Johnson'
  })

  const course3 = coursesStore.addCourse({
    name: 'English Composition',
    code: 'ENG102',
    instructor: 'Dr. Williams'
  })

  const course4 = coursesStore.addCourse({
    name: 'Physics I: Mechanics',
    code: 'PHYS101',
    instructor: 'Dr. Chen'
  })

  const course5 = coursesStore.addCourse({
    name: 'World History',
    code: 'HIST150',
    instructor: 'Prof. Anderson'
  })

  const course6 = coursesStore.addCourse({
    name: 'Introduction to Psychology',
    code: 'PSY101',
    instructor: 'Dr. Martinez'
  })

  const course7 = coursesStore.addCourse({
    name: 'Database Systems',
    code: 'CS340',
    instructor: 'Prof. Lee'
  })

  // Date helpers
  const today = new Date()
  const getDateStr = (daysFromToday) => {
    const date = new Date(today)
    date.setDate(date.getDate() + daysFromToday)
    return date.toISOString().split('T')[0]
  }

  const todayStr = getDateStr(0)
  const yesterdayStr = getDateStr(-1)
  const twoDaysAgoStr = getDateStr(-2)
  const tomorrowStr = getDateStr(1)
  const in2DaysStr = getDateStr(2)
  const in3DaysStr = getDateStr(3)
  const in4DaysStr = getDateStr(4)
  const in5DaysStr = getDateStr(5)
  const in7DaysStr = getDateStr(7)
  const in10DaysStr = getDateStr(10)
  const in14DaysStr = getDateStr(14)

  // ==================== ASSIGNMENTS ====================

  // CS101 Assignments
  const assignment1 = assignmentsStore.addAssignment({
    title: 'Programming Project: Data Structures',
    description: 'Implement a linked list and binary search tree in Python. Include unit tests and documentation.',
    courseId: course1.id,
    courseName: course1.name,
    dueDate: in7DaysStr,
    status: 'in_progress'
  })

  const assignment2 = assignmentsStore.addAssignment({
    title: 'Algorithm Analysis Quiz',
    description: 'Online quiz covering Big O notation and algorithm complexity analysis',
    courseId: course1.id,
    courseName: course1.name,
    dueDate: in3DaysStr,
    status: 'pending'
  })

  // MATH201 Assignments
  const assignment3 = assignmentsStore.addAssignment({
    title: 'Integration Problem Set',
    description: 'Complete problems 1-20 from Chapter 7. Show all work.',
    courseId: course2.id,
    courseName: course2.name,
    dueDate: in3DaysStr,
    status: 'in_progress'
  })

  const assignment4 = assignmentsStore.addAssignment({
    title: 'Midterm Exam Review',
    description: 'Review chapters 1-7 and complete practice problems',
    courseId: course2.id,
    courseName: course2.name,
    dueDate: in10DaysStr,
    status: 'pending'
  })

  // ENG102 Assignments
  const assignment5 = assignmentsStore.addAssignment({
    title: 'Research Essay: Climate Change',
    description: '2000 word essay on climate change impacts with at least 5 scholarly sources',
    courseId: course3.id,
    courseName: course3.name,
    dueDate: tomorrowStr,
    status: 'in_progress'
  })

  const assignment6 = assignmentsStore.addAssignment({
    title: 'Peer Review Workshop',
    description: 'Review and provide feedback on two classmates\' essay drafts',
    courseId: course3.id,
    courseName: course3.name,
    dueDate: in5DaysStr,
    status: 'pending'
  })

  // PHYS101 Assignments
  const assignment7 = assignmentsStore.addAssignment({
    title: 'Lab Report: Projectile Motion',
    description: 'Write up lab report for projectile motion experiment. Include data analysis and graphs.',
    courseId: course4.id,
    courseName: course4.name,
    dueDate: yesterdayStr,
    status: 'in_progress'
  })

  const assignment8 = assignmentsStore.addAssignment({
    title: 'Newton\'s Laws Problem Set',
    description: 'Complete problems 5.1-5.25 from the textbook',
    courseId: course4.id,
    courseName: course4.name,
    dueDate: in4DaysStr,
    status: 'pending'
  })

  const assignment9 = assignmentsStore.addAssignment({
    title: 'Physics Simulation Project',
    description: 'Create a simulation demonstrating conservation of momentum',
    courseId: course4.id,
    courseName: course4.name,
    dueDate: in14DaysStr,
    status: 'pending'
  })

  // HIST150 Assignments
  const assignment10 = assignmentsStore.addAssignment({
    title: 'Primary Source Analysis',
    description: 'Analyze the provided primary source document from the Industrial Revolution',
    courseId: course5.id,
    courseName: course5.name,
    dueDate: twoDaysAgoStr,
    status: 'in_progress'
  })

  const assignment11 = assignmentsStore.addAssignment({
    title: 'Chapter 8-10 Reading Response',
    description: 'Write a 500 word response to the assigned readings on World War I',
    courseId: course5.id,
    courseName: course5.name,
    dueDate: in2DaysStr,
    status: 'pending'
  })

  // PSY101 Assignments
  const assignment12 = assignmentsStore.addAssignment({
    title: 'Research Methods Quiz',
    description: 'Online quiz covering experimental design and research methodology',
    courseId: course6.id,
    courseName: course6.name,
    dueDate: todayStr,
    status: 'pending'
  })

  const assignment13 = assignmentsStore.addAssignment({
    title: 'Case Study Analysis',
    description: 'Analyze the provided case study using concepts from chapters 4-6',
    courseId: course6.id,
    courseName: course6.name,
    dueDate: in7DaysStr,
    status: 'pending'
  })

  // CS340 Assignments
  const assignment14 = assignmentsStore.addAssignment({
    title: 'SQL Query Assignment',
    description: 'Write SQL queries for the provided database schema. 15 questions total.',
    courseId: course7.id,
    courseName: course7.name,
    dueDate: in2DaysStr,
    status: 'in_progress'
  })

  const assignment15 = assignmentsStore.addAssignment({
    title: 'Database Design Project',
    description: 'Design and implement a database for a library management system',
    courseId: course7.id,
    courseName: course7.name,
    dueDate: in14DaysStr,
    status: 'pending'
  })

  // Completed assignment
  const assignment16 = assignmentsStore.addAssignment({
    title: 'Python Basics Assignment',
    description: 'Complete the introductory Python exercises',
    courseId: course1.id,
    courseName: course1.name,
    dueDate: twoDaysAgoStr,
    status: 'completed'
  })

  // ==================== TASKS ====================

  // CS101 - Data Structures Project tasks
  tasksStore.addTask({
    title: 'Research linked list implementations',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: twoDaysAgoStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Write linked list code',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Test linked list implementation',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Implement binary search tree',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: in2DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Write unit tests for BST',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: in3DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Write documentation',
    assignmentId: assignment1.id,
    assignmentTitle: assignment1.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: in5DaysStr,
    completed: false
  })

  // CS101 - Algorithm Quiz tasks
  tasksStore.addTask({
    title: 'Review Big O notation notes',
    assignmentId: assignment2.id,
    assignmentTitle: assignment2.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Practice algorithm complexity problems',
    assignmentId: assignment2.id,
    assignmentTitle: assignment2.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  // MATH201 - Integration Problem Set tasks
  tasksStore.addTask({
    title: 'Complete problems 1-10',
    assignmentId: assignment3.id,
    assignmentTitle: assignment3.title,
    courseId: course2.id,
    courseName: course2.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Complete problems 11-20',
    assignmentId: assignment3.id,
    assignmentTitle: assignment3.title,
    courseId: course2.id,
    courseName: course2.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  // MATH201 - Midterm Review tasks
  tasksStore.addTask({
    title: 'Review chapters 1-3',
    assignmentId: assignment4.id,
    assignmentTitle: assignment4.title,
    courseId: course2.id,
    courseName: course2.name,
    scheduledDate: in4DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Review chapters 4-5',
    assignmentId: assignment4.id,
    assignmentTitle: assignment4.title,
    courseId: course2.id,
    courseName: course2.name,
    scheduledDate: in5DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Review chapters 6-7',
    assignmentId: assignment4.id,
    assignmentTitle: assignment4.title,
    courseId: course2.id,
    courseName: course2.name,
    scheduledDate: in7DaysStr,
    completed: false
  })

  // ENG102 - Research Essay tasks
  tasksStore.addTask({
    title: 'Write essay outline',
    assignmentId: assignment5.id,
    assignmentTitle: assignment5.title,
    courseId: course3.id,
    courseName: course3.name,
    scheduledDate: yesterdayStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Gather scholarly sources',
    assignmentId: assignment5.id,
    assignmentTitle: assignment5.title,
    courseId: course3.id,
    courseName: course3.name,
    scheduledDate: yesterdayStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Write first draft',
    assignmentId: assignment5.id,
    assignmentTitle: assignment5.title,
    courseId: course3.id,
    courseName: course3.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Edit and proofread essay',
    assignmentId: assignment5.id,
    assignmentTitle: assignment5.title,
    courseId: course3.id,
    courseName: course3.name,
    scheduledDate: todayStr,
    completed: false
  })

  // PHYS101 - Lab Report tasks (OVERDUE)
  tasksStore.addTask({
    title: 'Organize lab data',
    assignmentId: assignment7.id,
    assignmentTitle: assignment7.title,
    courseId: course4.id,
    courseName: course4.name,
    scheduledDate: twoDaysAgoStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Create graphs and charts',
    assignmentId: assignment7.id,
    assignmentTitle: assignment7.title,
    courseId: course4.id,
    courseName: course4.name,
    scheduledDate: yesterdayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Write lab report analysis',
    assignmentId: assignment7.id,
    assignmentTitle: assignment7.title,
    courseId: course4.id,
    courseName: course4.name,
    scheduledDate: yesterdayStr,
    completed: false
  })

  // PHYS101 - Newton's Laws tasks
  tasksStore.addTask({
    title: 'Complete problems 5.1-5.10',
    assignmentId: assignment8.id,
    assignmentTitle: assignment8.title,
    courseId: course4.id,
    courseName: course4.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Complete problems 5.11-5.25',
    assignmentId: assignment8.id,
    assignmentTitle: assignment8.title,
    courseId: course4.id,
    courseName: course4.name,
    scheduledDate: in2DaysStr,
    completed: false
  })

  // HIST150 - Primary Source Analysis tasks (OVERDUE)
  tasksStore.addTask({
    title: 'Read primary source document',
    assignmentId: assignment10.id,
    assignmentTitle: assignment10.title,
    courseId: course5.id,
    courseName: course5.name,
    scheduledDate: twoDaysAgoStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Write analysis paragraphs',
    assignmentId: assignment10.id,
    assignmentTitle: assignment10.title,
    courseId: course5.id,
    courseName: course5.name,
    scheduledDate: twoDaysAgoStr,
    completed: false
  })

  // HIST150 - Reading Response tasks
  tasksStore.addTask({
    title: 'Read chapters 8-10',
    assignmentId: assignment11.id,
    assignmentTitle: assignment11.title,
    courseId: course5.id,
    courseName: course5.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Write reading response',
    assignmentId: assignment11.id,
    assignmentTitle: assignment11.title,
    courseId: course5.id,
    courseName: course5.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  // PSY101 - Research Methods Quiz tasks
  tasksStore.addTask({
    title: 'Review research methodology notes',
    assignmentId: assignment12.id,
    assignmentTitle: assignment12.title,
    courseId: course6.id,
    courseName: course6.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Take online quiz',
    assignmentId: assignment12.id,
    assignmentTitle: assignment12.title,
    courseId: course6.id,
    courseName: course6.name,
    scheduledDate: todayStr,
    completed: false
  })

  // PSY101 - Case Study tasks
  tasksStore.addTask({
    title: 'Read case study materials',
    assignmentId: assignment13.id,
    assignmentTitle: assignment13.title,
    courseId: course6.id,
    courseName: course6.name,
    scheduledDate: in3DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Identify relevant psychological concepts',
    assignmentId: assignment13.id,
    assignmentTitle: assignment13.title,
    courseId: course6.id,
    courseName: course6.name,
    scheduledDate: in4DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Write case study analysis',
    assignmentId: assignment13.id,
    assignmentTitle: assignment13.title,
    courseId: course6.id,
    courseName: course6.name,
    scheduledDate: in5DaysStr,
    completed: false
  })

  // CS340 - SQL Query Assignment tasks
  tasksStore.addTask({
    title: 'Review SQL syntax',
    assignmentId: assignment14.id,
    assignmentTitle: assignment14.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: yesterdayStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Complete questions 1-8',
    assignmentId: assignment14.id,
    assignmentTitle: assignment14.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: todayStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Complete questions 9-15',
    assignmentId: assignment14.id,
    assignmentTitle: assignment14.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: tomorrowStr,
    completed: false
  })

  // CS340 - Database Design Project tasks
  tasksStore.addTask({
    title: 'Design ER diagram',
    assignmentId: assignment15.id,
    assignmentTitle: assignment15.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: in7DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Create database schema',
    assignmentId: assignment15.id,
    assignmentTitle: assignment15.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: in10DaysStr,
    completed: false
  })

  tasksStore.addTask({
    title: 'Implement database tables',
    assignmentId: assignment15.id,
    assignmentTitle: assignment15.title,
    courseId: course7.id,
    courseName: course7.name,
    scheduledDate: in10DaysStr,
    completed: false
  })

  // Completed assignment tasks
  tasksStore.addTask({
    title: 'Complete Python basics exercises',
    assignmentId: assignment16.id,
    assignmentTitle: assignment16.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: twoDaysAgoStr,
    completed: true
  })

  tasksStore.addTask({
    title: 'Submit Python assignment',
    assignmentId: assignment16.id,
    assignmentTitle: assignment16.title,
    courseId: course1.id,
    courseName: course1.name,
    scheduledDate: twoDaysAgoStr,
    completed: true
  })

  // Update all assignment progress
  const allAssignments = [
    assignment1, assignment2, assignment3, assignment4, assignment5,
    assignment6, assignment7, assignment8, assignment9, assignment10,
    assignment11, assignment12, assignment13, assignment14, assignment15, assignment16
  ]

  allAssignments.forEach(assignment => {
    assignment.tasks = tasksStore.getTasksByAssignment(assignment.id)
    assignmentsStore.updateProgress(assignment.id)
  })
}
</script>

<template>
  <template v-if="route.meta.authPage || route.meta.landingPage">
    <RouterView v-slot="{ Component, route: r }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="r.path" />
      </Transition>
    </RouterView>
  </template>
  <MainLayout v-else>
    <RouterView v-slot="{ Component, route }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </MainLayout>

  <ToastContainer />
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
