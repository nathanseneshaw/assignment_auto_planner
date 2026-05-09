const BACKEND = 'https://assignment-auto-planner.onrender.com'
const APP = 'https://assignment-auto-planner.vercel.app'

const statusEl = document.getElementById('status')
const btn = document.getElementById('sync')
let detected = null

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) {
    statusEl.textContent = 'No active tab.'
    return
  }
  let u
  try {
    u = new URL(tab.url)
  } catch {
    statusEl.textContent = 'Open Blackboard or Canvas first.'
    return
  }
  if (/canvas|instructure/i.test(u.hostname)) {
    detected = { kind: 'canvas', tab, url: u }
  } else if (/blackboard|bb-?learn/i.test(u.hostname)) {
    detected = { kind: 'blackboard', tab, url: u }
  }
  if (detected) {
    statusEl.textContent = `Detected ${detected.kind === 'canvas' ? 'Canvas' : 'Blackboard'}.`
    btn.disabled = false
  } else {
    statusEl.textContent = 'Open Blackboard or Canvas in this tab first.'
  }
}

btn.onclick = async () => {
  if (!detected) return
  btn.disabled = true
  statusEl.className = ''
  statusEl.textContent = 'Reading cookies…'
  try {
    const cookies = await chrome.cookies.getAll({ domain: detected.url.hostname })
    statusEl.textContent = `Sending ${cookies.length} cookies…`
    const res = await fetch(`${BACKEND}/api/${detected.kind}/import-cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: detected.url.origin,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite || 'Lax',
        })),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
    statusEl.textContent = 'Synced. Opening Assignment Planner…'
    statusEl.className = 'ok'
    chrome.tabs.create({
      url: `${APP}/profile?sync=${detected.kind}:${data.sessionId}`,
    })
    setTimeout(() => window.close(), 800)
  } catch (e) {
    statusEl.textContent = e.message
    statusEl.className = 'err'
    btn.disabled = false
  }
}

init()
