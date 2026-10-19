-- Align species_database with database_design_v2 Section 4 (task 1.2).
--
-- Replaces the July primary key (external_species_id) with an internal UUID id,
-- tightens required fields and safety_class, and adds audit timestamps.
-- Existing rows are not deleted or rewritten; invalid rows abort the migration.
-- New timestamp columns use DEFAULT now(), so any existing rows receive
-- migration-time values for created_at and updated_at.

-- ---------------------------------------------------------------------------
-- Pre-application guards (before any schema change)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where confrelid = 'public.species_database'::regclass
      and contype = 'f'
  ) then
    raise exception
      'species_database has unexpected incoming foreign keys; remove or migrate them before aligning this table';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from public.species_database
    where diet_preferences is null
       or length(trim(diet_preferences)) = 0
       or habitat_preferences is null
       or length(trim(habitat_preferences)) = 0
       or handling_guidance is null
       or length(trim(handling_guidance)) = 0
       or minimum_handlers is null
       or minimum_handlers <= 0
       or safety_class not in ('low', 'moderate', 'high', 'critical')
  ) then
    raise exception
      'species_database contains rows that violate the locked design constraints; fix or remove them before continuing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.species_database
  add column id uuid not null default gen_random_uuid();

alter table public.species_database
  add column created_at timestamptz not null default now();

alter table public.species_database
  add column updated_at timestamptz not null default now();

alter table public.species_database
  add column updated_by uuid;

-- ---------------------------------------------------------------------------
-- Primary key swap
-- ---------------------------------------------------------------------------

alter table public.species_database
  drop constraint species_database_pkey;

alter table public.species_database
  add constraint species_database_pkey primary key (id);

alter table public.species_database
  add constraint species_database_external_species_id_key unique (external_species_id);

alter table public.species_database
  alter column external_species_id set not null;

-- ---------------------------------------------------------------------------
-- Checks and nullability
-- ---------------------------------------------------------------------------

alter table public.species_database
  drop constraint species_database_minimum_handlers_check;

alter table public.species_database
  drop constraint species_database_safety_class_check;

alter table public.species_database
  add constraint species_database_diet_preferences_check
  check (length(trim(diet_preferences)) > 0);

alter table public.species_database
  add constraint species_database_habitat_preferences_check
  check (length(trim(habitat_preferences)) > 0);

alter table public.species_database
  add constraint species_database_handling_guidance_check
  check (length(trim(handling_guidance)) > 0);

alter table public.species_database
  add constraint species_database_minimum_handlers_check
  check (minimum_handlers > 0);

alter table public.species_database
  add constraint species_database_safety_class_check
  check (safety_class in ('low', 'moderate', 'high', 'critical'));

alter table public.species_database
  alter column diet_preferences set not null;

alter table public.species_database
  alter column habitat_preferences set not null;

alter table public.species_database
  alter column handling_guidance set not null;

alter table public.species_database
  alter column minimum_handlers set not null;

-- ---------------------------------------------------------------------------
-- updated_by relationship, index and trigger
-- ---------------------------------------------------------------------------

alter table public.species_database
  add constraint species_database_updated_by_fkey
  foreign key (updated_by)
  references public.profiles (id);

create index species_database_updated_by_idx
  on public.species_database (updated_by);

create trigger species_database_set_updated_at
before update on public.species_database
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

comment on column public.species_database.id is
  'Internal primary key used by relationships within the main application database.';

comment on column public.species_database.external_species_id is
  'Stable unique identifier matching the separate Species API project; not the primary key.';
