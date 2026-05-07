-- =============================================================================
-- Text materials (pasted study content) + AI-generated question bank rows
-- Run after 003_categories.sql. Idempotent where possible.
-- =============================================================================

-- 1) Pasted text content (NOT extracted from PDFs — manual entry only).
create table if not exists public.text_materials (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists text_materials_created_by_idx on public.text_materials(created_by);
create index if not exists text_materials_category_idx on public.text_materials(category_id);
create index if not exists text_materials_created_at_idx on public.text_materials(created_at desc);

alter table public.text_materials enable row level security;

drop policy if exists "text_materials_owner_select" on public.text_materials;
drop policy if exists "text_materials_owner_insert" on public.text_materials;
drop policy if exists "text_materials_owner_update" on public.text_materials;
drop policy if exists "text_materials_owner_delete" on public.text_materials;

create policy "text_materials_owner_select" on public.text_materials
  for select using (auth.uid() = created_by);

create policy "text_materials_owner_insert" on public.text_materials
  for insert with check (auth.uid() = created_by);

create policy "text_materials_owner_update" on public.text_materials
  for update using (auth.uid() = created_by);

create policy "text_materials_owner_delete" on public.text_materials
  for delete using (auth.uid() = created_by);

-- 2) Question bank (reusable items; may reference source text material).
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  text_material_id uuid references public.text_materials(id) on delete set null,
  prompt text not null,
  model_answer text,
  question_type text not null,
  difficulty text not null default 'medium',
  marks numeric not null default 2,
  topic text,
  options jsonb,
  favorite boolean not null default false,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_bank_type_chk check (question_type in ('mcq','short','essay')),
  constraint question_bank_diff_chk check (difficulty in ('easy','medium','hard'))
);

create index if not exists question_bank_created_by_idx on public.question_bank(created_by);
create index if not exists question_bank_category_idx on public.question_bank(category_id);
create index if not exists question_bank_text_material_idx on public.question_bank(text_material_id);

alter table public.question_bank enable row level security;

drop policy if exists "question_bank_owner_select" on public.question_bank;
drop policy if exists "question_bank_owner_insert" on public.question_bank;
drop policy if exists "question_bank_owner_update" on public.question_bank;
drop policy if exists "question_bank_owner_delete" on public.question_bank;

create policy "question_bank_owner_select" on public.question_bank
  for select using (auth.uid() = created_by);

create policy "question_bank_owner_insert" on public.question_bank
  for insert with check (auth.uid() = created_by);

create policy "question_bank_owner_update" on public.question_bank
  for update using (auth.uid() = created_by);

create policy "question_bank_owner_delete" on public.question_bank
  for delete using (auth.uid() = created_by);

notify pgrst, 'reload schema';
