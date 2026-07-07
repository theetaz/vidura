-- Per-user chat assistant configuration: language, persona, memory and
-- retrieval depth. One row per user, created lazily on first save.

create table public.user_chat_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
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

alter table public.user_chat_settings enable row level security;

create policy "user_chat_settings_select_own" on public.user_chat_settings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "user_chat_settings_insert_own" on public.user_chat_settings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "user_chat_settings_update_own" on public.user_chat_settings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create trigger set_user_chat_settings_updated_at
before update on public.user_chat_settings
for each row execute function public.set_updated_at();
