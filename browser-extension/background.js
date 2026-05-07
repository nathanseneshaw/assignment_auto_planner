// Background service worker - Auto-detect Blackboard and sync

// Generic patterns that indicate a Blackboard LMS site
const BLACKBOARD_URL_INDICATORS = [
  'blackboard',
  '/ultra/',
  '/webapps/',
  '/bbcswebdav/',
  'learn.',
  'elearning',
  'lms.',
  'courses.',
  'bb-',
  'Bb-'
];

// Check if URL is a Blackboard site
function isBlackboardUrl(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return BLACKBOARD_URL_INDICATORS.some(pattern => lowerUrl.includes(pattern.toLowerCase()));
}

// Find any open Blackboard tab
async function findBlackboardTab() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (isBlackboardUrl(tab.url)) {
      return tab;
    }
  }
  return null;
}

// Perform sync on a Blackboard tab
async function syncFromTab(tab) {
  console.log('[AutoPlanner] Starting background sync from tab:', tab.id, tab.url);
  
  try {
    // First, try to inject the content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      console.log('[AutoPlanner] Content script injected');
    } catch (e) {
      console.log('[AutoPlanner] Content script injection result:', e.message);
    }
    
    // Wait for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Ping to verify content script is loaded
    let pingResponse;
    try {
      pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      console.log('[AutoPlanner] Ping response:', pingResponse);
    } catch (e) {
      console.error('[AutoPlanner] Ping failed - content script not responding:', e.message);
      // Try injecting again
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Run full sync
    console.log('[AutoPlanner] Sending fullSync message...');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'fullSync' });
    console.log('[AutoPlanner] fullSync response:', response);
    
    if (response && response.success) {
      const syncData = {
        courses: response.data.courses,
        assignments: response.data.assignments,
        lastSynced: new Date().toISOString(),
        syncedFromUrl: tab.url
      };
      
      // Save to storage
      await chrome.storage.local.set({ 
        syncedData: syncData,
        lastSyncTime: syncData.lastSynced
      });
      
      console.log(`[AutoPlanner] Background sync complete: ${syncData.courses.length} courses, ${syncData.assignments.length} assignments`);
      
      // Update badge to show success
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
      
      return syncData;
    } else {
      console.error('[AutoPlanner] Sync failed:', response?.error || 'Unknown error');
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
      return null;
    }
  } catch (error) {
    console.error('[AutoPlanner] Background sync error:', error);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
    return null;
  }
}

// Auto-sync when Blackboard tab is detected
async function checkAndSync() {
  const tab = await findBlackboardTab();
  if (tab) {
    // Check if we've synced recently (within last 30 minutes)
    const { lastSyncTime } = await chrome.storage.local.get(['lastSyncTime']);
    if (lastSyncTime) {
      const timeSinceSync = Date.now() - new Date(lastSyncTime).getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      if (timeSinceSync < thirtyMinutes) {
        console.log('[AutoPlanner] Skipping auto-sync, last sync was', Math.round(timeSinceSync / 60000), 'minutes ago');
        return;
      }
    }
    
    // Show syncing badge
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    
    await syncFromTab(tab);
  }
}

// Listen for tab updates - detect when user navigates to Blackboard
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isBlackboardUrl(tab.url)) {
    console.log('[AutoPlanner] Blackboard tab detected:', tab.url);
    // Delay slightly to ensure page is fully loaded
    setTimeout(() => checkAndSync(), 2000);
  }
});

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoPlanner] Extension installed');
  
  // Set default app URL
  chrome.storage.local.get(['appUrl'], (result) => {
    if (!result.appUrl) {
      chrome.storage.local.set({ appUrl: 'http://localhost:5173' });
    }
  });
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'syncNow',
    title: 'Sync Blackboard Now',
    contexts: ['action']
  });
  
  // Set up periodic check (every 15 minutes)
  chrome.alarms.create('checkBlackboard', { periodInMinutes: 15 });
});

// Handle alarm for periodic checking
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkBlackboard') {
    checkAndSync();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'syncNow') {
    const tab = await findBlackboardTab();
    if (tab) {
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
      await syncFromTab(tab);
    }
  }
});

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSyncedData') {
    chrome.storage.local.get(['syncedData', 'lastSyncTime'], (result) => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'forceSyncFromTab') {
    (async () => {
      const tab = await findBlackboardTab();
      if (tab) {
        const result = await syncFromTab(tab);
        sendResponse({ success: !!result, data: result });
      } else {
        sendResponse({ success: false, error: 'No Blackboard tab found' });
      }
    })();
    return true;
  }
  
  if (request.action === 'clearSyncData') {
    chrome.storage.local.remove(['syncedData', 'lastSyncTime'], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Initial check on startup
checkAndSync();
