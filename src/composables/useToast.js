/**
 * Global toast notification composable.
 *
 * The `toasts` array is module-scoped (a singleton) so that any component
 * calling `useToast()` reads/writes the same queue. This lets one component
 * trigger a toast (e.g. a store action) while another component (the
 * `<ToastContainer />`) renders the list.
 */
import { reactive } from 'vue'

const toasts = reactive([])
let toastId = 0

/**
 * @returns reactive toast queue plus helpers for the four severity levels.
 * Use `show(message, type, duration)` for full control, or the named
 * shortcuts (`success`, `error`, `warning`, `info`).
 */
export function useToast() {
  /**
   * Push a toast onto the queue and auto-dismiss after `duration` ms.
   * @param {string} message   Text shown to the user.
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   * @param {number} [duration=3000] Pass 0 to keep the toast until removed manually.
   * @returns {number} the toast id (useful for early manual dismissal).
   */
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

  /** Remove a toast immediately by id (no-op if it was already dismissed). */
  function remove(id) {
    const index = toasts.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.splice(index, 1)
    }
  }

  // Convenience wrappers — pass-through to `show` with a fixed `type`.
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
    showToast: show, // legacy alias for older call sites
    remove,
    success,
    error,
    warning,
    info
  }
}
