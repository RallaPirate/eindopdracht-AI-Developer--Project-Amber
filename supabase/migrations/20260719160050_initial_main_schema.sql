-- BioReserve OS
-- Initial schema for the main Supabase project.
--
-- Important:
-- Species data lives in a separate Supabase project. Therefore,
-- external_species_id is an application-level reference and cannot be
-- enforced as a PostgreSQL foreign key in this database.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared trigger function: maintain updated_at automatically
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- Extends Supabase Auth users with application-specific information.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null default 'user'
    check (role in ('user', 'moderator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- Create a matching profile whenever a new Supabase Auth user registers.
-- Supabase warns that a failing auth trigger can block sign-ups, so keep this
-- function small and deterministic.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'BioReserve User'
    )
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Specimens
-- One row per chipped animal, even when staff normally manage it as part of
-- a flock or herd.
-- ---------------------------------------------------------------------------

create table public.specimens (
  id uuid primary key default gen_random_uuid(),
  external_species_id text not null
    check (length(trim(external_species_id)) > 0),
  asset_code text not null unique
    check (length(trim(asset_code)) > 0),
  nickname text,
  date_of_birth date,
  weight_kg numeric(10, 2)
    check (weight_kg is null or weight_kg > 0),
  length_m numeric(7, 2)
    check (length_m is null or length_m > 0),
  height_m numeric(7, 2)
    check (height_m is null or height_m > 0),
  speed_kmh numeric(7, 2)
    check (speed_kmh is null or speed_kmh >= 0),
  lysine_protocol text,
  location text,
  status text not null default 'active'
    check (status in (
      'active',
      'quarantine',
      'medical',
      'transferred',
      'deceased',
      'missing'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on column public.specimens.external_species_id is
  'Stable text identifier from the separate external Species API project.';

create index specimens_external_species_id_idx
  on public.specimens (external_species_id);

create index specimens_status_idx
  on public.specimens (status);

create trigger specimens_set_updated_at
before update on public.specimens
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Reports
-- Every report concerns a species; specimen_id is optional when the report
-- concerns a flock, herd, or species-level procedure rather than one animal.
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  external_species_id text not null
    check (length(trim(external_species_id)) > 0),
  specimen_id uuid references public.specimens(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  ai_summary text,
  ai_keywords text[] not null default '{}'::text[],
  report_type text not null default 'care'
    check (report_type in (
      'care',
      'behaviour',
      'medical',
      'security',
      'incident'
    )),
  review_status text not null default 'draft'
    check (review_status in ('draft', 'approved', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on column public.reports.external_species_id is
  'Mandatory stable species identifier from the separate Species API project.';

comment on column public.reports.specimen_id is
  'Optional. Null means the report concerns the species, flock, or herd rather than one specimen.';

create index reports_external_species_id_idx
  on public.reports (external_species_id);

create index reports_specimen_id_idx
  on public.reports (specimen_id);

create index reports_created_by_idx
  on public.reports (created_by);

create index reports_review_status_idx
  on public.reports (review_status);

create index reports_ai_keywords_gin_idx
  on public.reports using gin (ai_keywords);

create trigger reports_set_updated_at
before update on public.reports
for each row
execute function public.set_updated_at();

-- Prevent an individual report from pointing to a specimen of another species.
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

  select s.external_species_id
    into specimen_species_id
    from public.specimens as s
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

create trigger reports_validate_specimen_species
before insert or update of external_species_id, specimen_id
on public.reports
for each row
execute function public.validate_report_specimen_species();

-- ---------------------------------------------------------------------------
-- Species knowledge index
-- Controlled vocabulary and approved internal guidance used to retrieve the
-- most relevant reports for an AI care question.
-- ---------------------------------------------------------------------------

create table public.species_knowledge_index (
  id uuid primary key default gen_random_uuid(),
  external_species_id text not null
    check (length(trim(external_species_id)) > 0),
  canonical_topic text not null
    check (length(trim(canonical_topic)) > 0),
  search_terms text[] not null default '{}'::text[],
  guidance_summary text not null
    check (length(trim(guidance_summary)) > 0),
  source_report_ids uuid[] not null default '{}'::uuid[],
  review_status text not null default 'suggested'
    check (review_status in ('suggested', 'approved', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (external_species_id, canonical_topic)
);

comment on column public.species_knowledge_index.source_report_ids is
  'MVP array of supporting report IDs. It is not database-enforced as a foreign-key relationship.';

create index species_knowledge_external_species_id_idx
  on public.species_knowledge_index (external_species_id);

create index species_knowledge_review_status_idx
  on public.species_knowledge_index (review_status);

create index species_knowledge_search_terms_gin_idx
  on public.species_knowledge_index using gin (search_terms);

create trigger species_knowledge_set_updated_at
before update on public.species_knowledge_index
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Internal species database
-- Polished BioReserve-facing descriptions and operational guidance.
-- General scientific reference and care data remain in the external API.
-- ---------------------------------------------------------------------------

create table public.species_database (
  external_species_id text primary key
    check (length(trim(external_species_id)) > 0),
  display_name text not null
    check (length(trim(display_name)) > 0),
  general_description text not null
    check (length(trim(general_description)) > 0),
  diet_preferences text,
  habitat_preferences text,
  handling_guidance text,
  minimum_handlers smallint
    check (minimum_handlers is null or minimum_handlers > 0),
  safety_class text not null
    check (length(trim(safety_class)) > 0)
);

comment on column public.species_database.external_species_id is
  'Primary key matching the stable identifier in the separate Species API project.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Policies deliberately come in a later migration. Until then, normal anon
-- and authenticated Data API requests cannot access rows in these tables.
-- SQL migrations and privileged server-side/database administration can.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.specimens enable row level security;
alter table public.reports enable row level security;
alter table public.species_knowledge_index enable row level security;
alter table public.species_database enable row level security;