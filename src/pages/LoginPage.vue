<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Card, Input, Button } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)

const redirectTarget = computed(() => {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') ? r : '/dashboard'
})

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const { error } = await authStore.signInWithPassword(
      email.value.trim(),
      password.value
    )
    if (error) {
      errorMessage.value = error.message || 'Could not sign in.'
      return
    }
    await router.replace(redirectTarget.value)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(71,85,105,0.06),transparent_50%),#fafafa]"
  >
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <div
          class="inline-flex w-11 h-11 rounded-xl bg-primary-900 items-center justify-center ring-1 ring-black/5 mb-4"
        >
          <svg
            class="w-6 h-6 text-white"
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
        <h1 class="text-2xl font-bold text-gray-900 tracking-tight">Sign in</h1>
        <p class="text-gray-500 text-sm mt-1">Assignment Auto-Planner</p>
      </div>

      <Card class="p-6 sm:p-8 shadow-lg shadow-gray-900/5 border border-gray-200/80">
        <div
          v-if="!isSupabaseConfigured"
          class="mb-4 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-sm px-4 py-3"
        >
          Add
          <code class="text-xs bg-amber-100/80 px-1 py-0.5 rounded">VITE_SUPABASE_URL</code>
          and
          <code class="text-xs bg-amber-100/80 px-1 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code>
          to your <code class="text-xs">.env</code> file, then restart the dev server.
        </div>

        <form class="space-y-4" @submit.prevent="onSubmit">
          <Input
            v-model="email"
            type="email"
            label="Email"
            placeholder="you@school.edu"
            required
            autocomplete="email"
          />
          <Input
            v-model="password"
            type="password"
            label="Password"
            placeholder="••••••••"
            required
            autocomplete="current-password"
          />

          <p
            v-if="errorMessage"
            class="text-sm text-danger-600 bg-danger-50 border border-danger-200/80 rounded-lg px-3 py-2"
          >
            {{ errorMessage }}
          </p>

          <Button type="submit" block :loading="loading" :disabled="loading || !isSupabaseConfigured">
            Sign in
          </Button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-6">
          No account?
          <router-link
            :to="{ name: 'Register', query: route.query }"
            class="font-semibold text-primary-900 hover:text-primary-800"
          >
            Create one
          </router-link>
        </p>
      </Card>
    </div>
  </div>
</template>
