import { ref, reactive } from 'vue'

const toasts = reactive([])
let toastId = 0

export function useToast() {
  function show(message, type = 'info', duration = 3000) {
    const id = ++toastId
    
    toasts.push({
      id,
      message,
      type,
      duration,
      visible: true
    })

    if (duration > 0) {
      setTimeout(() => {
        remove(id)
      }, duration)
    }

    return id
  }

  function remove(id) {
    const index = toasts.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.splice(index, 1)
    }
  }

  function success(message, duration) {
    return show(message, 'success', duration)
  }

  function error(message, duration) {
    return show(message, 'error', duration)
  }

  function warning(message, duration) {
    return show(message, 'warning', duration)
  }

  function info(message, duration) {
    return show(message, 'info', duration)
  }

  return {
    toasts,
    show,
    showToast: show,
    remove,
    success,
    error,
    warning,
    info
  }
}
