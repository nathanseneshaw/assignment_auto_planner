-- Courses & assignments synced from Canvas / Blackboard / extension / manual add
-- Run via Supabase CLI or SQL editor after linking the project.

CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  source text NOT NULL CHECK (source IN ('canvas', 'blackboard', 'extension', 'manual')),

  course_name text NOT NULL,
  professor_name text,
  code text,
  term text,

  external_course_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per LMS course per user (when we have an external id)
CREATE UNIQUE INDEX courses_user_source_external_uidx
  ON public.courses (user_id, source, external_course_id)
  WHERE external_course_id IS NOT NULL;

CREATE INDEX courses_user_id_idx ON public.courses (user_id);

CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses (id) ON DELETE CASCADE,

  assignment_name text NOT NULL,
  due_at timestamptz NOT NULL,
  description text,

  import_source text CHECK (import_source IS NULL OR import_source IN ('canvas', 'blackboard', 'extension')),

  external_assignment_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX assignments_user_external_uidx
  ON public.assignments (user_id, external_assignment_id)
  WHERE external_assignment_id IS NOT NULL;

CREATE INDEX assignments_user_id_idx ON public.assignments (user_id);
CREATE INDEX assignments_course_id_idx ON public.assignments (course_id);
CREATE INDEX assignments_due_idx ON public.assignments (user_id, due_at);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY courses_select_own ON public.courses FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY courses_insert_own ON public.courses FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY courses_update_own ON public.courses FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY courses_delete_own ON public.courses FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY assignments_select_own ON public.assignments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY assignments_insert_own ON public.assignments FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY assignments_update_own ON public.assignments FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY assignments_delete_own ON public.assignments FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.courses IS 'Imported or manually added courses; source = LMS origin.';
COMMENT ON TABLE public.assignments IS 'Imported or manually added assignments linked to courses.';
