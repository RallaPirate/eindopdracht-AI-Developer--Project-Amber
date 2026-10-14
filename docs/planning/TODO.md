# Project Amber — Deferred Tasks & Known Issues

Purpose: Track bugs, improvements and follow-up work discovered during implementation without expanding the scope of the current task.

The locked `amber_execution_order.md` remains the authoritative implementation sequence. This document records additional observations and follow-up tasks.

## Bugs

- [ ] **TASKBAR-01 — Taskbar buttons change order when windows gain focus.**
  - Observed during baseline verification (0.2).
  - Expected: taskbar buttons retain their opening order; the active button appears pressed.
  - Likely cause: `Taskbar.tsx` sorts windows by `zIndex`.
  - Verify after fixing: opening, focusing and closing several windows preserves the expected taskbar behaviour.

## Authentication improvements

- [ ] **AUTH-01 — Session verification errors have no recovery UI.**
  - Observed during baseline verification (0.2) while Supabase was unavailable.
  - Add a retry mechanism for transient authentication failures.
  - Provide a safe way to return to login when a stored session is unusable.
  - Do not grant desktop access without successful authentication.
  - Test using mocked authentication failures or controlled network failure scenarios.
  - Actual incident resolved after Supabase resumed.

## Notes

- These items are not automatically blockers.
- Address them at an appropriate point in the implementation schedule.
- Do not implement unrelated changes while completing an existing checklist task.
- Mark items complete only after verifying the expected behaviour.



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