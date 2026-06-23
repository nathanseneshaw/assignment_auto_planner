<script setup>
import { computed, ref } from 'vue'
import { Button } from '../components/ui'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const showSkipSignIn = computed(() => !isSupabaseConfigured)

const loginToApp = { name: 'Login', query: { redirect: '/dashboard' } }
const registerToApp = { name: 'Register', query: { redirect: '/dashboard' } }

// Always serves the installer from the newest published GitHub Release.
// Filename is version-less (see build.artifactName) so this link never changes.
const installerUrl = 'https://github.com/nathanseneshaw/assignment_auto_planner/releases/latest/download/Plannr-x64.exe'

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

const previewStats = [
  { label: 'Total', value: 9, tone: 'text-gray-900' },
  { label: 'Completed', value: 0, tone: 'text-primary-600' },
  { label: 'Overdue', value: 0, tone: 'text-rust-600' },
  { label: 'Due Today', value: 2, tone: 'text-warning-600' },
]

const previewBreakdown = [
  { label: 'Total', value: 9, tone: 'text-gray-900' },
  { label: 'Completed', value: 0, tone: 'text-primary-600' },
  { label: 'Remaining', value: 9, tone: 'text-warning-600' },
  { label: 'Overdue', value: 0, tone: 'text-rust-600' },
  { label: 'Due today', value: 2, tone: 'text-gray-400' },
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
    title: 'Plan the week ahead',
    body: 'Use the planner to block time, chip away at big projects, and spot overload before it sneaks up.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
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
    q: 'Can I try it without creating an account?',
    a: "No, an account is required to use the app. Sign up for free and you'll have full access to your dashboard, calendar sync, and planner right away.",
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
              <Button size="sm" type="button" @click="navigate">Create account</Button>
            </RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <main>
      <section class="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-24">
        <div class="max-w-3xl">
          <span
            class="eyebrow text-gray-600 border border-gray-400/50 px-3.5 py-1.5 rounded-full mb-6 inline-block"
          >
            Built for students
          </span>
          <h1
            class="display text-5xl sm:text-6xl lg:text-7xl text-gray-900 leading-[1.05]"
          >
            Stop juggling tabs.<br />
            <span class="text-primary-600">Plan assignments</span> with clarity.
          </h1>
          <p class="mt-6 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-2xl">
            Plannr brings your coursework into one organized workspace: deadlines, weekly planning, and calendar
            sync so you're always a step ahead.
          </p>

          <div class="mt-10 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
            <template v-if="isSupabaseConfigured">
              <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
                <Button size="lg" type="button" class="w-full sm:w-auto min-w-[9rem]" @click="navigate">
                  Sign in
                </Button>
              </RouterLink>
              <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
                <Button variant="secondary" size="lg" type="button" class="w-full sm:w-auto min-w-[9rem]" @click="navigate">
                  Create account
                </Button>
              </RouterLink>
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
        </div>

        <!-- ── Product preview: a static, non-interactive snapshot of the Tasks page ── -->
        <div class="mt-14 sm:mt-20" aria-hidden="true">
          <div
            class="relative mx-auto max-w-5xl rounded-2xl border border-paper-line bg-surface shadow-2xl shadow-gray-900/15 overflow-hidden"
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
                  <span class="text-gray-500">app.plannr.co</span>
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
                    <span>0/0 Today</span>
                    <span class="text-rust-600">9 Overdue</span>
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
                    <p class="eyebrow text-gray-400">No Date</p>
                    <span class="font-mono text-[11px] text-gray-400 tabular-nums">0/9</span>
                    <div class="flex-1 h-px bg-paper-line"></div>
                  </div>
                  <div class="mt-1">
                    <div
                      v-for="title in previewTasks"
                      :key="title"
                      class="flex items-start gap-3 py-2.5 border-b border-dotted border-paper-line"
                    >
                      <span class="mt-0.5 shrink-0 w-[18px] h-[18px] rounded-full border border-gray-300"></span>
                      <div class="flex-1 min-w-0">
                        <p class="font-serif text-[15px] leading-snug text-gray-900">{{ title }}</p>
                        <span
                          class="mt-1 inline-block font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rust-50 text-rust-600"
                        >
                          Urgent
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
                  <span class="text-5xl">0</span><span class="text-2xl text-gray-400">%</span>
                </p>
                <div class="mt-4 h-1.5 rounded-full bg-paper-line overflow-hidden"></div>
                <p class="mt-3 text-[12px] text-gray-500">
                  <span class="font-medium text-gray-900">0</span> of
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

      </section>

      <section id="features" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Why students use it</h2>
          <p class="mt-2 text-gray-600 max-w-2xl">
            Fewer surprises, clearer priorities. Works with Canvas, Blackboard, Google Calendar, or courses you add
            by hand.
          </p>

          <ul class="mt-12 grid gap-6 sm:grid-cols-3">
            <li
              v-for="item in features"
              :key="item.title"
              class="rounded-2xl border border-paper-line bg-surface p-6 shadow-sm shadow-gray-900/[0.03]"
            >
              <div class="w-11 h-11 rounded-xl bg-primary-100 flex items-center justify-center text-primary-900 mb-4">
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
          <div class="text-center">
            <span
              class="eyebrow text-gray-600 border border-gray-400/50 px-3.5 py-1.5 rounded-full mb-6 inline-block"
            >
              Desktop app
            </span>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Take Plannr off the browser tab
            </h2>
            <p class="mt-3 text-gray-600 max-w-xl mx-auto">
              Install the desktop app to keep your planner one click away  independent of your browser and always at hand during study sessions.
            </p>
          </div>

          <div class="mt-10 max-w-md mx-auto">
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
          </div>

          <p class="mt-6 text-center text-sm text-gray-500">
            Mac and Linux builds aren’t available yet. In the meantime, use the
            <RouterLink :to="loginToApp" class="text-primary-700 hover:underline">web app</RouterLink>.
          </p>
        </div>
      </section>

      <section id="faq" class="scroll-mt-20 border-t border-paper-line py-16 sm:py-20">
        <div class="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Frequently asked questions</h2>
          <p class="mt-2 text-gray-600">Everything you need to know before you dive in.</p>

          <ul class="mt-10 space-y-3">
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
            class="text-center rounded-3xl bg-primary-900 text-white px-8 py-14 sm:py-16 shadow-xl shadow-primary-900/25"
          >
            <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Your most organized semester starts here.</h2>
            <p class="mt-3 text-primary-200 max-w-xl mx-auto">
              Sign in to reach your dashboard and take control of your courses, tasks, and due dates, all in one place.
            </p>
            <div class="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <template v-if="isSupabaseConfigured">
                <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
                  <Button
                    variant="secondary"
                    size="lg"
                    type="button"
                    class="!bg-surface !text-primary-900 hover:!bg-gray-100"
                    @click="navigate"
                  >
                    Sign in
                  </Button>
                </RouterLink>
                <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
                  <Button
                    variant="outline"
                    size="lg"
                    type="button"
                    class="!border-white/40 !text-white hover:!bg-surface/10"
                    @click="navigate"
                  >
                    Create account
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
          </div>
        </div>
      </section>

      <footer class="border-t border-paper-line py-10">
        <div
          class="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500"
        >
          <p>© {{ new Date().getFullYear() }} Plannr</p>
          <nav class="flex items-center gap-5">
            <a href="#features" class="hover:text-gray-900 transition-colors">Features</a>
            <a href="#testimonials" class="hover:text-gray-900 transition-colors">Reviews</a>
            <a href="#download" class="hover:text-gray-900 transition-colors">Download</a>
            <a href="#faq" class="hover:text-gray-900 transition-colors">FAQ</a>
          </nav>
        </div>
      </footer>
    </main>
  </div>
</template>
