<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from '../components/ui'
import AppWalkthrough from '../components/features/AppWalkthrough.vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const showSkipSignIn = computed(() => !isSupabaseConfigured)

const loginToApp = { name: 'Login', query: { redirect: '/dashboard' } }
const registerToApp = { name: 'Register', query: { redirect: '/dashboard' } }

// Always serves the installer from the newest published GitHub Release.
// Filenames are version-less (see build.artifactName) so these links never change.
const installerUrl = 'https://github.com/nathanseneshaw/assignment_auto_planner/releases/latest/download/Plannr-x64.exe'
// Universal .dmg (build.mac arch: ['universal']) runs on both Apple Silicon and Intel.
const macInstallerUrl = 'https://github.com/nathanseneshaw/assignment_auto_planner/releases/latest/download/Plannr-universal.dmg'

// ── Static hero product preview (a faithful, non-interactive snapshot of the
//    Tasks page). Decorative only — marked aria-hidden in the template. ──
const previewAccount = { name: 'Alex Rivera', email: 'alex.rivera@school.edu', initials: 'AR' }

const previewTasks = [
  'Read Chapter 7: Thermodynamics',
  'Draft thesis for English essay',
  'Problem Set 4: Linear Algebra',
  'Review lecture notes for Bio midterm',
  'Outline slides for group project',
]

// ── Live demo loop: tasks in the preview check themselves off one by one,
//    and the surrounding stats/progress animate in sync, then reset. ──
const DEMO_TOTAL = 9
const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Reduced-motion visitors get a pleasant static snapshot instead of a loop.
const demoChecked = ref(prefersReducedMotion ? 3 : 0)
let demoStarted = false
let demoTimer = null

function stepDemo() {
  if (demoChecked.value < previewTasks.length) {
    demoChecked.value++
    demoTimer = setTimeout(stepDemo, 1100)
  } else {
    // Hold the "all done" state for a beat, then reset and loop.
    demoTimer = setTimeout(() => {
      demoChecked.value = 0
      demoTimer = setTimeout(stepDemo, 1000)
    }, 2800)
  }
}

function startDemo() {
  if (demoStarted || prefersReducedMotion) return
  demoStarted = true
  demoTimer = setTimeout(stepDemo, 1200)
}

const progressPercent = computed(() => Math.round((demoChecked.value / DEMO_TOTAL) * 100))

const previewStats = computed(() => [
  { label: 'Total', value: DEMO_TOTAL, tone: 'text-gray-900' },
  { label: 'Completed', value: demoChecked.value, tone: 'text-primary-600' },
  { label: 'Overdue', value: 0, tone: 'text-rust-600' },
  { label: 'Due Today', value: 2, tone: 'text-warning-600' },
])

const previewBreakdown = computed(() => [
  { label: 'Total', value: DEMO_TOTAL, tone: 'text-gray-900' },
  { label: 'Completed', value: demoChecked.value, tone: 'text-primary-600' },
  { label: 'Remaining', value: DEMO_TOTAL - demoChecked.value, tone: 'text-warning-600' },
  { label: 'Overdue', value: 0, tone: 'text-rust-600' },
  { label: 'Due today', value: 2, tone: 'text-gray-400' },
])

// ── Scroll-driven bits: reveal-on-scroll directive, demo trigger, sticky CTA ──
let revealObserver = null

// Local directive (auto-registered as v-reveal). Optional binding value = stagger delay in ms.
const vReveal = {
  mounted(el, binding) {
    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') return
    revealObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            revealObserver.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    )
    if (binding.value) el.style.transitionDelay = `${binding.value}ms`
    el.classList.add('reveal')
    revealObserver.observe(el)
  },
}

const previewEl = ref(null)
const showStickyCta = ref(false)

// ── Hero spotlight: a soft glow that trails the cursor (desktop pointers only) ──
const heroEl = ref(null)
const spotlightEl = ref(null)
const spotlightEnabled =
  !prefersReducedMotion &&
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: fine)').matches

function onHeroPointerMove(e) {
  if (!spotlightEnabled) return
  const glow = spotlightEl.value
  const host = heroEl.value
  if (!glow || !host) return
  const rect = host.getBoundingClientRect()
  const x = e.clientX - rect.left - glow.offsetWidth / 2
  const y = e.clientY - rect.top - glow.offsetHeight / 2
  glow.style.opacity = '1'
  glow.style.transform = `translate3d(${x}px, ${y}px, 0)`
}

function onHeroPointerLeave() {
  if (spotlightEl.value) spotlightEl.value.style.opacity = '0'
}

function onScroll() {
  // Mobile-only sticky CTA appears once the hero CTAs are scrolled away.
  showStickyCta.value = window.scrollY > 640
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  if (previewEl.value && typeof IntersectionObserver !== 'undefined') {
    const demoObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startDemo()
          demoObserver.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    demoObserver.observe(previewEl.value)
  } else {
    startDemo()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  clearTimeout(demoTimer)
  revealObserver?.disconnect()
})

const steps = [
  {
    title: 'Create your free account',
    body: 'Takes less than a minute. No credit card, no installs required to get started.',
  },
  {
    title: 'Connect your due dates',
    body: 'Paste a calendar link from Canvas, Blackboard, or Google Calendar, or upload a syllabus and Plannr pulls the due dates out for you.',
  },
  {
    title: 'See your whole semester',
    body: 'Every assignment lands on one timeline. Plan your week, track progress, and stop getting surprised by deadlines.',
  },
]

const features = [
  {
    title: 'One timeline for everything',
    body: 'See assignments, tasks, and deadlines in one organized dashboard, built for busy terms, not scattered spreadsheets.',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: 'Sync from any calendar',
    body: 'Paste an iCal link from Canvas, Blackboard, or Google Calendar and your due dates flow in automatically. No manual copying.',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  },
  {
    title: 'Turn a syllabus into a plan',
    body: 'Upload a course syllabus as a PDF or Word doc and Plannr extracts the due dates for you. No retyping anything.',
    icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
  {
    title: 'Plan the week ahead',
    body: 'Use the planner to block time, chip away at big projects, and spot overload before it sneaks up.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    title: 'Build next semester too',
    body: 'Search live course catalogs from over 55 universities, with real-time seat availability, while you plan your classes.',
    icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222',
  },
  {
    title: 'Catch overdue work early',
    body: 'Progress stats show what is done, what is due today, and what is slipping, so nothing sneaks past you.',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
]


const faqs = [
  {
    q: 'How much does it cost?',
    a: 'Plannr is completely free during the beta. Once the beta period ends, it will move to a subscription plan, but anyone who joins early will have plenty of notice before that happens.',
  },
  {
    q: 'What can I connect for automatic due dates?',
    a: 'Any calendar that gives you an iCal (ICS) link, including Canvas, Blackboard, and Google Calendar. Paste the link once and new assignments sync in automatically. You can also upload a course syllabus (PDF or Word doc) and the app will extract your due dates for you.',
  },
  {
    q: 'Do I need to install anything?',
    a: "Plannr is available as a web app you can open in any browser, and as a native desktop app for Windows and Mac if you prefer a dedicated window. Both stay in sync with your account.",
  },
  {
    q: 'How long does it take to set up?',
    a: "Under a minute. Create a free account, paste your calendar link or upload a syllabus, and your due dates appear on your timeline right away. No credit card needed.",
  },
  {
    q: 'Is my data private?',
    a: "Your courses, assignments, and calendar links are tied to your own account and aren’t shared with other students. Feeds are read-only links you can remove anytime.",
  },
  {
    q: 'How does weekly planning work?',
    a: "The weekly planner gives you a full view of everything on your plate: assignments, tasks, and any personal work you have scheduled. See your entire week at a glance so you can plan ahead, balance your workload, and avoid last-minute surprises.",
  },
]

const openFaq = ref(0)
function toggleFaq(i) {
  openFaq.value = openFaq.value === i ? -1 : i
}

function scrollToHowItWorks() {
  document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div class="min-h-screen scroll-smooth bg-paper text-gray-900">
    <header
      class="sticky top-0 z-20 border-b border-paper-line bg-paper/90 backdrop-blur-xl"
    >
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
        <RouterLink to="/" class="flex items-center gap-3 group min-w-0">
          <!-- Landing is always in light mode (route meta.landingPage), so only the light variant is needed. -->
          <img src="/plannr-icon-light.svg" alt="" class="w-9 h-9 shrink-0" />
          <span class="text-[15px] font-semibold tracking-tight text-gray-900 truncate">Plannr</span>
        </RouterLink>

        <nav class="hidden md:flex items-center gap-1 text-sm font-medium">
          <a href="#how-it-works" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">How it works</a>
          <a href="#tour" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Tour</a>
          <a href="#features" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Features</a>
          <a href="#download" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Download</a>
          <a href="#faq" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">FAQ</a>
        </nav>

        <nav class="flex items-center flex-wrap justify-end gap-2">
          <template v-if="isSupabaseConfigured && authStore.isAuthenticated">
            <RouterLink to="/dashboard" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Go to app</Button>
            </RouterLink>
          </template>
          <template v-else-if="isSupabaseConfigured">
            <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
              <Button variant="secondary" size="sm" type="button" @click="navigate">Sign in</Button>
            </RouterLink>
            <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Get started free</Button>
            </RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <main class="overflow-x-clip">
      <section
        ref="heroEl"
        class="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-24"
        @pointermove="onHeroPointerMove"
        @pointerleave="onHeroPointerLeave"
      >
        <!-- Soft ambient glow behind the hero (decorative). The blobs drift and
             breathe on a slow loop; the spotlight trails the cursor on desktop. -->
        <div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div class="hero-blob absolute -top-40 -left-32 w-[36rem] h-[36rem] rounded-full bg-primary-200/35 blur-3xl"></div>
          <div class="hero-blob hero-blob-2 absolute top-24 -right-40 w-[30rem] h-[30rem] rounded-full bg-warning-100/50 blur-3xl"></div>
          <div class="hero-blob hero-blob-3 absolute top-[24rem] left-1/4 w-[26rem] h-[26rem] rounded-full bg-primary-100/45 blur-3xl"></div>
          <div
            ref="spotlightEl"
            class="hero-spotlight absolute top-0 left-0 w-[42rem] h-[42rem] rounded-full bg-primary-300/20 blur-3xl opacity-0"
          ></div>
        </div>

        <div class="max-w-3xl">
          <span
            class="hero-enter hero-enter-1 eyebrow text-gray-600 border border-gray-400/50 px-3.5 py-1.5 rounded-full mb-6 inline-block"
          >
            Free for students during beta
          </span>
          <h1
            class="hero-enter hero-enter-2 display text-5xl sm:text-6xl lg:text-7xl text-gray-900 leading-[1.05]"
          >
            Never miss a due date<br />
            <span class="hero-underline relative inline-block text-primary-600">again</span>.
          </h1>
          <p class="hero-enter hero-enter-3 mt-6 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-2xl">
            Paste your Canvas, Blackboard, or Google Calendar link and every assignment lands on one
            organized timeline. Plan your week in minutes, not tabs.
          </p>

          <div class="hero-enter hero-enter-4 mt-10 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
            <template v-if="isSupabaseConfigured">
              <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
                <Button size="lg" type="button" class="w-full sm:w-auto min-w-[9rem]" @click="navigate">
                  Get started free
                </Button>
              </RouterLink>
              <Button
                variant="secondary"
                size="lg"
                type="button"
                class="w-full sm:w-auto min-w-[9rem]"
                @click="scrollToHowItWorks"
              >
                See how it works
              </Button>
            </template>
            <template v-else>
              <RouterLink to="/dashboard" custom v-slot="{ navigate }">
                <Button size="lg" type="button" class="w-full sm:w-auto min-w-[9rem]" @click="navigate">
                  Open the app
                </Button>
              </RouterLink>
              <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
                <Button variant="secondary" size="lg" type="button" class="w-full sm:w-auto min-w-[9rem]" @click="navigate">
                  Sign in
                </Button>
              </RouterLink>
            </template>
          </div>

          <p v-if="showSkipSignIn" class="mt-6 text-sm text-gray-500">
            Auth isn’t configured yet. Use <strong class="font-medium text-gray-700">Open the app</strong> to try the
            planner locally.
          </p>
          <p v-else class="hero-enter hero-enter-5 mt-5 text-sm text-gray-500">
            Free during beta · No credit card
          </p>
        </div>

        <!-- ── Product preview: a self-playing, non-interactive demo of the Tasks page ── -->
        <div ref="previewEl" class="mt-14 sm:mt-20 [perspective:1400px]" aria-hidden="true">
          <div
            v-reveal
            class="preview-card relative mx-auto max-w-5xl rounded-2xl border border-paper-line bg-surface shadow-2xl shadow-gray-900/15 overflow-hidden"
          >
            <!-- Browser chrome -->
            <div class="flex items-center gap-3 border-b border-paper-line bg-paper/60 px-4 py-2.5">
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded-full bg-gray-300"></span>
                <span class="w-3 h-3 rounded-full bg-gray-300"></span>
                <span class="w-3 h-3 rounded-full bg-gray-300"></span>
              </div>
              <div class="flex-1 flex justify-center">
                <div
                  class="flex items-center gap-1.5 rounded-md border border-paper-line bg-surface px-3 py-1 text-[11px] font-mono text-gray-400"
                >
                  <span class="text-gray-500">plannr.sh</span>
                  <span class="text-gray-300">/</span>
                  <span>tasks</span>
                </div>
              </div>
              <span
                class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-mono text-primary-700"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-primary-500"></span> On track
              </span>
            </div>

            <!-- App body -->
            <div class="flex">
              <!-- Sidebar -->
              <aside class="hidden lg:flex w-52 shrink-0 flex-col border-r border-paper-line bg-paper/40 p-5">
                <div class="flex items-center gap-2.5 mb-8">
                  <img src="/plannr-icon-light.svg" alt="" class="w-7 h-7 rounded-lg" />
                  <span class="text-[15px] font-semibold text-gray-900">Plannr</span>
                </div>

                <p class="eyebrow text-gray-400 mb-2">Today</p>
                <nav class="space-y-0.5 mb-6 text-sm">
                  <p class="px-2.5 py-1.5 rounded-lg text-gray-600">Dashboard</p>
                  <p
                    class="px-2.5 py-1.5 rounded-lg bg-primary-100/70 text-primary-900 font-medium flex items-center gap-2"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-primary-600"></span> Tasks
                  </p>
                </nav>

                <p class="eyebrow text-gray-400 mb-2">Plan</p>
                <nav class="space-y-0.5 text-sm">
                  <p class="px-2.5 py-1.5 rounded-lg text-gray-600 flex items-center justify-between">
                    Assignments <span class="font-mono text-[11px] text-gray-400">3</span>
                  </p>
                  <p class="px-2.5 py-1.5 rounded-lg text-gray-600 flex items-center justify-between">
                    Planner <span class="font-mono text-[11px] text-gray-400">5</span>
                  </p>
                  <p class="px-2.5 py-1.5 rounded-lg text-gray-600 flex items-center justify-between">
                    Courses <span class="font-mono text-[11px] text-gray-400">4</span>
                  </p>
                </nav>

                <div class="mt-auto flex items-center gap-2.5 pt-6">
                  <span
                    class="flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[11px] font-medium text-gray-600"
                  >{{ previewAccount.initials }}</span>
                  <div class="min-w-0">
                    <p class="text-[13px] font-medium text-gray-700 truncate">{{ previewAccount.name }}</p>
                    <p class="text-[11px] text-gray-400 truncate">{{ previewAccount.email }}</p>
                  </div>
                </div>
              </aside>

              <!-- Main column -->
              <div class="flex-1 min-w-0 p-5 sm:p-7">
                <!-- Breadcrumb + meta -->
                <div class="flex items-center justify-between gap-4 mb-5">
                  <p class="eyebrow text-gray-400 flex items-center gap-1.5">
                    <span>Home</span><span class="text-gray-300">›</span><span class="text-gray-600">Tasks</span>
                  </p>
                  <p class="hidden sm:flex eyebrow text-gray-400 items-center gap-2">
                    <span>Fri · Jun 12 · 3:03 PM</span>
                    <span class="text-gray-300">·</span>
                    <span>{{ Math.min(demoChecked, 2) }}/2 Today</span>
                    <span class="text-primary-600">{{ progressPercent }}% done</span>
                  </p>
                </div>

                <!-- Title + add -->
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <h3 class="display text-3xl sm:text-4xl text-gray-900">Tasks</h3>
                    <p class="mt-1 font-serif italic text-sm sm:text-base text-gray-500">
                      Plan and track your daily study tasks
                    </p>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-900 text-white text-[12px] font-semibold shadow-sm shadow-primary-900/15"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Task
                  </span>
                </div>

                <!-- Stat cards -->
                <div class="mt-5 grid grid-cols-4 gap-2.5 sm:gap-3">
                  <div
                    v-for="card in previewStats"
                    :key="card.label"
                    class="rounded-xl border border-paper-line bg-surface px-3 py-3 sm:px-4 shadow-sm shadow-gray-900/[0.03]"
                  >
                    <p class="display text-2xl sm:text-4xl leading-none" :class="card.tone">{{ card.value }}</p>
                    <p class="eyebrow text-gray-400 mt-2">{{ card.label }}</p>
                  </div>
                </div>

                <!-- Filter row -->
                <div class="mt-6 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-4">
                    <span class="eyebrow text-gray-400">Today</span>
                    <span class="hidden sm:inline eyebrow text-gray-400">This Week</span>
                    <span class="eyebrow text-gray-900 border-b-2 border-gray-900 pb-1">All</span>
                    <span
                      class="hidden sm:inline-flex items-center gap-1 rounded-lg border border-paper-line bg-surface px-2.5 py-1 text-[11px] font-mono text-gray-500"
                    >
                      All tasks
                      <svg class="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </div>
                  <span
                    class="hidden sm:inline-flex items-center gap-2 rounded-xl border border-paper-line bg-surface px-3 py-1.5 text-[11px] font-mono text-gray-400"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Search tasks…
                  </span>
                </div>

                <!-- Task group -->
                <div class="mt-6">
                  <div class="flex items-center gap-3">
                    <p class="eyebrow text-gray-400">This Week</p>
                    <span class="font-mono text-[11px] text-gray-400 tabular-nums">{{ demoChecked }}/9</span>
                    <div class="flex-1 h-px bg-paper-line"></div>
                  </div>
                  <div class="mt-1">
                    <div
                      v-for="(title, ti) in previewTasks"
                      :key="title"
                      class="flex items-start gap-3 py-2.5 border-b border-dotted border-paper-line"
                    >
                      <span
                        class="mt-0.5 shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-full border transition-colors duration-300"
                        :class="ti < demoChecked ? 'border-primary-600 bg-primary-600' : 'border-gray-300'"
                      >
                        <svg
                          v-if="ti < demoChecked"
                          class="w-2.5 h-2.5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="3.5"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                      <div class="flex-1 min-w-0">
                        <p
                          class="font-serif text-[15px] leading-snug transition-colors duration-300"
                          :class="ti < demoChecked ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-900'"
                        >{{ title }}</p>
                        <span
                          class="mt-1 inline-block font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors duration-300"
                          :class="ti < demoChecked ? 'bg-primary-50 text-primary-700' : 'bg-rust-50 text-rust-600'"
                        >
                          {{ ti < demoChecked ? 'Done' : 'Urgent' }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right rail · Progress -->
              <aside class="hidden xl:block w-56 shrink-0 border-l border-paper-line p-6">
                <p class="eyebrow text-gray-400 mb-3">Progress</p>
                <p class="display text-gray-900 leading-none">
                  <span class="text-5xl tabular-nums">{{ progressPercent }}</span><span class="text-2xl text-gray-400">%</span>
                </p>
                <div class="mt-4 h-1.5 rounded-full bg-paper-line overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary-600 transition-[width] duration-500 ease-out"
                    :style="{ width: progressPercent + '%' }"
                  ></div>
                </div>
                <p class="mt-3 text-[12px] text-gray-500">
                  <span class="font-medium text-gray-900">{{ demoChecked }}</span> of
                  <span class="font-medium text-gray-900">9</span> tasks complete
                </p>

                <p class="eyebrow text-gray-400 mt-7 mb-2">Breakdown</p>
                <div>
                  <div
                    v-for="row in previewBreakdown"
                    :key="row.label"
                    class="flex items-center justify-between py-2 border-b border-dotted border-paper-line"
                  >
                    <span class="text-[12px] text-gray-500">{{ row.label }}</span>
                    <span class="font-mono text-[14px] tabular-nums" :class="row.tone">{{ row.value }}</span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <!-- Trust strip: honest, concrete signals under the product preview -->
        <div v-reveal class="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-gray-500">
          <span>Works with Canvas, Blackboard &amp; Google Calendar</span>
          <span class="hidden sm:inline text-gray-300">·</span>
          <span>Course catalogs from 55+ universities</span>
          <span class="hidden sm:inline text-gray-300">·</span>
          <span>Web + Windows &amp; Mac desktop app</span>
        </div>
      </section>

      <section id="how-it-works" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div v-reveal>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Up and running in a minute</h2>
            <p class="mt-2 text-gray-600 max-w-2xl">
              No setup marathon, no manual data entry. Three steps and your semester is organized.
            </p>
          </div>

          <ol class="mt-12 grid gap-6 sm:grid-cols-3">
            <li
              v-for="(step, i) in steps"
              :key="step.title"
              v-reveal="i * 90"
              class="group rounded-2xl border border-paper-line bg-surface p-6 shadow-sm shadow-gray-900/[0.03] transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-primary-200"
            >
              <span
                class="flex w-11 h-11 items-center justify-center rounded-xl bg-primary-100 text-primary-900 display text-xl mb-4 transition-transform duration-300 group-hover:scale-110"
              >{{ i + 1 }}</span>
              <h3 class="text-lg font-semibold text-gray-900">{{ step.title }}</h3>
              <p class="mt-2 text-sm text-gray-600 leading-relaxed">{{ step.body }}</p>
            </li>
          </ol>

          <div v-if="isSupabaseConfigured" class="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
              <Button size="lg" type="button" class="w-full sm:w-auto" @click="navigate">
                Create your free account
              </Button>
            </RouterLink>
            <p class="text-sm text-gray-500">Free during beta. No credit card.</p>
          </div>
        </div>
      </section>

      <section id="tour" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div v-reveal>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">See Plannr in action</h2>
            <p class="mt-2 text-gray-600 max-w-2xl">
              A quick tour of the real app, from plugging in your calendar link to building next semester's schedule.
            </p>
          </div>

          <div v-reveal="120" class="mt-12">
            <AppWalkthrough />
          </div>
        </div>
      </section>

      <section id="features" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <div v-reveal>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Why students use it</h2>
            <p class="mt-2 text-gray-600 max-w-2xl">
              Fewer surprises, clearer priorities. Works with Canvas, Blackboard, Google Calendar, or courses you add
              by hand.
            </p>
          </div>

          <ul class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <li
              v-for="(item, i) in features"
              :key="item.title"
              v-reveal="(i % 3) * 90"
              class="group rounded-2xl border border-paper-line bg-surface p-6 shadow-sm shadow-gray-900/[0.03] transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-primary-200"
            >
              <div class="w-11 h-11 rounded-xl bg-primary-100 flex items-center justify-center text-primary-900 mb-4 transition-transform duration-300 group-hover:scale-110">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
                </svg>
              </div>
              <h3 class="text-lg font-semibold text-gray-900">{{ item.title }}</h3>
              <p class="mt-2 text-sm text-gray-600 leading-relaxed">{{ item.body }}</p>
            </li>
          </ul>
        </div>
      </section>

      <section id="download" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-4xl mx-auto px-4 sm:px-6">
          <div v-reveal class="text-center">
            <span
              class="eyebrow text-gray-600 border border-gray-400/50 px-3.5 py-1.5 rounded-full mb-6 inline-block"
            >
              Desktop app
            </span>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Take Plannr off the browser tab
            </h2>
            <p class="mt-3 text-gray-600 max-w-xl mx-auto">
              Install the desktop app to keep your planner one click away, independent of your browser and always at hand during study sessions.
            </p>
          </div>

          <div v-reveal="120" class="mt-10 grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
            <a
              :href="installerUrl"
              download
              class="flex items-center gap-4 rounded-2xl border border-paper-line bg-surface p-5 shadow-sm shadow-gray-900/[0.03] hover:border-primary-300 hover:shadow-md hover:-translate-y-0.5 transition-all group"
            >
              <svg
                class="w-10 h-10 shrink-0 text-primary-700"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.351" />
              </svg>
              <div class="flex-1 text-left">
                <p class="text-base font-semibold text-gray-900">Download for Windows</p>
                <p class="mt-0.5 text-sm text-gray-500">.exe installer · 64-bit</p>
              </div>
              <svg
                class="w-5 h-5 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>

            <a
              :href="macInstallerUrl"
              download
              class="flex items-center gap-4 rounded-2xl border border-paper-line bg-surface p-5 shadow-sm shadow-gray-900/[0.03] hover:border-primary-300 hover:shadow-md hover:-translate-y-0.5 transition-all group"
            >
              <svg
                class="w-10 h-10 shrink-0 text-primary-700"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
              </svg>
              <div class="flex-1 text-left">
                <p class="text-base font-semibold text-gray-900">Download for Mac</p>
                <p class="mt-0.5 text-sm text-gray-500">.dmg installer · Apple Silicon &amp; Intel</p>
              </div>
              <svg
                class="w-5 h-5 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>

          <p class="mt-6 text-center text-sm text-gray-500">
            Available for Windows and Mac. Prefer to stay in the browser? Use the
            <RouterLink :to="loginToApp" class="text-primary-700 hover:underline">web app</RouterLink>.
          </p>
        </div>
      </section>

      <section id="faq" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-3xl mx-auto px-4 sm:px-6">
          <div v-reveal>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Frequently asked questions</h2>
            <p class="mt-2 text-gray-600">Everything you need to know before you dive in.</p>
          </div>

          <ul v-reveal="120" class="mt-10 space-y-3">
            <li
              v-for="(item, i) in faqs"
              :key="item.q"
              class="rounded-2xl border border-paper-line bg-surface shadow-sm shadow-gray-900/[0.03]"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between gap-4 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 rounded-2xl"
                :aria-expanded="openFaq === i"
                @click="toggleFaq(i)"
              >
                <span class="text-base font-semibold text-gray-900">{{ item.q }}</span>
                <svg
                  class="h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200"
                  :class="{ 'rotate-180': openFaq === i }"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                class="grid transition-[grid-template-rows] duration-200 ease-out"
                :class="openFaq === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
              >
                <div class="min-h-0 overflow-hidden">
                  <p class="px-5 pb-5 text-gray-600 leading-relaxed">{{ item.a }}</p>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section class="py-16 sm:py-20 border-t border-paper-line">
        <div class="max-w-4xl mx-auto px-4 sm:px-6">
          <div
            v-reveal
            class="text-center rounded-3xl bg-primary-900 text-white px-8 py-14 sm:py-16 shadow-xl shadow-primary-900/25"
          >
            <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Your most organized semester starts here.</h2>
            <p class="mt-3 text-primary-200 max-w-xl mx-auto">
              Create a free account and take control of your courses, tasks, and due dates, all in one place.
            </p>
            <div class="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <template v-if="isSupabaseConfigured">
                <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
                  <Button
                    variant="secondary"
                    size="lg"
                    type="button"
                    class="!bg-surface !text-primary-900 hover:!bg-gray-100"
                    @click="navigate"
                  >
                    Get started free
                  </Button>
                </RouterLink>
                <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
                  <Button
                    variant="outline"
                    size="lg"
                    type="button"
                    class="!border-white/40 !text-white hover:!bg-surface/10"
                    @click="navigate"
                  >
                    Sign in
                  </Button>
                </RouterLink>
              </template>
              <template v-else>
                <RouterLink to="/dashboard" custom v-slot="{ navigate }">
                  <Button
                    variant="secondary"
                    size="lg"
                    type="button"
                    class="!bg-surface !text-primary-900 hover:!bg-gray-100"
                    @click="navigate"
                  >
                    Open the app
                  </Button>
                </RouterLink>
              </template>
            </div>
            <p v-if="isSupabaseConfigured" class="mt-4 text-sm text-primary-200/90">
              Free during beta. No credit card.
            </p>
          </div>
        </div>
      </section>

      <footer class="border-t border-paper-line py-10">
        <div
          class="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500"
        >
          <p>© {{ new Date().getFullYear() }} Plannr</p>
          <nav class="flex items-center gap-5">
            <a href="#how-it-works" class="hover:text-gray-900 transition-colors">How it works</a>
            <a href="#tour" class="hover:text-gray-900 transition-colors">Tour</a>
            <a href="#features" class="hover:text-gray-900 transition-colors">Features</a>
            <a href="#download" class="hover:text-gray-900 transition-colors">Download</a>
            <a href="#faq" class="hover:text-gray-900 transition-colors">FAQ</a>
          </nav>
        </div>
      </footer>
    </main>

    <!-- Sticky mobile CTA: appears after the hero CTAs scroll away -->
    <Transition name="sticky-cta">
      <div
        v-if="isSupabaseConfigured && showStickyCta"
        class="fixed inset-x-0 bottom-0 z-30 md:hidden border-t border-paper-line bg-paper/95 backdrop-blur-xl px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
          <Button block type="button" @click="navigate">Get started free</Button>
        </RouterLink>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Hero entrance: staggered fade-up on load ── */
.hero-enter {
  opacity: 0;
  animation: hero-fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.hero-enter-1 { animation-delay: 0.05s; }
.hero-enter-2 { animation-delay: 0.15s; }
.hero-enter-3 { animation-delay: 0.3s; }
.hero-enter-4 { animation-delay: 0.45s; }
.hero-enter-5 { animation-delay: 0.6s; }

@keyframes hero-fade-up {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Animated underline sweep on the highlighted headline word */
.hero-underline::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.04em;
  height: 0.09em;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.3;
  transform: scaleX(0);
  transform-origin: left;
  animation: underline-sweep 0.7s 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes underline-sweep {
  to { transform: scaleX(1); }
}

/* ── Hero background: blobs drift + breathe on offset loops; spotlight trails the cursor ── */
.hero-blob {
  animation: blob-drift 22s ease-in-out infinite alternate;
}
.hero-blob-2 {
  animation-duration: 28s;
  animation-delay: -9s;
}
.hero-blob-3 {
  animation-duration: 34s;
  animation-delay: -17s;
}

@keyframes blob-drift {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(3rem, -2rem, 0) scale(1.12);
  }
  100% {
    transform: translate3d(-2.5rem, 2rem, 0) scale(0.94);
  }
}

.hero-spotlight {
  transition:
    transform 0.7s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.5s ease;
}

/* ── Reveal-on-scroll (v-reveal adds .reveal, observer adds .is-revealed) ── */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}
.reveal.is-revealed {
  opacity: 1;
  transform: translateY(0);
}

/* The hero preview tilts up into place instead of a plain fade */
.preview-card.reveal {
  transform: rotateX(9deg) translateY(36px) scale(0.97);
  transition:
    opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}
.preview-card.reveal.is-revealed {
  transform: rotateX(0deg) translateY(0) scale(1);
}

/* ── Sticky mobile CTA slide-up ── */
.sticky-cta-enter-active,
.sticky-cta-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.sticky-cta-enter-from,
.sticky-cta-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .hero-enter,
  .reveal,
  .preview-card.reveal {
    animation: none;
    transition: none;
    opacity: 1;
    transform: none;
  }
  .hero-underline::after {
    animation: none;
    transform: scaleX(1);
  }
  .hero-blob {
    animation: none;
  }
  .hero-spotlight {
    display: none;
  }
}
</style>
