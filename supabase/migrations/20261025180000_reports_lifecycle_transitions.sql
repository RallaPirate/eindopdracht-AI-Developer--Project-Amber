-- Report lifecycle transitions and post-submission immutability (task 1.9).
--
-- Complements the field/state CHECK constraints from task 1.8 with a
-- BEFORE UPDATE trigger that enforces:
--   - permitted review_status / record_status transitions
--   - always-immutable identity fields
--   - post-submission content immutability
--   - completed-review metadata preservation once reviewed
--   - accepted AI field preservation after review and on withdraw-from-submitted
--
-- Preserves the existing AFTER UPDATE withdrawal propagation trigger.
-- Deferred:
--   1.10  management-review flag invariants and historical requester/timestamp
--   1.11  RLS policies and role-based authorisation

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: transitions and immutability
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

create trigger reports_enforce_lifecycle_update
before update on public.reports
for each row
execute function public.enforce_report_lifecycle_update();

comment on function public.enforce_report_lifecycle_update() is
  'BEFORE UPDATE on reports: permitted lifecycle transitions, post-submission immutability, completed-review and accepted-AI preservation. Management-review flag rules deferred to task 1.10.';
