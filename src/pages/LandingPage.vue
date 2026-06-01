<script setup>
import { computed, ref } from 'vue'
import { Button } from '../components/ui'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const showSkipSignIn = computed(() => !isSupabaseConfigured)

const loginToApp = { name: 'Login', query: { redirect: '/dashboard' } }
const registerToApp = { name: 'Register', query: { redirect: '/dashboard' } }

// Public Vercel Blob URL for the Windows installer — permanent, no expiry/token.
const installerUrl = 'https://vulxandurwzn2oir.public.blob.vercel-storage.com/Plannr-1.0.0-x64.exe'

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

// Anonymized sample testimonials — monograms are academic-field tags, not real
// names. Swap in real student quotes when available.
const testimonials = [
  {
    quote: 'I used to keep due dates in three different places. Now everything lands on one timeline and I plan my week instead of reacting to it.',
    role: 'CS sophomore',
    monogram: 'CS',
  },
  {
    quote: 'Pasting my calendar link once meant I stopped copying deadlines by hand. The week view shows me exactly when crunch time is coming.',
    role: 'Pre-med student',
    monogram: 'PM',
  },
  {
    quote: 'Between work and classes I needed something structured, not another cluttered app. Breaking big assignments into scheduled tasks keeps me on track.',
    role: 'Part-time grad student',
    monogram: 'GR',
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
  <div
    class="min-h-screen scroll-smooth bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(16,185,129,0.08),transparent_50%),#fafaf9] text-gray-900"
  >
    <header
      class="sticky top-0 z-20 border-b border-gray-200/70 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70"
    >
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
        <RouterLink to="/" class="flex items-center gap-3 group min-w-0">
          <!-- Landing is always in light mode (route meta.landingPage), so only the light variant is needed. -->
          <img src="/plannr-icon-light.svg" alt="" class="w-9 h-9 shrink-0" />
          <span class="text-[15px] font-semibold tracking-tight text-gray-900 truncate">Plannr</span>
        </RouterLink>

        <nav class="hidden md:flex items-center gap-1 text-sm font-medium">
          <a href="#features" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Features</a>
          <a href="#testimonials" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Reviews</a>
          <a href="#download" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">Download</a>
          <a href="#faq" class="px-3 py-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-colors">FAQ</a>
        </nav>

        <nav class="flex items-center flex-wrap justify-end gap-2">
          <template v-if="isSupabaseConfigured && authStore.isAuthenticated">
            <RouterLink to="/dashboard" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Go to app</Button>
            </RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <main>
      <section class="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-24">
        <div class="max-w-3xl">
          <p
            class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-700 bg-primary-100/80 px-3 py-1 rounded-full border border-primary-200/60 mb-6"
          >
            Built for students
          </p>
          <h1
            class="text-4xl sm:text-5xl lg:text-[3.25rem] font-bold tracking-tight text-gray-900 leading-[1.1]"
          >
            Stop juggling tabs.<br />
            <span class="text-primary-800">Plan assignments</span> with clarity.
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

        <div
          class="mt-16 sm:mt-20 rounded-3xl border border-gray-200/80 bg-white shadow-xl shadow-gray-900/[0.06] overflow-hidden"
        >
          <!-- Abstract illustration of the planner's week view — not a literal screenshot. -->
          <div
            class="aspect-[4/3] sm:aspect-[16/9] bg-gradient-to-br from-gray-50 via-white to-primary-100/50 p-4 sm:p-6"
          >
            <div
              class="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-sm"
            >
              <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-gray-200/70 px-4">
                <span class="h-2.5 w-2.5 rounded-full bg-gray-200"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-gray-200"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-gray-200"></span>
                <span class="ml-3 h-2 w-28 rounded-full bg-gray-100"></span>
                <span class="ml-auto h-5 w-14 rounded-md bg-primary-100"></span>
              </div>
              <div class="flex min-h-0 flex-1 gap-2 p-3 sm:gap-3 sm:p-4">
                <div class="flex flex-1 flex-col gap-2">
                  <span class="h-2 w-2/3 rounded-full bg-gray-200"></span>
                  <div class="space-y-1 rounded-lg bg-primary-100 p-1.5">
                    <span class="block h-1.5 w-3/4 rounded-full bg-primary-300/70"></span>
                    <span class="block h-1.5 w-1/2 rounded-full bg-primary-300/40"></span>
                  </div>
                  <div class="h-6 rounded-lg bg-gray-100"></div>
                </div>
                <div class="flex flex-1 flex-col gap-2">
                  <span class="h-2 w-1/2 rounded-full bg-gray-200"></span>
                  <div class="h-8 rounded-lg bg-gray-100"></div>
                  <div class="space-y-1 rounded-lg bg-primary-100 p-1.5">
                    <span class="block h-1.5 w-2/3 rounded-full bg-primary-300/70"></span>
                  </div>
                </div>
                <div class="flex flex-1 flex-col gap-2">
                  <span class="h-2 w-3/4 rounded-full bg-gray-200"></span>
                  <div class="space-y-1 rounded-lg bg-primary-200/60 p-1.5">
                    <span class="block h-1.5 w-3/4 rounded-full bg-primary-400/50"></span>
                    <span class="block h-1.5 w-2/3 rounded-full bg-primary-400/30"></span>
                  </div>
                </div>
                <div class="hidden flex-1 flex-col gap-2 sm:flex">
                  <span class="h-2 w-1/2 rounded-full bg-gray-200"></span>
                  <div class="h-6 rounded-lg bg-gray-100"></div>
                  <div class="space-y-1 rounded-lg bg-primary-100 p-1.5">
                    <span class="block h-1.5 w-3/4 rounded-full bg-primary-300/70"></span>
                    <span class="block h-1.5 w-1/2 rounded-full bg-primary-300/40"></span>
                  </div>
                </div>
                <div class="hidden flex-1 flex-col gap-2 sm:flex">
                  <span class="h-2 w-2/3 rounded-full bg-gray-200"></span>
                  <div class="h-10 rounded-lg bg-gray-100"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" class="scroll-mt-20 border-t border-gray-200/80 bg-white/50 py-16 sm:py-20">
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
              class="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm shadow-gray-900/[0.03]"
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

      <section id="testimonials" class="scroll-mt-20 border-t border-gray-200/80 py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Built around real student weeks</h2>
          <p class="mt-2 text-gray-600 max-w-2xl">
            Less last-minute panic, more steady progress. Here’s the kind of semester it’s made for.
          </p>

          <ul class="mt-12 grid gap-6 sm:grid-cols-3">
            <li
              v-for="t in testimonials"
              :key="t.role"
              class="flex flex-col rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm shadow-gray-900/[0.03]"
            >
              <svg class="w-7 h-7 text-primary-200" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9.983 3v7.391c0 5.704-3.731 9.57-8.983 10.609l-.995-2.151c2.432-.917 3.995-3.638 3.995-5.849H.001V3h9.982zm14.017 0v7.391c0 5.704-3.748 9.57-9 10.609l-.996-2.151c2.433-.917 3.996-3.638 3.996-5.849h-3.983V3h9.983z"
                />
              </svg>
              <p class="mt-4 flex-1 text-gray-700 leading-relaxed">{{ t.quote }}</p>
              <div class="mt-6 flex items-center gap-3">
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800"
                  aria-hidden="true"
                >{{ t.monogram }}</span>
                <span class="text-sm font-medium text-gray-500">{{ t.role }}</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section id="download" class="scroll-mt-20 border-t border-gray-200/80 py-16 sm:py-20">
        <div class="max-w-4xl mx-auto px-4 sm:px-6">
          <div class="text-center">
            <p
              class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-700 bg-primary-100/80 px-3 py-1 rounded-full border border-primary-200/60 mb-6"
            >
              Desktop app
            </p>
            <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Take Plannr off the browser tab
            </h2>
            <p class="mt-3 text-gray-600 max-w-xl mx-auto">
              Install the desktop app to keep your planner one click away — independent of your browser and always at hand during study sessions.
            </p>
          </div>

          <div class="mt-10 max-w-md mx-auto">
            <a
              :href="installerUrl"
              download
              class="flex items-center gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm shadow-gray-900/[0.03] hover:border-primary-300 hover:shadow-md hover:-translate-y-0.5 transition-all group"
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

      <section id="faq" class="scroll-mt-20 border-t border-gray-200/80 bg-white/50 py-16 sm:py-20">
        <div class="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Frequently asked questions</h2>
          <p class="mt-2 text-gray-600">Everything you need to know before you dive in.</p>

          <ul class="mt-10 space-y-3">
            <li
              v-for="(item, i) in faqs"
              :key="item.q"
              class="rounded-2xl border border-gray-200/80 bg-white shadow-sm shadow-gray-900/[0.03]"
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

      <section class="py-16 sm:py-20 border-t border-gray-200/80">
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
                    class="!bg-white !text-primary-900 hover:!bg-gray-100"
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
                    class="!border-white/40 !text-white hover:!bg-white/10"
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
                    class="!bg-white !text-primary-900 hover:!bg-gray-100"
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

      <footer class="border-t border-gray-200/80 py-10">
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
