-- Pillar A — visible archive lifecycle for ICS assignments.
--
-- The ICS writer (ics-supabase-writer.writeOccurrences) never deletes, so an
-- assignment a professor removes after its due date already persists. What was
-- missing is a first-class, *visible* state for "this is no longer in your
-- calendar feed". `feed_status` provides it:
--   'live'     — present in the most recent successful sync of its feed.
--   'archived' — vanished from the feed; kept for the student's record (and its
--                completion still counts toward the semester total), but hidden
--                from active/upcoming lists in the UI.
--
-- The writer sets 'archived' for feed-owned rows missing from a sync (guarded so
-- a broken/login-walled feed can't mass-archive) and flips a row back to 'live'
-- if it reappears. `archived_at` records when it left the feed.
--
-- Feature-detected by the writer (selectAssignments) so a deploy that lands
-- before this migration keeps syncing; the archive sweep simply no-ops until the
-- columns exist.

alter table public.assignments
  add column if not exists feed_status text not null default 'live',
  add column if not exists archived_at timestamptz;

-- Supports the per-feed sweep scan (user_id + feed_id + feed_status).
create index if not exists assignments_feed_status_idx
  on public.assignments (user_id, feed_id, feed_status);
