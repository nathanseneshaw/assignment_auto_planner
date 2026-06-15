-- Enables Supabase Realtime for the per-user sync tables so an edit in one open
-- instance (desktop, web, second window) shows up live in the others, instead of
-- only after a restart.
--
-- Two things are needed for `postgres_changes` to work the way the client
-- (src/composables/useSupabaseRealtimeSync.js) expects:
--
--   1. The tables must belong to the `supabase_realtime` publication. Until then,
--      no change events are emitted at all and the app silently falls back to its
--      old on-boot/on-sync hydration (so applying this is required for live sync,
--      but its absence is not fatal).
--
--   2. `replica identity full` — the default replica identity only includes the
--      primary key in UPDATE/DELETE change records. The client filters events by
--      `user_id=eq.<id>` (which RLS also evaluates against the old row), so the
--      old record must carry `user_id`. Without this, UPDATE/DELETE events for a
--      user would be dropped and deletes/edits made elsewhere wouldn't propagate.
--
-- Idempotent: safe to run more than once. Apply via the Supabase SQL editor
-- (Dashboard → SQL) or `supabase db push`.

do $$
declare
  t text;
begin
  foreach t in array array['courses', 'assignments', 'tasks'] loop
    -- Add to the realtime publication only if it isn't already a member
    -- (ALTER PUBLICATION ... ADD TABLE errors on a duplicate).
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;

    -- Emit the full old row on UPDATE/DELETE so filters + RLS can see user_id.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
