<script setup>
import { ref, computed } from 'vue'
import { useTasksStore } from '../stores/tasks'
import { useAssignmentsStore } from '../stores/assignments'
import { Card } from '../components/ui'

const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()

const combinedCountByDate = computed(() => {
  const counts = {}
  for (const [date, tasks] of Object.entries(tasksStore.tasksByDate)) {
    counts[date] = (counts[date] || 0) + tasks.length
  }
  for (const assignment of assignmentsStore.assignments) {
    if (assignment.dueDate) {
      counts[assignment.dueDate] = (counts[assignment.dueDate] || 0) + 1
    }
  }
  return counts
})

function formatDateKeyLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const year = new Date().getFullYear()

const gridWeeks = computed(() => {
  const start = new Date(year, 0, 1)
  const end   = new Date(year, 11, 31)
  const countMap = combinedCountByDate.value
  const todayKey = formatDateKeyLocal(new Date())

  const gridStart = new Date(start)
  const offsetToMonday = (gridStart.getDay() + 6) % 7
  gridStart.setDate(gridStart.getDate() - offsetToMonday)

  const weeks = []
  const cursor = new Date(gridStart)

  while (cursor <= end) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor)
      d.setDate(cursor.getDate() + i)
      const dateKey = formatDateKeyLocal(d)
      week.push({
        dateKey,
        count: countMap[dateKey] || 0,
        inYear: d >= start && d <= end,
        isToday: dateKey === todayKey,
      })
    }
    weeks.push(week)
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
})

const monthLabels = computed(() => {
  const labels = []
  let lastMonth = -1
  gridWeeks.value.forEach((week, wi) => {
    const first = week.find(d => d.inYear)
    if (!first) return
    const [y, m] = first.dateKey.split('-').map(Number)
    if (m !== lastMonth) {
      labels.push({ weekIndex: wi, label: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) })
      lastMonth = m
    }
  })
  return labels
})

function intensityClass(count, inYear) {
  if (!inYear) return 'bg-transparent'
  if (count === 0)  return 'bg-gray-100 dark:bg-surface/8'
  if (count <= 2)   return 'bg-accent-200'
  if (count <= 5)   return 'bg-warning-300'
  if (count <= 8)   return 'bg-warning-500'
  return 'bg-danger-500'
}

const hoveredCell = ref(null)

const hoveredDateLabel = computed(() => {
  if (!hoveredCell.value) return ''
  const [y, m, d] = hoveredCell.value.dateKey.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
})

function onCellEnter(cell) { if (cell.inYear) hoveredCell.value = cell }
function onCellLeave()     { hoveredCell.value = null }

const DAY_LABELS    = ['Mon', '', 'Wed', '', 'Fri', '', '']
const LEGEND_CELLS  = ['bg-gray-100 dark:bg-surface/8', 'bg-accent-200', 'bg-warning-300', 'bg-warning-500', 'bg-danger-500']
</script>

<template>
  <Card padding="lg">
    <!-- Header -->
    <div class="mb-4">
      <h3 class="text-[17px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Workload heatmap</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ year }} — assignments due + tasks scheduled per day</p>
    </div>

    <!-- Grid -->
    <div class="overflow-x-auto py-1">
      <div class="inline-flex items-start gap-[5px] min-w-max">

        <!-- Day-of-week labels -->
        <div class="flex flex-col shrink-0 text-[11px] text-gray-400 dark:text-gray-500 font-medium text-right" style="gap: 3px; padding-top: 20px;">
          <span v-for="(label, i) in DAY_LABELS" :key="i" class="h-[13px] leading-[13px]">{{ label }}</span>
        </div>

        <!-- Month labels + cells -->
        <div>
          <!-- Month labels row -->
          <div class="flex" style="gap: 3px; margin-bottom: 4px; height: 16px;">
            <div
              v-for="(_, wi) in gridWeeks"
              :key="wi"
              class="w-[13px] shrink-0 text-[11px] text-gray-500 dark:text-gray-400 font-medium overflow-visible whitespace-nowrap"
            >
              {{ monthLabels.find(l => l.weekIndex === wi)?.label ?? '' }}
            </div>
          </div>

          <!-- Cell grid -->
          <div class="flex" style="gap: 3px;">
            <div
              v-for="(week, wi) in gridWeeks"
              :key="wi"
              class="flex flex-col shrink-0"
              style="gap: 3px;"
            >
              <div
                v-for="cell in week"
                :key="cell.dateKey"
                class="w-[13px] h-[13px] rounded-[2px]"
                :class="[
                  intensityClass(cell.count, cell.inYear),
                  cell.isToday ? 'ring-2 ring-offset-1 ring-primary-500 dark:ring-primary-400 dark:ring-offset-gray-900' : '',
                  !cell.inYear ? 'opacity-0 pointer-events-none' : 'cursor-default',
                ]"
                @mouseenter="onCellEnter(cell)"
                @mouseleave="onCellLeave"
              />
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Footer: info strip + Less/More legend -->
    <div class="mt-4 flex items-center justify-between gap-4">
      <div class="h-5 flex items-center min-w-0">
        <transition name="fade" mode="out-in">
          <p v-if="hoveredCell" :key="hoveredCell.dateKey" class="text-[13px] text-gray-600 dark:text-gray-300 truncate">
            <span class="font-semibold text-gray-900 dark:text-gray-100">{{ hoveredDateLabel }}</span>
            &nbsp;—&nbsp;
            <span>{{
              hoveredCell.count === 0
                ? 'Nothing scheduled'
                : `${hoveredCell.count} item${hoveredCell.count === 1 ? '' : 's'} scheduled`
            }}</span>
          </p>
          <p v-else key="placeholder" class="text-[13px] text-gray-400 dark:text-gray-500 select-none">Hover a cell to see details</p>
        </transition>
      </div>

      <div class="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-400 dark:text-gray-500 font-medium">
        <span>Less</span>
        <div v-for="cls in LEGEND_CELLS" :key="cls" class="w-[13px] h-[13px] rounded-[2px]" :class="cls" />
        <span>More</span>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.1s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
