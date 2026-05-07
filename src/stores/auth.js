import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useProfileStore } from './profile'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const session = ref(null)
  const ready = ref(false)

  let initialized = false

  const isAuthenticated = computed(() => !!session.value)

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

  async function init() {
    if (initialized) return
    initialized = true

    if (!isSupabaseConfigured || !supabase) {
      ready.value = true
      return
    }

    const { data: { session: existing } } = await supabase.auth.getSession()
    session.value = existing
    user.value = existing?.user ?? null
    if (user.value) syncProfileFromAuth(user.value)

    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession
      user.value = newSession?.user ?? null
      if (user.value) syncProfileFromAuth(user.value)
    })

    ready.value = true
  }

  async function signInWithPassword(email, password) {
    if (!supabase) {
      return {
        error: { message: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.' },
      }
    }
    return supabase.auth.signInWithPassword({ email, password })
  }

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

  async function signOut() {
    if (!supabase) return
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
