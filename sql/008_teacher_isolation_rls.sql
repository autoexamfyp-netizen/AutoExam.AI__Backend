-- =============================================================================
-- AutoExam.ai — Re-apply owner-only RLS (multi-tenant teacher isolation)
-- Run in Supabase SQL Editor after 001–007. Idempotent; safe to re-run.
-- Drops common permissive legacy policies that leak rows across teachers.
-- =============================================================================

-- categories
alter table public.categories enable row level security;
drop policy if exists "Enable read access for all users" on public.categories;
drop policy if exists "Enable insert for authenticated users" on public.categories;
drop policy if exists "categories_select" on public.categories;
drop policy if exists "categories_insert" on public.categories;
drop policy if exists "categories_update" on public.categories;
drop policy if exists "categories_delete" on public.categories;
drop policy if exists "categories_owner_select" on public.categories;
drop policy if exists "categories_owner_insert" on public.categories;
drop policy if exists "categories_owner_update" on public.categories;
drop policy if exists "categories_owner_delete" on public.categories;
create policy "categories_owner_select" on public.categories for select using (auth.uid() = created_by);
create policy "categories_owner_insert" on public.categories for insert with check (auth.uid() = created_by);
create policy "categories_owner_update" on public.categories for update using (auth.uid() = created_by);
create policy "categories_owner_delete" on public.categories for delete using (auth.uid() = created_by);

-- materials
alter table public.materials enable row level security;
drop policy if exists "Enable read access for all users" on public.materials;
drop policy if exists "Enable insert for authenticated users" on public.materials;
drop policy if exists "materials_select" on public.materials;
drop policy if exists "materials_insert" on public.materials;
drop policy if exists "materials_update" on public.materials;
drop policy if exists "materials_delete" on public.materials;
drop policy if exists "materials_owner_select" on public.materials;
drop policy if exists "materials_owner_insert" on public.materials;
drop policy if exists "materials_owner_update" on public.materials;
drop policy if exists "materials_owner_delete" on public.materials;
create policy "materials_owner_select" on public.materials for select using (auth.uid() = uploaded_by);
create policy "materials_owner_insert" on public.materials for insert with check (auth.uid() = uploaded_by);
create policy "materials_owner_update" on public.materials for update using (auth.uid() = uploaded_by);
create policy "materials_owner_delete" on public.materials for delete using (auth.uid() = uploaded_by);

-- text_materials
alter table public.text_materials enable row level security;
drop policy if exists "text_materials_owner_select" on public.text_materials;
drop policy if exists "text_materials_owner_insert" on public.text_materials;
drop policy if exists "text_materials_owner_update" on public.text_materials;
drop policy if exists "text_materials_owner_delete" on public.text_materials;
create policy "text_materials_owner_select" on public.text_materials for select using (auth.uid() = created_by);
create policy "text_materials_owner_insert" on public.text_materials for insert with check (auth.uid() = created_by);
create policy "text_materials_owner_update" on public.text_materials for update using (auth.uid() = created_by);
create policy "text_materials_owner_delete" on public.text_materials for delete using (auth.uid() = created_by);

-- question_bank (owner policies; student read policies from 007 are preserved)
alter table public.question_bank enable row level security;
drop policy if exists "question_bank_owner_select" on public.question_bank;
drop policy if exists "question_bank_owner_insert" on public.question_bank;
drop policy if exists "question_bank_owner_update" on public.question_bank;
drop policy if exists "question_bank_owner_delete" on public.question_bank;
create policy "question_bank_owner_select" on public.question_bank for select using (auth.uid() = created_by);
create policy "question_bank_owner_insert" on public.question_bank for insert with check (auth.uid() = created_by);
create policy "question_bank_owner_update" on public.question_bank for update using (auth.uid() = created_by);
create policy "question_bank_owner_delete" on public.question_bank for delete using (auth.uid() = created_by);

-- exams (owner policies; student read from 007 preserved)
alter table public.exams enable row level security;
drop policy if exists "exams_owner_select" on public.exams;
drop policy if exists "exams_owner_insert" on public.exams;
drop policy if exists "exams_owner_update" on public.exams;
drop policy if exists "exams_owner_delete" on public.exams;
create policy "exams_owner_select" on public.exams for select using (auth.uid() = created_by);
create policy "exams_owner_insert" on public.exams for insert with check (auth.uid() = created_by);
create policy "exams_owner_update" on public.exams for update using (auth.uid() = created_by);
create policy "exams_owner_delete" on public.exams for delete using (auth.uid() = created_by);

-- published_exams
alter table public.published_exams enable row level security;
drop policy if exists "published_exams_owner_select" on public.published_exams;
drop policy if exists "published_exams_owner_insert" on public.published_exams;
drop policy if exists "published_exams_owner_update" on public.published_exams;
drop policy if exists "published_exams_owner_delete" on public.published_exams;
create policy "published_exams_owner_select" on public.published_exams for select using (auth.uid() = published_by);
create policy "published_exams_owner_insert" on public.published_exams for insert with check (auth.uid() = published_by);
create policy "published_exams_owner_update" on public.published_exams for update using (auth.uid() = published_by);
create policy "published_exams_owner_delete" on public.published_exams for delete using (auth.uid() = published_by);

notify pgrst, 'reload schema';
