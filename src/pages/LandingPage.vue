<script setup>
import { computed } from 'vue'
import { Button } from '../components/ui'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const showSkipSignIn = computed(() => !isSupabaseConfigured)

const loginToApp = { name: 'Login', query: { redirect: '/dashboard' } }
const registerToApp = { name: 'Register', query: { redirect: '/dashboard' } }

const features = [
  {
    title: 'One timeline for everything',
    body: 'See assignments, tasks, and deadlines in one calm dashboard—built for busy terms, not spreadsheet chaos.',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: 'Bring in Canvas & Blackboard',
    body: 'Connect your LMS to pull courses and assignments so you spend less time copying due dates by hand.',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  },
  {
    title: 'Plan the week ahead',
    body: 'Use the planner to block time, chip away at big projects, and spot overload before it sneaks up.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
]
</script>

<template>
  <div
    class="min-h-screen bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(71,85,105,0.08),transparent_50%),#fafafa] text-gray-900"
  >
    <header
      class="sticky top-0 z-20 border-b border-gray-200/70 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70"
    >
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
        <RouterLink to="/" class="flex items-center gap-3 group min-w-0">
          <div
            class="w-9 h-9 shrink-0 rounded-xl bg-primary-900 flex items-center justify-center ring-1 ring-black/5 shadow-sm shadow-primary-900/15"
          >
            <svg
              class="w-[1.125rem] h-[1.125rem] text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <span class="text-[15px] font-semibold tracking-tight text-gray-900 truncate">Assignment Auto-Planner</span>
        </RouterLink>

        <nav class="flex items-center flex-wrap justify-end gap-2">
          <template v-if="isSupabaseConfigured && authStore.isAuthenticated">
            <RouterLink to="/dashboard" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Go to app</Button>
            </RouterLink>
          </template>
          <template v-else-if="isSupabaseConfigured">
            <RouterLink :to="loginToApp" custom v-slot="{ navigate }">
              <Button variant="ghost" size="sm" type="button" @click="navigate">Sign in</Button>
            </RouterLink>
            <RouterLink :to="registerToApp" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Create account</Button>
            </RouterLink>
          </template>
          <template v-else>
            <RouterLink to="/dashboard" custom v-slot="{ navigate }">
              <Button size="sm" type="button" @click="navigate">Open app</Button>
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
            AutoPlanner pulls your coursework into a simple workspace—deadlines, weekly planning, and LMS sync so you
            always know what to do next.
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
            Auth isn’t configured yet—use <strong class="font-medium text-gray-700">Open the app</strong> to try the
            planner locally.
          </p>
        </div>

        <div
          class="mt-16 sm:mt-20 rounded-3xl border border-gray-200/80 bg-white/90 shadow-xl shadow-gray-900/[0.06] overflow-hidden"
        >
          <div
            class="aspect-[16/9] sm:aspect-[2/1] bg-gradient-to-br from-gray-100 via-white to-primary-50 flex items-center justify-center p-8 sm:p-12"
          >
            <div class="text-center max-w-md">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-primary-900 flex items-center justify-center shadow-lg shadow-primary-900/20 mb-5"
              >
                <svg class="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p class="text-sm font-semibold text-primary-900 uppercase tracking-wide">Inside the app</p>
              <p class="mt-2 text-gray-600">
                Dashboard, assignments list, weekly planner, and profile integrations—everything after you sign in.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="border-t border-gray-200/80 bg-white/50 py-16 sm:py-20">
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Why students use it</h2>
          <p class="mt-2 text-gray-600 max-w-2xl">
            Fewer surprises, clearer priorities—whether you’re on Canvas, Blackboard, or flying solo with manual
            courses.
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

      <section class="py-16 sm:py-20 border-t border-gray-200/80">
        <div class="max-w-4xl mx-auto px-4 sm:px-6">
          <div
            class="text-center rounded-3xl bg-primary-900 text-white px-8 py-14 sm:py-16 shadow-xl shadow-primary-900/25"
          >
            <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Ready for a calmer semester?</h2>
            <p class="mt-3 text-primary-200 max-w-xl mx-auto">
              Sign in to reach your dashboard and start organizing courses, tasks, and due dates in one place.
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

      <footer class="border-t border-gray-200/80 py-8 text-center text-sm text-gray-500">
        <p>© {{ new Date().getFullYear() }} Assignment Auto-Planner</p>
      </footer>
    </main>
  </div>
</template>
