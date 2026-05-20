<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfileStore } from '../stores/profile'
import { Card, Button, Select } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import IcsFeedsManager from '../components/IcsFeedsManager.vue'
import SyllabusParser from '../components/SyllabusParser.vue'
import { listSchools } from '../services/coursePlannerApi.js'

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

// Course Planner school selection — gates the new "/course-planner" page.
const supportedSchools = ref([])
const schoolsLoading = ref(false)
const schoolsError = ref('')
const selectedSchool = computed({
  get: () => profileStore.profile.school || '',
  set: (v) => profileStore.updateProfile({ school: v }),
})

async function loadSupportedSchools() {
  schoolsLoading.value = true
  schoolsError.value = ''
  try {
    supportedSchools.value = await listSchools()
  } catch (e) {
    schoolsError.value = e?.message || 'Failed to load supported schools.'
  } finally {
    schoolsLoading.value = false
  }
}

const schoolOptions = computed(() =>
  [{ value: '', label: 'Not set — pick later' }].concat(
    supportedSchools.value.map((s) => ({
      value: s.code,
      label: s.name,
    }))
  )
)

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

onMounted(loadSupportedSchools)
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Profile & Settings</h1>
      <p class="text-gray-500 mt-1">Manage your profile and connect your calendar feeds</p>
    </div>

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
            <h2 class="text-lg font-semibold text-gray-900 leading-tight">Your account</h2>
            <p class="text-xs text-gray-500 mt-1">Information from your profile</p>
          </div>
        </div>

        <div class="flex-1 min-w-0 space-y-1">
          <div class="hidden sm:block">
            <h2 class="text-lg font-semibold text-gray-900">Your account</h2>
          </div>

          <p class="text-xs text-gray-500 sm:hidden mt-1 mb-4">
            {{ isSupabaseConfigured ? 'From your signed-in account.' : 'Stored on this device.' }}
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 pt-4 sm:pt-5 border-t border-gray-100">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Full name</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 leading-snug break-words">
                {{ accountDisplayName }}
              </p>
            </div>
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Email</p>
              <p class="mt-1.5 text-[15px] font-medium text-gray-900 leading-snug break-all">
                {{ accountDisplayEmail }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- Course Planner — which university's catalog to search by default -->
    <Card>
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">Your university</h2>
          <p class="text-gray-500 text-sm mt-1">
            Selects which university's live course catalog the Course Planner searches.
          </p>
        </div>
        <Select
          v-model="selectedSchool"
          label="University"
          :options="schoolOptions"
          :disabled="schoolsLoading || supportedSchools.length === 0"
          :hint="schoolsLoading ? 'Loading…' : schoolsError || ''"
          :error="schoolsError"
        />
        <p class="text-xs text-gray-500">
          Schools marked "limited enrollment data" expose only open / closed status,
          not exact seat counts.
        </p>
      </div>
    </Card>

    <!-- Calendar feeds (ICS) — replaces the old LMS scraper integrations -->
    <div>
      <h2 class="text-lg font-semibold text-gray-900 mb-4">Assignment imports</h2>
      <p class="text-gray-500 text-sm mb-4">
        Subscribe to your school's calendar feed to import courses and assignments. Most LMSs
        (Canvas, Brightspace, Blackboard) expose a "Calendar feed" or "Subscribe" URL — paste it below.
      </p>
      <IcsFeedsManager />
      <SyllabusParser class="mt-4" />
    </div>

    <!-- Session -->
    <Card v-if="isSupabaseConfigured" padding="none" class="rounded-xl px-4 py-3">
      <div class="flex flex-col gap-2 flex-wrap sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h2 class="text-base font-semibold text-gray-900 leading-tight sm:mb-0">Session</h2>
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
