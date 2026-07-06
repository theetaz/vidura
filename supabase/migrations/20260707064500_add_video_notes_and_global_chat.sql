-- Timestamped user notes on videos, indexed for chat retrieval, and support
-- for a library-wide chat thread that is not tied to a single video.

create extension if not exists pg_trgm;

-- The library-wide chat thread has no video.
alter table public.chat_threads alter column video_id drop not null;

create table public.video_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  timestamp_ms integer not null default 0 check (timestamp_ms >= 0),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index video_notes_owner_video_time_idx
  on public.video_notes (owner_id, video_id, timestamp_ms);

-- Trigram indexes so chat retrieval can keyword-match transcripts and notes.
create index transcript_segments_normalized_text_trgm_idx
  on public.transcript_segments using gin (normalized_text gin_trgm_ops);

create index video_notes_content_trgm_idx
  on public.video_notes using gin (lower(content) gin_trgm_ops);

alter table public.video_notes enable row level security;

create policy "video_notes_select_own" on public.video_notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "video_notes_insert_own" on public.video_notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "video_notes_update_own" on public.video_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "video_notes_delete_own" on public.video_notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

create trigger set_video_notes_updated_at
before update on public.video_notes
for each row execute function public.set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.video_notes;
exception
  when duplicate_object then null;
end;
$$;
