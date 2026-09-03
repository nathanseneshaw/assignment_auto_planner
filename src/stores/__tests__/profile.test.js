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

// ── saveToLocalStorage (the darkMode / identity split) ────────────────────────
//
// Identity lives in the `profile` blob; the theme lives in its own `theme` key
// so it can survive sign-out, which wipes `profile`.

describe('saveToLocalStorage', () => {
  it('always writes both keys, even for a light-mode default profile', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan' })
    expect(JSON.parse(localStorage.getItem('profile'))).toMatchObject({ name: 'Nathan' })
    expect(localStorage.getItem('theme')).toBe('0')
  })

  it('persists a null avatar rather than dropping the field', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan' })
    const saved = JSON.parse(localStorage.getItem('profile'))
    expect(saved).toHaveProperty('avatar', null)
  })

  it('re-saves the identity blob on a dark-mode toggle without leaking darkMode into it', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan' })
    store.toggleDarkMode()
    const saved = JSON.parse(localStorage.getItem('profile'))
    expect(saved.name).toBe('Nathan')
    expect(saved).not.toHaveProperty('darkMode')
  })
})

// ── updateProfile ─────────────────────────────────────────────────────────────

describe('updateProfile merging', () => {
  it('ignores an empty patch but still persists', () => {
    const store = useProfileStore()
    store.updateProfile({ name: 'Nathan' })
    store.updateProfile({})
    expect(store.profile.name).toBe('Nathan')
    expect(JSON.parse(localStorage.getItem('profile')).name).toBe('Nathan')
  })

  it('lets an explicit empty string clear a field', () => {
    const store = useProfileStore()
    store.updateProfile({ school: 'rice' })
    store.updateProfile({ school: '' })
    expect(store.profile.school).toBe('')
    expect(JSON.parse(localStorage.getItem('profile')).school).toBe('')
  })

  it('routes darkMode passed through updateProfile into the theme key', () => {
    const store = useProfileStore()
    store.updateProfile({ darkMode: true })
    expect(store.profile.darkMode).toBe(true)
    expect(localStorage.getItem('theme')).toBe('1')
  })
})

// ── persistence round-trip ────────────────────────────────────────────────────

describe('persistence round-trip', () => {
  it('restores the full profile, theme included, in a fresh store', () => {
    const first = useProfileStore()
    first.updateProfile({ name: 'Nathan', email: 'n@x.com', school: 'rice', avatar: 'a.png' })
    first.toggleDarkMode()

    setActivePinia(createPinia())
    const second = useProfileStore()
    expect(second.profile).toEqual({
      name: 'Nathan',
      email: 'n@x.com',
      school: 'rice',
      avatar: 'a.png',
      darkMode: true,
    })
  })

  it('leaves fields the saved blob omits at their defaults', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Jane' }))
    setActivePinia(createPinia())
    const store = useProfileStore()
    expect(store.profile.name).toBe('Jane')
    expect(store.profile.email).toBe('')
    expect(store.profile.school).toBe('')
    expect(store.profile.avatar).toBeNull()
  })
})

// ── theme key precedence ──────────────────────────────────────────────────────

describe('theme key', () => {
  it('wins over a darkMode value that leaked into an old identity blob', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Jane', darkMode: true }))
    localStorage.setItem('theme', '0')
    setActivePinia(createPinia())
    expect(useProfileStore().profile.darkMode).toBe(false)
  })

  it('treats any value other than "1" as light mode', () => {
    localStorage.setItem('theme', 'true')
    setActivePinia(createPinia())
    expect(useProfileStore().profile.darkMode).toBe(false)
  })

  it('applies a stored dark theme even with no saved identity', () => {
    localStorage.setItem('theme', '1')
    setActivePinia(createPinia())
    const store = useProfileStore()
    expect(store.profile.darkMode).toBe(true)
    expect(store.profile.name).toBe('')
  })
})

// ── unavailable localStorage ──────────────────────────────────────────────────

describe('loadFromLocalStorage when storage is unavailable', () => {
  it('warns and falls back to defaults instead of breaking the boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => { throw new Error('SecurityError: storage is disabled') },
        setItem: () => {},
        removeItem: () => {},
      },
      writable: true,
      configurable: true,
    })

    setActivePinia(createPinia())
    const store = useProfileStore()

    expect(store.profile.name).toBe('')
    expect(store.profile.darkMode).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
