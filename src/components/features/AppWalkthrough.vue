<script setup>
/**
 * Interactive product walkthrough for the marketing landing page.
 *
 * Cycles through real screenshots of the app (captured from the live product,
 * stored in /public/walkthrough). Steps are clickable tabs; the tour also
 * auto-advances every few seconds once it scrolls into view, and stops the
 * moment the visitor interacts so it never fights their clicks.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const STEPS = [
  {
    key: 'ics-feeds',
    route: 'profile',
    title: 'Plug in your calendar link',
    body: 'Copy the calendar export link from Canvas or Blackboard, paste it straight into Plannr, and it stays connected. New assignments sync in on their own from then on.',
    image: '/walkthrough/ics-feeds.webp',
  },
  {
    key: 'assignments',
    route: 'assignments',
    title: 'Every due date in one place',
    body: 'Assignments flow in from your Canvas, Blackboard, or Google Calendar feeds and land on one list you can filter by course.',
    image: '/walkthrough/assignments.webp',
  },
  {
    key: 'planner',
    route: 'planner',
    title: 'Plan any day at a glance',
    body: 'Pick a day to see what is due and what you have planned, with a month view and the week ahead right beside it.',
    image: '/walkthrough/planner.webp',
  },
  {
    key: 'tasks',
    route: 'tasks',
    title: 'Break big work into small wins',
    body: 'Create tasks with priorities and groups, knock them out one by one, and watch your progress climb.',
    image: '/walkthrough/tasks.webp',
  },
  {
    key: 'course-planner',
    route: 'course-planner',
    title: 'Build next semester with live data',
    body: "Search your university's real course catalog, check open seats, and lay sections onto a weekly schedule.",
    image: '/walkthrough/course-planner.webp',
  },
]

const active = ref(0)
const activeStep = computed(() => STEPS[active.value])

// ── Auto-advance ──────────────────────────────────────────────────────────
// Plays only while the section is on screen; any click stops it for good.
const AUTOPLAY_MS = 6000
const rootEl = ref(null)
const userTookOver = ref(false)
const inView = ref(false)
let timer = null
let observer = null

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function syncTimer() {
  stopTimer()
  if (inView.value && !userTookOver.value) {
    timer = setInterval(() => {
      active.value = (active.value + 1) % STEPS.length
    }, AUTOPLAY_MS)
  }
}

function select(i) {
  userTookOver.value = true
  stopTimer()
  active.value = (i + STEPS.length) % STEPS.length
}

function onKeydown(e) {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    select(active.value + 1)
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    select(active.value - 1)
  }
}

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      inView.value = entry.isIntersecting
      syncTimer()
    },
    { threshold: 0.25 }
  )
  if (rootEl.value) observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  stopTimer()
  observer?.disconnect()
})
</script>

<template>
  <div ref="rootEl" @keydown="onKeydown">
    <div class="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
      <!-- Step list -->
      <div role="tablist" aria-label="Plannr walkthrough steps" class="order-2 lg:order-1 space-y-2.5">
        <button
          v-for="(step, i) in STEPS"
          :key="step.key"
          type="button"
          role="tab"
          :aria-selected="active === i"
          class="group relative w-full rounded-2xl border p-4 sm:p-5 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
          :class="
            active === i
              ? 'border-primary-300/80 bg-surface shadow-md shadow-primary-900/[0.06]'
              : 'border-paper-line bg-surface/50 hover:border-gray-300 hover:bg-surface'
          "
          @click="select(i)"
        >
          <span class="flex items-start gap-3.5">
            <span
              class="flex w-8 h-8 shrink-0 items-center justify-center rounded-lg display text-base transition-colors"
              :class="active === i ? 'bg-primary-900 text-white' : 'bg-primary-100 text-primary-900'"
            >{{ i + 1 }}</span>
            <span class="min-w-0">
              <span class="block text-[15px] font-semibold" :class="active === i ? 'text-gray-900' : 'text-gray-700'">
                {{ step.title }}
              </span>
              <span
                class="mt-1 hidden sm:block text-sm leading-relaxed text-gray-600 lg:transition-all lg:duration-300"
                :class="active === i ? '' : 'lg:hidden'"
              >
                {{ step.body }}
              </span>
            </span>
          </span>
          <!-- Autoplay progress hairline on the active step -->
          <span
            v-if="active === i && !userTookOver && inView"
            class="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full"
            aria-hidden="true"
          >
            <span
              class="block h-full origin-left bg-primary-500/60 animate-[walkthrough-progress_6s_linear_infinite]"
            ></span>
          </span>
        </button>
      </div>

      <!-- Screenshot in a browser frame -->
      <div class="order-1 lg:order-2 min-w-0">
        <div
          class="relative rounded-2xl border border-paper-line bg-surface shadow-2xl shadow-gray-900/15 overflow-hidden"
        >
          <div class="flex items-center gap-3 border-b border-paper-line bg-paper/60 px-4 py-2.5">
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded-full bg-gray-300"></span>
              <span class="w-3 h-3 rounded-full bg-gray-300"></span>
              <span class="w-3 h-3 rounded-full bg-gray-300"></span>
            </div>
            <div class="flex-1 flex justify-center min-w-0">
              <div
                class="flex items-center gap-1.5 rounded-md border border-paper-line bg-surface px-3 py-1 text-[11px] font-mono text-gray-400"
              >
                <span class="text-gray-500">app.plannr.co</span>
                <span class="text-gray-300">/</span>
                <span class="truncate">{{ activeStep.route }}</span>
              </div>
            </div>
            <span class="hidden sm:inline-flex font-mono text-[11px] text-gray-400 tabular-nums">
              {{ active + 1 }} / {{ STEPS.length }}
            </span>
          </div>

          <!-- All slides stay mounted and crossfade, so switching is instant. -->
          <div class="relative aspect-[16/10] bg-paper">
            <img
              v-for="(step, i) in STEPS"
              :key="step.key"
              :src="step.image"
              :alt="`Plannr ${step.route} page: ${step.title}`"
              class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
              :class="active === i ? 'opacity-100' : 'opacity-0'"
              :loading="i === 0 ? 'eager' : 'lazy'"
              draggable="false"
            />
          </div>
        </div>

        <!-- Mobile caption + prev/next (step bodies are hidden in the list on small screens) -->
        <div class="mt-4 flex items-start justify-between gap-4 lg:hidden">
          <p class="text-sm text-gray-600 leading-relaxed sm:hidden">{{ activeStep.body }}</p>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="flex w-9 h-9 items-center justify-center rounded-full border border-paper-line bg-surface text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
              aria-label="Previous step"
              @click="select(active - 1)"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              class="flex w-9 h-9 items-center justify-center rounded-full border border-paper-line bg-surface text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
              aria-label="Next step"
              @click="select(active + 1)"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes walkthrough-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
</style>
