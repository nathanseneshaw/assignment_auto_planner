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
  })

  function updateProfile(data) {
    profile.value = { ...profile.value, ...data }
    saveToLocalStorage()
  }

  function saveToLocalStorage() {
    localStorage.setItem('profile', JSON.stringify(profile.value))
  }

  function loadFromLocalStorage() {
    try {
      const savedProfile = localStorage.getItem('profile')
      if (savedProfile) {
        profile.value = JSON.parse(savedProfile)
      }
    } catch (e) {
      console.warn('[profile] Failed to load from localStorage, using defaults:', e)
    }
  }

  loadFromLocalStorage()

  return {
    profile,
    updateProfile,
  }
})
