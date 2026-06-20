<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAssignmentsStore } from '../stores/assignments'
import { useTasksStore } from '../stores/tasks'
import { useCoursesStore } from '../stores/courses'
import { useProfileStore } from '../stores/profile'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { resolveAssignmentCourseName } from '../utils/assignmentDisplay.js'

const router = useRouter()
const assignmentsStore = useAssignmentsStore()
const tasksStore = useTasksStore()
const coursesStore = useCoursesStore()
const profileStore = useProfileStore()
const authStore = useAuthStore()

const now = ref(new Date())
let clockTimer = null
onMounted(() => { clockTimer = setInterval(() => { now.value = new Date() }, 30_000) })
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer) })

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function localDateKey(d) {
  const dt = d || new Date()
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function parseDateLocal(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function shortDate(dateString) {
  const d = parseDateLocal(dateString)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

// ── Greeting / hero ──────────────────────────────────────────────────────
const greeting = computed(() => {
  const h = now.value.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
})

const firstName = computed(() => {
  let name = ''
  if (isSupabaseConfigured && authStore.user) {
    name = authStore.user.user_metadata?.full_name ||
      authStore.user.user_metadata?.name ||
      authStore.user.email?.split('@')[0] || ''
  }
  if (!name) name = profileStore.profile.name || ''
  return name ? name.split(' ')[0] : ''
})

const displayName = computed(() => firstName.value || 'Welcome')

const agenda = computed(() => tasksStore.todaysTasks)
const todayCompleted = computed(() => agenda.value.filter(t => t.completed).length)
const overdueCount = computed(() => assignmentsStore.overdueAssignments.length)
const nextDeadline = computed(() => assignmentsStore.upcomingAssignments[0] || null)
const railDeadlines = computed(() => assignmentsStore.upcomingAssignments.slice(0, 4))

// The closing sentence of the hero subtitle adapts to today's workload.
const slateLine = computed(() => {
  const n = agenda.value.length
  if (n > 0) return `You have ${n} task${n === 1 ? '' : 's'} lined up for today.`
  if (overdueCount.value > 0) return "Today's slate is clear  a good moment to catch up."
  return "Today's slate is clear  a good moment to plan ahead."
})

// ── Stat-card sub-labels ─────────────────────────────────────────────────
const todaysSub = computed(() =>
  agenda.value.length === 0 ? 'Nothing scheduled yet' : `${todayCompleted.value} done so far`
)
const upcomingSub = computed(() =>
  nextDeadline.value ? `Next · ${shortDate(nextDeadline.value.dueDate)}` : 'Nothing upcoming'
)
const overdueSub = computed(() => (overdueCount.value > 0 ? 'Needs attention' : 'All clear'))

const PRIORITY_DOT = { urgent: 'bg-rust-500', high: 'bg-warning-500', normal: 'bg-primary-600' }

function toggleTask(id) {
  tasksStore.toggleTaskComplete(id)
}

function courseName(assignment) {
  return resolveAssignmentCourseName(assignment, coursesStore.getCourseById) || 'Calendar feed'
}

// ── Activity heatmap (last 14 weeks of completed assignments) ────────────
const HEATMAP_WEEKS = 14
const DAY_LABELS = ['M', '', 'W', '', 'F', '', '']
const LEVEL_CLASS = [
  'bg-paper-line/70 dark:bg-gray-700/50',
  'bg-primary-200 dark:bg-primary-900',
  'bg-primary-400 dark:bg-primary-700',
  'bg-primary-600 dark:bg-primary-500',
  'bg-primary-800 dark:bg-primary-300',
]

const activity = computed(() => {
  const counts = {}
  let total = 0
  for (const a of assignmentsStore.assignments) {
    if (a.status !== 'completed') continue
    total++
    const ts = a.completedAt || a.updatedAt || a.createdAt
    if (!ts) continue
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) continue
    const key = localDateKey(d)
    counts[key] = (counts[key] || 0) + 1
  }

  const today = new Date(now.value)
  today.setHours(0, 0, 0, 0)
  const mondayOffset = (today.getDay() + 6) % 7
  const start = new Date(today)
  start.setDate(today.getDate() - mondayOffset - (HEATMAP_WEEKS - 1) * 7)

  const weeks = []
  const monthLabels = []
  let prevMonth = -1
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const days = []
    for (let r = 0; r < 7; r++) {
      const d = new Date(start)
      d.setDate(start.getDate() + w * 7 + r)
      const count = counts[localDateKey(d)] || 0
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4
      days.push({ key: localDateKey(d), count, future: d > today, level })
    }
    const m = days[0] ? parseDateLocal(days[0].key).getMonth() : prevMonth
    monthLabels.push(m !== prevMonth ? MONTHS_SHORT[m].toUpperCase() : '')
    prevMonth = m
    weeks.push(days)
  }
  return { weeks, monthLabels, total }
})

function cellClass(day) {
  // Days later this week (after today) have no activity yet  render them as
  // empty tiles rather than hiding them, so the current week's column stays a
  // full rectangle instead of leaving cells dangling off the top-right.
  return LEVEL_CLASS[day.level]
}
</script>

<template>
  <div class="relative pt-1 pb-12">
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-x-10 gap-y-10">

      <!-- ══ Center column ═══════════════════════════════════════════════ -->
      <div class="min-w-0 space-y-9">

        <!-- Hero -->
        <header>
          <p class="eyebrow text-gray-400 dark:text-gray-500">{{ greeting }}</p>
          <h1 class="display mt-1.5 text-5xl sm:text-6xl text-gray-900 dark:text-gray-50">
            {{ displayName }}<span class="text-primary-600">.</span>
          </h1>
          <p class="mt-4 max-w-2xl font-serif text-lg sm:text-xl leading-relaxed text-gray-600 dark:text-gray-300">
            <template v-if="overdueCount">
              <span class="italic text-rust-600 dark:text-rust-500">{{ overdueCount }} overdue assignment<template v-if="overdueCount !== 1">s</template></span><template v-if="agenda.length"> need attention. </template><template v-else> are waiting. </template>
            </template>
            <span>{{ slateLine }}</span>
          </p>
        </header>

        <!-- Stat group -->
        <div class="grid grid-cols-3 rounded-2xl border border-paper-line dark:border-gray-700/60 overflow-hidden bg-surface/30 dark:bg-gray-800/20">
          <!-- Today's tasks -->
          <div class="p-5 sm:p-6 border-r border-paper-line dark:border-gray-700/60">
            <p class="display text-4xl sm:text-5xl text-gray-900 dark:text-gray-50 leading-none">
              {{ todayCompleted }}<span class="text-2xl sm:text-3xl text-gray-400 dark:text-gray-600">/{{ agenda.length }}</span>
            </p>
            <p class="mt-3.5 text-sm font-semibold text-gray-800 dark:text-gray-200">Today's Tasks</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{{ todaysSub }}</p>
          </div>
          <!-- Upcoming -->
          <div class="p-5 sm:p-6 border-r border-paper-line dark:border-gray-700/60">
            <p class="display text-4xl sm:text-5xl text-gray-900 dark:text-gray-50 leading-none">
              {{ assignmentsStore.upcomingAssignments.length }}
            </p>
            <p class="mt-3.5 text-sm font-semibold text-gray-800 dark:text-gray-200">Upcoming</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{{ upcomingSub }}</p>
          </div>
          <!-- Overdue -->
          <div class="p-5 sm:p-6">
            <p
              class="display text-4xl sm:text-5xl leading-none"
              :class="overdueCount > 0 ? 'text-rust-600 dark:text-rust-500' : 'text-gray-900 dark:text-gray-50'"
            >
              {{ overdueCount }}
            </p>
            <p class="mt-3.5 text-sm font-semibold text-gray-800 dark:text-gray-200">Overdue</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{{ overdueSub }}</p>
          </div>
        </div>

        <!-- Today's tasks -->
        <section>
          <div class="flex items-baseline justify-between border-b border-paper-line dark:border-gray-700/60 pb-2.5">
            <h2 class="display text-xl text-gray-900 dark:text-gray-100">Today's tasks</h2>
            <button type="button" @click="router.push('/tasks')" class="eyebrow text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
              View all →
            </button>
          </div>

          <!-- Task list -->
          <div v-if="agenda.length" class="mt-1 divide-y divide-paper-line dark:divide-gray-700/50">
            <div
              v-for="task in agenda"
              :key="task.id"
              class="group flex items-center gap-3.5 py-3 cursor-pointer"
              @click="toggleTask(task.id)"
            >
              <button
                type="button"
                class="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
                :class="task.completed
                  ? 'bg-primary-600 border-primary-600'
                  : 'border-gray-300 dark:border-gray-600 group-hover:border-primary-500'"
                @click.stop="toggleTask(task.id)"
              >
                <svg v-if="task.completed" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7" />
                </svg>
                <span
                  v-else
                  class="w-1.5 h-1.5 rounded-full"
                  :class="PRIORITY_DOT[task.priorityLevel] || 'bg-gray-300 dark:bg-gray-600'"
                />
              </button>
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm font-medium truncate transition-colors"
                  :class="task.completed ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-900 dark:text-gray-100'"
                >
                  {{ task.title }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {{ task.courseName || task.assignmentTitle || 'Personal task' }}
                </p>
              </div>
              <span class="flex-shrink-0 eyebrow text-gray-300 dark:text-gray-600">
                {{ task.completed ? 'Done' : (task.priorityLevel === 'urgent' ? 'Urgent' : task.priorityLevel === 'high' ? 'High' : '') }}
              </span>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="mt-6">
            <p class="font-serif italic text-xl text-gray-500 dark:text-gray-400">Your slate is clear for today.</p>
            <p class="mt-1.5 text-sm text-gray-400 dark:text-gray-500">Add assignments to get tasks scheduled automatically.</p>
            <button
              type="button"
              @click="router.push({ path: '/tasks', query: { new: '1' } })"
              class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add task
            </button>
          </div>
        </section>

        <!-- Activity -->
        <section>
          <div class="flex items-baseline justify-between border-b border-paper-line dark:border-gray-700/60 pb-2.5">
            <h2 class="display text-xl text-gray-900 dark:text-gray-100">Activity</h2>
            <span class="eyebrow text-gray-400">Past 14 weeks</span>
          </div>

          <div class="mt-5 max-w-2xl">
            <!-- Month labels (mirror the grid columns so they line up) -->
            <div class="flex gap-1.5">
              <div class="w-6 shrink-0" aria-hidden="true" />
              <div
                v-for="(label, i) in activity.monthLabels"
                :key="`m-${i}`"
                class="flex-1 relative h-4"
              >
                <span v-if="label" class="absolute left-0 bottom-0 font-mono text-[10px] tracking-wide text-gray-400 whitespace-nowrap">{{ label }}</span>
              </div>
            </div>

            <!-- Grid: cells grow to fill the width as squares -->
            <div class="flex gap-1.5 mt-1.5">
              <!-- Day-of-week labels -->
              <div class="w-6 shrink-0 flex flex-col gap-1.5">
                <span
                  v-for="(d, r) in DAY_LABELS"
                  :key="`d-${r}`"
                  class="flex-1 flex items-center font-mono text-[10px] leading-none text-gray-400"
                >{{ d }}</span>
              </div>
              <!-- Weeks -->
              <div v-for="(week, i) in activity.weeks" :key="`w-${i}`" class="flex-1 flex flex-col gap-1.5">
                <div
                  v-for="day in week"
                  :key="day.key"
                  class="aspect-square rounded-[5px]"
                  :class="cellClass(day)"
                  :title="`${day.count} completed · ${day.key}`"
                />
              </div>
            </div>
          </div>

          <!-- Legend -->
          <div class="mt-4 max-w-2xl flex items-center justify-between gap-4">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-[10px] text-gray-400">Less</span>
              <span v-for="lvl in 5" :key="`l-${lvl}`" class="w-3.5 h-3.5 rounded-[4px]" :class="LEVEL_CLASS[lvl - 1]" />
              <span class="font-mono text-[10px] text-gray-400">More</span>
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500">
              <span class="font-medium text-gray-500 dark:text-gray-400">{{ activity.total }}</span> assignments completed this semester
            </p>
          </div>
        </section>
      </div>

      <!-- ══ Right rail · Plan ═══════════════════════════════════════════ -->
      <aside class="lg:border-l lg:border-paper-line dark:lg:border-gray-700/60 lg:pl-8 lg:sticky lg:top-16 self-start">
        <p class="eyebrow text-gray-400 dark:text-gray-500 mb-4">Plan</p>

        <!-- Weekly planner -->
        <button
          type="button"
          @click="router.push('/planner')"
          class="group block w-full text-left rounded-2xl bg-gradient-to-br from-primary-800 to-primary-900 hover:from-primary-700 hover:to-primary-800 transition-colors p-4 shadow-sm shadow-primary-900/20"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <svg class="w-3.5 h-3.5 text-primary-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span class="text-[14px] font-semibold text-white tracking-tight">Weekly planner</span>
              </div>
              <p class="mt-1 text-[12.5px] text-primary-200/80">View + block the week ahead</p>
            </div>
            <svg class="w-4 h-4 text-primary-300 shrink-0 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        <!-- Overdue alert -->
        <div
          v-if="overdueCount"
          class="mt-4 rounded-2xl border border-dashed border-rust-500/35 bg-rust-50/70 dark:bg-rust-500/[0.06] p-4"
        >
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-rust-500" />
            <span class="eyebrow text-rust-600">{{ overdueCount }} Overdue</span>
          </div>
          <p class="mt-2 font-serif text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-300">
            You have <span class="font-medium text-rust-600 dark:text-rust-500">{{ overdueCount }} assignment{{ overdueCount === 1 ? '' : 's' }}</span> past their due date.<template v-if="nextDeadline"> Let's clear them before {{ shortDate(nextDeadline.dueDate) }} hits.</template>
          </p>
          <button
            type="button"
            @click="router.push('/assignments')"
            class="mt-2.5 inline-flex items-center text-[12.5px] font-medium text-rust-600 hover:text-rust-500 underline underline-offset-2 decoration-rust-500/40 transition-colors"
          >
            Review overdue →
          </button>
        </div>

        <!-- Upcoming deadlines -->
        <div class="mt-7">
          <p class="text-[13px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Upcoming deadlines</p>

          <div v-if="railDeadlines.length">
            <button
              v-for="a in railDeadlines"
              :key="a.id"
              type="button"
              @click="router.push('/assignments')"
              class="block w-full text-left py-3 border-b border-dotted border-paper-line dark:border-gray-700/60 group"
            >
              <div class="flex items-start justify-between gap-3">
                <p class="text-[13px] font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors">
                  {{ a.title }}
                </p>
                <span class="shrink-0 mt-0.5 font-mono text-[11px] text-gray-400">{{ shortDate(a.dueDate) }}</span>
              </div>
              <p class="mt-1 font-mono text-[10.5px] text-gray-400 truncate">{{ courseName(a) }} · Calendar feed</p>
            </button>
          </div>
          <p v-else class="text-[13px] text-gray-400 dark:text-gray-500 py-3">Nothing on the horizon yet.</p>

          <button
            type="button"
            @click="router.push('/assignments')"
            class="mt-3 eyebrow text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            View all →
          </button>
        </div>
      </aside>

    </div>
  </div>
</template>
