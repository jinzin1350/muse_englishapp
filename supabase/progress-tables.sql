-- English Learning App: per-user scores & mistakes tables
-- Run this once in Supabase SQL Editor (same place you created profiles).

-- 1) Mistakes each user got wrong (for "My Mistakes" + review quizzes)
create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text,
  level text,
  kind text,
  question text not null,
  options jsonb not null default '[]',
  answer int not null,
  picked int,
  created_at timestamptz not null default now()
);
create index if not exists mistakes_user_idx
  on public.mistakes (user_id, created_at desc);

-- 2) Quiz attempts per user (for "My Scores")
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text,
  level text,
  theme text,
  kind text,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_idx
  on public.quiz_attempts (user_id, created_at desc);

-- 3) Row Level Security: each user sees only their own rows
alter table public.mistakes enable row level security;
alter table public.quiz_attempts enable row level security;

drop policy if exists "users own mistakes" on public.mistakes;
create policy "users own mistakes" on public.mistakes
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users own attempts" on public.quiz_attempts;
create policy "users own attempts" on public.quiz_attempts
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4) Admin (you) can read everything, same pattern as profiles
drop policy if exists "admin full access" on public.mistakes;
create policy "admin full access" on public.mistakes
  for all using (auth.jwt() ->> 'email' = 'engi.alireza@gmail.com');

drop policy if exists "admin full access" on public.quiz_attempts;
create policy "admin full access" on public.quiz_attempts
  for all using (auth.jwt() ->> 'email' = 'engi.alireza@gmail.com');
