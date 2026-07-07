-- Vidura application schema for the self-hosted backend.
--
-- Differences from the Supabase version:
--   * owner_id references better-auth's "user"(id) (text), not auth.users.
--   * No RLS — ownership is enforced in the API layer.
--   * Row changes emit NOTIFY 'vidura_changes' for the SSE realtime layer.
--
-- better-auth owns the user/session/account/verification tables (created by
-- its CLI migrate). This file must be applied AFTER those exist.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public."user"(id) on delete cascade,
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

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public."user"(id) on delete cascade,
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

create table if not exists public.transcript_segments (
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

create table if not exists public.translated_segments (
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

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public."user"(id) on delete cascade,
  video_id uuid references public.videos(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  owner_id text not null references public."user"(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  cited_segment_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.video_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public."user"(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  timestamp_ms integer not null default 0 check (timestamp_ms >= 0),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_chat_settings (
  owner_id text primary key references public."user"(id) on delete cascade,
  response_language text not null default 'auto'
    check (response_language in ('auto', 'si', 'en', 'singlish')),
  answer_style text not null default 'balanced'
    check (answer_style in ('concise', 'balanced', 'detailed')),
  custom_instructions text not null default '',
  memory_depth text not null default 'medium'
    check (memory_depth in ('short', 'medium', 'long')),
  retrieval_depth text not null default 'standard'
    check (retrieval_depth in ('focused', 'standard', 'broad')),
  creativity text not null default 'balanced'
    check (creativity in ('focused', 'balanced', 'creative')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_owner_status_created_idx
  on public.videos (owner_id, status, created_at desc);
create index if not exists processing_jobs_owner_video_created_idx
  on public.processing_jobs (owner_id, video_id, created_at desc);
create index if not exists processing_jobs_status_created_idx
  on public.processing_jobs (status, created_at) where status in ('queued', 'running');
create index if not exists transcript_segments_video_time_idx
  on public.transcript_segments (video_id, start_ms, end_ms);
create index if not exists transcript_segments_normalized_text_trgm_idx
  on public.transcript_segments using gin (normalized_text gin_trgm_ops);
create index if not exists translated_segments_video_lang_idx
  on public.translated_segments (video_id, language_code, version);
create index if not exists chat_threads_owner_video_created_idx
  on public.chat_threads (owner_id, video_id, created_at desc);
create index if not exists chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at);
create index if not exists video_notes_owner_video_time_idx
  on public.video_notes (owner_id, video_id, timestamp_ms);
create index if not exists video_notes_content_trgm_idx
  on public.video_notes using gin (lower(content) gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Emit a compact change event for the SSE realtime layer. Payload carries the
-- table, the owner (for scoping to the right user) and the affected video.
create or replace function public.notify_vidura_change()
returns trigger language plpgsql as $$
declare
  row_data jsonb;
  owner text;
  vid text;
begin
  row_data := to_jsonb(coalesce(new, old));
  owner := row_data->>'owner_id';
  vid := coalesce(row_data->>'video_id', row_data->>'id');
  -- transcript/translated segments have no owner_id; resolve it via the video
  -- so events can be scoped to the right user.
  if owner is null and vid is not null then
    select owner_id into owner from public.videos where id = vid::uuid;
  end if;
  perform pg_notify(
    'vidura_changes',
    json_build_object(
      'table', tg_table_name,
      'op', tg_op,
      'owner_id', owner,
      'video_id', vid
    )::text
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
  updated_tables text[] := array[
    'videos', 'processing_jobs', 'chat_threads', 'video_notes',
    'user_chat_settings'
  ];
  notify_tables text[] := array[
    'videos', 'processing_jobs', 'transcript_segments', 'translated_segments',
    'chat_threads', 'chat_messages', 'video_notes'
  ];
begin
  foreach t in array updated_tables loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$s', t);
    execute format(
      'create trigger set_%1$s_updated_at before update on public.%1$s
       for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array notify_tables loop
    execute format('drop trigger if exists notify_%1$s_change on public.%1$s', t);
    execute format(
      'create trigger notify_%1$s_change after insert or update or delete
       on public.%1$s for each row execute function public.notify_vidura_change()', t);
  end loop;
end;
$$;
