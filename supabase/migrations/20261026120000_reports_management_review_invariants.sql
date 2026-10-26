-- Management-review flag invariants and historical metadata (task 1.10).
--
-- Complements tasks 1.8–1.9 with:
--   - a CHECK requiring requester/timestamp NULL when the flag is false,
--     and both non-NULL when the flag is true
--   - BEFORE UPDATE rules allowing false→true only while submitted/active,
--     and freezing flag + requester + timestamp once set (never unflag)
--
-- Preserves existing 1.9 trigger attachment, function security, and the
-- AFTER UPDATE withdrawal propagation trigger.
-- Deferred:
--   1.11  RLS policies and role-based authorisation

-- ---------------------------------------------------------------------------
-- Flag / requester / timestamp pairing (all lifecycle states)
-- ---------------------------------------------------------------------------

alter table public.reports
  add constraint reports_management_review_metadata_check
  check (
    (
      management_review_requested = false
      and management_review_requested_at is null
      and management_review_requested_by is null
    )
    or (
      management_review_requested = true
      and management_review_requested_at is not null
      and management_review_requested_by is not null
    )
  );

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: extend lifecycle enforcement with management-review rules
-- ---------------------------------------------------------------------------

create or replace function public.enforce_report_lifecycle_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  same_lifecycle boolean;
  preserve_accepted_ai boolean;
begin
  -- Always immutable after insert.
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception
      'reports update rejected: id, created_by and created_at are immutable';
  end if;

  -- Post-submission content and submission timestamp.
  if not (old.review_status = 'draft' and old.record_status = 'active') then
    if new.species_id is distinct from old.species_id
       or new.specimen_id is distinct from old.specimen_id
       or new.report_type is distinct from old.report_type
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.submitted_at is distinct from old.submitted_at then
      raise exception
        'reports update rejected: species_id, specimen_id, report_type, title, body and submitted_at are immutable after submission';
    end if;
  end if;

  -- Completed-review metadata once the report has been reviewed.
  if old.review_status = 'reviewed' then
    if new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by then
      raise exception
        'reports update rejected: reviewed_at and reviewed_by are immutable once review_status is reviewed';
    end if;
  end if;

  -- Accepted AI fields: freeze once reviewed, and on withdraw-from-submitted.
  -- Still writable while submitted/active and during approval to reviewed/active.
  preserve_accepted_ai :=
    old.review_status = 'reviewed'
    or (
      old.review_status = 'submitted'
      and old.record_status = 'active'
      and new.review_status = 'reviewed'
      and new.record_status = 'withdrawn'
    );

  if preserve_accepted_ai then
    if new.ai_summary is distinct from old.ai_summary
       or new.ai_keywords is distinct from old.ai_keywords then
      raise exception
        'reports update rejected: ai_summary and ai_keywords are immutable after review and during withdrawal of a submitted report';
    end if;
  end if;

  -- Management-review flag: false→true only while submitted/active;
  -- once true, flag + at + by are immutable (never unflag).
  if old.management_review_requested then
    if new.management_review_requested is distinct from true
       or new.management_review_requested_at
            is distinct from old.management_review_requested_at
       or new.management_review_requested_by
            is distinct from old.management_review_requested_by then
      raise exception
        'reports update rejected: management_review_requested, management_review_requested_at and management_review_requested_by are immutable once set';
    end if;
  elsif new.management_review_requested then
    if not (
      old.review_status = 'submitted'
      and old.record_status = 'active'
      and new.review_status = 'submitted'
      and new.record_status = 'active'
    ) then
      raise exception
        'reports update rejected: management_review_requested may change from false to true only while the report remains submitted/active';
    end if;
  end if;

  -- Permitted lifecycle transitions (same-state updates allowed).
  same_lifecycle :=
    (old.review_status, old.record_status)
    is not distinct from (new.review_status, new.record_status);

  if not same_lifecycle
     and not (
       old.review_status = 'draft'
       and old.record_status = 'active'
       and new.review_status = 'submitted'
       and new.record_status = 'active'
     )
     and not (
       old.review_status = 'submitted'
       and old.record_status = 'active'
       and new.review_status = 'reviewed'
       and new.record_status = 'active'
     )
     and not (
       old.review_status = 'submitted'
       and old.record_status = 'active'
       and new.review_status = 'reviewed'
       and new.record_status = 'withdrawn'
     )
     and not (
       old.review_status = 'reviewed'
       and old.record_status = 'active'
       and new.review_status = 'reviewed'
       and new.record_status = 'withdrawn'
     )
     and not (
       old.review_status = 'reviewed'
       and old.record_status = 'active'
       and new.review_status = 'reviewed'
       and new.record_status = 'archived'
     )
     and not (
       old.review_status = 'reviewed'
       and old.record_status = 'active'
       and new.review_status = 'reviewed'
       and new.record_status = 'sealed'
     )
     and not (
       old.review_status = 'reviewed'
       and old.record_status = 'sealed'
       and new.review_status = 'reviewed'
       and new.record_status = 'active'
     ) then
    raise exception
      'reports update rejected: lifecycle transition from %/% to %/% is not permitted',
      old.review_status,
      old.record_status,
      new.review_status,
      new.record_status;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_report_lifecycle_update()
  from public, anon;

comment on function public.enforce_report_lifecycle_update() is
  'BEFORE UPDATE on reports: permitted lifecycle transitions, post-submission immutability, completed-review and accepted-AI preservation, and management-review flag invariants.';
