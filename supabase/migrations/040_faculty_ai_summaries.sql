-- Migration 040: Cached AI executive summaries per faculty, period, and subject.
-- Allows automatic, instant loading for faculty without re-calling the LLM on every visit.

create table if not exists public.faculty_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.users(id) on delete cascade,
  academic_year text not null,
  semester text not null,
  subject_code text not null default '',
  summary text not null,
  comment_count integer not null default 0,
  small_sample boolean not null default false,
  caveat text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faculty_ai_summaries_unique unique (faculty_id, academic_year, semester, subject_code)
);

create index if not exists idx_faculty_ai_summaries_lookup
  on public.faculty_ai_summaries (faculty_id, academic_year, semester, subject_code);

alter table public.faculty_ai_summaries enable row level security;

-- Faculty can read their own cached summaries
drop policy if exists "Faculty can read own AI summaries" on public.faculty_ai_summaries;
create policy "Faculty can read own AI summaries"
  on public.faculty_ai_summaries
  for select
  to authenticated
  using (
    auth.uid() = faculty_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin')
    )
  );
