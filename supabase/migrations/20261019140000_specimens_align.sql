-- Align specimens with database_design_v2 Section 4 (task 1.3).
--
-- Replaces external_species_id with species_id (FK to species_database),
-- adds UNIQUE (id, species_id) for the later reports composite FK,
-- tightens lysine_protocol, location and status, and aligns updated_by
-- with the retained-profile design. Also updates the transitional
-- reports_validate_specimen_species function to join via species_id
-- until reports are aligned in task 1.4.
-- Existing rows are not deleted; invalid rows abort the migration.

-- ---------------------------------------------------------------------------
-- Pre-application guards (before any schema change)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from public.specimens as s
    where not exists (
      select 1
      from public.species_database as sd
      where sd.external_species_id = s.external_species_id
    )
  ) then
    raise exception
      'specimens.external_species_id values must exist in species_database; fix or remove unmatched rows before continuing';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from public.specimens
    where status not in (
      'active',
      'quarantine',
      'medical',
      'transferred',
      'deceased',
      'missing'
    )
  ) then
    raise exception
      'specimens.status contains values outside the legacy set; migrate those rows manually before continuing';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from public.specimens
    where lysine_protocol is not null
      and lysine_protocol not in (
        'standard',
        'increased',
        'reduced',
        'suspended',
        'not_applicable'
      )
  ) then
    raise exception
      'specimens.lysine_protocol contains values outside the locked design; fix or remove them before continuing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Drop legacy status CHECK, then normalise data
-- Legacy specimens_status_check rejects under_treatment, so it must be
-- dropped before remapping medical -> under_treatment.
-- ---------------------------------------------------------------------------

alter table public.specimens
  drop constraint specimens_status_check;

-- Intentional: align legacy status 'medical' with locked design 'under_treatment'.
update public.specimens
set status = 'under_treatment'
where status = 'medical';

-- Intentional: NULL lysine_protocol becomes the locked default 'standard'.
update public.specimens
set lysine_protocol = 'standard'
where lysine_protocol is null;

-- Intentional: NULL or empty location becomes the locked default 'lab'.
update public.specimens
set location = 'lab'
where location is null
   or length(trim(location)) = 0;

-- ---------------------------------------------------------------------------
-- Species identity: add species_id, backfill, replace reports trigger
-- ---------------------------------------------------------------------------

alter table public.specimens
  add column species_id uuid;

update public.specimens as s
set species_id = sd.id
from public.species_database as sd
where sd.external_species_id = s.external_species_id;

do $$
begin
  if exists (
    select 1
    from public.specimens
    where species_id is null
  ) then
    raise exception
      'specimens.species_id backfill left null values; aborting before dropping external_species_id';
  end if;
end $$;

-- Transitional: reports still store external_species_id until task 1.4.
-- Resolve specimen species via species_id -> species_database.external_species_id.
create or replace function public.validate_report_specimen_species()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  specimen_species_id text;
begin
  if new.specimen_id is null then
    return new;
  end if;

  select sd.external_species_id
    into specimen_species_id
    from public.specimens as s
    join public.species_database as sd on sd.id = s.species_id
   where s.id = new.specimen_id;

  if specimen_species_id is distinct from new.external_species_id then
    raise exception
      'Report species % does not match specimen species %',
      new.external_species_id,
      specimen_species_id;
  end if;

  return new;
end;
$$;

drop index public.specimens_external_species_id_idx;

alter table public.specimens
  drop column external_species_id;

alter table public.specimens
  alter column species_id set not null;

alter table public.specimens
  add constraint specimens_species_id_fkey
  foreign key (species_id)
  references public.species_database (id)
  on delete restrict;

alter table public.specimens
  add constraint specimens_id_species_id_key
  unique (id, species_id);

-- ---------------------------------------------------------------------------
-- Locked CHECKs, defaults, nullability and updated_by relationship
-- ---------------------------------------------------------------------------

alter table public.specimens
  add constraint specimens_status_check
  check (status in (
    'active',
    'quarantine',
    'under_treatment',
    'transferred',
    'deceased',
    'missing'
  ));

alter table public.specimens
  add constraint specimens_lysine_protocol_check
  check (lysine_protocol in (
    'standard',
    'increased',
    'reduced',
    'suspended',
    'not_applicable'
  ));

alter table public.specimens
  alter column lysine_protocol set default 'standard';

alter table public.specimens
  alter column lysine_protocol set not null;

alter table public.specimens
  add constraint specimens_location_check
  check (length(trim(location)) > 0);

alter table public.specimens
  alter column location set default 'lab';

alter table public.specimens
  alter column location set not null;

alter table public.specimens
  drop constraint specimens_updated_by_fkey;

alter table public.specimens
  add constraint specimens_updated_by_fkey
  foreign key (updated_by)
  references public.profiles (id);

-- ---------------------------------------------------------------------------
-- Indexes and comments
-- ---------------------------------------------------------------------------

create index specimens_species_id_idx
  on public.specimens (species_id);

create index specimens_updated_by_idx
  on public.specimens (updated_by);

comment on column public.specimens.species_id is
  'Foreign key to species_database(id); identifies the species of this specimen.';
