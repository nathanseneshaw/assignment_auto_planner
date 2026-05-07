import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref({
    name: '',
    email: '',
    avatar: null
  })

  const lmsConnections = ref({
    canvas: {
      connected: false,
      authMode: 'token',
      apiUrl: '',
      apiToken: '',
      serverSessionId: '',
      lastSynced: null
    },
    blackboard: {
      connected: false,
      apiUrl: '',
      username: '',
      password: '',
      courseIds: [],
      availableCourses: [],
      lastSynced: null
    }
  })

  const extensionSync = ref({
    lastSynced: null,
    coursesImported: 0,
    assignmentsImported: 0
  })

  const isCanvasConnected = computed(() => lmsConnections.value.canvas.connected)
  const isBlackboardConnected = computed(() => lmsConnections.value.blackboard.connected)
  const hasAnyLmsConnected = computed(() => isCanvasConnected.value || isBlackboardConnected.value)

  function updateProfile(data) {
    profile.value = { ...profile.value, ...data }
    saveToLocalStorage()
  }

  function connectCanvas(apiUrl, apiToken) {
    lmsConnections.value.canvas = {
      connected: true,
      authMode: 'token',
      apiUrl: apiUrl.trim(),
      apiToken: apiToken.trim(),
      serverSessionId: '',
      lastSynced: new Date().toISOString()
    }
    saveToLocalStorage()
    return true
  }

  /** Canvas via embedded browser sync (no API token); user signs in in a real browser window. */
  function connectCanvasBrowser(apiUrl) {
    lmsConnections.value.canvas = {
      connected: true,
      authMode: 'browser',
      apiUrl: apiUrl.trim(),
      apiToken: '',
      serverSessionId: '',
      lastSynced: new Date().toISOString()
    }
    saveToLocalStorage()
    return true
  }

  function disconnectCanvas() {
    lmsConnections.value.canvas = {
      connected: false,
      authMode: 'token',
      apiUrl: '',
      apiToken: '',
      serverSessionId: '',
      lastSynced: null
    }
    saveToLocalStorage()
  }

  function connectBlackboard(apiUrl, username, password, courseIds = [], availableCourses = []) {
    lmsConnections.value.blackboard = {
      connected: true,
      apiUrl: apiUrl.trim(),
      username: username.trim(),
      password: password,
      courseIds: courseIds,
      availableCourses: availableCourses,
      lastSynced: new Date().toISOString()
    }
    saveToLocalStorage()
    return true
  }

  function connectBlackboardBrowser(apiUrl) {
    const previous = lmsConnections.value.blackboard || {}
    lmsConnections.value.blackboard = {
      connected: true,
      apiUrl: apiUrl.trim(),
      username: previous.username || '',
      password: previous.password || '',
      courseIds: Array.isArray(previous.courseIds) ? previous.courseIds : [],
      availableCourses: Array.isArray(previous.availableCourses) ? previous.availableCourses : [],
      lastSynced: new Date().toISOString()
    }
    saveToLocalStorage()
    return true
  }

  function updateBlackboardCourses(courseIds, availableCourses) {
    lmsConnections.value.blackboard.courseIds = courseIds
    if (availableCourses) {
      lmsConnections.value.blackboard.availableCourses = availableCourses
    }
    saveToLocalStorage()
  }

  function disconnectBlackboard() {
    lmsConnections.value.blackboard = {
      connected: false,
      apiUrl: '',
      username: '',
      password: '',
      courseIds: [],
      availableCourses: [],
      lastSynced: null
    }
    saveToLocalStorage()
  }

  function syncLms(platform) {
    if (platform === 'canvas' && lmsConnections.value.canvas.connected) {
      lmsConnections.value.canvas.lastSynced = new Date().toISOString()
    } else if (platform === 'blackboard' && lmsConnections.value.blackboard.connected) {
      lmsConnections.value.blackboard.lastSynced = new Date().toISOString()
    }
    saveToLocalStorage()
  }

  function updateExtensionSync(coursesCount, assignmentsCount) {
    extensionSync.value = {
      lastSynced: new Date().toISOString(),
      coursesImported: coursesCount,
      assignmentsImported: assignmentsCount
    }
    saveToLocalStorage()
  }

  function saveToLocalStorage() {
    localStorage.setItem('profile', JSON.stringify(profile.value))
    localStorage.setItem('lmsConnections', JSON.stringify(lmsConnections.value))
    localStorage.setItem('extensionSync', JSON.stringify(extensionSync.value))
  }

  function loadFromLocalStorage() {
    const savedProfile = localStorage.getItem('profile')
    const savedLms = localStorage.getItem('lmsConnections')
    const savedExtensionSync = localStorage.getItem('extensionSync')
    
    if (savedProfile) {
      profile.value = JSON.parse(savedProfile)
    }
    if (savedLms) {
      const parsed = JSON.parse(savedLms)
      lmsConnections.value = parsed
      const c = lmsConnections.value.canvas
      if (c?.authMode === 'oauth') {
        c.connected = false
        c.serverSessionId = ''
        c.authMode = 'token'
      }
      if (c && c.authMode == null) {
        if (c.apiToken) c.authMode = 'token'
        else if (c.serverSessionId) c.authMode = 'browser'
        else c.authMode = 'browser'
      }
      if (c && c.serverSessionId == null) c.serverSessionId = ''
    }
    if (savedExtensionSync) {
      extensionSync.value = JSON.parse(savedExtensionSync)
    }
  }

  loadFromLocalStorage()

  return {
    profile,
    lmsConnections,
    extensionSync,
    isCanvasConnected,
    isBlackboardConnected,
    hasAnyLmsConnected,
    updateProfile,
    connectCanvas,
    connectCanvasBrowser,
    disconnectCanvas,
    connectBlackboard,
    connectBlackboardBrowser,
    updateBlackboardCourses,
    disconnectBlackboard,
    syncLms,
    updateExtensionSync
  }
})
