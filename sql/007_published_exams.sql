-- =============================================================================
-- AutoExam.ai — Publishing + Student Submissions
-- Run after 006_exams_metadata.sql.
-- Idempotent + defensive (heals partially-migrated tables, never destroys data).
--
-- New tables:
--   public.published_exams        scheduled instance of an `exams` template
--   public.exam_submissions       a student's attempt of a published_exam
--   public.submission_answers     graded answer rows (created on submit)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) published_exams
-- ---------------------------------------------------------------------------
create table if not exists public.published_exams (
  id uuid primary key default gen_random_uuid()
);

alter table public.published_exams add column if not exists generated_exam_id uuid;
alter table public.published_exams add column if not exists title text;
alter table public.published_exams add column if not exists description text;
alter table public.published_exams add column if not exists category_id uuid;
alter table public.published_exams add column if not exists published_by uuid;
alter table public.published_exams add column if not exists start_time timestamptz;
alter table public.published_exams add column if not exists end_time timestamptz;
alter table public.published_exams add column if not exists duration_minutes int;
alter table public.published_exams add column if not exists total_questions int;
alter table public.published_exams add column if not exists total_marks numeric;
alter table public.published_exams add column if not exists is_active boolean;
alter table public.published_exams add column if not exists allow_one_attempt boolean;
alter table public.published_exams add column if not exists shuffle_questions boolean;
alter table public.published_exams add column if not exists auto_submit_on_timeout boolean;
alter table public.published_exams add column if not exists show_results_immediately boolean;
alter table public.published_exams add column if not exists created_at timestamptz;
alter table public.published_exams add column if not exists updated_at timestamptz;

alter table public.published_exams
  alter column duration_minutes         set default 60,
  alter column total_questions          set default 0,
  alter column total_marks              set default 0,
  alter column is_active                set default true,
  alter column allow_one_attempt        set default true,
  alter column shuffle_questions        set default false,
  alter column auto_submit_on_timeout   set default true,
  alter column show_results_immediately set default false,
  alter column created_at               set default now(),
  alter column updated_at               set default now();

update public.published_exams set duration_minutes         = 60    where duration_minutes         is null;
update public.published_exams set total_questions          = 0     where total_questions          is null;
update public.published_exams set total_marks              = 0     where total_marks              is null;
update public.published_exams set is_active                = true  where is_active                is null;
update public.published_exams set allow_one_attempt        = true  where allow_one_attempt        is null;
update public.published_exams set shuffle_questions        = false where shuffle_questions        is null;
update public.published_exams set auto_submit_on_timeout   = true  where auto_submit_on_timeout   is null;
update public.published_exams set show_results_immediately = false where show_results_immediately is null;
update public.published_exams set created_at = now() where created_at is null;
update public.published_exams set updated_at = now() where updated_at is null;
update public.published_exams set title      = '(untitled)' where title is null;

alter table public.published_exams alter column title                    set not null;
alter table public.published_exams alter column duration_minutes         set not null;
alter table public.published_exams alter column total_questions          set not null;
alter table public.published_exams alter column total_marks              set not null;
alter table public.published_exams alter column is_active                set not null;
alter table public.published_exams alter column allow_one_attempt        set not null;
alter table public.published_exams alter column shuffle_questions        set not null;
alter table public.published_exams alter column auto_submit_on_timeout   set not null;
alter table public.published_exams alter column show_results_immediately set not null;
alter table public.published_exams alter column created_at               set not null;
alter table public.published_exams alter column updated_at               set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'published_exams_generated_exam_fkey' and conrelid = 'public.published_exams'::regclass
  ) then
    alter table public.published_exams
      add constraint published_exams_generated_exam_fkey
      foreign key (generated_exam_id) references public.exams(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'published_exams_published_by_fkey' and conrelid = 'public.published_exams'::regclass
  ) then
    alter table public.published_exams
      add constraint published_exams_published_by_fkey
      foreign key (published_by) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'published_exams_category_fkey' and conrelid = 'public.published_exams'::regclass
  ) then
    alter table public.published_exams
      add constraint published_exams_category_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end $$;

create index if not exists published_exams_active_idx     on public.published_exams(is_active);
create index if not exists published_exams_category_idx   on public.published_exams(category_id);
create index if not exists published_exams_publisher_idx  on public.published_exams(published_by);
create index if not exists published_exams_window_idx     on public.published_exams(start_time, end_time);

alter table public.published_exams enable row level security;

drop policy if exists "published_exams_owner_select"      on public.published_exams;
drop policy if exists "published_exams_owner_insert"      on public.published_exams;
drop policy if exists "published_exams_owner_update"      on public.published_exams;
drop policy if exists "published_exams_owner_delete"      on public.published_exams;
drop policy if exists "published_exams_student_read_active" on public.published_exams;

create policy "published_exams_owner_select" on public.published_exams
  for select using (auth.uid() = published_by);
create policy "published_exams_owner_insert" on public.published_exams
  for insert with check (auth.uid() = published_by);
create policy "published_exams_owner_update" on public.published_exams
  for update using (auth.uid() = published_by);
create policy "published_exams_owner_delete" on public.published_exams
  for delete using (auth.uid() = published_by);

-- Any authenticated user (i.e. students) can SELECT active published exams.
-- Postgres OR's all SELECT policies, so this composes with the owner rule.
create policy "published_exams_student_read_active" on public.published_exams
  for select using (auth.uid() is not null and is_active = true);

-- ---------------------------------------------------------------------------
-- 2) exam_submissions
-- ---------------------------------------------------------------------------
create table if not exists public.exam_submissions (
  id uuid primary key default gen_random_uuid()
);

alter table public.exam_submissions add column if not exists published_exam_id uuid;
alter table public.exam_submissions add column if not exists student_id uuid;
alter table public.exam_submissions add column if not exists status text;
alter table public.exam_submissions add column if not exists started_at timestamptz;
alter table public.exam_submissions add column if not exists submitted_at timestamptz;
alter table public.exam_submissions add column if not exists time_taken_seconds int;
alter table public.exam_submissions add column if not exists total_score numeric;
alter table public.exam_submissions add column if not exists max_score numeric;
alter table public.exam_submissions add column if not exists answers_data jsonb;
alter table public.exam_submissions add column if not exists last_saved_at timestamptz;
alter table public.exam_submissions add column if not exists teacher_remarks text;
alter table public.exam_submissions add column if not exists created_at timestamptz;
alter table public.exam_submissions add column if not exists updated_at timestamptz;

alter table public.exam_submissions
  alter column status        set default 'in_progress',
  alter column started_at    set default now(),
  alter column answers_data  set default '{}'::jsonb,
  alter column last_saved_at set default now(),
  alter column total_score   set default 0,
  alter column max_score     set default 0,
  alter column created_at    set default now(),
  alter column updated_at    set default now();

update public.exam_submissions set status        = 'in_progress' where status is null;
update public.exam_submissions set started_at    = now()         where started_at is null;
update public.exam_submissions set answers_data  = '{}'::jsonb   where answers_data is null;
update public.exam_submissions set last_saved_at = now()         where last_saved_at is null;
update public.exam_submissions set total_score   = 0             where total_score is null;
update public.exam_submissions set max_score     = 0             where max_score is null;
update public.exam_submissions set created_at    = now()         where created_at is null;
update public.exam_submissions set updated_at    = now()         where updated_at is null;

alter table public.exam_submissions alter column status        set not null;
alter table public.exam_submissions alter column started_at    set not null;
alter table public.exam_submissions alter column answers_data  set not null;
alter table public.exam_submissions alter column last_saved_at set not null;
alter table public.exam_submissions alter column created_at    set not null;
alter table public.exam_submissions alter column updated_at    set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'exam_submissions_status_check' and conrelid = 'public.exam_submissions'::regclass
  ) then
    alter table public.exam_submissions drop constraint exam_submissions_status_check;
  end if;
end $$;
alter table public.exam_submissions
  add constraint exam_submissions_status_check
  check (status in ('in_progress','submitted','evaluated','late','expired'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exam_submissions_published_fkey' and conrelid = 'public.exam_submissions'::regclass
  ) then
    alter table public.exam_submissions
      add constraint exam_submissions_published_fkey
      foreign key (published_exam_id) references public.published_exams(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'exam_submissions_student_fkey' and conrelid = 'public.exam_submissions'::regclass
  ) then
    alter table public.exam_submissions
      add constraint exam_submissions_student_fkey
      foreign key (student_id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.exam_submissions alter column published_exam_id set not null;
alter table public.exam_submissions alter column student_id        set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exam_submissions_one_per_student' and conrelid = 'public.exam_submissions'::regclass
  ) then
    alter table public.exam_submissions
      add constraint exam_submissions_one_per_student unique (published_exam_id, student_id);
  end if;
end $$;

create index if not exists exam_submissions_student_idx   on public.exam_submissions(student_id);
create index if not exists exam_submissions_published_idx on public.exam_submissions(published_exam_id);
create index if not exists exam_submissions_status_idx    on public.exam_submissions(status);

alter table public.exam_submissions enable row level security;

drop policy if exists "exam_submissions_student_select" on public.exam_submissions;
drop policy if exists "exam_submissions_student_insert" on public.exam_submissions;
drop policy if exists "exam_submissions_student_update" on public.exam_submissions;
drop policy if exists "exam_submissions_teacher_select" on public.exam_submissions;
drop policy if exists "exam_submissions_teacher_update" on public.exam_submissions;

create policy "exam_submissions_student_select" on public.exam_submissions
  for select using (auth.uid() = student_id);
create policy "exam_submissions_student_insert" on public.exam_submissions
  for insert with check (auth.uid() = student_id);
create policy "exam_submissions_student_update" on public.exam_submissions
  for update using (auth.uid() = student_id);

-- Teachers can read/grade submissions for any published exam they own.
create policy "exam_submissions_teacher_select" on public.exam_submissions
  for select using (
    exists (
      select 1 from public.published_exams pe
      where pe.id = exam_submissions.published_exam_id
        and pe.published_by = auth.uid()
    )
  );
create policy "exam_submissions_teacher_update" on public.exam_submissions
  for update using (
    exists (
      select 1 from public.published_exams pe
      where pe.id = exam_submissions.published_exam_id
        and pe.published_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3) submission_answers (created on submit, supports manual grading)
-- ---------------------------------------------------------------------------
create table if not exists public.submission_answers (
  id uuid primary key default gen_random_uuid()
);

alter table public.submission_answers add column if not exists submission_id uuid;
alter table public.submission_answers add column if not exists question_id uuid;
alter table public.submission_answers add column if not exists answer_text text;
alter table public.submission_answers add column if not exists selected_option text;
alter table public.submission_answers add column if not exists is_correct boolean;
alter table public.submission_answers add column if not exists marks_obtained numeric;
alter table public.submission_answers add column if not exists max_marks numeric;
alter table public.submission_answers add column if not exists evaluator_remarks text;
alter table public.submission_answers add column if not exists created_at timestamptz;
alter table public.submission_answers add column if not exists updated_at timestamptz;

alter table public.submission_answers
  alter column max_marks  set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.submission_answers set max_marks  = 0     where max_marks  is null;
update public.submission_answers set created_at = now() where created_at is null;
update public.submission_answers set updated_at = now() where updated_at is null;

alter table public.submission_answers alter column max_marks  set not null;
alter table public.submission_answers alter column created_at set not null;
alter table public.submission_answers alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submission_answers_submission_fkey' and conrelid = 'public.submission_answers'::regclass
  ) then
    alter table public.submission_answers
      add constraint submission_answers_submission_fkey
      foreign key (submission_id) references public.exam_submissions(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'submission_answers_question_fkey' and conrelid = 'public.submission_answers'::regclass
  ) then
    alter table public.submission_answers
      add constraint submission_answers_question_fkey
      foreign key (question_id) references public.question_bank(id) on delete cascade;
  end if;
end $$;

alter table public.submission_answers alter column submission_id set not null;
alter table public.submission_answers alter column question_id   set not null;

create index if not exists submission_answers_submission_idx on public.submission_answers(submission_id);
create index if not exists submission_answers_question_idx   on public.submission_answers(question_id);

alter table public.submission_answers enable row level security;

drop policy if exists "submission_answers_student_select" on public.submission_answers;
drop policy if exists "submission_answers_student_insert" on public.submission_answers;
drop policy if exists "submission_answers_teacher_select" on public.submission_answers;
drop policy if exists "submission_answers_teacher_update" on public.submission_answers;

create policy "submission_answers_student_select" on public.submission_answers
  for select using (
    exists (
      select 1 from public.exam_submissions s
      where s.id = submission_answers.submission_id
        and s.student_id = auth.uid()
    )
  );
create policy "submission_answers_student_insert" on public.submission_answers
  for insert with check (
    exists (
      select 1 from public.exam_submissions s
      where s.id = submission_answers.submission_id
        and s.student_id = auth.uid()
    )
  );
create policy "submission_answers_teacher_select" on public.submission_answers
  for select using (
    exists (
      select 1
        from public.exam_submissions s
        join public.published_exams pe on pe.id = s.published_exam_id
       where s.id = submission_answers.submission_id
         and pe.published_by = auth.uid()
    )
  );
create policy "submission_answers_teacher_update" on public.submission_answers
  for update using (
    exists (
      select 1
        from public.exam_submissions s
        join public.published_exams pe on pe.id = s.published_exam_id
       where s.id = submission_answers.submission_id
         and pe.published_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Cross-table SELECT policies — let students read the exam, its question
--    links, and the question bank rows referenced by an active published exam.
--
--    Postgres composes SELECT policies with OR, so existing teacher-only
--    policies stay valid; we just *add* a student-read path.
-- ---------------------------------------------------------------------------

drop policy if exists "exams_student_read_published" on public.exams;
create policy "exams_student_read_published" on public.exams
  for select using (
    exists (
      select 1 from public.published_exams pe
      where pe.generated_exam_id = exams.id
        and pe.is_active = true
    )
  );

drop policy if exists "exam_questions_student_read_published" on public.exam_questions;
create policy "exam_questions_student_read_published" on public.exam_questions
  for select using (
    exists (
      select 1 from public.published_exams pe
      where pe.generated_exam_id = exam_questions.exam_id
        and pe.is_active = true
    )
  );

drop policy if exists "question_bank_student_read_published" on public.question_bank;
create policy "question_bank_student_read_published" on public.question_bank
  for select using (
    exists (
      select 1
        from public.exam_questions eq
        join public.published_exams pe on pe.generated_exam_id = eq.exam_id
       where eq.question_id = question_bank.id
         and pe.is_active = true
    )
  );

-- Small helper to keep `total_questions` in sync if a teacher adds/removes
-- questions on the underlying exam template after publishing.
create or replace function public.published_exams_recount() returns trigger
language plpgsql as $$
begin
  if new.generated_exam_id is not null then
    update public.published_exams pe
       set total_questions = (
         select count(*)::int from public.exam_questions eq where eq.exam_id = new.generated_exam_id
       ),
       total_marks = (
         select coalesce(sum(qb.marks), 0)
           from public.exam_questions eq
           join public.question_bank   qb on qb.id = eq.question_id
          where eq.exam_id = new.generated_exam_id
       ),
       updated_at = now()
     where pe.id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists published_exams_recount_aiu on public.published_exams;
create trigger published_exams_recount_aiu
after insert or update of generated_exam_id on public.published_exams
for each row execute function public.published_exams_recount();

notify pgrst, 'reload schema';
