-- =============================================================================
-- AutoExam.ai — categories (subject folders) + materials.category_id
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run.
-- Idempotent: safe to re-run.
-- =============================================================================

-- 1) Categories table.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One category title per teacher (case-insensitive).
create unique index if not exists categories_owner_title_uniq
  on public.categories (created_by, lower(title));

create index if not exists categories_created_by_idx on public.categories(created_by);

-- 2) Add the FK column on materials (nullable, so legacy rows are fine).
alter table public.materials add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'materials_category_id_fkey'
  ) then
    alter table public.materials
      add constraint materials_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end $$;

create index if not exists materials_category_id_idx on public.materials(category_id);

-- 3) RLS — owner-only on categories.
alter table public.categories enable row level security;

drop policy if exists "categories_owner_select" on public.categories;
drop policy if exists "categories_owner_insert" on public.categories;
drop policy if exists "categories_owner_update" on public.categories;
drop policy if exists "categories_owner_delete" on public.categories;

create policy "categories_owner_select" on public.categories
  for select using (auth.uid() = created_by);

create policy "categories_owner_insert" on public.categories
  for insert with check (auth.uid() = created_by);

create policy "categories_owner_update" on public.categories
  for update using (auth.uid() = created_by);

create policy "categories_owner_delete" on public.categories
  for delete using (auth.uid() = created_by);

-- 4) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
