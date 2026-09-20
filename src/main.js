import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './style.css'
import { useAuthStore } from './stores/auth'

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  const authStore = useAuthStore()
  await authStore.init()

  app.use(router)
  app.mount('#app')

  // Test hook for the Playwright suite, exposed in dev and in the dedicated
  // `e2e` build mode only. Both operands are compile-time literals, so the
  // whole block is dead-code-eliminated from every shipping bundle: `vite
  // build`, electron:build and ios:build all run in the default `production`
  // mode, where DEV is false and MODE is not 'e2e'.
  //
  // Playwright uses it to seed Pinia stores directly (see e2e/fixtures/test.js),
  // which keeps a tasks test from having to click through course creation just
  // to reach its actual subject.
  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    window.__APP_TEST_HOOK__ = { app, pinia, router }
  }
}

bootstrap()
