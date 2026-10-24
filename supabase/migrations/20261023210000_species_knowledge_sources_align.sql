-- Align species_knowledge_sources with database_design_v2 Sections 4–5 / 7.6 (task 1.6).
--
-- Creates the knowledge–report source join table with composite FKs to the
-- already-aligned reports and species_knowledge_index unique (id, species_id)
-- keys, FK indexes, insert eligibility (reviewed/active, FOR SHARE), and
-- withdrawal propagation to pending knowledge entries.
--
-- Assumption: application tables are empty; species_knowledge_sources does not
-- yet exist. No row backfill or conversion.
-- RLS policies are deferred to task 1.11.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.species_knowledge_sources (
  knowledge_index_id uuid not null,
  report_id uuid not null,
  species_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint species_knowledge_sources_pkey
    primary key (knowledge_index_id, report_id),
  constraint species_knowledge_sources_knowledge_index_id_species_id_fkey
    foreign key (knowledge_index_id, species_id)
    references public.species_knowledge_index (id, species_id)
    on delete cascade,
  constraint species_knowledge_sources_report_id_species_id_fkey
    foreign key (report_id, species_id)
    references public.reports (id, species_id)
    on delete restrict,
  constraint species_knowledge_sources_species_id_fkey
    foreign key (species_id)
    references public.species_database (id)
    on delete restrict,
  constraint species_knowledge_sources_created_by_fkey
    foreign key (created_by)
    references public.profiles (id)
);

-- ---------------------------------------------------------------------------
-- Indexes (FK columns not covered as PK-leading)
-- ---------------------------------------------------------------------------

create index species_knowledge_sources_report_id_idx
  on public.species_knowledge_sources (report_id);

create index species_knowledge_sources_species_id_idx
  on public.species_knowledge_sources (species_id);

create index species_knowledge_sources_created_by_idx
  on public.species_knowledge_sources (created_by);

-- ---------------------------------------------------------------------------
-- Insert eligibility: referenced report must be reviewed/active
-- Locks the report row FOR SHARE so a concurrent withdrawal cannot commit
-- between the check and the source-link insert.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_species_knowledge_source_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  report_review_status text;
  report_record_status text;
begin
  select r.review_status, r.record_status
  into report_review_status, report_record_status
  from public.reports as r
  where r.id = new.report_id
  for share;

  if not found then
    raise exception
      'species_knowledge_sources insert rejected: report % does not exist',
      new.report_id;
  end if;

  if report_review_status is distinct from 'reviewed'
     or report_record_status is distinct from 'active' then
    raise exception
      'species_knowledge_sources insert rejected: report % must be reviewed/active (found %/%)',
      new.report_id,
      report_review_status,
      report_record_status;
  end if;

  return new;
end;
$$;

create trigger species_knowledge_sources_enforce_eligibility
before insert on public.species_knowledge_sources
for each row
execute function public.enforce_species_knowledge_source_eligibility();

-- ---------------------------------------------------------------------------
-- Withdrawal propagation: remove this report's source links and set every
-- affected knowledge entry to pending (guidance and other links retained).
-- SECURITY DEFINER so propagation still works once RLS policies exist (1.11).
-- ---------------------------------------------------------------------------

create or replace function public.propagate_report_withdrawal_to_knowledge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with deleted_links as (
    delete from public.species_knowledge_sources as s
    where s.report_id = new.id
    returning s.knowledge_index_id
  )
  update public.species_knowledge_index as k
  set
    status = 'pending',
    updated_by = new.updated_by
  where k.id in (select distinct d.knowledge_index_id from deleted_links as d);

  return new;
end;
$$;

revoke all on function public.propagate_report_withdrawal_to_knowledge()
  from public, anon;

create trigger reports_propagate_withdrawal_to_knowledge
after update of record_status on public.reports
for each row
when (
  old.record_status is distinct from 'withdrawn'
  and new.record_status = 'withdrawn'
)
execute function public.propagate_report_withdrawal_to_knowledge();

-- ---------------------------------------------------------------------------
-- RLS: enable now; policies deferred to task 1.11
-- ---------------------------------------------------------------------------

alter table public.species_knowledge_sources enable row level security;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

comment on table public.species_knowledge_sources is
  'Accepted links between species_knowledge_index entries and supporting reports.';

comment on column public.species_knowledge_sources.knowledge_index_id is
  'Knowledge entry supported by the report; part of composite FK with species_id.';

comment on column public.species_knowledge_sources.report_id is
  'Supporting report; part of composite FK with species_id. Must be reviewed/active at insert.';

comment on column public.species_knowledge_sources.species_id is
  'Species shared by the knowledge entry and report; enforced by dual composite FKs.';

comment on column public.species_knowledge_sources.created_at is
  'When the source relationship was accepted and created.';

comment on column public.species_knowledge_sources.created_by is
  'Senior or management profile that accepted the relationship. Nullable for seeded data.';
