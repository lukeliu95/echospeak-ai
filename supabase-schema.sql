-- EchoSpeak AI · Supabase schema (single-user / anonymous desktop app).
-- Run this in the Supabase SQL editor before switching the app's data backend to
-- Supabase (Settings → 数据后端). Mirrors the 5 tables of
-- docs/design/review/data-model.json plus an app_settings key/value row.
--
-- NOTE: not yet exercised against a live project. Column types chosen to match the
-- TypeScript row shapes in electron/storage/types.ts (jsonb for nested JSON).

create table if not exists user_profile (
  id text primary key,
  native_language text not null default 'zh-CN',
  target_language text not null default 'en',
  listening_level text not null,
  speaking_level text not null,
  daily_practice_minutes int not null,
  priority jsonb not null,
  interests jsonb not null,
  business_scenarios jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists practice_session (
  id text primary key,
  user_id text not null,
  date text not null,
  planned_minutes int not null,
  actual_minutes int not null,
  speaking_minutes int not null,
  listening_minutes int not null,
  completed boolean not null,
  topic text,
  mode text not null,
  summary text,
  created_at timestamptz not null
);
create index if not exists idx_session_user on practice_session(user_id);

create table if not exists utterance (
  id text primary key,
  session_id text not null,
  type text not null,
  prompt_text text not null,
  user_transcript text,
  improved_text text,
  audio_path text,
  score_pronunciation int,
  score_fluency int,
  score_completeness int,
  score_naturalness int,
  score_confidence int,
  feedback text,
  created_at timestamptz not null
);
create index if not exists idx_utterance_session on utterance(session_id);

create table if not exists mistake (
  id text primary key,
  user_id text not null,
  utterance_id text not null,
  category text not null,
  original text not null,
  correction text not null,
  explanation text,
  review_count int not null default 0,
  mastered boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists idx_mistake_user on mistake(user_id);

create table if not exists sentence_pattern (
  id text primary key,
  pattern text not null,
  meaning_zh text,
  examples jsonb not null,
  level text not null,
  scenario text,
  user_mastery_score int not null default 0
);

create table if not exists app_settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);

-- DEV trust model: this is a personal single-user app with no auth. Either leave
-- RLS disabled (default) for a private project, or enable RLS + a permissive policy
-- for the anon role. Example permissive setup (uncomment to use):
--
-- alter table user_profile enable row level security;
-- create policy anon_all on user_profile for all to anon using (true) with check (true);
-- (repeat per table)
