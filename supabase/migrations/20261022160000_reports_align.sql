-- Align reports with database_design_v2 Section 4 (task 1.4).
--
-- Replaces external_species_id with species_id (FK to species_database),
-- adds UNIQUE (id, species_id) and the composite specimen FK, aligns
-- draft-content nullability, review_status values, record_status and
-- submission/review/management-review metadata, and rewires profile FKs
-- for the retained-profile design. Removes the transitional
-- reports_validate_specimen_species trigger and function.
--
-- Precondition: reports must be empty. No row backfill or conversion.
-- Lifecycle cross-field CHECKs, transition/immutability triggers,
-- management-review invariants and RLS policies are deferred to
-- tasks 1.8–1.12.

-- ---------------------------------------------------------------------------
-- Pre-application guard (before any schema change)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.reports) then
    raise exception
      'reports must be empty before alignment; clear or migrate rows manually before continuing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Remove transitional specimen–species validation and legacy species key
-- ---------------------------------------------------------------------------

drop trigger if exists reports_validate_specimen_species on public.reports;

drop function if exists public.validate_report_specimen_species();

alter table public.reports
  drop constraint reports_specimen_id_fkey;

drop index public.reports_external_species_id_idx;

alter table public.reports
  drop column external_species_id;

-- ---------------------------------------------------------------------------
-- Species identity and specimen composite relationship
-- ---------------------------------------------------------------------------

alter table public.reports
  add column species_id uuid not null;

alter table public.reports
  add constraint reports_species_id_fkey
  foreign key (species_id)
  references public.species_database (id)
  on delete restrict;

alter table public.reports
  add constraint reports_id_species_id_key
  unique (id, species_id);

alter table public.reports
  add constraint reports_specimen_id_species_id_fkey
  foreign key (specimen_id, species_id)
  references public.specimens (id, species_id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- New lifecycle and review metadata columns
-- ---------------------------------------------------------------------------

alter table public.reports
  add column record_status text not null default 'active';

alter table public.reports
  add constraint reports_record_status_check
  check (record_status in (
    'active',
    'archived',
    'withdrawn',
    'sealed'
  ));

alter table public.reports
  add column submitted_at timestamptz;

alter table public.reports
  add column reviewed_at timestamptz;

alter table public.reports
  add column reviewed_by uuid;

alter table public.reports
  add column review_note text;

alter table public.reports
  add column management_review_requested boolean not null default false;

alter table public.reports
  add column management_review_requested_at timestamptz;

alter table public.reports
  add column management_review_requested_by uuid;

-- ---------------------------------------------------------------------------
-- Align existing columns (schema only; no row updates)
-- ---------------------------------------------------------------------------

alter table public.reports
  alter column title drop not null;

alter table public.reports
  alter column body drop not null;

alter table public.reports
  alter column report_type drop not null;

alter table public.reports
  alter column report_type drop default;

alter table public.reports
  alter column ai_keywords drop not null;

alter table public.reports
  alter column ai_keywords drop default;

alter table public.reports
  drop constraint reports_review_status_check;

alter table public.reports
  add constraint reports_review_status_check
  check (review_status in (
    'draft',
    'submitted',
    'reviewed'
  ));

-- ---------------------------------------------------------------------------
-- Profile relationships (retained profiles; no CASCADE / SET NULL)
-- ---------------------------------------------------------------------------

alter table public.reports
  drop constraint reports_created_by_fkey;

alter table public.reports
  add constraint reports_created_by_fkey
  foreign key (created_by)
  references public.profiles (id);

alter table public.reports
  drop constraint reports_updated_by_fkey;

alter table public.reports
  add constraint reports_updated_by_fkey
  foreign key (updated_by)
  references public.profiles (id);

alter table public.reports
  add constraint reports_reviewed_by_fkey
  foreign key (reviewed_by)
  references public.profiles (id);

alter table public.reports
  add constraint reports_management_review_requested_by_fkey
  foreign key (management_review_requested_by)
  references public.profiles (id);

-- ---------------------------------------------------------------------------
-- Indexes and comments
-- ---------------------------------------------------------------------------

create index reports_species_id_idx
  on public.reports (species_id);

create index reports_updated_by_idx
  on public.reports (updated_by);

create index reports_reviewed_by_idx
  on public.reports (reviewed_by);

create index reports_management_review_requested_by_idx
  on public.reports (management_review_requested_by);

create index reports_record_status_idx
  on public.reports (record_status);

comment on column public.reports.species_id is
  'Foreign key to species_database(id); identifies the species discussed in the report.';

comment on column public.reports.specimen_id is
  'Optional. Null means the report concerns the species, flock, or herd rather than one specimen. Part of composite FK with species_id to specimens(id, species_id).';

comment on column public.reports.record_status is
  'How the organisational record is treated: active, archived, withdrawn, or sealed.';

comment on column public.reports.submitted_at is
  'Set when the creator submits the report for review.';

comment on column public.reports.reviewed_at is
  'Set when a senior or management user completes the review.';

comment on column public.reports.reviewed_by is
  'Profile that completed the most recent review.';

comment on column public.reports.review_note is
  'Optional internal explanation for approval, withdrawal, sealing, or another review decision.';

comment on column public.reports.management_review_requested is
  'Indicates whether management review was requested.';

comment on column public.reports.management_review_requested_at is
  'Time at which the report was flagged for management review.';

comment on column public.reports.management_review_requested_by is
  'Profile that flagged the report for management review.';
