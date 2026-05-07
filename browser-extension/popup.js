// Popup script - Shows synced data and allows manual sync/send

// Elements
const lastSyncedContainer = document.getElementById('lastSynced');
const lastSyncedTime = document.getElementById('lastSyncedTime');
const statusContainer = document.getElementById('statusContainer');
const status = document.getElementById('status');
const statusText = document.getElementById('statusText');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const dataSummary = document.getElementById('dataSummary');
const courseCount = document.getElementById('courseCount');
const assignmentCount = document.getElementById('assignmentCount');
const noData = document.getElementById('noData');
const sendToAppBtn = document.getElementById('sendToAppBtn');
const syncNowBtn = document.getElementById('syncNowBtn');
const syncBtnText = document.getElementById('syncBtnText');
const appUrlInput = document.getElementById('appUrl');

let currentData = null;
let isSyncing = false;
const debugLog = document.getElementById('debugLog');

// Debug logging function
function log(msg) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  console.log(line);
  if (debugLog) {
    debugLog.textContent = line + '\n' + debugLog.textContent;
  }
}

// Load settings
chrome.storage.local.get(['appUrl'], (result) => {
  if (result.appUrl) appUrlInput.value = result.appUrl;
});

appUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ appUrl: appUrlInput.value });
});

// Format time ago
function formatTimeAgo(dateString) {
  if (!dateString) return 'Never';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Get freshness class
function getFreshnessClass(dateString) {
  if (!dateString) return '';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  
  if (diffMs < oneHour) return 'recent';
  if (diffMs > oneDay) return 'old';
  return '';
}

// Show status message
function showStatus(message, type) {
  statusContainer.style.display = 'block';
  status.className = 'status ' + type;
  statusText.textContent = message;
}

// Hide status
function hideStatus() {
  statusContainer.style.display = 'none';
}

// Update UI with data
function updateUI(data, lastSync) {
  if (data && (data.courses?.length > 0 || data.assignments?.length > 0)) {
    currentData = data;
    
    // Show last synced
    lastSyncedContainer.style.display = 'flex';
    lastSyncedTime.textContent = formatTimeAgo(lastSync);
    lastSyncedTime.className = 'last-synced-time ' + getFreshnessClass(lastSync);
    
    // Show data summary
    dataSummary.style.display = 'block';
    courseCount.textContent = data.courses?.length || 0;
    assignmentCount.textContent = data.assignments?.length || 0;
    
    // Show send button
    sendToAppBtn.style.display = 'block';
    
    // Hide no data
    noData.style.display = 'none';
  } else {
    currentData = null;
    lastSyncedContainer.style.display = 'none';
    dataSummary.style.display = 'none';
    sendToAppBtn.style.display = 'none';
    noData.style.display = 'block';
  }
}

// Load existing synced data
async function loadSyncedData() {
  const result = await chrome.storage.local.get(['syncedData', 'lastSyncTime']);
  if (result.syncedData) {
    updateUI(result.syncedData, result.lastSyncTime);
  } else {
    updateUI(null, null);
  }
}

// Check if we can communicate with the current tab
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      log('No active tab found');
      return { success: false, error: 'No active tab' };
    }
    
    log('Active tab: ' + tab.url);
    
    // Check if it's a Blackboard URL (generic detection)
    const blackboardPatterns = ['blackboard', '/ultra/', '/webapps/', 'learn.', 'elearning', 'lms.', '/bbcswebdav/'];
    const lowerUrl = tab.url.toLowerCase();
    const isBlackboard = blackboardPatterns.some(p => lowerUrl.includes(p));
    if (!isBlackboard) {
      log('Not a Blackboard page');
      return { success: false, error: 'Not a Blackboard page', url: tab.url };
    }
    
    // Try to inject content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      log('Content script injected');
    } catch (e) {
      log('Script injection: ' + e.message);
    }
    
    // Wait a moment
    await new Promise(r => setTimeout(r, 300));
    
    // Try to ping the content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'checkPage' });
      log('Page check: isLoggedIn=' + response.isLoggedIn + ', courses=' + response.coursesOnPage);
      return { success: true, ...response, tabId: tab.id };
    } catch (e) {
      log('Content script not responding: ' + e.message);
      return { success: false, error: 'Content script not responding', url: tab.url };
    }
  } catch (e) {
    log('Error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Listen for progress updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'syncProgress') {
    const progress = message.progress;
    if (progress.phase === 'courses') {
      progressText.textContent = `Found ${progress.count} courses...`;
      progressFill.style.width = '15%';
    } else if (progress.phase === 'assignments') {
      const percent = 15 + (progress.current / progress.total) * 80;
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${progress.courseName} (${progress.current}/${progress.total})`;
    }
  }
});

// Sync now button - directly sync from current tab first, then try background
syncNowBtn.addEventListener('click', async () => {
  if (isSyncing) return;
  isSyncing = true;
  
  syncBtnText.innerHTML = '<div class="spinner"></div> Syncing...';
  syncNowBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressFill.style.width = '5%';
  progressText.textContent = 'Checking current tab...';
  hideStatus();
  
  try {
    // First, try to sync from the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const blackboardPatterns = ['blackboard', '/ultra/', '/webapps/', 'learn.', 'elearning', 'lms.', '/bbcswebdav/'];
    const lowerUrl = (tab?.url || '').toLowerCase();
    const isBlackboard = tab && blackboardPatterns.some(p => lowerUrl.includes(p));
    
    if (isBlackboard) {
      log('Syncing from tab: ' + tab.url);
      progressText.textContent = 'Injecting sync script...';
      progressFill.style.width = '10%';
      
      // Inject content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        log('Script injected');
      } catch (e) {
        log('Script inject: ' + e.message);
      }
      
      await new Promise(r => setTimeout(r, 500));
      progressText.textContent = 'Starting sync...';
      progressFill.style.width = '15%';
      log('Sending fullSync message...');
      
      // Send fullSync message directly to the tab
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'fullSync' });
      log('Response: success=' + response?.success + ', courses=' + response?.data?.courses?.length);
      
      if (response && response.success) {
        const courseCount = response.data.courses?.length || 0;
        const assignmentCount = response.data.assignments?.length || 0;
        const errorCount = response.data.errors?.length || 0;
        
        // Check if we have any data
        if (courseCount === 0 && assignmentCount === 0) {
          log('No data found. Errors: ' + JSON.stringify(response.data.errors));
          const errorMsg = response.data.errors?.[0]?.error || 'No courses found. Click "Courses" in Blackboard sidebar first.';
          throw new Error(errorMsg);
        }
        
        // Save to storage
        const syncData = {
          courses: response.data.courses,
          assignments: response.data.assignments,
          lastSynced: new Date().toISOString(),
          syncedFromUrl: tab.url
        };
        await chrome.storage.local.set({ 
          syncedData: syncData,
          lastSyncTime: syncData.lastSynced
        });
        
        progressFill.style.width = '100%';
        progressText.textContent = 'Sync complete!';
        await loadSyncedData();
        log('Sync complete: ' + courseCount + ' courses, ' + assignmentCount + ' assignments');
        
        let statusMsg = `Synced ${courseCount} courses and ${assignmentCount} assignments`;
        if (errorCount > 0) {
          statusMsg += ` (${errorCount} errors)`;
        }
        showStatus(statusMsg, 'success');
      } else {
        log('Sync failed: ' + (response?.error || 'No data'));
        throw new Error(response?.error || 'Sync returned no data');
      }
    } else {
      // Not on Blackboard, try background sync
      log('Not on Blackboard, trying background sync...');
      progressText.textContent = 'Looking for Blackboard tab...';
      
      const response = await chrome.runtime.sendMessage({ action: 'forceSyncFromTab' });
      log('Background sync: success=' + response?.success);
      
      if (response && response.success) {
        progressFill.style.width = '100%';
        progressText.textContent = 'Sync complete!';
        await loadSyncedData();
        showStatus(`Synced ${response.data?.courses?.length || 0} courses and ${response.data?.assignments?.length || 0} assignments`, 'success');
      } else {
        log('Background sync failed: ' + (response?.error || 'Unknown'));
        throw new Error(response?.error || 'No Blackboard tab found');
      }
    }
  } catch (error) {
    log('Error: ' + error.message);
    const msg = error.message || 'Unknown error';
    
    if (msg.includes('No Blackboard tab') || msg.includes('Could not establish connection')) {
      showStatus('Open Blackboard and make sure you are logged in', 'warning');
    } else if (msg.includes('Cannot access')) {
      showStatus('Cannot access this page. Navigate to Blackboard first.', 'warning');
    } else {
      showStatus('Sync failed: ' + msg, 'error');
    }
    progressContainer.style.display = 'none';
  } finally {
    syncBtnText.textContent = 'Sync Now';
    syncNowBtn.disabled = false;
    isSyncing = false;
    
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 2000);
  }
});

// Send to app button
sendToAppBtn.addEventListener('click', async () => {
  if (!currentData) return;
  
  sendToAppBtn.disabled = true;
  sendToAppBtn.textContent = 'Opening app...';
  
  try {
    const appUrl = appUrlInput.value.replace(/\/$/, '');
    const importData = {
      ...currentData,
      autoImport: true
    };
    
    const importUrl = `${appUrl}/profile?import=${encodeURIComponent(JSON.stringify(importData))}`;
    await chrome.tabs.create({ url: importUrl });
    
    showStatus('Sent to app!', 'success');
  } catch (error) {
    showStatus('Failed to open app', 'error');
  } finally {
    sendToAppBtn.disabled = false;
    sendToAppBtn.textContent = 'Send to Assignment Planner';
  }
});

// Initialize
async function init() {
  log('Popup initialized');
  await loadSyncedData();
  
  // Check current tab status
  const tabCheck = await checkCurrentTab();
  log('Tab check complete');
  
  if (tabCheck.success) {
    if (tabCheck.isLoggedIn) {
      showStatus(`Ready to sync (${tabCheck.coursesOnPage} courses detected on page)`, 'info');
    } else {
      showStatus('Blackboard detected but you may not be logged in', 'warning');
    }
  } else if (tabCheck.error === 'Not a Blackboard page') {
    showStatus('Navigate to Blackboard, then click Sync Now', 'info');
  } else if (tabCheck.error === 'Content script not responding') {
    showStatus('Try refreshing the Blackboard page, then click Sync Now', 'warning');
  } else {
    showStatus('Open Blackboard in a tab to sync', 'info');
  }
}

init();
