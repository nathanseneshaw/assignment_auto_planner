<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Card, Input, Button } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { isElectron } from '../lib/platform'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const fullName = ref('')
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const loading = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  successMessage.value = ''
  loading.value = true
  try {
    const { data, error } = await authStore.signUp(
      email.value.trim(),
      password.value,
      fullName.value.trim()
    )
    if (error) {
      errorMessage.value = error.message || 'Could not create account.'
      return
    }
    if (data.user && !data.session) {
      successMessage.value =
        'Check your email to confirm your account before signing in.'
      return
    }
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/dashboard'
    await router.replace(redirect)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(16,185,129,0.08),transparent_50%),#fafaf9]"
  >
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <!-- Auth pages always render in light mode (see App.vue applyTheme), so only the light variant is needed. -->
        <img src="/plannr-icon-light.svg" alt="" class="inline-block w-11 h-11 mb-4" />
        <h1 class="text-3xl font-bold text-gray-900 tracking-tight">Create account</h1>
        <p class="text-gray-500 text-sm mt-1">Plannr</p>
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
            v-model="fullName"
            label="Full name"
            placeholder="Alex Student"
            autocomplete="name"
          />
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
            placeholder="At least 6 characters"
            required
            autocomplete="new-password"
          />

          <p
            v-if="errorMessage"
            class="text-sm text-danger-600 bg-danger-50 border border-danger-200/80 rounded-lg px-3 py-2"
          >
            {{ errorMessage }}
          </p>
          <p
            v-if="successMessage"
            class="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-lg px-3 py-2"
          >
            {{ successMessage }}
          </p>

          <Button type="submit" block :loading="loading" :disabled="loading || !isSupabaseConfigured">
            Create account
          </Button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-6">
          Already have an account?
          <router-link
            :to="{ name: 'Login', query: route.query }"
            class="font-semibold text-primary-900 hover:text-primary-800"
          >
            Sign in
          </router-link>
        </p>
      </Card>

      <p v-if="!isElectron" class="text-center text-sm text-gray-500 mt-5">
        <router-link to="/" class="font-semibold text-primary-900 hover:text-primary-800">
          ← Back to home
        </router-link>
      </p>
    </div>
  </div>
</template>
