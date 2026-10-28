-- Align species_knowledge_index with database_design_v2 Section 4 (task 1.5).
--
-- Replaces external_species_id with species_id (FK to species_database),
-- replaces review_status with status (pending/reviewed), drops the MVP
-- source_report_ids array, adds created_by, rewires updated_by for the
-- retained-profile design, and adds UNIQUE (species_id, canonical_topic)
-- and UNIQUE (id, species_id) for the composite FK in task 1.6.
--
-- Assumption: species_knowledge_index is empty. No row backfill or conversion.
-- species_knowledge_sources, withdrawal/source-eligibility enforcement and
-- RLS policies are deferred to tasks 1.6 and 1.11–1.12.

-- ---------------------------------------------------------------------------
-- Remove legacy indexes, unique key and review_status check
-- ---------------------------------------------------------------------------

drop index public.species_knowledge_external_species_id_idx;

drop index public.species_knowledge_review_status_idx;

alter table public.species_knowledge_index
  drop constraint species_knowledge_index_external_species_id_canonical_topic_key;

alter table public.species_knowledge_index
  drop constraint species_knowledge_index_review_status_check;

-- ---------------------------------------------------------------------------
-- Drop obsolete columns
-- ---------------------------------------------------------------------------

alter table public.species_knowledge_index
  drop column external_species_id;

alter table public.species_knowledge_index
  drop column source_report_ids;

alter table public.species_knowledge_index
  drop column review_status;

-- ---------------------------------------------------------------------------
-- Species identity, status and created_by
-- ---------------------------------------------------------------------------

alter table public.species_knowledge_index
  add column species_id uuid not null;

alter table public.species_knowledge_index
  add constraint species_knowledge_index_species_id_fkey
  foreign key (species_id)
  references public.species_database (id)
  on delete restrict;

alter table public.species_knowledge_index
  add column status text not null default 'reviewed';

alter table public.species_knowledge_index
  add constraint species_knowledge_index_status_check
  check (status in (
    'pending',
    'reviewed'
  ));

alter table public.species_knowledge_index
  add column created_by uuid;

alter table public.species_knowledge_index
  add constraint species_knowledge_index_id_species_id_key
  unique (id, species_id);

alter table public.species_knowledge_index
  add constraint species_knowledge_index_species_id_canonical_topic_key
  unique (species_id, canonical_topic);

-- ---------------------------------------------------------------------------
-- Profile relationships (retained profiles; no CASCADE / SET NULL)
-- ---------------------------------------------------------------------------

alter table public.species_knowledge_index
  drop constraint species_knowledge_index_updated_by_fkey;

alter table public.species_knowledge_index
  add constraint species_knowledge_index_updated_by_fkey
  foreign key (updated_by)
  references public.profiles (id);

alter table public.species_knowledge_index
  add constraint species_knowledge_index_created_by_fkey
  foreign key (created_by)
  references public.profiles (id);

-- ---------------------------------------------------------------------------
-- Indexes and comments
-- ---------------------------------------------------------------------------

create index species_knowledge_index_species_id_idx
  on public.species_knowledge_index (species_id);

create index species_knowledge_index_status_idx
  on public.species_knowledge_index (status);

create index species_knowledge_index_created_by_idx
  on public.species_knowledge_index (created_by);

create index species_knowledge_index_updated_by_idx
  on public.species_knowledge_index (updated_by);

comment on column public.species_knowledge_index.species_id is
  'Foreign key to species_database(id); identifies the species to which the guidance applies.';

comment on column public.species_knowledge_index.status is
  'pending or reviewed. Pending entries are not authoritative operational guidance.';

comment on column public.species_knowledge_index.created_by is
  'Profile that approved the initial entry. Nullable for seeded system data.';

comment on column public.species_knowledge_index.updated_by is
  'Profile responsible for the most recent change to the knowledge entry.';
