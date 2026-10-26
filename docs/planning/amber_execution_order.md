Project Amber — Execution Order

Ongoing: after completed functionality, verify → commit → PR/merge where appropriate → capture useful evidence.
Scope: stretch functionality, RAG, custom MCP, extra polish and optional integrations remain excluded until feature freeze.

### 0. Baseline and project safeguards

- [X] 0.1 Inspect repository structure, installed dependencies and lockfile.
- [X] 0.2 Verify the existing authentication/profile flow and desktop shell.
- [X] 0.3 Verify the current Supabase schema, migrations and RLS state against the locked design.
- [X] 0.4 Make the existing application build successfully locally.
- [X] 0.5 Establish a working Vercel deployment of the existing baseline.
- [X] 0.6 Verify/install the required Skills.sh setup, including vercel-react-best-practices.
- [X] 0.7 Create the submission/evidence checklist: requirements, screenshots, code examples, prompts and test evidence.
- [X] 0.8 Confirm the Git workflow: feature branches, small commits and PRs throughout development.
Milestone: we know exactly what exists, the baseline runs locally and on Vercel, and development can proceed without guessing.

### 1. Database foundation

- [X] 1.1 Implement/align profiles and permanent profile ↔ Auth identity handling.
- [X] 1.2 Implement/align species_database.
- [X] 1.3 Implement/align specimens.
- [X] 1.4 Implement/align reports.
- [X] 1.5 Implement/align species_knowledge_index.
- [X] 1.6 Implement/align species_knowledge_sources.
- [X] 1.7 Implement required foreign keys, constraints, indexes, timestamps and audit fields.
- [X] 1.8 Implement database constraints for valid report lifecycle field/state combinations.
- [X] 1.9 Implement report transition and post-submission immutability enforcement.
- [X] 1.10 Implement management-review flag invariants and preservation of its historical requester/timestamp metadata.
- [ ] 1.11 Apply the locked RLS permissions for all six application tables.
- [ ] 1.12 Verify the critical role/operation matrix for Employee, Senior and Management across all six application tables, including important field-level and lifecycle restrictions.
This follows the locked design's principle that authenticated access is role/permission constrained and that controlled workflows do not imply unrestricted table writes.    database_design_v2
**Milestone:** the database can safely support application development.

### 2. Application data layer

- [ ] 2.1 Install/verify TanStack Query and create the application Query setup.
- [ ] 2.2 Establish authenticated Supabase client/server access patterns.
- [ ] 2.3 Establish the internal profile/role lookup used by protected operations.
- [ ] 2.4 Add shared validation/error-handling patterns needed by feature queries and mutations.
- [ ] 2.5 Verify one simple authenticated database read end-to-end.
**Milestone:** UI features can now use a known, consistent data-access pattern.

### 3. Species workflow — first complete AI feature

- [ ] 3.1 Implement reading/listing local species_database entries with React Query.
- [ ] 3.2 Implement the dedicated external Species API tool.
- [ ] 3.3 Install/configure the Vercel AI SDK and Zod using the course agent pattern.
- [ ] 3.4 Prerequisite: apply the relevant shared Agent safeguards from 7.11 to this workflow before implementation. Implement a bounded Agent flow that retrieves external species data and creates a structured enriched proposal, distinguishing API-supplied data from Agent-generated recommendations.
- [ ] 3.5 Build the Management review UI for the proposed species entry, distinguishing API-supplied data from Agent-generated recommendations.
- [ ] 3.6 Implement explicit acceptance and controlled persistence.
- [ ] 3.7 Reject unauthorised creation, invalid proposals and duplicate external_species_id values.
- [ ] 3.8 Implement permitted manual Senior/Management edits.
- [ ] 3.9 Verify the complete workflow locally and deployed.
The course reference specifically gives us the streamText + tools + Zod inputSchema + bounded-loop pattern we want to adapt rather than inventing our own framework.    amber-course-implementation-ref…
**Milestone:** Amber has its first complete assessed AI workflow: external API → AI interpretation → human approval → database persistence.

### 4. Specimens and report authoring

- [ ] 4.1 Implement specimen listing/selection.
- [ ] 4.2 Implement Management specimen creation.
- [ ] 4.3 Implement role-appropriate specimen updates: Senior and Management can update nickname, DOB, measurements, location and status, Management can update lysine protocol.
- [ ] 4.4 Implement own-report draft listing.
- [ ] 4.5 Implement report creation, including report type and species selection. Filter the specimen selector to specimens belonging to the selected species, and enforce the species–specimen match during creation and draft editing.
- [ ] 4.6 Implement draft editing.
- [ ] 4.7 Implement draft deletion.
- [ ] 4.8 Implement report submission.
- [ ] 4.9 Verify that submitted report content becomes immutable as designed.
- [ ] 4.10 Verify that another user cannot access or modify someone else's drafts.
- [ ] 4.11 Implement the author's report overview for drafts and submitted/reviewed reports, including review/record status.
**Milestone:** the principal human CRUD workflow works with React Query and ownership enforcement.

### 5. Report review and lifecycle

- [ ] 5.1 Implement the Senior/Management submitted-report review queue.
- [ ] 5.2 Implement report opening with role-aware access.
- [ ] 5.3 Implement approve → reviewed/active.
- [ ] 5.4 Implement reject/withdraw through the controlled withdrawal workflow: update the report state, remove its species_knowledge_sources links and mark every affected knowledge entry pending in one database transaction, retaining the entries' guidance and remaining source links. Ensure the controlled withdrawal workflow sets reports.updated_by to the acting user's permanent profiles.id, and verify that the withdrawal trigger propagates that identity to every affected knowledge entry.
- [ ] 5.5 Implement request-for-management-review.
- [ ] 5.6 Enforce Management-only review of flagged submitted/active reports; the flag restricts Senior review/withdrawal only while the report remains submitted.
- [ ] 5.7 Implement Management archive.
- [ ] 5.8 Implement Management seal/unseal.
- [ ] 5.9 Implement author status-only views for withdrawn/sealed reports.
- [ ] 5.10 Verify permitted and forbidden lifecycle transitions.
- [ ] 5.11 Implement authenticated browsing/opening of reviewed/active reports.
- [ ] 5.12 Implement authenticated search/browsing of reviewed/archived reports.
- [ ] 5.13 Implement Management opening/reading of sealed reports through the Management interface.
**Milestone:** the complete human report lifecycle works independently of AI.

### 6. Report analysis and knowledge workflow

- [ ] 6.1 Prerequisite: apply the relevant shared Agent safeguards and sealed-source handling from 7.4 before implementing report analysis. Implement Agent analysis of submitted reports. The analysis must compare the submitted report with existing evidence and determine whether it supports, extends, conflicts with or justifies revision of existing guidance.
- [ ] 6.2 Generate structured ai_summary, ai_keywords and knowledge proposals based on the Agent analysis.
- [ ] 6.3 Search existing knowledge entries, including pending, during proposal generation.
- [ ] 6.4 Allow the reviewer to independently accept, dismiss or request regeneration of each proposed ai_summary, ai_keywords set or knowledge-index change. Regenerated proposals require fresh explicit acceptance. Accepted report-level AI fields are persisted through the controlled review workflow while the report may still remain submitted/active. Allow the authorised reviewer to optionally save review_note, subject to the flagged-report restrictions.
- [ ] 6.5 Implement creation of accepted knowledge entries.
- [ ] 6.6 Implement accepted updates to existing knowledge entries.
- [ ] 6.7 Create accepted species_knowledge_sources links only for eligible reviewed/active reports (A submitted report may help generate a temporary proposal, but it cannot become a new knowledge source until it has transitioned to reviewed/active).
- [ ] 6.8 Revalidate the target knowledge entry, supporting evidence, current permissions and source eligibility inside the knowledge-acceptance transaction immediately before writing. Reject stale proposals and require reassessment/re-acceptance. Allow the report’s expected approval transition and associated review/audit changes, provided its underlying content is unchanged and its current state and permissions are revalidated.
- [ ] 6.9 Persist accepted knowledge changes and new source links atomically in that same transaction. If report approval is part of the operation, include it in the transaction; if the report was already approved separately, a failed knowledge-acceptance transaction must not undo that earlier approval.
- [ ] 6.10 Verify withdrawal propagation: withdrawn reports have no remaining source links, all affected knowledge entries are pending, retained guidance and unrelated source links remain intact, and the operation cannot partially succeed.
- [ ] 6.11 Verify pending-entry reassessment and return to reviewed.
- [ ] 6.12 Implement browsing/reading of reviewed species_knowledge_index entries.
- [ ] 6.13 Implement the Senior/Management pending-entry review/reassessment interface.
- [ ] 6.14 Implement Management deletion of knowledge entries, including automatic removal of their source links.
- [ ] 6.15 Check that a perfectly valid report may be approved even if its generated knowledge proposal is rejected or simply never accepted
These behaviours are already specified quite tightly in Sections 7.4–7.6 of the locked design, including the freshness check and transactional acceptance sequence.
**Milestone:** Amber's most complex AI + human approval + database workflow works safely.

### 7. Operational Assistant

- [ ] 7.1 Implement retrieval tools for species_database.
- [ ] 7.2 Implement retrieval of reviewed knowledge entries and permitted source reports.
- [ ] 7.3 Add relevant specimen retrieval.
- [ ] 7.4 Integrate and verify sealed-source handling: Management may retrieve contents; Employee/Senior receive only permitted sealed-source metadata, and the Agent may disclose that sealed evidence exists without exposing or inferring its contents.
- [ ] 7.5 Implement the fixed-location Open-Meteo tool.
- [ ] 7.6 Implement bounded multi-step Agent behaviour.
- [ ] 7.7 Implement streaming responses in the Assistant UI.
- [ ] 7.8 Surface missing data/tool failures rather than inventing answers.
- [ ] 7.9 Test Assistant behaviour across Employee, Senior and Management roles.
- [ ] 7.10 Verify that the Agent does not treat its own previous unaccepted proposals as established evidence.
- [ ] 7.11 Verify the Agent shared safeguards: apply authentication/authorisation, schema validation, untrusted-data boundaries, temporary-proposal rules, bounded execution and explicit failure handling consistently across every Agent workflow.
- [ ] 7.12 Integrate the external Species API tool into operational Assistant questions and enforce API-grounded factual answers.
**Milestone:** the operational Agent demonstrates streaming, tool calling, multiple data sources and permission-aware retrieval.


### 8. Personnel/account workflows

- [ ] 8.1 Implement own-profile viewing.
- [ ] 8.2 Implement Management personnel listing.
- [ ] 8.3 Implement Management role changes.
- [ ] 8.4 Implement own authentication-account deletion.
- [ ] 8.5 Implement Management deletion of another user's authentication account.
- [ ] 8.6 Verify retained profiles, anonymisation and historical authorship after Auth deletion.
**Milestone:** remaining required role/account operations work without damaging historical records.

### 9. Integration, verification and feature freeze

- [ ] 9.1 Verify the complete deployed application using Employee, Senior and Management accounts.
- [ ] 9.2 Verify registration/login.
- [ ] 9.3 Verify AI-enriched species creation.
- [ ] 9.4 Verify report CRUD/submission.
- [ ] 9.5 Verify report review + AI knowledge contribution.
- [ ] 9.6 Verify the operational Assistant.
- [ ] 9.7 Test important invalid/unauthorised/failure paths.
- [ ] 9.8 Record representative AI evaluation cases and failures.
- [ ] 9.9 Confirm Vercel production configuration and environment variables.
- [ ] 9.10 Confirm Git requirement: ≥20 meaningful commits and ≥5 merged PRs.
- [ ] 9.11 Stop adding functionality.
**Milestone:** FEATURE FREEZE. 🔒

### 10. Submission

- [ ] 10.1 Complete README installation instructions, include the Supabase REST API base URL.
- [ ] 10.2 Capture final readable Supabase ERD.
- [ ] 10.3 Complete the technical implementation sections of the report.
- [ ] 10.4 Complete database/RLS justification and AI/data-risk discussion.
- [ ] 10.5 Complete AI-assisted development reflection.
- [ ] 10.6 Complete prompt-design section.
- [ ] 10.7 Add required prompts, Agent instructions and Cursor instructions to the appendices.
- [ ] 10.8 Verify the report is 2500–3000 words excluding contents/appendices.
- [ ] 10.9 Add GitHub, Vercel and Supabase URLs.
- [ ] 10.10 Prepare and rehearse the 8–12 minute demonstration.
- [ ] 10.11 Run the assignment Quickscan line by line.
- [ ] 10.12 Submit.