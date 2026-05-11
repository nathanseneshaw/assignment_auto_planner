-- ICS calendar feed support.
-- Adds the ics_feeds table, widens source/import_source CHECKs to include 'ics',
-- and adds traceability columns to courses and assignments.

-- 1. ics_feeds table
CREATE TABLE public.ics_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  url text NOT NULL,
  label text,

  last_synced_at timestamptz,
  last_sync_status text CHECK (last_sync_status IN ('pending', 'success', 'error')) DEFAULT 'pending',
  last_sync_error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ics_feeds_user_url_uidx ON public.ics_feeds (user_id, url);
CREATE INDEX ics_feeds_user_id_idx ON public.ics_feeds (user_id);

ALTER TABLE public.ics_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY ics_feeds_select_own ON public.ics_feeds FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY ics_feeds_insert_own ON public.ics_feeds FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY ics_feeds_update_own ON public.ics_feeds FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY ics_feeds_delete_own ON public.ics_feeds FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.ics_feeds IS 'User-provided ICS calendar URLs (LMS / Google Calendar / etc.).';

-- 2. Widen the source / import_source CHECK constraints to allow 'ics'.
-- The original constraints were inline, so Postgres auto-named them.
-- Drop by exact name when present; create the widened versions.
DO $$
DECLARE
  cn text;
BEGIN
  -- courses.source
  FOR cn IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%canvas%blackboard%'
  LOOP
    EXECUTE format('ALTER TABLE public.courses DROP CONSTRAINT %I', cn);
  END LOOP;

  -- assignments.import_source
  FOR cn IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%import_source%canvas%blackboard%'
  LOOP
    EXECUTE format('ALTER TABLE public.assignments DROP CONSTRAINT %I', cn);
  END LOOP;
END $$;

ALTER TABLE public.courses
  ADD CONSTRAINT courses_source_check
  CHECK (source IN ('canvas', 'blackboard', 'extension', 'manual', 'ics'));

ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_import_source_check
  CHECK (import_source IS NULL OR import_source IN ('canvas', 'blackboard', 'extension', 'ics'));

-- 3. Traceability columns.
-- feed_id ON DELETE SET NULL preserves history when a user removes a feed.
ALTER TABLE public.courses
  ADD COLUMN feed_id uuid REFERENCES public.ics_feeds (id) ON DELETE SET NULL;

ALTER TABLE public.assignments
  ADD COLUMN feed_id uuid REFERENCES public.ics_feeds (id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN source_url text;

CREATE INDEX assignments_feed_id_idx ON public.assignments (feed_id);
CREATE INDEX courses_feed_id_idx ON public.courses (feed_id);
