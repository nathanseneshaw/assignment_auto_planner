/**
 * Shared Playwright fixtures for the Plannr end-to-end suite.
 *
 * Every spec imports `test` / `expect` from here instead of `@playwright/test`.
 * Two fixtures are layered on top of the base `page`:
 *
 *   api  - HTTP stubbing for the Express backend. Auto-installed before the
 *          test body runs, so it is always active by the time you navigate.
 *          Unstubbed `/api/**` calls are answered with 503 and recorded, which
 *          turns a forgotten mock into a visible failure instead of a hang.
 *
 *   app  - navigation plus direct Pinia access. `app.goto()` waits for the Vue
 *          app to actually mount, and `app.store(id)` reads/writes real store
 *          state through the dev-only `window.__APP_TEST_HOOK__` (see
 *          src/main.js), so a spec can set up its subject in one call rather
 *          than clicking through unrelated UI first.
 *
 * Both are function-scoped: state never leaks between tests.
 *
 * The app under test runs with blank Supabase credentials (`.env.e2e`), so it
 * is in local-only mode: no auth wall, no backend writes, empty stores on every
 * page load. That is what makes these tests deterministic and offline.
 */
import { test as base, expect } from '@playwright/test'

/** Every backend call the app can make goes through this origin (`.env.e2e`). */
const API_GLOB = '**/api/**'

/**
 * Normalise the shapes a spec might use to name an endpoint into a predicate
 * over the request URL.
 *
 * Accepts:
 *   - a plain string: matched as a substring of the full URL, so
 *     '/api/ics/feeds' matches regardless of origin or query string
 *   - a RegExp: tested against the full URL
 *   - a function: called with (url, request) and returns a boolean
 */
function toMatcher(pattern) {
  if (typeof pattern === 'function') return pattern
  if (pattern instanceof RegExp) return (url) => pattern.test(url)
  return (url) => url.includes(pattern)
}

class ApiMock {
  constructor(page) {
    this.page = page
    /** Registered handlers. Searched newest-first so a test can override a default. */
    this._handlers = []
    /** Every intercepted request, in order. Assert against this for call counts. */
    this.requests = []
    /** Requests that hit no handler and were failed with 503. */
    this.unmatched = []
  }

  async _install() {
    await this.page.route(API_GLOB, async (route, request) => {
      const url = request.url()
      const parsed = new URL(url)
      const record = {
        url,
        method: request.method(),
        pathname: parsed.pathname,
        search: parsed.search,
        postData: request.postData(),
      }
      // Parsed JSON body, or null when the request had none / was not JSON.
      try {
        record.json = JSON.parse(request.postData() || 'null')
      } catch {
        record.json = null
      }
      this.requests.push(record)

      for (let i = this._handlers.length - 1; i >= 0; i -= 1) {
        const handler = this._handlers[i]
        if (!handler.match(url, request)) continue
        if (handler.once) this._handlers.splice(i, 1)
        await handler.fulfill(route, request, record)
        return
      }

      this.unmatched.push(record)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'e2e: no mock registered for this endpoint',
          method: record.method,
          path: record.pathname,
        }),
      })
    })
  }

  /**
   * Register a raw handler. `respond` receives Playwright's route and request
   * and is responsible for fulfilling or aborting.
   * Returns `this` so registrations can be chained.
   */
  route(pattern, respond, { once = false } = {}) {
    this._handlers.push({ match: toMatcher(pattern), fulfill: respond, once })
    return this
  }

  /**
   * Stub a JSON response. `body` may be a value or a function of
   * (request, record) for responses that depend on the query string.
   */
  json(pattern, body, { status = 200, once = false, delay = 0 } = {}) {
    return this.route(
      pattern,
      async (route, request, record) => {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        const resolved = typeof body === 'function' ? await body(request, record) : body
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(resolved === undefined ? null : resolved),
        })
      },
      { once }
    )
  }

  /** Stub a failing endpoint, for error-state and retry coverage. */
  fail(pattern, { status = 500, body = { error: 'e2e simulated failure' }, once = false } = {}) {
    return this.json(pattern, body, { status, once })
  }

  /** Simulate a dropped connection (fetch rejects rather than returning !ok). */
  offline(pattern, { once = false } = {}) {
    return this.route(pattern, async (route) => route.abort('connectionfailed'), { once })
  }

  /** Requests recorded so far whose URL matches `pattern`. */
  callsTo(pattern) {
    const match = toMatcher(pattern)
    return this.requests.filter((r) => match(r.url))
  }

  /** Poll until at least `count` matching requests have been seen. */
  async waitForCall(pattern, { count = 1, timeout = 7500 } = {}) {
    const deadline = Date.now() + timeout
    for (;;) {
      const calls = this.callsTo(pattern)
      if (calls.length >= count) return calls
      if (Date.now() > deadline) {
        const seen = this.requests.map((r) => `${r.method} ${r.pathname}`).join(', ') || '(none)'
        throw new Error(`Timed out waiting for ${count} call(s) to ${pattern}. Seen: ${seen}`)
      }
      await this.page.waitForTimeout(100)
    }
  }
}

/** Handle onto one live Pinia store inside the page. */
class StoreHandle {
  constructor(page, id) {
    this.page = page
    this.id = id
  }

  /**
   * Wait for the store to exist in-page. Stores are created lazily by the
   * components that use them, so page-scoped stores (coursePlanner, icsFeeds,
   * scheduleBuilder) only exist once their page has mounted - hence the poll.
   */
  async _ready() {
    // `polling: 100` rather than the default requestAnimationFrame: several
    // headless browsers running in parallel share one software GL context, and
    // rAF callbacks can starve badly enough under that load to blow the timeout
    // on a page that is otherwise perfectly ready. A timer does not care.
    await this.page.waitForFunction(
      (id) => !!(window.__APP_TEST_HOOK__ && window.__APP_TEST_HOOK__.pinia._s.get(id)),
      this.id,
      { timeout: 15000, polling: 100 }
    )
  }

  /** JSON snapshot of the store's state. */
  async state() {
    await this._ready()
    return this.page.evaluate(
      (id) => JSON.parse(JSON.stringify(window.__APP_TEST_HOOK__.pinia._s.get(id).$state)),
      this.id
    )
  }

  /** Shallow-merge into the store's state (Pinia $patch). */
  async patch(partial) {
    await this._ready()
    await this.page.evaluate(
      ([id, value]) => window.__APP_TEST_HOOK__.pinia._s.get(id).$patch(value),
      [this.id, partial]
    )
  }

  /**
   * Call an action and return its JSON-serialisable result.
   * e.g. await app.store('courses').invoke('addCourse', { name: 'CS 101' })
   */
  async invoke(method, ...args) {
    await this._ready()
    return this.page.evaluate(
      ([id, name, callArgs]) => {
        const store = window.__APP_TEST_HOOK__.pinia._s.get(id)
        const result = store[name](...callArgs)
        return result === undefined ? null : JSON.parse(JSON.stringify(result))
      },
      [this.id, method, args]
    )
  }
}

class AppDriver {
  constructor(page) {
    this.page = page
    this._localStorage = {}
  }

  /**
   * Queue localStorage entries to be written before any app code runs.
   * Must be called before `goto`. Values are JSON-stringified unless already a
   * string. The app persists `profile`, `theme` and the `coursePlanner:*` keys
   * this way.
   */
  seedLocalStorage(entries) {
    Object.assign(this._localStorage, entries)
    return this
  }

  /** Navigate and wait for the Vue app to mount. */
  async goto(path = '/', { waitForApp = true } = {}) {
    const pending = this._localStorage
    if (Object.keys(pending).length) {
      await this.page.addInitScript((seed) => {
        for (const [key, value] of Object.entries(seed)) {
          window.localStorage.setItem(
            key,
            typeof value === 'string' ? value : JSON.stringify(value)
          )
        }
      }, pending)
      this._localStorage = {}
    }

    await this.page.goto(path)
    if (waitForApp) {
      await this.page.waitForFunction(() => !!window.__APP_TEST_HOOK__, null, {
        timeout: 20000,
        polling: 100,
      })
      await expect(this.page.locator('#app')).not.toBeEmpty()
    }
    return this.page
  }

  /** Handle onto a Pinia store by its id, e.g. 'tasks', 'courses', 'coursePlanner'. */
  store(id) {
    return new StoreHandle(this.page, id)
  }

  /** Client-side route change without a full reload. */
  async navigate(path) {
    await this.page.evaluate((to) => window.__APP_TEST_HOOK__.router.push(to), path)
    await this.page.waitForFunction(
      (to) => window.location.pathname === to || window.location.hash === `#${to}`,
      path,
      { timeout: 10000, polling: 100 }
    )
  }

  /** Current router path as the app sees it. */
  async currentPath() {
    return this.page.evaluate(() => window.__APP_TEST_HOOK__.router.currentRoute.value.fullPath)
  }
}

export const test = base.extend({
  api: async ({ page }, use) => {
    const api = new ApiMock(page)
    await api._install()
    await use(api)
  },

  // Depends on `api` so interception is installed before any navigation.
  app: async ({ page, api }, use) => {
    void api
    await use(new AppDriver(page))
  },
})

export { expect }
