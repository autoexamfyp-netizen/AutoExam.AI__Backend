-- =============================================================================
-- AutoExam.ai — extend `exams` so it doubles as the "generated papers" entity
-- Run after 005_exams.sql. Idempotent + defensive.
--
-- Spec calls it `generated_exams`; we keep `exams` as the canonical table to
-- avoid a breaking rename, and add the missing metadata columns + FKs:
--   - source_material_id  → links a paper back to the text content it came from
--   - total_questions     → cached count for paper cards
--   - difficulty          → 'easy' | 'medium' | 'hard' | 'mixed'
-- =============================================================================

alter table public.exams
  add column if not exists source_material_id uuid;

alter table public.exams
  add column if not exists total_questions int;

alter table public.exams
  add column if not exists difficulty text;

-- Defaults + backfill -------------------------------------------------------
alter table public.exams
  alter column total_questions set default 0,
  alter column difficulty      set default 'medium';

update public.exams set total_questions = 0        where total_questions is null;
update public.exams set difficulty      = 'medium' where difficulty      is null;

alter table public.exams alter column total_questions set not null;
alter table public.exams alter column difficulty      set not null;

-- Difficulty check ----------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'exams_difficulty_check' and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams drop constraint exams_difficulty_check;
  end if;
end $$;

alter table public.exams
  add constraint exams_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard', 'mixed'));

-- source_material_id FK (guarded; only adds if missing) --------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exams_source_material_id_fkey' and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_source_material_id_fkey
      foreign key (source_material_id) references public.text_materials(id) on delete set null;
  end if;
end $$;

create index if not exists exams_source_material_idx on public.exams(source_material_id);

-- Maintain `total_questions` automatically so paper cards always show the right
-- number even after manual question add/remove.
create or replace function public.exams_recount_questions() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.exams
       set total_questions = total_questions + 1
     where id = new.exam_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.exams
       set total_questions = greatest(total_questions - 1, 0)
     where id = old.exam_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists exam_questions_count_aiu on public.exam_questions;
drop trigger if exists exam_questions_count_aid on public.exam_questions;

create trigger exam_questions_count_aiu
after insert on public.exam_questions
for each row execute procedure public.exams_recount_questions();

create trigger exam_questions_count_aid
after delete on public.exam_questions
for each row execute procedure public.exams_recount_questions();

-- Backfill totals once for any existing exams.
update public.exams e
   set total_questions = sub.cnt
  from (
    select exam_id, count(*) as cnt
      from public.exam_questions
     group by exam_id
  ) sub
 where sub.exam_id = e.id;

notify pgrst, 'reload schema';
