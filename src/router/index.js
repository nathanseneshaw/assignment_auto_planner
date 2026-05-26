/**
 * Vue Router config + auth guard.
 *
 * Routes are lazy-loaded so each page lands in its own webpack chunk. Route
 * `meta` drives the guard:
 *   - `requiresAuth` : redirect anonymous users to /login (preserving target via ?redirect=).
 *   - `guestOnly`    : redirect already-signed-in users away from /login and /register.
 *   - `landingPage`  : signed-in users skip the marketing page and go straight to /dashboard.
 *
 * When Supabase is not configured the guard is a no-op so the app remains
 * usable in pure local-storage / demo mode.
 *
 * Electron variant: the marketing landing page is web-only. In the Electron
 * build `IS_ELECTRON_BUILD` is a literal `true`, so Rollup eliminates the
 * Landing route definition (and the LandingPage.vue dynamic import along with
 * it). `/` then resolves to a redirect into the auth flow.
 */
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { IS_ELECTRON_BUILD } from '../lib/platform'

// Electron has no marketing page: `/` is an auth-aware entry point. The
// redirect function decides the destination on the first hop — unauthenticated
// users go straight to /login (the explicit guarantee asked for here), while
// signed-in users go straight to /dashboard without flashing through /login.
// Safe to call useAuthStore() here because Pinia is installed before the
// router in main.js, and authStore.init() is awaited before mount.
const rootRoute = IS_ELECTRON_BUILD
  ? {
      path: '/',
      redirect: () => {
        const authStore = useAuthStore()
        return authStore.isAuthenticated ? '/dashboard' : '/login'
      },
      meta: { title: 'Sign in' },
    }
  : {
      path: '/',
      name: 'Landing',
      component: () => import('../pages/LandingPage.vue'),
      meta: { title: 'Welcome', landingPage: true },
    }

const routes = [
  rootRoute,
  {
    path: '/login',
    name: 'Login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { title: 'Sign in', authPage: true, guestOnly: true },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../pages/RegisterPage.vue'),
    meta: { title: 'Create account', authPage: true, guestOnly: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../pages/DashboardPage.vue'),
    meta: { title: 'Dashboard', requiresAuth: true },
  },
  {
    path: '/assignments',
    name: 'Assignments',
    component: () => import('../pages/AssignmentsPage.vue'),
    meta: { title: 'Assignments', requiresAuth: true },
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import('../pages/TasksPage.vue'),
    meta: { title: 'Tasks', requiresAuth: true },
  },
  {
    path: '/planner',
    name: 'Planner',
    component: () => import('../pages/PlannerPage.vue'),
    meta: { title: 'Planner', requiresAuth: true },
  },
  {
    path: '/course-planner',
    name: 'CoursePlanner',
    component: () => import('../pages/CoursePlannerPage.vue'),
    meta: { title: 'Course Planner', requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { title: 'Profile & Settings', requiresAuth: true },
  },
]

// Electron loads the renderer from a `file://` URL where `createWebHistory()`
// breaks: the initial pathname is the full filesystem path (not `/`), so
// routes don't match; and `pushState('/tasks')` produces `file:///tasks`,
// which Chromium treats as a different document and can wipe in-memory state
// (Pinia/auth) mid-navigation — that's why "click any button → kicked to /login"
// was happening. Hash mode keeps the document path stable and routes purely
// from the `#fragment`, which is the standard Electron + Vue Router fix.
const router = createRouter({
  history: IS_ELECTRON_BUILD ? createWebHashHistory() : createWebHistory(),
  routes,
})

/**
 * Single global guard handles: tab title, landing redirect, auth wall, and
 * "don't let signed-in users see /login or /register" bouncing.
 */
router.beforeEach((to, from, next) => {
  // Browser tab title — set on every nav, not just initial mount.
  document.title = `${to.meta.title} | Plannr`

  const authStore = useAuthStore()

  // Signed-in users skip the marketing page and land in the app.
  if (isSupabaseConfigured && authStore.isAuthenticated && to.name === 'Landing') {
    next({ path: '/dashboard' })
    return
  }

  if (isSupabaseConfigured) {
    // Auth wall — bounce anonymous users to login, preserving where they were headed.
    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      next({
        name: 'Login',
        query: { redirect: to.fullPath },
      })
      return
    }
    // Already authed? /login and /register make no sense — send to dashboard.
    if (to.meta.guestOnly && authStore.isAuthenticated) {
      next({ path: '/dashboard' })
      return
    }
  }

  next()
})

export default router
