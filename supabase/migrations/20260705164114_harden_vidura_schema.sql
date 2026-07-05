alter function public.set_updated_at()
set search_path = public, pg_temp;

create index if not exists processing_jobs_video_id_idx
  on public.processing_jobs (video_id);

create index if not exists chat_threads_video_id_idx
  on public.chat_threads (video_id);

create index if not exists chat_messages_owner_id_idx
  on public.chat_messages (owner_id);
