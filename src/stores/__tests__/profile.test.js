import { setActivePinia, createPinia } from 'pinia'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useProfileStore } from '../profile.js'

beforeEach(() => {
  setActivePinia(createPinia())
})

// ── defaults ──────────────────────────────────────────────────────────────────

describe('profile defaults', () => {
  it('starts with empty identity and light mode', () => {
    const store = useProfileStore()
    expect(store.profile).toEqual({
      name: '',
      email: '',
      avatar: null,
      darkMode: false,
      school: '',
    })
  })
})

// ── updateProfile ─────────────────────────────────────────────────────────────

describe('updateProfile', () => {
  it('merges partial updates without dropping other fields', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan' })
    store.updateProfile({ email: 'nathan@example.com' })
    expect(store.profile.name).toBe('Nathan')
    expect(store.profile.email).toBe('nathan@example.com')
  })

  it('persists identity fields under the "profile" key', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan', email: 'n@x.com', school: 'rice', avatar: 'a.png' })
    const saved = JSON.parse(localStorage.getItem('profile'))
    expect(saved).toEqual({ name: 'Nathan', email: 'n@x.com', school: 'rice', avatar: 'a.png' })
  })

  it('never writes darkMode into the persisted identity blob', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan', darkMode: true })
    const saved = JSON.parse(localStorage.getItem('profile'))
    expect(saved).not.toHaveProperty('darkMode')
    // darkMode is tracked separately in the theme key instead.
    expect(localStorage.getItem('theme')).toBe('1')
  })
})

// ── toggleDarkMode ────────────────────────────────────────────────────────────

describe('toggleDarkMode', () => {
  it('flips the flag and persists it to the theme key', () => {
    const store = useProfileStore()
    expect(store.profile.darkMode).toBe(false)
    store.toggleDarkMode()
    expect(store.profile.darkMode).toBe(true)
    expect(localStorage.getItem('theme')).toBe('1')
    store.toggleDarkMode()
    expect(store.profile.darkMode).toBe(false)
    expect(localStorage.getItem('theme')).toBe('0')
  })
})

// ── load-on-construct ─────────────────────────────────────────────────────────

describe('loadFromLocalStorage (runs on store construction)', () => {
  it('restores identity and theme saved by a previous session', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Jane', email: 'jane@x.com', school: 'ttu' }))
    localStorage.setItem('theme', '1')
    setActivePinia(createPinia())
    const store = useProfileStore()
    expect(store.profile.name).toBe('Jane')
    expect(store.profile.email).toBe('jane@x.com')
    expect(store.profile.school).toBe('ttu')
    expect(store.profile.darkMode).toBe(true)
  })

  it('falls back to defaults when the persisted profile is malformed JSON', () => {
    localStorage.setItem('profile', '{not valid json')
    setActivePinia(createPinia())
    const store = useProfileStore()
    expect(store.profile.name).toBe('')
    expect(store.profile.email).toBe('')
  })

  it('leaves darkMode false when no theme key exists', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Jane' }))
    setActivePinia(createPinia())
    const store = useProfileStore()
    expect(store.profile.darkMode).toBe(false)
  })
})
