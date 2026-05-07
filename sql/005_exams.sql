-- =============================================================================
-- AutoExam.ai — exams + exam_questions + ai_generated flag
-- Run after 004_text_materials_question_bank.sql.
-- Idempotent.
-- =============================================================================

-- 1) Mark which question bank rows came from AI for analytics.
alter table public.question_bank
  add column if not exists ai_generated boolean not null default false;

create index if not exists question_bank_ai_idx on public.question_bank(ai_generated);

-- 2) Exams.
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  description text,
  duration_minutes int not null default 60,
  total_marks numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exams_created_by_idx on public.exams(created_by);
create index if not exists exams_category_idx on public.exams(category_id);
create index if not exists exams_created_at_idx on public.exams(created_at desc);

alter table public.exams enable row level security;

drop policy if exists "exams_owner_select" on public.exams;
drop policy if exists "exams_owner_insert" on public.exams;
drop policy if exists "exams_owner_update" on public.exams;
drop policy if exists "exams_owner_delete" on public.exams;

create policy "exams_owner_select" on public.exams
  for select using (auth.uid() = created_by);
create policy "exams_owner_insert" on public.exams
  for insert with check (auth.uid() = created_by);
create policy "exams_owner_update" on public.exams
  for update using (auth.uid() = created_by);
create policy "exams_owner_delete" on public.exams
  for delete using (auth.uid() = created_by);

-- 3) Exam ↔ question link table.
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (exam_id, question_id)
);

create index if not exists exam_questions_exam_idx on public.exam_questions(exam_id);
create index if not exists exam_questions_question_idx on public.exam_questions(question_id);

alter table public.exam_questions enable row level security;

drop policy if exists "exam_questions_owner_select" on public.exam_questions;
drop policy if exists "exam_questions_owner_insert" on public.exam_questions;
drop policy if exists "exam_questions_owner_delete" on public.exam_questions;

-- Owner = owner of the parent exam. Inline EXISTS keeps the policy simple.
create policy "exam_questions_owner_select" on public.exam_questions
  for select using (
    exists (select 1 from public.exams e where e.id = exam_questions.exam_id and e.created_by = auth.uid())
  );

create policy "exam_questions_owner_insert" on public.exam_questions
  for insert with check (
    exists (select 1 from public.exams e where e.id = exam_questions.exam_id and e.created_by = auth.uid())
  );

create policy "exam_questions_owner_delete" on public.exam_questions
  for delete using (
    exists (select 1 from public.exams e where e.id = exam_questions.exam_id and e.created_by = auth.uid())
  );

notify pgrst, 'reload schema';
