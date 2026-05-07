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

router.beforeEach((to, from, next) => {
  document.title = `${to.meta.title} | Assignment Auto-Planner`

  const authStore = useAuthStore()

  if (isSupabaseConfigured && authStore.isAuthenticated && to.name === 'Landing') {
    next({ path: '/dashboard' })
    return
  }

  if (isSupabaseConfigured) {
    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      next({
        name: 'Login',
        query: { redirect: to.fullPath },
      })
      return
    }
    if (to.meta.guestOnly && authStore.isAuthenticated) {
      next({ path: '/dashboard' })
      return
    }
  }

  next()
})

export default router
