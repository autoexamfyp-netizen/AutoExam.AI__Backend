-- =============================================================================
-- AutoExam.ai — exams + exam_questions + ai_generated flag
-- Run after 004_text_materials_question_bank.sql.
-- Fully idempotent: safe to re-run on a partially-migrated database.
-- =============================================================================

-- 1) Mark which question bank rows came from AI for analytics. -----------------
alter table public.question_bank
  add column if not exists ai_generated boolean not null default false;

create index if not exists question_bank_ai_idx on public.question_bank(ai_generated);

-- 2) Ensure `exams` table exists with the minimum spine. ----------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid()
);

-- All other columns added defensively so partial pre-existing tables get healed.
alter table public.exams add column if not exists created_by uuid;
alter table public.exams add column if not exists category_id uuid;
alter table public.exams add column if not exists title text;
alter table public.exams add column if not exists description text;
alter table public.exams add column if not exists duration_minutes int;
alter table public.exams add column if not exists total_marks numeric;
alter table public.exams add column if not exists status text;
alter table public.exams add column if not exists created_at timestamptz;
alter table public.exams add column if not exists updated_at timestamptz;

-- Defaults / NOT NULLs (apply only after columns are guaranteed to exist) -----
alter table public.exams
  alter column duration_minutes set default 60,
  alter column total_marks      set default 0,
  alter column created_at       set default now(),
  alter column updated_at       set default now();

-- `status` default is set carefully: only if 'draft' is a legal value for the
-- current type (text always accepts it; enums only if they contain it).
do $$
declare
  is_text_or_has_draft boolean;
begin
  select
    coalesce(
      (select t.typname = 'text'
         from pg_attribute a join pg_type t on t.oid = a.atttypid
        where a.attrelid = 'public.exams'::regclass and a.attname = 'status'),
      false
    )
    or exists (
      select 1
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        join pg_enum  e on e.enumtypid = t.oid
       where a.attrelid = 'public.exams'::regclass
         and a.attname  = 'status'
         and e.enumlabel = 'draft'
    )
    into is_text_or_has_draft;

  if is_text_or_has_draft then
    execute 'alter table public.exams alter column status set default ''draft''';
    execute 'update public.exams set status = ''draft'' where status is null';
  else
    raise notice 'Skipping default/backfill on exams.status — current type does not contain ''draft''';
  end if;
end $$;

-- Backfill any nulls so we can safely tighten constraints.
update public.exams set duration_minutes = 60     where duration_minutes is null;
update public.exams set total_marks      = 0      where total_marks      is null;
update public.exams set created_at       = now()  where created_at       is null;
update public.exams set updated_at       = now()  where updated_at       is null;
update public.exams set title            = '(untitled)' where title is null;

alter table public.exams alter column duration_minutes set not null;
alter table public.exams alter column total_marks      set not null;
alter table public.exams alter column created_at       set not null;
alter table public.exams alter column updated_at       set not null;
alter table public.exams alter column title            set not null;

-- Only enforce NOT NULL on status if no nulls remain (handles enums where we
-- couldn't backfill above).
do $$
begin
  if not exists (select 1 from public.exams where status is null) then
    alter table public.exams alter column status set not null;
  end if;
end $$;

-- Relax NOT NULL on any *legacy* columns we don't populate (e.g. an old
-- `course_id` column from a previous schema). We don't drop the columns —
-- just remove the NOT NULL so inserts succeed without supplying values.
do $$
declare r record;
begin
  for r in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'exams'
       and is_nullable  = 'NO'
       and column_default is null
       and column_name not in (
         'id','created_by','title','category_id','description',
         'duration_minutes','total_marks','status','difficulty',
         'total_questions','source_material_id','created_at','updated_at'
       )
  loop
    execute format('alter table public.exams alter column %I drop not null', r.column_name);
  end loop;
end $$;

-- Foreign keys (added only if missing). --------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exams_created_by_fkey' and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'exams_category_id_fkey' and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end $$;

-- created_by must be NOT NULL for RLS policies to work; skip rows with null.
do $$
begin
  if not exists (
    select 1 from public.exams where created_by is null
  ) then
    alter table public.exams alter column created_by set not null;
  end if;
end $$;

-- Status column handling. -----------------------------------------------------
-- Two cases:
--   (a) status is plain `text`           → add an explicit CHECK constraint.
--   (b) status is an existing ENUM        → leave alone (the enum already
--       constrains values; trying to ALTER its type breaks dependent policies
--       on other tables, e.g. `questions_student_select`).
--
-- The backend only ever inserts 'draft' on creation, which existing
-- `exam_status` enums all contain, so case (b) is safe.
do $$
declare
  status_oid       oid;
  status_typname   text;
  status_typtype   "char";
  status_typschema text;
  ck_exists        boolean;
begin
  select a.atttypid, t.typname, t.typtype, n.nspname
    into status_oid, status_typname, status_typtype, status_typschema
    from pg_attribute a
    join pg_type      t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
   where a.attrelid = 'public.exams'::regclass
     and a.attname  = 'status'
     and a.attnum   > 0;

  if status_typtype = 'e' then
    raise notice 'exams.status is enum %.% — leaving as-is (enum already constrains values)',
      status_typschema, status_typname;
  else
    -- Plain text (or some other compatible scalar): re-apply our CHECK.
    select exists (
      select 1 from pg_constraint
       where conname = 'exams_status_check'
         and conrelid = 'public.exams'::regclass
    ) into ck_exists;
    if ck_exists then
      execute 'alter table public.exams drop constraint exams_status_check';
    end if;

    -- Normalize legacy values into the canonical set first.
    update public.exams set status = 'draft'     where status is null or status = '';
    update public.exams set status = 'published' where lower(status) in ('publish','live','open','active');
    update public.exams set status = 'closed'    where lower(status) in ('archive','archived','ended','done','complete','completed');
    update public.exams set status = 'draft'     where status not in ('draft','published','closed');

    execute 'alter table public.exams
      add constraint exams_status_check
      check (status in (''draft'',''published'',''closed''))';
  end if;
end $$;

create index if not exists exams_created_by_idx on public.exams(created_by);
create index if not exists exams_category_idx   on public.exams(category_id);
create index if not exists exams_created_at_idx on public.exams(created_at desc);

-- RLS policies. ---------------------------------------------------------------
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

-- 3) Exam ↔ question link table. ---------------------------------------------
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid()
);

alter table public.exam_questions add column if not exists exam_id uuid;
alter table public.exam_questions add column if not exists question_id uuid;
alter table public.exam_questions add column if not exists position int;
alter table public.exam_questions add column if not exists created_at timestamptz;

alter table public.exam_questions
  alter column position   set default 0,
  alter column created_at set default now();
update public.exam_questions set position   = 0     where position   is null;
update public.exam_questions set created_at = now() where created_at is null;
alter table public.exam_questions alter column position   set not null;
alter table public.exam_questions alter column created_at set not null;

-- Drop any FK on exam_questions.exam_id / .question_id that points at the
-- WRONG table (e.g. an older `questions` legacy table). Then add the canonical
-- FK pointing to `public.exams` and `public.question_bank` if missing.
--
-- We do this by name lookup on `pg_constraint` joined to its referenced table;
-- this is more reliable than going by constraint name alone.
do $$
declare r record;
begin
  -- Drop any wrong-target FKs referencing public.exam_questions.exam_id
  for r in
    select c.conname
      from pg_constraint c
      join pg_class       t on t.oid = c.conrelid
      join pg_namespace   n on n.oid = t.relnamespace
      join pg_class       rt on rt.oid = c.confrelid
      join pg_namespace   rn on rn.oid = rt.relnamespace
     where c.contype = 'f'
       and n.nspname = 'public'
       and t.relname = 'exam_questions'
       and exists (
         select 1
           from unnest(c.conkey) ck(attnum)
           join pg_attribute a
             on a.attrelid = c.conrelid
            and a.attnum   = ck.attnum
          where a.attname  = 'exam_id'
       )
       and not (rn.nspname = 'public' and rt.relname = 'exams')
  loop
    execute format('alter table public.exam_questions drop constraint %I', r.conname);
  end loop;

  -- Drop any wrong-target FKs referencing public.exam_questions.question_id
  for r in
    select c.conname
      from pg_constraint c
      join pg_class       t on t.oid = c.conrelid
      join pg_namespace   n on n.oid = t.relnamespace
      join pg_class       rt on rt.oid = c.confrelid
      join pg_namespace   rn on rn.oid = rt.relnamespace
     where c.contype = 'f'
       and n.nspname = 'public'
       and t.relname = 'exam_questions'
       and exists (
         select 1
           from unnest(c.conkey) ck(attnum)
           join pg_attribute a
             on a.attrelid = c.conrelid
            and a.attnum   = ck.attnum
          where a.attname  = 'question_id'
       )
       and not (rn.nspname = 'public' and rt.relname = 'question_bank')
  loop
    execute format('alter table public.exam_questions drop constraint %I', r.conname);
  end loop;

  -- Now add the canonical FKs only if a correctly-targeted one is missing.
  if not exists (
    select 1 from pg_constraint c
      join pg_class       rt on rt.oid = c.confrelid
      join pg_namespace   rn on rn.oid = rt.relnamespace
     where c.conrelid = 'public.exam_questions'::regclass
       and c.contype = 'f'
       and rn.nspname = 'public'
       and rt.relname = 'exams'
       and exists (
         select 1 from unnest(c.conkey) ck(attnum)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
         where a.attname = 'exam_id'
       )
  ) then
    alter table public.exam_questions
      add constraint exam_questions_exam_id_fkey
      foreign key (exam_id) references public.exams(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint c
      join pg_class       rt on rt.oid = c.confrelid
      join pg_namespace   rn on rn.oid = rt.relnamespace
     where c.conrelid = 'public.exam_questions'::regclass
       and c.contype = 'f'
       and rn.nspname = 'public'
       and rt.relname = 'question_bank'
       and exists (
         select 1 from unnest(c.conkey) ck(attnum)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
         where a.attname = 'question_id'
       )
  ) then
    alter table public.exam_questions
      add constraint exam_questions_question_id_fkey
      foreign key (question_id) references public.question_bank(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'exam_questions_unique' and conrelid = 'public.exam_questions'::regclass
  ) then
    alter table public.exam_questions add constraint exam_questions_unique unique (exam_id, question_id);
  end if;
end $$;

alter table public.exam_questions alter column exam_id     set not null;
alter table public.exam_questions alter column question_id set not null;

-- Relax NOT NULL on any legacy columns the link table might already carry.
do $$
declare r record;
begin
  for r in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'exam_questions'
       and is_nullable  = 'NO'
       and column_default is null
       and column_name not in (
         'id','exam_id','question_id','position','created_at'
       )
  loop
    execute format('alter table public.exam_questions alter column %I drop not null', r.column_name);
  end loop;
end $$;

create index if not exists exam_questions_exam_idx     on public.exam_questions(exam_id);
create index if not exists exam_questions_question_idx on public.exam_questions(question_id);

alter table public.exam_questions enable row level security;

drop policy if exists "exam_questions_owner_select" on public.exam_questions;
drop policy if exists "exam_questions_owner_insert" on public.exam_questions;
drop policy if exists "exam_questions_owner_delete" on public.exam_questions;

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
