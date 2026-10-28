-- 1.11d: Report reviewer and lifecycle permissions.
--
-- Extends 1.11c (locked design §6 reports):
--   1. Additive column UPDATE grants for reviewer/lifecycle fields.
--   2. New permissive UPDATE policies for review, management-review request,
--      and Management archive/seal/unseal. Policies are author-agnostic for
--      reviewers (Senior/Management may act on other users' reports). created_by
--      immutability remains in enforce_report_lifecycle_update / write trigger.
--   3. Extended enforce_report_write() branches: author draft (1.11c), distinct
--      management-review request, submitted review/approve, Management
--      archive/seal/unseal. Client withdrawal is rejected.
--   4. Controlled public.withdraw_report() SECURITY DEFINER RPC — required
--      because PostgreSQL applies SELECT policies to the new row of any UPDATE
--      that reads the relation (WHERE / RETURNING); no SELECT policy covers
--      withdrawn contents, and widening SELECT would break confidentiality.
--
-- Management-review requests are distinct operations: raising the flag must not
-- accompany AI, review_note or review-outcome changes in the same statement.
--
-- Preserves: 1.11c author INSERT/UPDATE/DELETE and SELECT policies; status-only
-- overview RPC; lifecycle CHECKs and enforce_report_lifecycle_update; AFTER
-- UPDATE withdrawal-propagation trigger (propagate_report_withdrawal_to_knowledge).
-- Does not change species, specimens, profiles or knowledge RLS (1.11e).
--
-- Trigger order (unchanged):
--   reports_enforce_lifecycle_update
--   reports_enforce_write
--   reports_set_updated_at
-- Then CHECKs; then AFTER withdrawal propagation when record_status → withdrawn.

-- ---------------------------------------------------------------------------
-- 1. Privileges (restate 1.11c + reviewer/lifecycle columns)
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
  review_status,
  record_status,
  review_note,
  ai_summary,
  ai_keywords,
  management_review_requested
) on table public.reports to authenticated;

grant delete on table public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS UPDATE policies (author-agnostic for reviewers; no withdrawn end-state)
-- ---------------------------------------------------------------------------

-- Partial AI / review_note save and approve → reviewed/active.
-- Senior: unflagged submitted/active only. Management: flagged or unflagged.
-- WITH CHECK never allows withdrawn (withdrawal is RPC-only).
-- Senior WITH CHECK keeps management_review_requested = false so flag raising
-- cannot ride on this policy; use reports_update_request_management_review.
create policy reports_update_review_submitted
on public.reports
for update
to authenticated
using (
  (select private.current_profile_id()) is not null
  and review_status = 'submitted'
  and record_status = 'active'
  and (
    (select private.current_profile_role()) = 'management'
    or (
      (select private.current_profile_role()) = 'senior'
      and management_review_requested = false
    )
  )
)
with check (
  (select private.current_profile_id()) is not null
  and (
    (
      review_status = 'submitted'
      and record_status = 'active'
      and (
        (select private.current_profile_role()) = 'management'
        or (
          (select private.current_profile_role()) = 'senior'
          and management_review_requested = false
        )
      )
    )
    or (
      review_status = 'reviewed'
      and record_status = 'active'
      and (
        (select private.current_profile_role()) = 'management'
        or (
          (select private.current_profile_role()) = 'senior'
          and management_review_requested = false
        )
      )
    )
  )
);

-- Distinct management-review request: false → true while submitted/active.
-- Write trigger forbids simultaneous AI / review_note / outcome changes.
create policy reports_update_request_management_review
on public.reports
for update
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) in ('senior', 'management')
  and review_status = 'submitted'
  and record_status = 'active'
  and management_review_requested = false
)
with check (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) in ('senior', 'management')
  and review_status = 'submitted'
  and record_status = 'active'
  and management_review_requested = true
);

-- Management archive / seal / unseal only (not withdraw).
create policy reports_update_management_lifecycle
on public.reports
for update
to authenticated
using (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) = 'management'
  and review_status = 'reviewed'
  and record_status in ('active', 'sealed')
)
with check (
  (select private.current_profile_id()) is not null
  and (select private.current_profile_role()) = 'management'
  and review_status = 'reviewed'
  and record_status in ('active', 'archived', 'sealed')
);

-- ---------------------------------------------------------------------------
-- 3. Extended write-validation trigger
-- ---------------------------------------------------------------------------

create or replace function public.enforce_report_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_privileged boolean;
  acting_id uuid;
  acting_role text;
  is_submit boolean;
  is_flag_request boolean;
  is_approve boolean;
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

  acting_role := (select private.current_profile_role());

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

  -- Reject client withdrawal; use public.withdraw_report().
  if new.record_status = 'withdrawn' then
    raise exception
      'reports update rejected: withdrawal must use withdraw_report()';
  end if;

  -- -----------------------------------------------------------------------
  -- Author draft edit / submit (1.11c)
  -- -----------------------------------------------------------------------
  if old.created_by = acting_id
     and old.review_status = 'draft'
     and old.record_status = 'active' then
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
  end if;

  -- -----------------------------------------------------------------------
  -- Distinct management-review request (false → true only)
  -- -----------------------------------------------------------------------
  is_flag_request :=
    old.review_status = 'submitted'
    and old.record_status = 'active'
    and new.review_status = 'submitted'
    and new.record_status = 'active'
    and old.management_review_requested = false
    and new.management_review_requested = true;

  if is_flag_request then
    if acting_role is distinct from 'senior'
       and acting_role is distinct from 'management' then
      raise exception
        'reports update rejected: only senior or management may request management review';
    end if;

    if new.species_id is distinct from old.species_id
       or new.specimen_id is distinct from old.specimen_id
       or new.report_type is distinct from old.report_type
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.submitted_at is distinct from old.submitted_at
       or new.ai_summary is distinct from old.ai_summary
       or new.ai_keywords is distinct from old.ai_keywords
       or new.review_note is distinct from old.review_note
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by then
      raise exception
        'reports update rejected: management-review request cannot change content, AI, review note or review outcome';
    end if;

    new.management_review_requested_at := now();
    new.management_review_requested_by := acting_id;
    new.updated_by := acting_id;
    return new;
  end if;

  -- -----------------------------------------------------------------------
  -- Reviewer partial save / approve on submitted/active
  -- -----------------------------------------------------------------------
  if old.review_status = 'submitted'
     and old.record_status = 'active' then
    if acting_role = 'management' then
      null;
    elsif acting_role = 'senior' and old.management_review_requested = false then
      null;
    else
      raise exception
        'reports update rejected: insufficient role for this review operation';
    end if;

    -- Flag trio immutable on this path (raise flag via distinct operation).
    if new.management_review_requested
          is distinct from old.management_review_requested
       or new.management_review_requested_at
            is distinct from old.management_review_requested_at
       or new.management_review_requested_by
            is distinct from old.management_review_requested_by then
      raise exception
        'reports update rejected: management-review metadata cannot change during review save or approval';
    end if;

    if new.species_id is distinct from old.species_id
       or new.specimen_id is distinct from old.specimen_id
       or new.report_type is distinct from old.report_type
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.submitted_at is distinct from old.submitted_at then
      raise exception
        'reports update rejected: submitted report content and submitted_at are immutable';
    end if;

    is_approve :=
      new.review_status = 'reviewed'
      and new.record_status = 'active';

    if new.review_status = 'submitted' and new.record_status = 'active' then
      new.reviewed_at := old.reviewed_at;
      new.reviewed_by := old.reviewed_by;
    elsif is_approve then
      new.reviewed_at := now();
      new.reviewed_by := acting_id;
    else
      raise exception
        'reports update rejected: reviewers may only keep submitted/active or approve to reviewed/active';
    end if;

    new.updated_by := acting_id;
    return new;
  end if;

  -- -----------------------------------------------------------------------
  -- Management archive / seal / unseal
  -- -----------------------------------------------------------------------
  if acting_role = 'management'
     and old.review_status = 'reviewed'
     and new.review_status = 'reviewed' then
    if not (
      (
        old.record_status = 'active'
        and new.record_status in ('archived', 'sealed')
      )
      or (
        old.record_status = 'sealed'
        and new.record_status = 'active'
      )
    ) then
      raise exception
        'reports update rejected: invalid management lifecycle transition';
    end if;

    if new.species_id is distinct from old.species_id
       or new.specimen_id is distinct from old.specimen_id
       or new.report_type is distinct from old.report_type
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.submitted_at is distinct from old.submitted_at
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.ai_summary is distinct from old.ai_summary
       or new.ai_keywords is distinct from old.ai_keywords
       or new.management_review_requested
            is distinct from old.management_review_requested
       or new.management_review_requested_at
            is distinct from old.management_review_requested_at
       or new.management_review_requested_by
            is distinct from old.management_review_requested_by then
      raise exception
        'reports update rejected: archive, seal and unseal may only change record_status and review_note';
    end if;

    new.updated_by := acting_id;
    return new;
  end if;

  raise exception
    'reports update rejected: operation not permitted for this user or report state';
end;
$$;

revoke all on function public.enforce_report_write()
  from public, anon, authenticated;

comment on function public.enforce_report_write() is
  'BEFORE INSERT/UPDATE on reports: privileged vs client split; author draft create/edit/submit; distinct management-review request; Senior/Management review save and approve; Management archive/seal/unseal; stamps submitted_at, reviewed_*, management-review metadata and updated_by. Client withdrawal rejected — use withdraw_report().';

comment on trigger reports_enforce_write on public.reports is
  'Runs alphabetically after reports_enforce_lifecycle_update and before reports_set_updated_at; stamps submission/review/audit fields for authorised client writers.';

-- ---------------------------------------------------------------------------
-- 4. Controlled withdrawal RPC (SEC-02)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER bypasses RLS so the transition into withdrawn can succeed
-- without a SELECT policy on withdrawn rows. Caller AuthN/AuthZ and audit
-- identity are enforced inside the function. Existing AFTER trigger
-- propagate_report_withdrawal_to_knowledge runs in the same transaction.

create or replace function public.withdraw_report(
  p_report_id uuid,
  p_review_note text default null
)
returns table (
  id uuid,
  review_status text,
  record_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_id uuid;
  acting_role text;
  target public.reports%rowtype;
begin
  -- Uniform error text: avoid disclosing existence, state or role details.
  if (select auth.uid()) is null then
    raise exception 'report withdrawal rejected';
  end if;

  acting_id := (select private.current_profile_id());
  acting_role := (select private.current_profile_role());

  if acting_id is null
     or acting_role is null
     or acting_role not in ('senior', 'management') then
    raise exception 'report withdrawal rejected';
  end if;

  select r.*
  into target
  from public.reports as r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'report withdrawal rejected';
  end if;

  if target.review_status = 'submitted'
     and target.record_status = 'active' then
    if target.management_review_requested
       and acting_role is distinct from 'management' then
      raise exception 'report withdrawal rejected';
    end if;

    update public.reports as r
    set
      review_status = 'reviewed',
      record_status = 'withdrawn',
      reviewed_at = now(),
      reviewed_by = acting_id,
      review_note = case
        when p_review_note is null then r.review_note
        else p_review_note
      end,
      updated_by = acting_id
    where r.id = p_report_id;

  elsif target.review_status = 'reviewed'
     and target.record_status = 'active' then
    update public.reports as r
    set
      record_status = 'withdrawn',
      review_note = case
        when p_review_note is null then r.review_note
        else p_review_note
      end,
      updated_by = acting_id
    where r.id = p_report_id;

  else
    raise exception 'report withdrawal rejected';
  end if;

  return query
  select
    p_report_id,
    'reviewed'::text,
    'withdrawn'::text;
end;
$$;

revoke all on function public.withdraw_report(uuid, text)
  from public, anon, service_role;
grant execute on function public.withdraw_report(uuid, text)
  to authenticated;

comment on function public.withdraw_report(uuid, text) is
  'SECURITY DEFINER controlled withdrawal: AuthN/AuthZ caller; locks and revalidates the row; stamps reviewed_* when withdrawing submitted reports and updated_by always; returns id/review_status/record_status only. Relies on propagate_report_withdrawal_to_knowledge for atomic source-link removal and knowledge pending. Confidentiality: no withdrawn content returned; table SELECT still denies withdrawn rows.';

-- ---------------------------------------------------------------------------
-- 5. Verification notes (do not run inside this migration)
-- ---------------------------------------------------------------------------
-- Privileges:
--   select has_column_privilege('authenticated', 'public.reports', 'record_status', 'UPDATE'); -- true
--   select has_column_privilege('authenticated', 'public.reports', 'ai_summary', 'UPDATE');    -- true
--   select has_column_privilege('authenticated', 'public.reports', 'reviewed_by', 'UPDATE');    -- false
--   select has_column_privilege('authenticated', 'public.reports', 'management_review_requested_by', 'UPDATE'); -- false
--   select has_column_privilege('authenticated', 'public.reports', 'updated_by', 'UPDATE');     -- false
--
-- Positive (linked profiles; Work Mode):
--   Senior on unflagged submitted (other author's): save AI/review_note; approve →
--     reviewed/active with reviewed_by = senior profile; updated_by stamped.
--   Senior: request management review alone (flag true + at/by stamped); SELECT still ok.
--   Management on flagged submitted: save AI/note; approve; withdraw_report().
--   Senior: withdraw_report() on reviewed/active even if historically flagged.
--   Management: archive; seal; unseal; source links retained; knowledge status unchanged.
--   After withdraw_report(): species_knowledge_sources for that report gone; affected
--     knowledge entries pending with updated_by = withdrawer; overview RPC id+withdrawn
--     for author; select * from reports where id = … → 0 rows for all roles.
--
-- Negative:
--   Employee: review/flag/approve/archive/seal/withdraw_report all rejected.
--   Senior on flagged submitted: AI/note/approve UPDATE rejected; withdraw_report rejected.
--   Senior: flag request combined with AI or review_note change in one UPDATE rejected.
--   Direct UPDATE … SET record_status = 'withdrawn' rejected (trigger and/or RLS).
--   Forge reviewed_by / management_review_requested_by / updated_by via client rejected.
--   Unauthorised withdraw_report (wrong role/state/flag): generic 'report withdrawal rejected'.
--   Repeated withdraw_report on already withdrawn: rejected (no second transition).
--   Concurrent withdraw_report: row lock; one succeeds; loser revalidates and rejects.
--   Forced failure inside withdrawal propagation (e.g. simulated) rolls back report
--     transition and knowledge changes together.
--   Author 1.11c draft create/edit/submit/delete still works; SELECT matrix unchanged;
--   list_own_report_status_overview unchanged.
