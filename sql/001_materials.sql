-- =============================================================================
-- AutoExam.ai — materials table migration (idempotent)
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to run multiple times. Works for both brand-new and pre-existing tables.
-- =============================================================================

-- 1) Make sure the table exists. Only `id` is created here; every other
--    column is added below with ADD COLUMN IF NOT EXISTS so a pre-existing
--    table (with a different shape) also gets fully upgraded.
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid()
);

-- 2) Bring the table to the canonical shape. Each ADD is a no-op if the
--    column already exists, so this works on any prior version.
alter table public.materials add column if not exists uploaded_by       uuid;
alter table public.materials add column if not exists title             text;
alter table public.materials add column if not exists original_filename text;
alter table public.materials add column if not exists file_url          text;
alter table public.materials add column if not exists public_id         text;
alter table public.materials add column if not exists resource_type     text default 'auto';
alter table public.materials add column if not exists material_type     text;
alter table public.materials add column if not exists mime_type         text;
alter table public.materials add column if not exists size_bytes        bigint;
alter table public.materials add column if not exists created_at        timestamptz not null default now();
alter table public.materials add column if not exists updated_at        timestamptz not null default now();

-- 2b) Relax NOT NULL on any *legacy* columns we don't populate (e.g. an old
--     `course_id` column from a previous schema). We don't drop the columns —
--     just remove the NOT NULL so inserts succeed without supplying values.
do $$
declare r record;
begin
  for r in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'materials'
      and is_nullable  = 'NO'
      and column_default is null
      and column_name not in (
        'id','uploaded_by','title','file_url','public_id','material_type',
        'resource_type','created_at','updated_at'
      )
  loop
    execute format('alter table public.materials alter column %I drop not null', r.column_name);
  end loop;
end $$;

-- 3) Foreign key on uploaded_by → auth.users(id), only if not present yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'materials_uploaded_by_fkey'
  ) then
    alter table public.materials
      add constraint materials_uploaded_by_fkey
      foreign key (uploaded_by) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 4) `material_type` must be plain text. If a previous migration created it as
--    a Postgres enum (or anything else), convert it to text so the check
--    constraint and the JS code (which sends plain strings) both work.
do $$
declare
  col_udt text;
begin
  select udt_name into col_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'materials'
    and column_name  = 'material_type';

  if col_udt is not null and col_udt <> 'text' then
    execute 'alter table public.materials
             alter column material_type type text
             using material_type::text';
  end if;
end $$;

-- Allowed material_type values. Drop+recreate so it's predictable.
alter table public.materials drop constraint if exists materials_material_type_check;
alter table public.materials
  add constraint materials_material_type_check
  check (material_type is null or material_type in ('pdf','image','video','other'));

-- 5) Indexes.
create index if not exists materials_uploaded_by_idx on public.materials(uploaded_by);
create index if not exists materials_created_at_idx  on public.materials(created_at desc);

-- 6) Row Level Security: owner-only access. We DROP any old policies first
--    so we don't accidentally inherit a recursive / cross-table policy
--    (e.g., one that referenced public.courses).
alter table public.materials enable row level security;

drop policy if exists "materials_owner_select" on public.materials;
drop policy if exists "materials_owner_insert" on public.materials;
drop policy if exists "materials_owner_update" on public.materials;
drop policy if exists "materials_owner_delete" on public.materials;

-- Defensive: drop common legacy policy names.
drop policy if exists "Enable read access for all users"      on public.materials;
drop policy if exists "Enable insert for authenticated users" on public.materials;
drop policy if exists "materials_select"                      on public.materials;
drop policy if exists "materials_insert"                      on public.materials;
drop policy if exists "materials_update"                      on public.materials;
drop policy if exists "materials_delete"                      on public.materials;

create policy "materials_owner_select" on public.materials
  for select using (auth.uid() = uploaded_by);

create policy "materials_owner_insert" on public.materials
  for insert with check (auth.uid() = uploaded_by);

create policy "materials_owner_update" on public.materials
  for update using (auth.uid() = uploaded_by);

create policy "materials_owner_delete" on public.materials
  for delete using (auth.uid() = uploaded_by);

-- 7) Force PostgREST (the layer Supabase uses for the JS client) to refresh
--    its schema cache so newly-added columns are visible immediately.
notify pgrst, 'reload schema';
