-- 1.11e: RLS permissions and field-level enforcement for
-- species_knowledge_index and species_knowledge_sources.
--
-- Three layers (locked design §6):
--   1. Narrow grants — SELECT for linked clients; column-level INSERT/UPDATE on
--      knowledge index; Management DELETE on knowledge index; SELECT-only on
--      sources. No anon privileges. No client INSERT/UPDATE/DELETE on sources.
--   2. RLS — role-aware SELECT (Employee reviewed-only; Senior/Management all);
--      Senior/Management INSERT/UPDATE on knowledge; Management DELETE;
--      sources SELECT only (no write policies).
--   3. BEFORE INSERT OR UPDATE trigger on knowledge index — privileged vs client
--      session split; immutable identity/audit fields; force reviewed on INSERT;
--      reject client reviewed→pending; stamp created_by/updated_by from
--      private.current_profile_id() on authorised client writes.
--
-- Privileged database sessions (service_role JWT, or current_user with
-- SUPERUSER/BYPASSRLS) are detected explicitly. A missing/null auth.uid() on an
-- ordinary role is rejected — it is not treated as a trusted admin path.
-- Privileged sessions keep identity immutability on UPDATE, do not call the
-- private profile helpers, and do not overwrite updated_by. This preserves
-- propagate_report_withdrawal_to_knowledge() which sets status='pending' and
-- updated_by from the withdrawn report while running as SECURITY DEFINER.
--
-- Trigger order (PostgreSQL alphabetical BEFORE triggers on the same event):
--   species_knowledge_enforce_write  then  species_knowledge_set_updated_at
-- Field triggers assign NEW.created_by / NEW.updated_by without requiring client
-- INSERT/UPDATE privilege on those columns (privilege checks apply to the
-- statement column lists). Existing set_updated_at continues to maintain updated_at.
--
-- Management DELETE of a knowledge entry relies on the existing composite FK
-- species_knowledge_sources → species_knowledge_index ON DELETE CASCADE.
-- PostgreSQL referential-integrity actions bypass row security
-- (https://www.postgresql.org/docs/current/ddl-rowsecurity.html). No extra
-- BEFORE DELETE cleanup function is required. Direct client DELETE on sources
-- remains denied (no grant, no policy). Supporting reports are retained
-- (sources → reports is ON DELETE RESTRICT).
--
-- Source-link INSERT remains workflow-only: no authenticated INSERT grant or
-- policy. Future Section 6 acceptance must use a controlled privileged path
-- (SEC-02) while retaining enforce_species_knowledge_source_eligibility.
--
-- Preserves: withdraw_report(); propagate_report_withdrawal_to_knowledge;
-- enforce_species_knowledge_source_eligibility; existing FKs/CHECKs/uniques;
-- set_updated_at. Does not implement knowledge-acceptance RPC or Agent/UI.
-- No changes to profiles, species_database, specimens or reports policies.

-- ---------------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------------

revoke all on table public.species_knowledge_index from anon, authenticated;
revoke all on table public.species_knowledge_sources from anon, authenticated;

grant select on table public.species_knowledge_index to authenticated;
grant select on table public.species_knowledge_sources to authenticated;

grant insert (
  species_id,
  canonical_topic,
  search_terms,
  guidance_summary
) on table public.species_knowledge_index to authenticated;

grant update (
  canonical_topic,
  search_terms,
  guidance_summary,
  status
) on table public.species_knowledge_index to authenticated;

grant delete on table public.species_knowledge_index to authenticated;

-- species_knowledge_sources: SELECT only. No INSERT/UPDATE/DELETE for authenticated.

-- ---------------------------------------------------------------------------
-- 2. RLS policies — species_knowledge_index
-- ---------------------------------------------------------------------------

create policy species_knowledge_index_select_reviewed
on public.species_knowledge_index
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and status = 'reviewed'
);

create policy species_knowledge_index_select_pending_editors
on public.species_knowledge_index
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) in ('senior', 'management')
);

create policy species_knowledge_index_insert_editors
on public.species_knowledge_index
for insert
to authenticated
with check (
  (select private.current_profile_role()) in ('senior', 'management')
);

create policy species_knowledge_index_update_editors
on public.species_knowledge_index
for update
to authenticated
using (
  (select private.current_profile_role()) in ('senior', 'management')
)
with check (
  (select private.current_profile_role()) in ('senior', 'management')
);

create policy species_knowledge_index_delete_management
on public.species_knowledge_index
for delete
to authenticated
using (
  (select private.current_profile_role()) = 'management'
);

-- ---------------------------------------------------------------------------
-- 3. RLS policies — species_knowledge_sources (SELECT only)
-- ---------------------------------------------------------------------------

create policy species_knowledge_sources_select_reviewed
on public.species_knowledge_sources
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and exists (
    select 1
    from public.species_knowledge_index as k
    where k.id = knowledge_index_id
      and k.status = 'reviewed'
  )
);

create policy species_knowledge_sources_select_editors
on public.species_knowledge_sources
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) in ('senior', 'management')
);

-- ---------------------------------------------------------------------------
-- 4. Write-validation trigger — species_knowledge_index
-- ---------------------------------------------------------------------------

create or replace function public.enforce_species_knowledge_index_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_privileged boolean;
  acting_id uuid;
  acting_role text;
begin
  is_privileged :=
    coalesce((select auth.role()), '') = 'service_role'
    or exists (
      select 1
      from pg_catalog.pg_roles as r
      where r.rolname = current_user
        and (r.rolsuper or r.rolbypassrls)
    );

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.species_id is distinct from old.species_id
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception
        'species_knowledge_index update rejected: id, species_id, created_at and created_by are immutable';
    end if;
  end if;

  if is_privileged then
    return new;
  end if;

  if (select auth.uid()) is null then
    raise exception
      'species_knowledge_index write rejected: authenticated session required';
  end if;

  acting_id := (select private.current_profile_id());
  acting_role := (select private.current_profile_role());
  if acting_id is null then
    raise exception
      'species_knowledge_index write rejected: linked application profile required';
  end if;

  if acting_role is distinct from 'senior'
     and acting_role is distinct from 'management' then
    raise exception
      'species_knowledge_index write rejected: senior or management role required';
  end if;

  if tg_op = 'INSERT' then
    -- Ordinary clients may not create pending entries; human-approved creates
    -- start reviewed. status is not in the INSERT grant; force anyway.
    new.status := 'reviewed';
    new.created_by := acting_id;
    new.updated_by := acting_id;
    return new;
  end if;

  -- UPDATE: status is a workflow decision, not a free label.
  -- pending → reviewed: authorised human reassessment.
  -- reviewed → pending: only trusted withdrawal propagation (privileged path).
  if new.status is distinct from old.status then
    if not (
      old.status = 'pending'
      and new.status = 'reviewed'
    ) then
      raise exception
        'species_knowledge_index update rejected: status transition from % to % is not permitted for client writers',
        old.status,
        new.status;
    end if;
  end if;

  new.updated_by := acting_id;
  return new;
end;
$$;

revoke all on function public.enforce_species_knowledge_index_write()
  from public, anon, authenticated;

create trigger species_knowledge_enforce_write
before insert or update on public.species_knowledge_index
for each row
execute function public.enforce_species_knowledge_index_write();

comment on function public.enforce_species_knowledge_index_write() is
  'BEFORE INSERT/UPDATE on species_knowledge_index: privileged vs client session split; immutable id/species_id/created_at/created_by; force reviewed on INSERT; reject client reviewed→pending; stamp created_by/updated_by for linked Senior/Management writers. Does not prove AI-proposal acceptance — that remains Section 6 / SEC-02.';

comment on trigger species_knowledge_enforce_write on public.species_knowledge_index is
  'Runs alphabetically before species_knowledge_set_updated_at; stamps audit fields then set_updated_at maintains updated_at. Privileged path preserves withdrawal-propagated updated_by.';

-- ---------------------------------------------------------------------------
-- 5. Reviewer verification notes (do not run inside this migration)
-- ---------------------------------------------------------------------------
-- Privilege combination (as role authenticated):
--   select has_table_privilege('authenticated', 'public.species_knowledge_index', 'SELECT');   -- true
--   select has_table_privilege('authenticated', 'public.species_knowledge_index', 'DELETE');   -- true (RLS: Management only)
--   select has_table_privilege('authenticated', 'public.species_knowledge_sources', 'SELECT'); -- true
--   select has_table_privilege('authenticated', 'public.species_knowledge_sources', 'INSERT'); -- false
--   select has_table_privilege('authenticated', 'public.species_knowledge_sources', 'UPDATE'); -- false
--   select has_table_privilege('authenticated', 'public.species_knowledge_sources', 'DELETE'); -- false
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'canonical_topic', 'UPDATE'); -- true
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'status', 'UPDATE');          -- true
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'status', 'INSERT');          -- false
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'species_id', 'UPDATE');      -- false
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'created_by', 'INSERT');      -- false
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'updated_by', 'UPDATE');      -- false
--   select has_column_privilege('authenticated', 'public.species_knowledge_index', 'id', 'INSERT');              -- false
--
-- Expected behavioural checks with linked JWTs (step 1.12 / independent review):
--
-- species_knowledge_index
--   Employee: SELECT reviewed ok; SELECT pending denied; INSERT/UPDATE/DELETE denied.
--   Senior: SELECT all; INSERT human-approved entry → status reviewed, created_by/updated_by
--           = acting profiles.id; UPDATE canonical_topic/search_terms/guidance_summary ok;
--           pending→reviewed ok; reviewed→pending raises trigger rejection; DELETE denied.
--   Management: same writes as Senior; DELETE entry ok.
--   Management DELETE with source links: knowledge row gone; corresponding
--           species_knowledge_sources rows removed via existing ON DELETE CASCADE;
--           supporting reports still present (sources→reports ON DELETE RESTRICT).
--   Unlinked authenticated / anon: no SELECT/INSERT/UPDATE/DELETE.
--   Client SET of id / species_id / created_at / created_by / updated_by / updated_at:
--           denied by missing column privilege and/or trigger.
--
-- species_knowledge_sources
--   Employee: SELECT links of reviewed knowledge only; pending-parent links denied.
--   Senior/Management: SELECT all links; direct INSERT/UPDATE/DELETE denied by privilege.
--
-- Withdrawal regression (critical — must remain atomic):
--   After withdraw_report() on a linked reviewed/active or submitted report:
--           that report's species_knowledge_sources rows gone; every affected
--           knowledge entry status='pending'; guidance_summary and unrelated source
--           links unchanged; knowledge updated_by = withdrawer's profiles.id;
--           updated_at advanced by set_updated_at. Client cannot DELETE sources or
--           set knowledge status to pending directly.
--
-- Confidentiality:
--   Knowledge/sources SELECT never returns report title/body.
--   Following source report_id remains subject to reports RLS (1.11c/d):
--           archived readable as permitted; sealed contents Management-only;
--           withdrawn inaccessible. Sealed-source metadata lookup is later (7.4).
--   Agent reviewed-only operational use is application-layer (Section 7), not RLS.
--
-- Out of scope for 1.11e (already scheduled): Section 6 knowledge-acceptance
-- transaction / SEC-02 privileged source INSERT; step 1.12 full matrix run.
