/**
 * Launch options for Playwright on servers (Render, Docker, Linux) vs local dev.
 * Render sets RENDER=true; Chromium in containers needs --no-sandbox.
 */

function truthy(v) {
  return v === '1' || /^true$/i.test(String(v || ''))
}

function falsy(v) {
  return v === '0' || /^false$/i.test(String(v || ''))
}

/** Headed UI only makes sense locally; cloud should use headless. */
export function resolvePlaywrightHeadless() {
  const v = process.env.PLAYWRIGHT_HEADLESS
  if (truthy(v)) return true
  if (falsy(v)) return false
  if (process.env.RENDER === 'true') return true
  return false
}

/**
 * @param {string | undefined} channel chrome | msedge | undefined
 */
export function buildChromiumLaunchOptions(channel) {
  const headless = resolvePlaywrightHeadless()
  const launchOpts = {
    headless,
    ...(channel ? { channel } : {}),
  }
  const needsSandboxWorkaround =
    headless || process.env.RENDER === 'true' || process.platform === 'linux'
  if (needsSandboxWorkaround) {
    launchOpts.args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ]
  }
  return launchOpts
}
