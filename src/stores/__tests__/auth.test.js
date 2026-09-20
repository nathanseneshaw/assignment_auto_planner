import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth.js'

// Provide a mock Supabase client — the real one requires env vars and network.
// Both exports are getters over `supabaseModule` so a test can swap the client
// out for `null` and exercise the "Supabase is not configured" branches.
const supabaseModule = vi.hoisted(() => ({ client: null, current: null, configured: true }))

vi.mock('../../lib/supabase', () => {
  supabaseModule.client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({}),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  }
  supabaseModule.current = supabaseModule.client
  return {
    get isSupabaseConfigured() { return supabaseModule.configured },
    get supabase() { return supabaseModule.current },
  }
})

import { supabase } from '../../lib/supabase'
import { useProfileStore } from '../profile.js'

/** A Supabase user, defaulting to the shape an email/password signup produces. */
function makeUser(overrides = {}) {
  return { id: 'u1', email: 'me@example.com', user_metadata: {}, ...overrides }
}

/** A session wrapping `user`. */
function makeSession(user = makeUser(), overrides = {}) {
  return { access_token: 'tok', refresh_token: 'refresh', user, ...overrides }
}

/** Run `init()` and hand back the callback it registered with Supabase. */
async function initCapturingAuthCallback(store) {
  let callback
  supabase.auth.onAuthStateChange.mockImplementationOnce((fn) => { callback = fn; return {} })
  await store.init()
  return callback
}

/**
 * Install a fake BroadcastChannel (happy-dom has none) and return the list of
 * channels the code under test opens.
 */
function stubBroadcastChannel() {
  const channels = []
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name
      this.onmessage = null
      channels.push(this)
    }
    postMessage() {}
    close() {}
  }
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  return channels
}

/** Externally-resolvable promise, used to hold a request in flight. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Drain the microtask + timer queues. */
const settleBackgroundWork = () => new Promise((r) => setTimeout(r, 0))

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
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
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
      { emailRedirectTo: `${window.location.origin}/auth/verify-email` }
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

// ── syncProfileFromAuth (account info mirrored into the profile store) ─────────
//
// The auth store is the single source of truth for the signed-in identity and
// pushes email/name into the profile store so the rest of the app stays
// auth-agnostic. These tests assert that mirror is correct at every entry point.

describe('account info mirrored into the profile store', () => {
  it('populates profile email + name from a restored session on init', async () => {
    const user = { id: 'u1', email: 'restored@example.com', user_metadata: { full_name: 'Restored User' } }
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't', user } } })

    await useAuthStore().init()

    const profile = useProfileStore().profile
    expect(profile.email).toBe('restored@example.com')
    expect(profile.name).toBe('Restored User')
  })

  it('updates the profile when a SIGNED_IN event fires', async () => {
    let cb
    supabase.auth.onAuthStateChange.mockImplementationOnce((fn) => { cb = fn; return {} })
    await useAuthStore().init()

    cb('SIGNED_IN', {
      access_token: 'tok',
      user: { id: 'u2', email: 'signin@example.com', user_metadata: { full_name: 'Alice' } },
    })

    const profile = useProfileStore().profile
    expect(profile.email).toBe('signin@example.com')
    expect(profile.name).toBe('Alice')
  })

  it('falls back to user_metadata.name when full_name is absent', async () => {
    const user = { id: 'u1', email: 'a@example.com', user_metadata: { name: 'Only Name' } }
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't', user } } })

    await useAuthStore().init()
    expect(useProfileStore().profile.name).toBe('Only Name')
  })

  it('keeps the existing profile name when auth metadata has no name', async () => {
    useProfileStore().updateProfile({ name: 'Locally Set' })
    const user = { id: 'u1', email: 'a@example.com', user_metadata: {} }
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 't', user } } })

    await useAuthStore().init()
    const profile = useProfileStore().profile
    expect(profile.name).toBe('Locally Set')
    expect(profile.email).toBe('a@example.com')
  })

  it('mirrors a changed email into the profile via refreshUser', async () => {
    const store = useAuthStore()
    store.session = { access_token: 'old' }
    store.user = { id: 'u1', email: 'old@example.com' }
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'new', user: { id: 'u1', email: 'new@example.com', user_metadata: {} } } },
      error: null,
    })

    await store.refreshUser()

    expect(store.user.email).toBe('new@example.com')
    expect(useProfileStore().profile.email).toBe('new@example.com')
  })

  it('refreshUser is a no-op when signed out', async () => {
    await useAuthStore().refreshUser()
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled()
  })
})

// ── refreshUser ───────────────────────────────────────────────────────────────
//
// Refreshing mints a token carrying the current email — this is how an email
// change confirmed in another tab or on another device reaches this tab, since
// the link tab never establishes a session of its own (detectSessionInUrl off).

describe('refreshUser', () => {
  it('adopts the refreshed session and user', async () => {
    const store = useAuthStore()
    store.session = makeSession(makeUser(), { access_token: 'old' })
    store.user = makeUser()
    const refreshed = makeSession(makeUser({ email: 'new@example.com' }), { access_token: 'new' })
    supabase.auth.refreshSession.mockResolvedValueOnce({ data: { session: refreshed }, error: null })

    await store.refreshUser()

    expect(store.session.access_token).toBe('new')
    expect(store.user.email).toBe('new@example.com')
  })

  it('leaves state untouched when the refresh errors', async () => {
    const store = useAuthStore()
    store.session = makeSession(makeUser(), { access_token: 'old' })
    store.user = makeUser({ email: 'old@example.com' })
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid Refresh Token' },
    })

    await store.refreshUser()

    expect(store.session.access_token).toBe('old')
    expect(store.user.email).toBe('old@example.com')
    expect(store.isAuthenticated).toBe(true) // not signed out by a failed refresh
  })

  it('leaves state untouched when the refresh returns no session', async () => {
    const store = useAuthStore()
    store.session = makeSession(makeUser(), { access_token: 'old' })
    store.user = makeUser()
    supabase.auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null })

    await store.refreshUser()

    expect(store.session.access_token).toBe('old')
  })

  it('nulls the user when the refreshed session carries none', async () => {
    const store = useAuthStore()
    store.session = makeSession()
    store.user = makeUser()
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'new' } },
      error: null,
    })

    await store.refreshUser()

    expect(store.user).toBeNull()
  })
})

// ── cross-tab email-change nudge ──────────────────────────────────────────────
//
// The tab that opens the email-change link cannot push the new address here, so
// it broadcasts on 'plannr-auth' instead and this tab re-pulls the user.

describe('cross-tab email-change nudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the plannr-auth channel during init', async () => {
    const channels = stubBroadcastChannel()
    await useAuthStore().init()
    expect(channels.map((c) => c.name)).toContain('plannr-auth')
  })

  it('refreshes the user when another tab reports an email change', async () => {
    const channels = stubBroadcastChannel()
    const user = makeUser({ email: 'old@example.com' })
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession(user) } })
    supabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: makeSession(makeUser({ email: 'new@example.com' })) },
      error: null,
    })

    const store = useAuthStore()
    await store.init()
    channels.at(-1).onmessage({ data: { type: 'email-changed' } })
    await settleBackgroundWork()

    expect(store.user.email).toBe('new@example.com')
    expect(useProfileStore().profile.email).toBe('new@example.com')
  })

  it('ignores broadcasts of other types', async () => {
    const channels = stubBroadcastChannel()
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() } })

    const store = useAuthStore()
    await store.init()
    channels.at(-1).onmessage({ data: { type: 'something-else' } })
    await settleBackgroundWork()

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('still marks the store ready when the channel cannot be opened', async () => {
    vi.stubGlobal('BroadcastChannel', class {
      constructor() { throw new Error('BroadcastChannel is blocked') }
    })
    const store = useAuthStore()
    await store.init()
    expect(store.ready).toBe(true)
  })
})

// ── refresh on tab refocus ────────────────────────────────────────────────────

describe('refresh when the tab regains focus', () => {
  // A persistent (not `...Once`) implementation: listeners registered by stores
  // from earlier tests are still attached to `document` and fire first.
  afterEach(() => {
    supabase.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: null })
  })

  it('re-pulls the user so an email changed on another device shows up', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: makeSession(makeUser({ email: 'old@example.com' })) },
    })
    supabase.auth.refreshSession.mockResolvedValue({
      data: { session: makeSession(makeUser({ email: 'changed@example.com' })) },
      error: null,
    })

    const store = useAuthStore()
    await store.init()
    document.dispatchEvent(new Event('visibilitychange'))
    await settleBackgroundWork()

    expect(store.user.email).toBe('changed@example.com')
  })

  it('ignores the event that fires when the tab is being hidden', async () => {
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: makeSession(makeUser({ email: 'old@example.com' })) },
    })
    const store = useAuthStore()
    await store.init()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    supabase.auth.refreshSession.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    await settleBackgroundWork()
    delete document.visibilityState

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled()
    expect(store.user.email).toBe('old@example.com')
  })
})

// ── syncProfileFromAuth fallbacks ─────────────────────────────────────────────

describe('syncProfileFromAuth fallbacks', () => {
  it('ignores a non-string full_name and uses the name metadata', async () => {
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)
    onAuthChange('SIGNED_IN', makeSession(makeUser({ user_metadata: { full_name: 42, name: 'Fallback' } })))
    expect(useProfileStore().profile.name).toBe('Fallback')
  })

  it('ignores an empty full_name and uses the name metadata', async () => {
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)
    onAuthChange('SIGNED_IN', makeSession(makeUser({ user_metadata: { full_name: '', name: 'Fallback' } })))
    expect(useProfileStore().profile.name).toBe('Fallback')
  })

  it('survives a user with no user_metadata at all', async () => {
    const profile = useProfileStore()
    profile.updateProfile({ name: 'Locally Set' })
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)

    const user = makeUser({ email: 'a@example.com' })
    delete user.user_metadata
    expect(() => onAuthChange('SIGNED_IN', makeSession(user))).not.toThrow()

    expect(profile.profile.name).toBe('Locally Set')
    expect(profile.profile.email).toBe('a@example.com')
  })

  it('keeps the stored email when the auth user has none', async () => {
    const profile = useProfileStore()
    profile.updateProfile({ email: 'stored@example.com' })
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)

    const user = makeUser()
    delete user.email
    onAuthChange('SIGNED_IN', makeSession(user))

    expect(profile.profile.email).toBe('stored@example.com')
  })

  it('does not touch the profile for a session with no user', async () => {
    const profile = useProfileStore()
    profile.updateProfile({ name: 'Locally Set', email: 'stored@example.com' })
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)

    onAuthChange('SIGNED_IN', { access_token: 'tok' })

    expect(store.user).toBeNull()
    expect(profile.profile).toMatchObject({ name: 'Locally Set', email: 'stored@example.com' })
  })

  it('follows a TOKEN_REFRESHED event to the new session', async () => {
    const store = useAuthStore()
    const onAuthChange = await initCapturingAuthCallback(store)
    onAuthChange('TOKEN_REFRESHED', makeSession(makeUser(), { access_token: 'rotated' }))
    expect(store.session.access_token).toBe('rotated')
    expect(store.isAuthenticated).toBe(true)
  })
})

// ── signOut ordering ──────────────────────────────────────────────────────────

describe('signOut ordering', () => {
  it('drops local state before the network sign-out resolves', async () => {
    const pending = deferred()
    supabase.auth.signOut.mockReturnValueOnce(pending.promise)
    const store = useAuthStore()
    store.session = makeSession()
    store.user = makeUser()

    const p = store.signOut()
    // The router guard reads isAuthenticated synchronously after this call.
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('profile')).toBeNull()

    pending.resolve({})
    await p
  })
})

// ── not-configured fallbacks (local-only mode) ────────────────────────────────
//
// With no VITE_SUPABASE_* env vars the client is null. Every entry point has to
// degrade to a readable error instead of throwing, and the app must still boot.

describe('when Supabase is not configured', () => {
  beforeEach(() => {
    supabaseModule.current = null
    supabaseModule.configured = false
  })

  afterEach(() => {
    supabaseModule.current = supabaseModule.client
    supabaseModule.configured = true
  })

  it('exposes isSupabaseConfigured as false', () => {
    expect(useAuthStore().isSupabaseConfigured).toBe(false)
  })

  it('init marks the store ready without reading a session', async () => {
    const store = useAuthStore()
    await store.init()
    expect(store.ready).toBe(true)
    expect(supabaseModule.client.auth.getSession).not.toHaveBeenCalled()
    expect(supabaseModule.client.auth.onAuthStateChange).not.toHaveBeenCalled()
  })

  it('signInWithPassword explains which env vars are missing', async () => {
    const result = await useAuthStore().signInWithPassword('a@b.com', 'pw')
    expect(result.error.message).toContain('VITE_SUPABASE_URL')
    expect(result.error.message).toContain('VITE_SUPABASE_ANON_KEY')
    expect(supabaseModule.client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signUp explains which env vars are missing', async () => {
    const result = await useAuthStore().signUp('a@b.com', 'pw', 'Jane')
    expect(result.error.message).toContain('VITE_SUPABASE_URL')
    expect(supabaseModule.client.auth.signUp).not.toHaveBeenCalled()
  })

  it('the account-change entry points all report a configuration error', async () => {
    const store = useAuthStore()
    const results = await Promise.all([
      store.reauthenticatePassword('pw'),
      store.updatePassword('new-pw'),
      store.updateEmail('new@example.com'),
    ])
    for (const result of results) {
      expect(result.error.message).toBe('Supabase is not configured.')
    }
    expect(supabaseModule.client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('refreshUser and signOut are no-ops rather than crashes', async () => {
    const store = useAuthStore()
    await expect(store.refreshUser()).resolves.toBeUndefined()
    await expect(store.signOut()).resolves.toBeUndefined()
    expect(supabaseModule.client.auth.signOut).not.toHaveBeenCalled()
  })
})

// ── isSupabaseConfigured passthrough ──────────────────────────────────────────

describe('isSupabaseConfigured passthrough', () => {
  it('is exposed on the store so the UI can hide auth-only affordances', () => {
    expect(useAuthStore().isSupabaseConfigured).toBe(true)
  })
})
