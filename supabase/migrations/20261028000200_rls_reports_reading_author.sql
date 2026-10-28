-- 1.11c: Reports reading and author permissions.
--
-- Three layers (locked design §6 reports):
--   1. Narrow grants — table SELECT; column-level INSERT/UPDATE for author
--      fields; DELETE for own drafts; no anon privileges; no client privileges on
--      identity, audit, submission timestamp, review, AI or management-review columns.
--   2. RLS — linked-profile SELECT per locked visibility matrix; own draft INSERT;
--      own draft UPDATE (including submit) and DELETE.
--   3. BEFORE INSERT OR UPDATE trigger — privileged vs client split; stamp
--      created_by / submitted_at / updated_by; reject non-author field changes.
--
-- Status-only overview: public.list_own_report_status_overview() is SECURITY
-- DEFINER with search_path ''. Confidentiality does not rely on RLS; it relies
-- on created_by = private.current_profile_id(), review_status = reviewed and
-- record_status in (sealed, withdrawn), a two-column projection (id,
-- record_status), and EXECUTE granted only to authenticated.
--
-- Trigger order (PostgreSQL alphabetical BEFORE triggers on UPDATE):
--   reports_enforce_lifecycle_update
--   reports_enforce_write
--   reports_set_updated_at
-- Lifecycle runs first and allows draft/active → submitted/active without
-- requiring submitted_at yet; reports_enforce_write then stamps submitted_at
-- with now(); CHECKs run after all BEFORE triggers. Do not modify the existing
-- lifecycle function or withdrawal-propagation trigger in this migration.
--
-- Deferred to 1.11d: Senior/Management review writes, management-review flag,
-- withdraw, archive, seal, unseal. Those need additive UPDATE grants, new UPDATE
-- policies and extended write-trigger branches — not a broadening of
-- reports_update_own_draft. UPDATE ... RETURNING * after withdraw will fail
-- SELECT policies (no role may read withdrawn contents); prefer no RETURNING
-- or a later confirmation RPC. SEC-02 still applies to any service_role path.
--
-- Preserves existing CHECKs, FKs, lifecycle triggers and knowledge withdrawal
-- propagation. Does not change species, specimens, profiles or knowledge tables.
-- No unrestricted SECURITY DEFINER write RPCs.

-- ---------------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------------

revoke all on table public.reports from anon, authenticated;

grant select on table public.reports to authenticated;

grant insert (
  species_id,
  specimen_id,
  title,
  body,
  report_type
) on table public.reports to authenticated;

grant update (
  title,
  body,
  report_type,
  species_id,
  specimen_id,
  review_status
) on table public.reports to authenticated;

grant delete on table public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------------------------

create policy reports_select_own_authoring
on public.reports
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and created_by = (select private.current_profile_id())
  and review_status in ('draft', 'submitted')
  and record_status = 'active'
);

create policy reports_select_submitted_reviewers
on public.reports
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) in ('senior', 'management')
  and review_status = 'submitted'
  and record_status = 'active'
);

create policy reports_select_reviewed_open
on public.reports
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and review_status = 'reviewed'
  and record_status in ('active', 'archived')
);

create policy reports_select_sealed_management
on public.reports
for select
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) = 'management'
  and review_status = 'reviewed'
  and record_status = 'sealed'
);

create policy reports_insert_own_draft
on public.reports
for insert
to authenticated
with check (
  created_by = (select private.current_profile_id())
  and review_status = 'draft'
  and record_status = 'active'
  and submitted_at is null
  and reviewed_at is null
  and reviewed_by is null
  and review_note is null
  and ai_summary is null
  and ai_keywords is null
  and management_review_requested = false
  and management_review_requested_at is null
  and management_review_requested_by is null
);

create policy reports_update_own_draft
on public.reports
for update
to authenticated
using (
  created_by = (select private.current_profile_id())
  and review_status = 'draft'
  and record_status = 'active'
)
with check (
  created_by = (select private.current_profile_id())
  and (
    (review_status = 'draft' and record_status = 'active')
    or (review_status = 'submitted' and record_status = 'active')
  )
);

create policy reports_delete_own_draft
on public.reports
for delete
to authenticated
using (
  created_by = (select private.current_profile_id())
  and review_status = 'draft'
  and record_status = 'active'
);

-- ---------------------------------------------------------------------------
-- 3. Write-validation trigger (author ops only; 1.11d extends later)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_report_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_privileged boolean;
  acting_id uuid;
  is_submit boolean;
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
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception
        'reports update rejected: id, created_by and created_at are immutable';
    end if;
  end if;

  if is_privileged then
    return new;
  end if;

  if (select auth.uid()) is null then
    raise exception
      'reports write rejected: authenticated session required';
  end if;

  acting_id := (select private.current_profile_id());
  if acting_id is null then
    raise exception
      'reports write rejected: linked application profile required';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := acting_id;
    new.review_status := 'draft';
    new.record_status := 'active';
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    new.ai_summary := null;
    new.ai_keywords := null;
    new.management_review_requested := false;
    new.management_review_requested_at := null;
    new.management_review_requested_by := null;
    new.updated_by := acting_id;
    return new;
  end if;

  -- Client UPDATE: author draft edit or submit only (1.11c).
  if old.created_by is distinct from acting_id
     or old.review_status is distinct from 'draft'
     or old.record_status is distinct from 'active' then
    raise exception
      'reports update rejected: authors may only update their own draft/active reports';
  end if;

  if new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.review_note is distinct from old.review_note
     or new.ai_summary is distinct from old.ai_summary
     or new.ai_keywords is distinct from old.ai_keywords
     or new.management_review_requested
          is distinct from old.management_review_requested
     or new.management_review_requested_at
          is distinct from old.management_review_requested_at
     or new.management_review_requested_by
          is distinct from old.management_review_requested_by then
    raise exception
      'reports update rejected: review, AI and management-review fields are not writable through author operations';
  end if;

  if new.record_status is distinct from 'active' then
    raise exception
      'reports update rejected: authors may not change record_status';
  end if;

  is_submit :=
    new.review_status = 'submitted'
    and new.record_status = 'active';

  if new.review_status = 'draft' and new.record_status = 'active' then
    new.submitted_at := old.submitted_at;
  elsif is_submit then
    new.submitted_at := now();
  else
    raise exception
      'reports update rejected: authors may only keep a draft active or submit it';
  end if;

  new.updated_by := acting_id;
  return new;
end;
$$;

revoke all on function public.enforce_report_write()
  from public, anon, authenticated;

create trigger reports_enforce_write
before insert or update on public.reports
for each row
execute function public.enforce_report_write();

comment on function public.enforce_report_write() is
  'BEFORE INSERT/UPDATE on reports: privileged vs client split; author draft create/edit/submit only in 1.11c; stamp created_by, submitted_at and updated_by for linked client writers. Extend in 1.11d for reviewer/lifecycle writes.';

comment on trigger reports_enforce_write on public.reports is
  'Runs alphabetically after reports_enforce_lifecycle_update and before reports_set_updated_at; stamps submitted_at on submit and updated_by, then set_updated_at maintains updated_at.';

-- ---------------------------------------------------------------------------
-- 4. Restricted author status-only overview (sealed / withdrawn)
-- ---------------------------------------------------------------------------

create or replace function public.list_own_report_status_overview()
returns table (
  id uuid,
  record_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  acting_id uuid;
begin
  acting_id := (select private.current_profile_id());
  if acting_id is null then
    return;
  end if;

  return query
  select
    r.id,
    r.record_status
  from public.reports as r
  where r.created_by = acting_id
    and r.review_status = 'reviewed'
    and r.record_status in ('sealed', 'withdrawn');
end;
$$;

revoke all on function public.list_own_report_status_overview()
  from public, anon, service_role;
grant execute on function public.list_own_report_status_overview()
  to authenticated;

comment on function public.list_own_report_status_overview() is
  'SECURITY DEFINER status-only overview: returns only id and record_status for the caller''s own reviewed/sealed or reviewed/withdrawn reports. Confidentiality depends on owner filter, status predicate, two-column projection, empty search_path and EXECUTE limited to authenticated — not on RLS.';

-- ---------------------------------------------------------------------------
-- 5. Reviewer verification notes (do not run inside this migration)
-- ---------------------------------------------------------------------------
-- Privilege combination (as role authenticated):
--   select has_table_privilege('authenticated', 'public.reports', 'SELECT');   -- true
--   select has_table_privilege('authenticated', 'public.reports', 'DELETE');   -- true
--   select has_column_privilege('authenticated', 'public.reports', 'title', 'UPDATE');          -- true
--   select has_column_privilege('authenticated', 'public.reports', 'review_status', 'UPDATE'); -- true
--   select has_column_privilege('authenticated', 'public.reports', 'submitted_at', 'UPDATE');  -- false
--   select has_column_privilege('authenticated', 'public.reports', 'record_status', 'UPDATE'); -- false
--   select has_column_privilege('authenticated', 'public.reports', 'reviewed_by', 'UPDATE');   -- false
--   select has_column_privilege('authenticated', 'public.reports', 'created_by', 'INSERT');  -- false
--   select has_column_privilege('authenticated', 'public.reports', 'updated_by', 'UPDATE');    -- false
--
-- Expected behavioural checks after you apply (independent Work Mode / 1.12):
--   Linked roles: own draft SELECT/INSERT/UPDATE/DELETE/submit; submitted_at
--     server-stamped; updated_by = private.current_profile_id().
--   Senior/Management: SELECT others' submitted/active; Employee: denied.
--   All linked: SELECT reviewed/active and reviewed/archived.
--   Management: SELECT sealed contents; Employee/Senior: sealed contents denied.
--   Any role: withdrawn contents denied via table SELECT.
--   list_own_report_status_overview(): only own sealed/withdrawn id+record_status.
--   Unlinked authenticated / anon: no table DML/SELECT; anon no overview EXECUTE.
