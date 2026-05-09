function truthy(v) {
  return v === '1' || /^true$/i.test(String(v || ''))
}

function falsy(v) {
  return v === '0' || /^false$/i.test(String(v || ''))
}

export function resolvePlaywrightHeadless() {
  const v = process.env.PLAYWRIGHT_HEADLESS
  if (truthy(v)) return true
  if (falsy(v)) return false
  if (process.env.RENDER === 'true') return true
  return false
}

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
