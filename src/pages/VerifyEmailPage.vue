<script setup>
/**
 * Email-change verification landing page - the target of the confirmation link
 * Supabase emails to a user's new address when they change it from Settings
 * (`emailRedirectTo` in the auth store's updateEmail).
 *
 * Like the signup confirm page, this tab deliberately does NOT sign in
 * (detectSessionInUrl is off). Supabase has already applied the email change
 * server-side by the time it redirects here, so we read the boot-time snapshot
 * (getAuthCallback) and show the result, then tell the user to close the tab.
 *
 * To update the email in the app instantly, we post a one-off message on the
 * shared 'plannr-auth' BroadcastChannel; the auth store (in the open app tab)
 * listens for it and refreshes the session so the new email shows everywhere.
 * Cross-device there's no listener, but the app tab also refreshes on focus.
 */
import { ref, onMounted } from 'vue'
import { Card, Button } from '../components/ui'
import { getAuthCallback } from '../lib/supabase'

const cb = getAuthCallback()

// 'confirmed' when the link carried a valid token, 'error' for an expired/invalid
// link, 'unknown' when the page is opened directly (no callback params at boot).
const status = ref(
  cb.status === 'confirmed' ? 'confirmed' : cb.status === 'error' ? 'error' : 'unknown'
)
const errorMessage = ref(cb.error)

onMounted(() => {
  // Nudge the open app tab (same browser) so it pulls the new email immediately.
  if (status.value === 'confirmed' && typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('plannr-auth')
      channel.postMessage({ type: 'email-changed' })
      channel.close()
    } catch {
      /* BroadcastChannel unavailable - the app tab still refreshes on focus. */
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
        <img src="/plannr-icon-light.svg" alt="" class="inline-block w-11 h-11 mb-4" />
        <p class="text-gray-500 text-sm mt-1">Plannr</p>
      </div>

      <Card class="p-6 sm:p-8 shadow-lg shadow-gray-900/5 border border-gray-200/80 text-center">
        <!-- Confirmed -->
        <template v-if="status === 'confirmed'">
          <div
            class="mx-auto mb-5 w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"
          >
            <svg class="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 class="text-xl font-bold text-gray-900 tracking-tight">Email verified</h1>
          <p class="text-gray-500 text-sm mt-2">
            Your email address has been updated. You can close this tab.
          </p>
        </template>

        <!-- Error / expired link -->
        <template v-else-if="status === 'error'">
          <div
            class="mx-auto mb-5 w-12 h-12 rounded-full bg-danger-100 flex items-center justify-center"
          >
            <svg class="w-6 h-6 text-danger-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <h1 class="text-xl font-bold text-gray-900 tracking-tight">Link didn't work</h1>
          <p class="text-gray-500 text-sm mt-2">
            {{ errorMessage || 'This verification link is invalid or has expired.' }}
            You can request a new one from Settings in Plannr.
          </p>
          <router-link to="/profile" class="inline-block mt-5">
            <Button>Go to settings</Button>
          </router-link>
        </template>

        <!-- Unknown / opened directly -->
        <template v-else>
          <h1 class="text-xl font-bold text-gray-900 tracking-tight">You can close this tab</h1>
          <p class="text-gray-500 text-sm mt-2">
            If you came from a verification link that didn't work, it may have expired.
            You can request a new one from Settings in Plannr.
          </p>
          <router-link to="/profile" class="inline-block mt-5">
            <Button>Go to settings</Button>
          </router-link>
        </template>
      </Card>
    </div>
  </div>
</template>
