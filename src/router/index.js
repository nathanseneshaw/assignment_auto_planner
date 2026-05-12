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
 */
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured } from '../lib/supabase'

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: () => import('../pages/LandingPage.vue'),
    meta: { title: 'Welcome', landingPage: true },
  },
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
    path: '/course',
    name: 'Courses',
    component: () => import('../pages/CoursesPage.vue'),
    meta: { title: 'Courses', requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { title: 'Profile & Settings', requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Single global guard handles: tab title, landing redirect, auth wall, and
 * "don't let signed-in users see /login or /register" bouncing.
 */
router.beforeEach((to, from, next) => {
  // Browser tab title — set on every nav, not just initial mount.
  document.title = `${to.meta.title} | Assignment Auto-Planner`

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
