/**
 * Debugging session: capture response bodies, especially captcha.zog reply.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = 'https://coursebook.utdallas.edu/guidedsearch'
const OUT = tmpdir()
const log = (...a) => console.log('[debug]', ...a)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--window-position=-3000,-3000', // off-screen so user never sees it
    '--window-size=1366,900',
  ],
})
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  locale: 'en-US',
})
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
})
const page = await context.newPage()

page.on('response', async (r) => {
  const u = r.url()
  if (u.includes('captcha.zog') || u.includes('clip-cb11-hat.zog')) {
    let body = ''
    try { body = (await r.text()).slice(0, 1500) } catch {}
    log('RESP', r.status(), u.split('?')[0], '\n   body:', body || '(empty)')
  }
})
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('cb11') || t.includes('captcha') || t.includes('search')) {
    log('CONSOLE', msg.type(), t.slice(0, 300))
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
log('page loaded — waiting 10s for captcha v3')
await page.waitForTimeout(10000)

// Check if a recaptcha v2 challenge appeared (would block us)
const v2Visible = await page.evaluate(() => {
  const f = document.querySelector('#recaptcha_v2_here iframe')
  return f ? f.getBoundingClientRect() : null
})
log('v2 widget present?', v2Visible)

// Re-execute grecaptcha right before search (action=cb11 is what JS uses)
const tokenInfo = await page.evaluate(async () => {
  if (typeof grecaptcha === 'undefined') return { error: 'grecaptcha missing' }
  try {
    const token = await grecaptcha.execute(
      '6Le40H4UAAAAAOsmU_X6nkaBUpqSyKTRPIDKMRYG',
      { action: 'cb11' }
    )
    return { token: token.slice(0, 30) + '…', len: token.length }
  } catch (e) {
    return { error: String(e) }
  }
})
log('manual grecaptcha.execute:', tokenInfo)

await page.selectOption('#combobox_term', 'term_26f')
await page.selectOption('#combobox_cp', 'cp_cs')
log('selected term + cp; calling do_guided_search')

await page.evaluate(() => window.do_guided_search && window.do_guided_search())
await page.waitForTimeout(8000)

const srHtml = await page.locator('#sr').innerHTML()
writeFileSync(join(OUT, 'utd_sr.html'), srHtml)
log(`#sr captured: ${srHtml.length} bytes`)
log(`#sr snippet: ${srHtml.slice(0, 600).replace(/\s+/g, ' ')}`)

await browser.close()
