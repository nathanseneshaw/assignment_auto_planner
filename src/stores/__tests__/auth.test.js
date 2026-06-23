import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth.js'

// Provide a mock Supabase client — the real one requires env vars and network
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({}),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { supabase } from '../../lib/supabase'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ── isAuthenticated ───────────────────────────────────────────────────────────

describe('isAuthenticated', () => {
  it('is false when session is null (initial state)', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
  })

  it('is true when session is set', () => {
    const store = useAuthStore()
    store.session = { access_token: 'tok', user: { id: 'u1' } }
    expect(store.isAuthenticated).toBe(true)
  })
})

// ── ready flag ────────────────────────────────────────────────────────────────

describe('ready', () => {
  it('starts as false before init()', () => {
    const store = useAuthStore()
    expect(store.ready).toBe(false)
  })

  it('becomes true after init() completes', async () => {
    const store = useAuthStore()
    await store.init()
    expect(store.ready).toBe(true)
  })
})

// ── init ──────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('calls getSession to restore persisted session', async () => {
    const store = useAuthStore()
    await store.init()
    expect(supabase.auth.getSession).toHaveBeenCalledOnce()
  })

  it('subscribes to auth state changes', async () => {
    const store = useAuthStore()
    await store.init()
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledOnce()
  })

  it('sets user/session from a restored session', async () => {
    const mockUser = { id: 'u1', email: 'test@example.com', user_metadata: {} }
    const mockSession = { access_token: 'tok', user: mockUser }
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: mockSession } })

    const store = useAuthStore()
    await store.init()
    expect(store.session).toEqual(mockSession)
    expect(store.user?.id).toBe('u1')
  })

  it('leaves user/session null when no persisted session exists', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    const store = useAuthStore()
    await store.init()
    expect(store.user).toBeNull()
    expect(store.session).toBeNull()
  })

  it('is idempotent — second call does not re-subscribe', async () => {
    const store = useAuthStore()
    await store.init()
    await store.init() // second call should be a no-op
    expect(supabase.auth.getSession).toHaveBeenCalledOnce()
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledOnce()
  })
})

// ── signInWithPassword ────────────────────────────────────────────────────────

describe('signInWithPassword', () => {
  it('delegates to supabase.auth.signInWithPassword', async () => {
    const store = useAuthStore()
    await store.signInWithPassword('user@example.com', 'password123')
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'password123',
    })
  })

  it('returns the supabase response', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'u2' } }, error: null })
    const store = useAuthStore()
    const result = await store.signInWithPassword('user@example.com', 'pass')
    expect(result.error).toBeNull()
    expect(result.data.user.id).toBe('u2')
  })

  it('returns an error object when supabase reports an auth failure', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid login credentials' },
    })
    const store = useAuthStore()
    const result = await store.signInWithPassword('bad@email.com', 'wrongpass')
    expect(result.error?.message).toBe('Invalid login credentials')
  })
})

// ── signOut ───────────────────────────────────────────────────────────────────

describe('signOut', () => {
  it('clears session and user immediately', async () => {
    const store = useAuthStore()
    store.session = { access_token: 'tok' }
    store.user = { id: 'u1' }
    await store.signOut()
    expect(store.session).toBeNull()
    expect(store.user).toBeNull()
  })

  it('calls supabase.auth.signOut', async () => {
    const store = useAuthStore()
    await store.signOut()
    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('clears localStorage keys', async () => {
    const store = useAuthStore()
    localStorage.setItem('profile', '{"name":"Test"}')
    localStorage.setItem('coursePlanner:saved', '[]')
    localStorage.setItem('coursePlanner:work', '[]')
    await store.signOut()
    expect(localStorage.getItem('profile')).toBeNull()
    expect(localStorage.getItem('coursePlanner:saved')).toBeNull()
    expect(localStorage.getItem('coursePlanner:work')).toBeNull()
  })

  it('preserves the theme preference across sign-out', async () => {
    const store = useAuthStore()
    localStorage.setItem('theme', '1')
    await store.signOut()
    expect(localStorage.getItem('theme')).toBe('1')
  })
})

// ── signUp ────────────────────────────────────────────────────────────────────

describe('signUp', () => {
  it('delegates to supabase.auth.signUp with email, password, and full_name', async () => {
    const store = useAuthStore()
    await store.signUp('new@example.com', 'pass123', 'Jane Doe')
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'pass123',
      options: {
        emailRedirectTo: expect.stringContaining('/auth/confirm'),
        data: { full_name: 'Jane Doe' },
      },
    })
  })

  it('returns the supabase response on success', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'u3' }, session: null }, error: null })
    const store = useAuthStore()
    const result = await store.signUp('new@example.com', 'pass123', 'Jane Doe')
    expect(result.error).toBeNull()
    expect(result.data.user.id).toBe('u3')
  })

  it('returns an error when supabase rejects the sign-up', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email already registered' },
    })
    const store = useAuthStore()
    const result = await store.signUp('taken@example.com', 'pass123', 'Jane')
    expect(result.error?.message).toBe('Email already registered')
  })
})

// ── reauthenticatePassword ────────────────────────────────────────────────────

describe('reauthenticatePassword', () => {
  it('verifies the current password against the signed-in user email', async () => {
    const store = useAuthStore()
    store.user = { id: 'u1', email: 'me@example.com' }
    await store.reauthenticatePassword('current-pass')
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'current-pass',
    })
  })

  it('returns an error when not signed in', async () => {
    const store = useAuthStore()
    const result = await store.reauthenticatePassword('whatever')
    expect(result.error).toBeTruthy()
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('surfaces a wrong-password error from supabase', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid login credentials' },
    })
    const store = useAuthStore()
    store.user = { id: 'u1', email: 'me@example.com' }
    const result = await store.reauthenticatePassword('wrong')
    expect(result.error?.message).toBe('Invalid login credentials')
  })
})

// ── updatePassword ────────────────────────────────────────────────────────────

describe('updatePassword', () => {
  it('delegates to supabase.auth.updateUser with the new password', async () => {
    const store = useAuthStore()
    await store.updatePassword('new-pass-123')
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass-123' })
  })

  it('returns an error when supabase rejects the update', async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'Password should be at least 6 characters' },
    })
    const store = useAuthStore()
    const result = await store.updatePassword('123')
    expect(result.error?.message).toBe('Password should be at least 6 characters')
  })
})

// ── updateEmail ───────────────────────────────────────────────────────────────

describe('updateEmail', () => {
  it('delegates to supabase.auth.updateUser with the new email and a verify redirect', async () => {
    const store = useAuthStore()
    await store.updateEmail('new@example.com')
    expect(supabase.auth.updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      { emailRedirectTo: expect.stringContaining('/auth/verify-email') }
    )
  })

  it('returns an error when supabase rejects the change', async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email address already in use' },
    })
    const store = useAuthStore()
    const result = await store.updateEmail('taken@example.com')
    expect(result.error?.message).toBe('Email address already in use')
  })
})

// ── onAuthStateChange callback ────────────────────────────────────────────────

describe('onAuthStateChange', () => {
  it('updates user and session when a SIGNED_IN event fires', async () => {
    let capturedCallback
    supabase.auth.onAuthStateChange.mockImplementationOnce((cb) => {
      capturedCallback = cb
      return {}
    })

    const store = useAuthStore()
    await store.init()

    const newUser = { id: 'u2', email: 'signin@example.com', user_metadata: { full_name: 'Alice' } }
    const newSession = { access_token: 'new-tok', user: newUser }
    capturedCallback('SIGNED_IN', newSession)

    expect(store.user?.id).toBe('u2')
    expect(store.session).toEqual(newSession)
    expect(store.isAuthenticated).toBe(true)
  })

  it('clears user and session when a SIGNED_OUT event fires', async () => {
    let capturedCallback
    supabase.auth.onAuthStateChange.mockImplementationOnce((cb) => {
      capturedCallback = cb
      return {}
    })

    const store = useAuthStore()
    store.session = { access_token: 'old-tok' }
    store.user = { id: 'u1' }
    await store.init()

    capturedCallback('SIGNED_OUT', null)

    expect(store.user).toBeNull()
    expect(store.session).toBeNull()
    expect(store.isAuthenticated).toBe(false)
  })
})
