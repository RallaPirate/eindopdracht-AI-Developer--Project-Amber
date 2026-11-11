### Section 3 — Local automated verification

**Status:** Automated test suite passed across two test-runner environments, with one PostgreSQL integration test skipped.

**Test framework:** Node.js built-in test runner (Node 24.22.2).

**Results:**
- 219 tests passed using the standard Node environment.
- Four server-only test files initially failed during module loading, without executing their tests.
- These files were rerun with `--conditions=react-server`.
- The server-side rerun completed with 60 passed, 0 failed and 1 skipped.
- Total: 279 successful test cases across the two runs, with no unresolved failures.

**Limitations:** The PostgreSQL integration test was skipped. Live Supabase permissions, database persistence and deployed application behaviour require separate verification.

**Tested commit:** [Insert local Git commit SHA]

**Supporting evidence:** `section3-test-results.txt` and the terminal output of the server-side rerun.



PROJECT AMBER — SECTION 3.9 VERIFICATION
=========================================
Date: 08-11-2026
Environment: Vercel production
Deployment URL: https://project-amber-blond.vercel.app/
Tested commit: main 4368fd8f182178c1fead4d676a4e11cde2dd55b8
Tester:

AUTOMATED TESTS (LOCAL)
-----------------------
Node.js: v24.22.2
Passed: 279
Failed: 0 unresolved
Skipped: 1 (PostgreSQL integration test)
Evidence:
- logs/section3-test-results.txt
- logs/section3-server-tests.txt

DEPLOYED APPLICATION TESTS
--------------------------
Mark each test PASS / FAIL / BLOCKED / NOT TESTED.

[X] 01. Management — AI species creation
    External API → AI proposal → approval → saved record
    Result: PASS
    Notes: Test 01 — BLOCKED: External Species API configuration missing or invalid in production. Fix configuration and retest.

[X] 02. Management — Proposal rejection
    Dismissed proposal causes no database INSERT
    Result: PASS
    Notes:

[X] 03. Management — Duplicate prevention
    Existing external_species_id cannot be inserted again
    Result: PASS
    Notes:

[X] 04. Management — Invalid input
    Invalid proposal is rejected without persistence
    Result: PASS
    Notes:

[X] 05. Senior — Species editing
    Permitted fields update and persist after refresh
    Result: PASS
    Notes:

[X] 06. Senior — Creation restriction
    Cannot create species, including via direct API request
    Result: PASS
    Notes: Senior creation UI unavailable in production. Automated endpoint tests confirm Senior requests are rejected with HTTP 403 before persistence. Direct live Supabase INSERT protection is a separate database/RLS verification, to be supported by existing Step 1.12 evidence or checked under Test 08.

[X] 07. Employee — Read-only access
    Can view species but cannot create or modify them
    Result:
    Notes:

[ ] 08. Database integrity and audit
    Correct updated_by and timestamps
    Protected identity fields unchanged
    Failed operations leave database unchanged
    Result: PASS for observed data integrity and audit configuration; direct live write-denial checks remain unverified in this pass
    Notes:Live Supabase verified: two species records, no duplicate external IDs, valid required fields and timestamps, populated audit identities, enabled RLS and audit triggers, and role-restricted policies. Compsognathus's latest audit identity references a linked Senior profile. Direct authenticated write-denial tests were not repeated.

[X] 09. Production errors and recovery
    Appropriate error messages; no unintended writes
    Result: PASS for observed error handling and recovery.
    Notes:

FINAL VERDICT
-------------
Section 3.9: PASS

Observations: The species browse list does not refresh automatically after successful creation (recorded as SPECIES-UI-01). The PostgreSQL integration test was skipped, and no new direct live write-denial tests were performed during this production pass.

Conclusion: The deployed species workflow has been verified through the principal creation, editing, authorisation and error-handling scenarios. Outstanding limitations are documented.


PROJECT AMBER — ASSISTANT MVP LOCAL VERIFICATION
Date: 08-11-2026
Environment: Local development; authenticated browser sessions
Feature: Assistant.exe — minimal streaming operational Assistant
Scope: AI SDK streaming, local species retrieval and Open-Meteo
AUTOMATED TESTS (LOCAL)
Initial implementation:
Passed: 296
Skipped: 1 (existing PostgreSQL integration test)

Independent review:
Passed: 73 server tests
Skipped: 1 (PostgreSQL integration test)

Wildcard regression fix: 14 focused tests passed
TypeScript: PASS
Targeted Assistant ESLint: PASS
Production build: PASS (original implementation run)

Additional automated coverage:
- Scripted-model test demonstrated sequential species retrieval → returned evidence → subsequent weather-tool decision → final answer.
- DOM tests covered incremental streaming, cancellation, recovery and simulated account-switch isolation.
Notes: These are reported tool-run results. The manual browser tests below provide separate real-application evidence. The two skipped-test statements refer to their respective test runs; no combined total is asserted.
LOCAL APPLICATION TESTS
Mark each test PASS / PARTIAL / FAIL / NOT TESTED.

[X] 01. Local Assistant UI
Assistant opens in its 680 × 500 desktop window; messages and controls render.
Result: PASS
Notes:

[X] 02. Live species retrieval
A Gallimimus question invokes species search and identifies the required minimum number of handlers.
Result: PASS
Notes: Correctly identified the three-handler minimum.

[X] 03. Live weather retrieval
Open-Meteo provides forecast information in the browser conversation.
Result: PASS
Notes:

[X] 04. Combined species and weather reasoning
Assistant combines species handling guidance with tomorrow's forecast.
Result: PASS
Notes: Combined Gallimimus guidance and weather information, acknowledging forecast limitations.

[X] 05. Contextual follow-up
Assistant understands a follow-up about moving the same specimen with two colleagues.
Result: PASS
Notes:

[X] 06. Additional species question
A Compsognathus question returns the species' handling requirement without assuming that transporting multiple specimens alone is safe.
Result: PASS
Notes: Correctly identified the one-handler minimum; did not assume that transporting three specimens alone was automatically safe.

[X] 07. Off-topic request
Assistant declines a chocolate brownie recipe and remains within its operational scope.
Result: PASS
Notes:

[X] 08. Stop and recovery
Stop interrupts generation; a subsequent question can be answered.
Result: PASS
Notes: An incomplete-answer notice appeared initially, then disappeared. A subsequent question succeeded, but the previous tool label remained stuck at “Species search: working...”.

[X] 09. Logout and return
Previous conversation does not reappear after logout and return.
Result: PASS
Notes:

[X] 10. Switch between accounts
Account B does not inherit Account A's conversation.
Result: PASS
Notes:

[ ] 11. Account switch during active streaming
Switch accounts while the Assistant is still generating.
Result: NOT TESTED
Notes: Generation completed before the switch could be performed. The BioReserve OS loading sequence also delays account changes.
KNOWN MINOR UI ISSUES
1. Inline Markdown bold syntax (**text**) displays literally.
2. An interrupted species-tool call can retain a “working...” label after cancellation, even when later requests succeed.
3. The incomplete-answer notification disappeared after initially appearing.
4. Weather wording could use the reserve's fictional classification terminology while keeping representative offshore weather distinct from actual local conditions.
[X] FIX MINOR UI ISSUES MENTIONED ABOVE
REMAINING VERIFICATION
Environment: Vercel production
Date: 9 November 2026
Deployment URL: https://project-amber-blond.vercel.app/
Tested commit: main bee6e99026be3121b2c22e99b2c0590f9b28dbd3
Deployment status: READY — verified through Vercel
Production streaming: Assistant.exe sends and receives streamed responses successfully.
[X] Species retrieval: Agent retrieves an existing species through the authenticated, RLS-scoped database client.
[X] External weather retrieval: Agent successfully calls Open-Meteo and incorporates the forecast into its answer.
[X] Combined reasoning: Agent uses species guidance and weather information together in an operational recommendation.
[X] Role access: Verify Employee, Senior and Management accounts where available. All three should have the same permitted species read access.
[X] Authentication and isolation: Verify that signed-out users cannot access the Assistant and that conversations do not persist between accounts.
[X] Stop and recovery: Interrupt a response, confirm the interrupted state remains visible, and successfully send another message.
[X] Evidence: Record the deployment URL, commit SHA, relevant screenshots and observed test results.

Existing security evidence: Database RLS policies were verified during the database foundation work. Independent Assistant code review and automated tests confirmed authenticated, caller-scoped retrieval without service-role access.
Deferred verification: Account switching during active streaming was not practical during local testing because responses completed too quickly. Automated session-isolation tests passed.

Final production verdict: PENDING

FINAL VERDICT
Assistant MVP (local): PASS for principal functional tests; PASS for Stop/recovery; deployment verification pending.

Observations: Species retrieval, Open-Meteo retrieval, multi-source reasoning, contextual follow-ups and basic session isolation passed in local browser tests. Cancellation exposed minor UI-state defects. Account switching during active streaming was not tested.

Conclusion: The local Assistant MVP is functional and has passed the principal conversational, retrieval and basic session-isolation tests. Remaining issues concern deployment-specific verification gaps. Full Section 7 implementation is intentionally deferred.

----
### Step 4.6 — Report Draft Editing: Verification limitations

**Date:** 11 November 2026  
**Environment:** Local development

**Independent review:** PASS after correction and independent reproduction of the stale-draft reopening and whitespace-only title defects.

**Automated tests:** 72 DOM/authentication tests and 32 specimen/cache-isolation tests passed.

**Manual observations:**
- Cross-author draft isolation through My drafts: PASS — another user's drafts were not accessible through the UI.
- Full network interruption: Authentication.exe suspended protected access. Unsaved editor inputs were lost.
- Failed UPDATE with authentication remaining valid: NOT TESTED manually; automated regression coverage exists.
- Direct cross-author and non-draft UPDATE denial: NOT TESTED live; RLS reviewed and denial behaviour mock-tested.
- Specimen-linked editing: NOT TESTED live; no specimen fixtures available.

**Conclusion:** Independent code review passed. The remaining negative-path verification gaps and offline editor behaviour are documented under REPORT-VERIFY-01 in `docs/planning/TODO.md`. These are deferred and do not independently invalidate the Step 4.6 code-review verdict.