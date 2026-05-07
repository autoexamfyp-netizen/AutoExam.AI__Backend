-- =============================================================================
-- Fix: "infinite recursion detected in policy for relation 'courses'"
--
-- This appears when a policy on `courses` (or another table that references
-- `courses`) has a USING / WITH CHECK clause that itself queries `courses`.
-- Supabase aborts the query rather than loop forever.
--
-- Run this ONLY if you actually have a `public.courses` table.
-- For development you can drop the broken policies and either:
--   (a) leave RLS off until you design the access model, or
--   (b) replace them with simple owner-only policies (template below).
-- =============================================================================

-- 0) Inspect what's installed (read-only — safe to run first):
--    select schemaname, tablename, policyname, cmd, qual, with_check
--    from pg_policies
--    where tablename in ('courses','materials')
--    order by tablename, policyname;


-- 1) Drop ALL existing policies on `courses` (the recursive one will be gone).
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'courses'
  loop
    execute format('drop policy if exists %I on public.courses', r.policyname);
  end loop;
end $$;


-- 2a) DEV-ONLY shortcut: disable RLS on courses so reads/writes work again.
--     Comment this out if you'd rather keep RLS on (use 2b instead).
alter table if exists public.courses disable row level security;


-- 2b) PRODUCTION-LIKE template: keep RLS on, owner-only access.
--     Uncomment if `public.courses` has an `owner_id uuid` column referencing
--     auth.users(id). Adjust the column name as needed.
--
-- alter table public.courses enable row level security;
--
-- create policy "courses_owner_select" on public.courses
--   for select using (auth.uid() = owner_id);
-- create policy "courses_owner_insert" on public.courses
--   for insert with check (auth.uid() = owner_id);
-- create policy "courses_owner_update" on public.courses
--   for update using (auth.uid() = owner_id);
-- create policy "courses_owner_delete" on public.courses
--   for delete using (auth.uid() = owner_id);


-- 3) Also remove any policy on `materials` that joins back into `courses`,
--    since that's what triggered the recursion when we queried materials.
--    (001_materials.sql already drops/recreates clean policies, but this is
--    a belt-and-braces sweep in case the names differed.)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename  = 'materials'
      and (qual like '%courses%' or with_check like '%courses%')
  loop
    execute format('drop policy if exists %I on public.materials', r.policyname);
  end loop;
end $$;


-- 4) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
