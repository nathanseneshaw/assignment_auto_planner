<script setup>
/**
 * Email-confirmation landing page — the target of the signup confirmation link
 * (`emailRedirectTo` in the auth store's signUp).
 *
 * This tab deliberately does NOT sign in. Supabase has already confirmed the
 * email server-side by the time it redirects here (the implicit-flow token in
 * the URL is proof of that), so we just read the boot-time snapshot
 * (getAuthCallback) and show the result. The user is told they can close the
 * tab; the original tab they signed up in is the one that logs into the app.
 *
 * To make that original tab sign in instantly (instead of waiting for its next
 * poll tick), we post a one-off message on a BroadcastChannel that RegisterPage
 * listens on. Cross-device there's no listener, but the poll there covers it.
 *
 * Styling mirrors LoginPage / RegisterPage (centered header block + Card, Geist
 * font, emerald accent) so the page is visually part of the auth flow.
 */
import { ref, computed, onMounted } from 'vue'
import { Card, Button } from '../components/ui'
import { getAuthCallback } from '../lib/supabase'

const cb = getAuthCallback()

// 'confirmed' when the link carried a valid token, 'error' for an expired/invalid
// link, 'unknown' when the page is opened directly (no callback params at boot).
const status = ref(
  cb.status === 'confirmed' ? 'confirmed' : cb.status === 'error' ? 'error' : 'unknown'
)
const errorMessage = ref(cb.error)

const heading = computed(() => {
  if (status.value === 'confirmed') return 'Email confirmed'
  if (status.value === 'error') return 'Link didn’t work'
  return 'You can close this tab'
})

onMounted(() => {
  // Nudge the original signup tab (same browser) so it signs in immediately.
  if (status.value === 'confirmed' && typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('plannr-auth')
      channel.postMessage({ type: 'email-confirmed' })
      channel.close()
    } catch {
      /* BroadcastChannel unavailable — the poll on RegisterPage still covers it. */
    }
  }
  // Drop the implicit-flow tokens from the address bar for cleanliness/safety.
  if (typeof window !== 'undefined' && window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
})
</script>

<template>
  <div
    class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(16,185,129,0.08),transparent_50%),#fafaf9]"
  >
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <!-- Auth pages always render in light mode (see App.vue applyTheme), so only the light variant is needed. -->
        <img src="/plannr-icon-light.svg" alt="" class="inline-block w-11 h-11 mb-4" />
        <h1 class="text-3xl font-bold text-gray-900 tracking-tight">{{ heading }}</h1>
        <p class="text-gray-500 text-sm mt-1">Plannr</p>
      </div>

      <Card class="p-6 sm:p-8 shadow-lg shadow-gray-900/5 border border-gray-200/80 text-center">
        <!-- Confirmed -->
        <template v-if="status === 'confirmed'">
          <div
            class="mx-auto mb-5 w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center"
          >
            <svg class="w-7 h-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p class="text-gray-600 text-sm leading-relaxed">
            Your email is verified. You can safely close this tab. The Plannr window
            where you signed up is signing you in now.
          </p>
        </template>

        <!-- Error / expired link -->
        <template v-else-if="status === 'error'">
          <div
            class="mx-auto mb-5 w-14 h-14 rounded-full bg-danger-100 flex items-center justify-center"
          >
            <svg class="w-7 h-7 text-danger-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <p class="text-gray-600 text-sm leading-relaxed">
            {{ errorMessage || 'This confirmation link is invalid or has expired.' }}
            You can request a new one by signing in.
          </p>
          <router-link to="/login" class="inline-block mt-6">
            <Button>Go to sign in</Button>
          </router-link>
        </template>

        <!-- Unknown / opened directly -->
        <template v-else>
          <p class="text-gray-600 text-sm leading-relaxed">
            If you came from a confirmation link that didn't work, it may have expired.
            You can request a new one by signing in.
          </p>
          <router-link to="/login" class="inline-block mt-6">
            <Button>Go to sign in</Button>
          </router-link>
        </template>
      </Card>
    </div>
  </div>
</template>
