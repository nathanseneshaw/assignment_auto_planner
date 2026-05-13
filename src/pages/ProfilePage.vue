<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProfileStore } from '../stores/profile'
import { Card, Button } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import IcsFeedsManager from '../components/IcsFeedsManager.vue'

const router = useRouter()

const profileStore = useProfileStore()
const authStore = useAuthStore()

const accountDisplayName = computed(() => {
  const u = authStore.user
  if (isSupabaseConfigured && u) {
    const meta = u.user_metadata || {}
    return (
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      profileStore.profile.name ||
      '—'
    )
  }
  return profileStore.profile.name || '—'
})

const accountDisplayEmail = computed(() => {
  if (isSupabaseConfigured && authStore.user?.email) {
    return authStore.user.email
  }
  return profileStore.profile.email || '—'
})

function getInitials(name) {
  const n = String(name || '').trim()
  if (!n || n === '—') return '?'
  return n.split(/\s+/).map((part) => part[0]).join('').toUpperCase().slice(0, 2)
}

const signingOut = ref(false)

async function signOutAccount() {
  signingOut.value = true
  try {
    await authStore.signOut()
    await router.push({ name: 'Login' })
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Profile & Settings</h1>
      <p class="text-gray-500 dark:text-gray-400 mt-1">Manage your profile and connect your calendar feeds</p>
    </div>

    <!-- Appearance -->
    <Card>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3.5">
          <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
            <!-- Sun icon (light mode) -->
            <svg v-if="!profileStore.profile.darkMode" class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z" />
            </svg>
            <!-- Moon icon (dark mode) -->
            <svg v-else class="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ profileStore.profile.darkMode ? 'Dark mode' : 'Light mode' }}</p>
        </div>

        <!-- Toggle switch -->
        <button
          type="button"
          role="switch"
          :aria-checked="profileStore.profile.darkMode"
          @click="profileStore.toggleDarkMode()"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-offset-2"
          :class="profileStore.profile.darkMode ? 'bg-primary-900' : 'bg-gray-200 dark:bg-gray-600'"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200"
            :class="profileStore.profile.darkMode ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>
    </Card>

    <!-- Account details (read-only) -->
    <Card>
      <div class="flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8">
        <div class="flex-shrink-0 flex sm:block items-center gap-4 sm:gap-0">
          <div
            class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary-900 flex items-center justify-center text-white text-xl sm:text-2xl font-bold shadow-md shadow-primary-900/15 ring-4 ring-gray-100"
            aria-hidden="true"
          >
            {{ getInitials(accountDisplayName) }}
          </div>
          <div class="sm:hidden min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-tight">Your account</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Information from your profile</p>
          </div>
        </div>

        <div class="flex-1 min-w-0 space-y-1">
          <div class="hidden sm:block">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Your account</h2>
          </div>

          <p class="text-xs text-gray-500 dark:text-gray-400 sm:hidden mt-1 mb-4">
            {{ isSupabaseConfigured ? 'From your signed-in account.' : 'Stored on this device.' }}
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 pt-4 sm:pt-5 border-t border-gray-100 dark:border-gray-700/80">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Full name</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 dark:text-gray-100 leading-snug break-words">
                {{ accountDisplayName }}
              </p>
            </div>
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Email</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 dark:text-gray-100 leading-snug break-all">
                {{ accountDisplayEmail }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- Calendar feeds (ICS) — replaces the old LMS scraper integrations -->
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Assignment imports</h2>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Subscribe to your school's calendar feed to import courses and assignments. Most LMSs
        (Canvas, Brightspace, Blackboard) expose a "Calendar feed" or "Subscribe" URL — paste it below.
      </p>
      <IcsFeedsManager />
    </div>

    <!-- Session -->
    <Card v-if="isSupabaseConfigured" padding="none" class="rounded-xl px-4 py-3">
      <div class="flex flex-col gap-2 flex-wrap sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight sm:mb-0">Session</h2>
        <div class="flex shrink-0">
          <template v-if="authStore.user">
            <Button variant="outline" :loading="signingOut" :disabled="signingOut" @click="signOutAccount">
              Sign out
            </Button>
          </template>
          <template v-else>
            <router-link to="/login">
              <Button>Sign in</Button>
            </router-link>
          </template>
        </div>
      </div>
    </Card>
  </div>
</template>
