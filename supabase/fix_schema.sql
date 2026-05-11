-- fix_schema.sql
-- Run this in the Supabase SQL Editor to bring the database up to the schema
-- the app expects. Every statement is idempotent (safe to re-run).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ics_feeds table (create if it doesn't exist yet)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ics_feeds (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  url              text        NOT NULL,
  label            text,
  last_synced_at   timestamptz,
  last_sync_status text        CHECK (last_sync_status IN ('pending', 'success', 'error')) DEFAULT 'pending',
  last_sync_error  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ics_feeds_user_url_uidx ON public.ics_feeds (user_id, url);
CREATE        INDEX IF NOT EXISTS ics_feeds_user_id_idx   ON public.ics_feeds (user_id);

ALTER TABLE public.ics_feeds ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ics_feeds' AND policyname = 'ics_feeds_select_own') THEN
    CREATE POLICY ics_feeds_select_own ON public.ics_feeds FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ics_feeds' AND policyname = 'ics_feeds_insert_own') THEN
    CREATE POLICY ics_feeds_insert_own ON public.ics_feeds FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ics_feeds' AND policyname = 'ics_feeds_update_own') THEN
    CREATE POLICY ics_feeds_update_own ON public.ics_feeds FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ics_feeds' AND policyname = 'ics_feeds_delete_own') THEN
    CREATE POLICY ics_feeds_delete_own ON public.ics_feeds FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. courses — add missing columns
-- ────────────────────────────────────────────────────────────────────────────

-- source column (NOT NULL, needs a default for pre-existing rows)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'courses' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.courses ADD COLUMN source text;
    UPDATE public.courses SET source = 'manual' WHERE source IS NULL;
    ALTER TABLE public.courses ALTER COLUMN source SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS external_course_id text,
  ADD COLUMN IF NOT EXISTS feed_id            uuid REFERENCES public.ics_feeds (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS courses_user_source_external_uidx
  ON public.courses (user_id, source, external_course_id)
  WHERE external_course_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. assignments — add missing columns
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS external_assignment_id text,
  ADD COLUMN IF NOT EXISTS import_source          text,
  ADD COLUMN IF NOT EXISTS feed_id                uuid REFERENCES public.ics_feeds (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_seen_at           timestamptz,
  ADD COLUMN IF NOT EXISTS source_url             text;

CREATE UNIQUE INDEX IF NOT EXISTS assignments_user_external_uidx
  ON public.assignments (user_id, external_assignment_id)
  WHERE external_assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assignments_feed_id_idx ON public.assignments (feed_id);
CREATE INDEX IF NOT EXISTS courses_feed_id_idx     ON public.courses     (feed_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Widen CHECK constraints to allow 'ics'
-- ────────────────────────────────────────────────────────────────────────────

-- courses.source
DO $$ DECLARE cn text; BEGIN
  -- Drop any existing constraint that doesn't already include 'ics'
  FOR cn IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%ics%'
  LOOP
    EXECUTE format('ALTER TABLE public.courses DROP CONSTRAINT %I', cn);
  END LOOP;
  -- Add widened constraint only if none covering 'ics' exists yet
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.courses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ics%'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
  ) THEN
    ALTER TABLE public.courses ADD CONSTRAINT courses_source_check
      CHECK (source IN ('canvas', 'blackboard', 'extension', 'manual', 'ics'));
  END IF;
END $$;

-- assignments.import_source
DO $$ DECLARE cn text; BEGIN
  FOR cn IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%import_source%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%ics%'
  LOOP
    EXECUTE format('ALTER TABLE public.assignments DROP CONSTRAINT %I', cn);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%import_source%'
      AND pg_get_constraintdef(oid) ILIKE '%ics%'
  ) THEN
    ALTER TABLE public.assignments ADD CONSTRAINT assignments_import_source_check
      CHECK (import_source IS NULL OR import_source IN ('canvas', 'blackboard', 'extension', 'ics'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS on courses and assignments
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.courses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'courses_select_own') THEN
    CREATE POLICY courses_select_own ON public.courses FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'courses_insert_own') THEN
    CREATE POLICY courses_insert_own ON public.courses FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'courses_update_own') THEN
    CREATE POLICY courses_update_own ON public.courses FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'courses_delete_own') THEN
    CREATE POLICY courses_delete_own ON public.courses FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assignments' AND policyname = 'assignments_select_own') THEN
    CREATE POLICY assignments_select_own ON public.assignments FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assignments' AND policyname = 'assignments_insert_own') THEN
    CREATE POLICY assignments_insert_own ON public.assignments FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assignments' AND policyname = 'assignments_update_own') THEN
    CREATE POLICY assignments_update_own ON public.assignments FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assignments' AND policyname = 'assignments_delete_own') THEN
    CREATE POLICY assignments_delete_own ON public.assignments FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Grant permissions to the authenticated role
-- ────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ics_feeds    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments   TO authenticated;
