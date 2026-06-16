/**
 * Auth store  wraps Supabase Auth in a Pinia store and mirrors the current
 * user's display name/email into the profile store so the rest of the app can
 * stay LMS/auth-agnostic.
 *
 * Lifecycle:
 * - `init()` runs once from `App.vue` on boot, then every Supabase auth event
 *   updates `user` / `session` reactively.
 * - `ready` flips to true after init completes (used by the router guard to
 *   wait for session restoration before redirecting).
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useProfileStore } from './profile'

export const useAuthStore = defineStore('auth', () => {
  /** Current Supabase user, or `null` when signed out. */
  const user = ref(null)
  /** Full session object (contains access/refresh tokens). */
  const session = ref(null)
  /** True after the initial session restore completes  gates the router. */
  const ready = ref(false)

  // Guard against `init()` being called twice (it wires up a global listener).
  let initialized = false

  const isAuthenticated = computed(() => !!session.value)

  /**
   * Push the signed-in user's name/email into the profile store. Existing
   * profile values win when the OAuth/email metadata does not supply one
   * (e.g. magic-link signups have no full_name).
   */
  function syncProfileFromAuth(u) {
    if (!u) return
    const profileStore = useProfileStore()
    const meta = u.user_metadata || {}
    const name =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      profileStore.profile.name
    profileStore.updateProfile({
      email: u.email || profileStore.profile.email,
      name: name || profileStore.profile.name,
    })
  }

  /**
   * Restore any persisted session and subscribe to future auth changes.
   * Safe to call before Supabase is configured  just marks the store ready.
   */
  async function init() {
    if (initialized) return
    initialized = true

    if (!isSupabaseConfigured || !supabase) {
      ready.value = true
      return
    }

    // Step 1: read whatever Supabase persisted across reloads.
    const { data: { session: existing } } = await supabase.auth.getSession()
    session.value = existing
    user.value = existing?.user ?? null
    if (user.value) syncProfileFromAuth(user.value)

    // Step 2: keep state in sync with future sign-ins, token refreshes, sign-outs.
    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession
      user.value = newSession?.user ?? null
      if (user.value) syncProfileFromAuth(user.value)
    })

    ready.value = true
  }

  /** Email/password sign-in. Returns Supabase's `{ data, error }` shape unchanged. */
  async function signInWithPassword(email, password) {
    if (!supabase) {
      return {
        error: { message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.' },
      }
    }
    return supabase.auth.signInWithPassword({ email, password })
  }

  /**
   * Create an account. Redirects the confirmation email back to the in-app
   * dashboard so the user lands authenticated after clicking the link.
   */
  async function signUp(email, password, fullName) {
    if (!supabase) {
      return {
        error: { message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.' },
      }
    }
    const redirectTo = `${window.location.origin}/dashboard`
    return supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { full_name: fullName },
      },
    })
  }

  /** Clear the current session (server- and client-side). */
  async function signOut() {
    if (!supabase) return
    // Clear local state immediately so the router guard sees unauthenticated
    // before the async Supabase signOut response / onAuthStateChange fires.
    session.value = null
    user.value = null
    localStorage.removeItem('profile')
    localStorage.removeItem('coursePlanner:saved')
    localStorage.removeItem('coursePlanner:work')
    await supabase.auth.signOut()
  }

  return {
    user,
    session,
    ready,
    isAuthenticated,
    isSupabaseConfigured,
    init,
    signInWithPassword,
    signUp,
    signOut,
  }
})
