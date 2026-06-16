/**
 * Profile store. Persists display name / email / avatar to localStorage so
 * the sidebar and settings page render with the user's identity before any
 * network round-trip.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref({
    name: '',
    email: '',
    avatar: null,
    darkMode: false,
    school: '',
  })

  function updateProfile(data) {
    profile.value = { ...profile.value, ...data }
    saveToLocalStorage()
  }

  function toggleDarkMode() {
    profile.value.darkMode = !profile.value.darkMode
    saveToLocalStorage()
  }

  function saveToLocalStorage() {
    const { darkMode, ...identity } = profile.value
    localStorage.setItem('profile', JSON.stringify(identity))
    localStorage.setItem('theme', darkMode ? '1' : '0')
  }

  function loadFromLocalStorage() {
    try {
      const savedProfile = localStorage.getItem('profile')
      if (savedProfile) {
        profile.value = { ...profile.value, ...JSON.parse(savedProfile) }
      }
      const savedTheme = localStorage.getItem('theme')
      if (savedTheme !== null) {
        profile.value.darkMode = savedTheme === '1'
      }
    } catch (e) {
      console.warn('[profile] Failed to load from localStorage, using defaults:', e)
    }
  }

  loadFromLocalStorage()

  return {
    profile,
    updateProfile,
    toggleDarkMode,
  }
})
