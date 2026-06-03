-- Adds a content fingerprint to ics_feeds so the sync endpoint can skip ALL
-- parsing + database writes when a feed body is byte-identical to the previous
-- sync. The server feature-detects this column: if it is absent, sync still
-- works (it just always writes), so applying this migration is optional but
-- recommended — it removes the per-tick course/assignment selects on unchanged
-- feeds, which is the common case for a 30-minute auto-sync.
--
-- Apply via the Supabase SQL editor (Dashboard → SQL) or `supabase db push`.

alter table public.ics_feeds
  add column if not exists content_hash text;

comment on column public.ics_feeds.content_hash is
  'sha256 hex of the last successfully-synced raw ICS body. When the freshly '
  'fetched body hashes to this value, the sync is a no-op (skips parse + writes).';
