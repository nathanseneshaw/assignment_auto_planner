-- Pillar C — durable assignment completion.
--
-- Until now, completion state lived only in local Pinia memory: every ICS sync
-- re-hydrated assignments via lmsSupabaseHydration.mapAssignmentRow, which hard
-- reset each row to status='pending' / progress=0. That made the Dashboard
-- "completed this semester" counter (DashboardPage.vue) ephemeral — a completion
-- vanished on the next 30-minute auto-sync.
--
-- Persisting status / progress / completed_at lets completion survive re-sync
-- (and, later, feed archival), so a student keeps proof they finished an
-- assignment even after the professor deletes it from the calendar feed.
--
-- The ICS writer (ics-supabase-writer.writeOccurrences) never writes these
-- columns, so a re-sync can never clobber a completion. The client persist path
-- (lmsSupabaseSync.persistAssignmentToSupabase) feature-detects them and degrades
-- gracefully if this migration has not been applied yet.

alter table public.assignments
  add column if not exists status text not null default 'pending',
  add column if not exists progress integer not null default 0,
  add column if not exists completed_at timestamptz;

-- Speeds up the "completed this semester" style scans (user_id + status).
create index if not exists assignments_user_status_idx
  on public.assignments (user_id, status);
