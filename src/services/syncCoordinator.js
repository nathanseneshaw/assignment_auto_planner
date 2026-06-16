/**
 * Tiny cross-composable coordinator for Supabase sync.
 *
 * `useSupabaseRealtimeSync` re-hydrates Pinia from Supabase whenever another
 * device/instance changes the signed-in user's rows. That hydration replaces the
 * local store arrays, which would normally trip the deep watchers in
 * `useSupabaseStoreSync` and schedule a full upsert back to Supabase — and that
 * write would echo back over Realtime as another change event, producing an
 * endless flush ⇄ hydrate ping-pong between the two instances.
 *
 * To break the loop, the realtime layer brackets its hydration with
 * `beginRemoteApply()` / `endRemoteApply()`; the store-sync watchers skip
 * scheduling a flush while a remote apply is in progress. It is reference-counted
 * so overlapping applies (a debounced hydrate firing while another is settling)
 * never clear the flag early.
 */
let remoteApplyDepth = 0

/** Enter a remote-apply section. Pair every call with {@link endRemoteApply}. */
export function beginRemoteApply() {
  remoteApplyDepth += 1
}

/** Leave a remote-apply section. Clamped at zero so it can't go negative. */
export function endRemoteApply() {
  remoteApplyDepth = Math.max(0, remoteApplyDepth - 1)
}

/** True while a Supabase→Pinia hydration triggered by a remote change is running. */
export function isApplyingRemote() {
  return remoteApplyDepth > 0
}
