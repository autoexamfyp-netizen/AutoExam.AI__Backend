-- Allow PowerPoint slides as a first-class material_type (PDF + PPT for uploads).
-- Legacy image/video rows are remapped to 'other' so the new check constraint can apply.

update public.materials
set material_type = 'other',
    updated_at    = coalesce(updated_at, now())
where material_type is not null
  and material_type not in ('pdf', 'ppt', 'other');

alter table public.materials drop constraint if exists materials_material_type_check;

alter table public.materials
  add constraint materials_material_type_check
  check (material_type is null or material_type in ('pdf', 'ppt', 'other'));
