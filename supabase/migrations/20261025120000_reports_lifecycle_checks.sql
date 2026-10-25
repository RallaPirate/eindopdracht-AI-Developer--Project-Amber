-- Report lifecycle field/state CHECK constraints (task 1.8).
--
-- Enforces the valid review_status / record_status pairs and the
-- per-status field requirements from database_design_v2 Section 3.
--
-- Deferred:
--   1.9  permitted transitions and post-submission immutability (BEFORE UPDATE)
--   1.10 general management-review flag consistency and flag transitions
--        (draft-specific flag/metadata rules are enforced here)

-- ---------------------------------------------------------------------------
-- Valid review_status / record_status pairs only
-- ---------------------------------------------------------------------------

alter table public.reports
  add constraint reports_lifecycle_state_check
  check (
    (review_status = 'draft' and record_status = 'active')
    or (review_status = 'submitted' and record_status = 'active')
    or (
      review_status = 'reviewed'
      and record_status in ('active', 'archived', 'withdrawn', 'sealed')
    )
  );

-- ---------------------------------------------------------------------------
-- Draft: no submission/review/AI/management-review metadata
-- ---------------------------------------------------------------------------

alter table public.reports
  add constraint reports_draft_fields_check
  check (
    review_status <> 'draft'
    or (
      submitted_at is null
      and reviewed_at is null
      and reviewed_by is null
      and review_note is null
      and ai_summary is null
      and ai_keywords is null
      and management_review_requested = false
      and management_review_requested_at is null
      and management_review_requested_by is null
    )
  );

-- ---------------------------------------------------------------------------
-- Submitted: submitted_at and content required; review outcome still unset.
-- AI fields, review_note and management-review metadata remain optional here.
-- ---------------------------------------------------------------------------

alter table public.reports
  add constraint reports_submitted_fields_check
  check (
    review_status <> 'submitted'
    or (
      submitted_at is not null
      and reviewed_at is null
      and reviewed_by is null
      and title is not null
      and body is not null
      and report_type is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Reviewed: submission and review metadata required; content required.
-- AI fields, review_note and historical management-review metadata optional.
-- ---------------------------------------------------------------------------

alter table public.reports
  add constraint reports_reviewed_fields_check
  check (
    review_status <> 'reviewed'
    or (
      submitted_at is not null
      and reviewed_at is not null
      and reviewed_by is not null
      and title is not null
      and body is not null
      and report_type is not null
    )
  );
