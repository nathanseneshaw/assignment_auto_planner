chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (!tab.url) return
  let badge = ''
  try {
    const h = new URL(tab.url).hostname
    if (/canvas|instructure/i.test(h)) badge = 'CV'
    else if (/blackboard|bb-?learn/i.test(h)) badge = 'BB'
  } catch {
    /* ignore non-http URLs */
  }
  chrome.action.setBadgeText({ tabId, text: badge })
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#0a2540' })
})
