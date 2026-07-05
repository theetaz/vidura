create extension if not exists pgcrypto;

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  youtube_url text not null,
  title text not null,
  channel_title text,
  thumbnail_url text,
  duration_ms integer,
  source_language text,
  target_language text not null default 'si-LK',
  status text not null default 'queued'
    check (status in ('queued', 'fetching_transcript', 'translating', 'ready', 'failed')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, youtube_video_id)
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  kind text not null default 'process_video'
    check (kind in ('process_video', 'translate_segments', 'embed_segments')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  segment_index integer not null,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  source_language text not null,
  text text not null,
  normalized_text text,
  created_at timestamptz not null default now(),
  unique (video_id, segment_index)
);

create table public.translated_segments (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.transcript_segments(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  language_code text not null default 'si-LK',
  text text not null,
  model text not null,
  version integer not null default 1,
  quality_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (segment_id, language_code, version)
);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  cited_segment_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index videos_owner_status_created_idx
  on public.videos (owner_id, status, created_at desc);

create index processing_jobs_owner_video_created_idx
  on public.processing_jobs (owner_id, video_id, created_at desc);

create index processing_jobs_status_created_idx
  on public.processing_jobs (status, created_at)
  where status in ('queued', 'running');

create index transcript_segments_video_time_idx
  on public.transcript_segments (video_id, start_ms, end_ms);

create index translated_segments_video_lang_idx
  on public.translated_segments (video_id, language_code, version);

create index chat_threads_owner_video_created_idx
  on public.chat_threads (owner_id, video_id, created_at desc);

create index chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_videos_updated_at
before update on public.videos
for each row execute function public.set_updated_at();

create trigger set_processing_jobs_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

create trigger set_chat_threads_updated_at
before update on public.chat_threads
for each row execute function public.set_updated_at();

alter table public.videos enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.translated_segments enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy "users can read own videos"
on public.videos
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can create own videos"
on public.videos
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "users can update own videos"
on public.videos
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "users can delete own videos"
on public.videos
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can read own processing jobs"
on public.processing_jobs
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can create own processing jobs"
on public.processing_jobs
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "users can read transcript segments for own videos"
on public.transcript_segments
for select
to authenticated
using (
  exists (
    select 1
    from public.videos
    where videos.id = transcript_segments.video_id
      and videos.owner_id = (select auth.uid())
  )
);

create policy "users can read translated segments for own videos"
on public.translated_segments
for select
to authenticated
using (
  exists (
    select 1
    from public.videos
    where videos.id = translated_segments.video_id
      and videos.owner_id = (select auth.uid())
  )
);

create policy "users can read own chat threads"
on public.chat_threads
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can create own chat threads"
on public.chat_threads
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "users can update own chat threads"
on public.chat_threads
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "users can delete own chat threads"
on public.chat_threads
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can read own chat messages"
on public.chat_messages
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "users can create own chat messages"
on public.chat_messages
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.videos to authenticated;
grant select, insert on public.processing_jobs to authenticated;
grant select on public.transcript_segments to authenticated;
grant select on public.translated_segments to authenticated;
grant select, insert, update, delete on public.chat_threads to authenticated;
grant select, insert on public.chat_messages to authenticated;
