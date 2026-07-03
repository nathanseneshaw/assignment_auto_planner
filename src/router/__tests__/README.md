# Testing Route Names with Vitest

This guide explains how to test Vue Router route names stored as a frozen const object (the JS equivalent of an enum).

---

## Step 1 - Create a route names const

In `src/router/routeNames.js`:

```js
export const RouteName = Object.freeze({
  Landing:       'Landing',
  Login:         'Login',
  Register:      'Register',
  Dashboard:     'Dashboard',
  Assignments:   'Assignments',
  Tasks:         'Tasks',
  Planner:       'Planner',
  CoursePlanner: 'CoursePlanner',
  Profile:       'Profile',
  AuthConfirm:   'AuthConfirm',
  VerifyEmail:   'VerifyEmail',
})
```

Then reference it in `src/router/index.js` instead of raw strings:

```js
import { RouteName } from './routeNames'

{ path: '/login', name: RouteName.Login, ... }
```

---

## Step 2 - Unit test the enum

Test that values haven't drifted and the object is immutable:

```js
// src/router/__tests__/routeNames.test.js
import { RouteName } from '../routeNames'

describe('RouteName enum', () => {
  it('every value matches its key', () => {
    for (const [key, value] of Object.entries(RouteName)) {
      expect(value).toBe(key)
    }
  })

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(RouteName)).toBe(true)
  })
})
```

---

## Step 3 - Use RouteName in component tests

When testing navigation in a component, import `RouteName` and assert against it instead of raw strings:

```js
import { RouteName } from '../../router/routeNames'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute:  () => ({ name: RouteName.Dashboard, params: {}, query: {} }),
}))

it('pushes to Login on logout', async () => {
  const push = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ push })

  await wrapper.find('[data-testid="logout"]').trigger('click')
  expect(push).toHaveBeenCalledWith({ name: RouteName.Login })
})
```

---

## Key rule

Never assert against a raw string like `'Login'` in a component test - assert against `RouteName.Login`. If a route name changes, the failure surfaces at the enum definition rather than scattered across multiple test files.
