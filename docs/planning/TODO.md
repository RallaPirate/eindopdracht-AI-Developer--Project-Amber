# Project Amber — Deferred Tasks & Known Issues

Purpose: Track bugs, improvements and follow-up work discovered during implementation without expanding the scope of the current task.

The locked `amber_execution_order.md` remains the authoritative implementation sequence. This document records additional observations and follow-up tasks.

## Bugs

- [ ] **TASKBAR-01 — Taskbar buttons change order when windows gain focus.**
  - Observed during baseline verification (0.2).
  - Expected: taskbar buttons retain their opening order; the active button appears pressed.
  - Likely cause: `Taskbar.tsx` sorts windows by `zIndex`.
  - Verify after fixing: opening, focusing and closing several windows preserves the expected taskbar behaviour.

  - [ ] **AUTH-UI-01 — Profile display name intermittently falls back to email.**
  - Observed during task 1.1 verification: a newly registered employee had the correct `profiles.display_name` in Supabase, but the UI initially displayed the email address instead.
  - Expected: the UI displays `profiles.display_name` after the authenticated profile lookup succeeds.
  - Current status: unreproducible after 24 hours; the correct display name now appears in both local development and production.
  - Root cause of the original intermittent fallback remains unknown; no functional fix applied.
  - Separate follow-up (do not treat as the explanation for the intermittent fallback above): ensure a delayed `enrichDisplayName()` response cannot overwrite the displayed identity after logout or account switching.
  - If the intermittent fallback recurs, inspect the `enrichDisplayName()` query result, Supabase errors and asynchronous UI updates.
  - Verify after fixing: correct display name after registration, login, refresh and session restoration; no stale name after logout or account switch.

  - [ ] TECH: Fix render-time ref assignments in
  `src/components/desktop/BioReserveShell.tsx`
  (lines 92–93, `react-hooks/refs`).
  Move ref synchronisation to a React-safe pattern
  while preserving boot, session restoration,
  welcome screen and account-switching behaviour.
  Verify with ESLint and a manual authentication
  smoke test.
  Priority: Low — pre-existing, non-blocking.

  - [ ] **SPECIES-UI-01 — Species list does not refresh after accepting a new species.**
  - Observed during Step 3.9 production verification (8 November 2026).
  - After Management successfully accepts and saves an AI-generated species proposal, the new species does not appear in the existing Species Database browse list.
  - Closing and reopening the Species Database window displays the newly created species correctly, confirming that persistence succeeded.
  - Expected: the browse list updates automatically after successful acceptance, without requiring the window to be reopened.
  - Investigate the TanStack Query cache invalidation/refetch and list synchronisation following species acceptance. The acceptance mutation already requests invalidation, so verify why the mounted list remains stale before changing the implementation.
  - Verify after fixing: an accepted species appears immediately; rejected proposals do not alter the list; existing authentication-aware cache isolation remains intact.
  - **Priority:** Low — non-blocking usability defect. Defer until after the essential implementation milestones.

## Authentication improvements

- [ ] **AUTH-01 — Session verification errors have no recovery UI.**
  - Observed during baseline verification (0.2) while Supabase was unavailable.
  - Distinguish transient authentication-service failures (e.g. Auth/API unreachable) from genuinely invalid or absent sessions, and surface them differently in the UI.
  - Add a retry mechanism for transient authentication failures.
  - Provide a safe way to return to login when a stored session is unusable.
  - Do not grant desktop access without successful authentication.
  - Test using mocked authentication failures or controlled network failure scenarios.
  - Actual incident resolved after Supabase resumed.

  ### REPORT-VERIFY-01 — Deferred live verification of report draft editing

**Applies to:** Step 4.6 — Report Draft Editing.

**Priority:** Low — deferred, non-blocking.

- [ ] Test a failed report UPDATE while authentication remains verified. Confirm that unsaved inputs survive and retry succeeds.
- [ ] Investigate the loss of unsaved editor input during full network disconnection. Coordinate with existing AUTH-01; do not weaken authentication or protected-data safeguards.
- [ ] Verify direct authenticated UPDATE denial for another author's draft and for non-draft reports, using disposable test records. Confirm that rejected operations leave stored data unchanged.
- [ ] Verify specimen-linked editing against live Supabase when a suitable fixture exists.

**Background:** During local Step 4.6 testing on 11 November 2026, taking the browser fully offline caused Authentication.exe to suspend protected access and the editor's unsaved changes were lost. This did not isolate a failed UPDATE under an otherwise verified session. Cross-author draft visibility was checked through the UI, but direct unauthorised UPDATE attempts were not performed.

**Completion criterion:** Outstanding scenarios are verified and recorded in `docs/evidence/verification.md`, with any confirmed defects addressed separately.

## Notes

- These items are not automatically blockers.
- Address them at an appropriate point in the implementation schedule.
- Do not implement unrelated changes while completing an existing checklist task.
- Mark items complete only after verifying the expected behaviour.


- [X] TECH: Identity-aware TanStack Query cache isolation
  across all authentication state changes, including
  session restoration, expiry, logout, account switching
  and unexpected sign-out.
  Ensure authenticated query keys include the verified
  user identity, and pending requests cannot repopulate
  another user's cache.
  Must be completed before Step 3.1 introduces private
  cached queries.
  Authenticated reads and writes go through
  `useAuthenticatedQuery` / `useAuthenticatedMutation`.
  The browser cache binds to the verified Auth user id
  from `getClaims()`, and a `profiles.role` change removes
  cached rows for that same user. `initialData` is not restored.
    Verification (2026-11-01):
  - Independent Stage 2 acceptance review: PASS.
  - 52/52 automated tests passed; TypeScript and production
    build passed.
  - 5/5 final local browser smoke checks passed, covering
    login, restoration, account switching, unexpected sign-out,
    reauthentication and desktop behaviour.
  - Protected mutation callbacks use the epoch-bound cache
    capability documented in useAuthenticatedQuery.ts.




### SEC-01 — Replace insecure development credentials before Vercel deployment

**Priority:** High — blocks task 0.5.

- [X] Identify existing disposable test accounts in Supabase Auth.
- [X] Replace weak passwords with strong, unique credentials or remove unnecessary test accounts.
- [X] Before deleting accounts, check whether any existing application records must be preserved.
- [X] Verify that no test credentials or secrets have been committed to GitHub.
- [X] Check which Supabase project the Vercel deployment will connect to.
- [X] Verify that the deployed application does not provide unintended access to protected data.
- [X] Keep credentials out of repository files, including documentation and test fixtures.

**Completion criterion:** No publicly accessible deployment relies on known weak test credentials.


### SEC-02 — Enforce authorisation in privileged server-side database operations

**Applies to:** Sections 3–4 and all subsequent controlled workflows using privileged database access.

- [ ] Prefer authenticated, user-scoped Supabase operations where practical.
- [ ] Whenever `service_role` or another privileged database context is required, verify the authenticated caller's linked profile and permissions server-side before writing.
- [ ] Explicitly enforce the relevant role, ownership, field-level and workflow restrictions from `database_design_v2.md` that privileged access would otherwise bypass through RLS.
- [ ] Ensure `updated_by` records the acting user's permanent `profiles.id` for authorised user-initiated changes.
- [ ] Test unauthorised operations, including insufficient roles and attempts to modify restricted fields or records.
- [ ] Verify that rejected operations do not persist unauthorised changes.

**Completion criterion:** All privileged server-side write workflows enforce the authenticated user's permissions, preserve audit-field integrity and reject unauthorised changes, even when RLS is bypassed.


### REPORT-OVERVIEW-01 — Combine RLS reads with status-only sealed/withdrawn overview

**Applies to:** Execution-order steps 4.11 and 5.9 (author report overview UI / data layer).

- [ ] Build the author overview from two sources only: (1) ordinary reports the author may read through normal RLS-protected `reports` queries; (2) the author’s own sealed/withdrawn rows via the restricted overview RPC (`id` + `record_status` only).
- [ ] Do not fetch or display confidential fields for sealed/withdrawn reports; do not attempt unrestricted `SELECT` of those rows for non-Management (or for withdrawn for any role).
- [ ] Do not include reports authored by other users in the author overview.
- [ ] Keep sealed/withdrawn entries non-clickable in the UI as specified in `database_design_v2.md`.

**Completion criterion:** The overview lists the author’s accessible reports plus UUID/status-only sealed and withdrawn references, without leaking confidential report contents or other authors’ reports.