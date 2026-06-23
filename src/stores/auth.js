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
  // Cross-tab nudge channel for email changes confirmed in the link tab.
  let authChannel = null

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

    // Step 3: pick up an email change confirmed in another tab/device.
    // The email-change link tab never establishes a session of its own
    // (detectSessionInUrl is off), so it can't push the new email here. Instead:
    //   - same browser: it broadcasts on 'plannr-auth'; we refresh on the nudge.
    //   - cross-device: no broadcast arrives, so we also refresh whenever this
    //     tab regains focus, which catches the user coming back to the app.
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        authChannel = new BroadcastChannel('plannr-auth')
        authChannel.onmessage = (e) => {
          if (e?.data?.type === 'email-changed') refreshUser()
        }
      } catch {
        /* BroadcastChannel unavailable — the visibility refresh below covers it. */
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshUser()
      })
    }

    ready.value = true
  }

  /**
   * Re-pull the signed-in user from Supabase so a change applied elsewhere
   * (notably an email change confirmed from the link tab) is reflected here.
   * Refreshing the session mints a token carrying the current email, which
   * flows through onAuthStateChange; we also set state directly so the update
   * lands even if no event fires. No-op when signed out.
   */
  async function refreshUser() {
    if (!supabase || !session.value) return
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data?.session) return
    session.value = data.session
    user.value = data.session.user ?? null
    if (user.value) syncProfileFromAuth(user.value)
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
   * Create an account. The confirmation email links to a dedicated /auth/confirm
   * page (not /dashboard): clicking it confirms the email and tells the user to
   * close that tab, while the original tab they signed up in detects the
   * confirmation and signs them into the dashboard automatically.
   */
  async function signUp(email, password, fullName) {
    if (!supabase) {
      return {
        error: { message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.' },
      }
    }
    const redirectTo = `${window.location.origin}/auth/confirm`
    return supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { full_name: fullName },
      },
    })
  }

  /**
   * Verify the user's *current* password before a sensitive change. Supabase's
   * updateUser({ password }) only needs the active session, so we re-check the
   * current password ourselves by signing in again with it. The re-sign-in
   * returns a fresh session for the same user, which is harmless.
   */
  async function reauthenticatePassword(password) {
    if (!supabase) {
      return { error: { message: 'Supabase is not configured.' } }
    }
    const email = user.value?.email
    if (!email) {
      return { error: { message: 'You are not signed in.' } }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  /** Set a new password for the signed-in user. Returns Supabase's `{ data, error }`. */
  async function updatePassword(newPassword) {
    if (!supabase) {
      return { error: { message: 'Supabase is not configured.' } }
    }
    return supabase.auth.updateUser({ password: newPassword })
  }

  /**
   * Start an email change. Supabase emails a confirmation link to the *new*
   * address; clicking it lands on /auth/verify-email (a "you can close this
   * tab" page) and applies the change. The email itself goes out through
   * whatever SMTP provider Supabase Auth is configured with (Resend here).
   */
  async function updateEmail(newEmail) {
    if (!supabase) {
      return { error: { message: 'Supabase is not configured.' } }
    }
    const redirectTo = `${window.location.origin}/auth/verify-email`
    return supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: redirectTo })
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
    reauthenticatePassword,
    updatePassword,
    updateEmail,
    refreshUser,
    signOut,
  }
})
