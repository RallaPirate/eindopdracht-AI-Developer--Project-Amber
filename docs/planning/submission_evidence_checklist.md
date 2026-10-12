# Project Amber — Submission and evidence checklist

Prepared: 12 October 2026 · Execution task **0.7** · Intended repository location: `docs/planning/submission_evidence_checklist.md`

This is an evidence-collection plan, not a statement that the application passes assessment. All boxes start unchecked. Tick a box only after the evidence exists, has been inspected and has a recorded location. Creating this document does not complete any implementation or verification task.

## 1. Sources, labels and scope

Source references throughout this checklist:

| Reference | Source and authority |
| --- | --- |
| **A p./pp.** | `AI_Developer_eindopdracht_v1.3_(30_EC)[1].pdf`, version 1.3; PDF page numbers 1–20. Defines assignment requirements, Quickscan and assessment criteria. Repository structure on p. 17 was inspected as an image. |
| **EO** | `amber_execution_order.md`, supplied locked sequence, tasks 0.1–10.12. Defines when to collect evidence; this checklist does not replace it. |
| **DB §** | `database_design_v2.md`, supplied locked design, sections 1–7. Defines Amber's six application tables, permissions, lifecycle and controlled AI workflows. |
| **CR §** | `amber-course-implementation-reference.md`, prepared 30 September 2026. Teaching patterns and version caveats, not additional assessment requirements. |
| **Status** | `current_status.odt` and `databasecontentsuploadChatGPT.odt`. Historical snapshots, not verified current implementation. |
| **Rules** | Supplied `general(1).mdc`, `components(1).mdc`, `ui-style(1).mdc`. Preserve the faux desktop, feature components and existing project organisation. |

**Reported update, 12 October 2026:** `TODO.md` is now available in the GitHub repository. Project Amber has been successfully deployed to Vercel, deployment protection is enabled, the initial hosted smoke test passed, and both required Skills.sh skills have been installed and committed. These developments were reported by the project owner; they have **not been independently verified for this checklist**. `TODO.md` has not yet been read for this revision. No repository, running application, live database or GitHub history was inspected. Link the existing deployment/smoke-test records and Skills configuration/commit evidence under B2–B3 before marking those evidence items complete; do not repeat completed setup solely to collect evidence.

The older status snapshot reports email/password authentication and the desktop shell working, feature windows empty, and no React Query or AI SDK yet. Its local-only deployment note is superseded by the reported Vercel deployment above; the remaining implementation notes must be reconciled with the repository and current `TODO.md`. Its database snapshot also predates the locked model (for example, direct profile/Auth identity and embedded source IDs). These are historical provenance notes, not current findings. Its “not required” labels for species/personnel do not override the later locked EO/DB scope. All evidence checkboxes remain unchecked until supporting evidence has been collected, inspected and documented.

**Clarify early:** review **A1 (CRUD/RLS interpretation)** and **A3 (acceptance of the external Species API and core-feature grouping)** in [Section 7](#7-ambiguities-to-retain-and-resolve-without-changing-scope), before relying on those interpretations for assessment. Retain any existing assessor clarification or obtain it if absent. Do not assume approval or change the locked database design.

Labels:

- **[M] Mandatory assignment coverage:** explicitly required by A. The proposed evidence format is a practical choice unless A specifies it (for example, an ERD screenshot or PDF).
- **[P] Locked-project verification:** needed to substantiate Amber's agreed behaviour; not a separately prescribed assignment deliverable or new feature.
- **[O] Optional evidence/polish:** omit under deadline pressure. No optional item is a submission gate.

Maintain the six-table model, Employee/Senior/Management permissions, human acceptance before AI persistence, temporary ordinary answers, and the existing desktop architecture. No RAG, custom MCP server, autonomous writes or new CRUD permissions are introduced here.

## 2. Keep collection lightweight

Use existing files where available; create the following suggested locations only as evidence is collected. Paths below are repository-relative. Large recordings can live outside Git with a stable link recorded in the index.

| Location | Purpose |
| --- | --- |
| `docs/evidence/index.md` | Evidence IDs, actual paths/links, criterion, date, commit and gaps. |
| `docs/evidence/verification.md` | Baseline, CRUD, RLS, lifecycle and AI test results; one file is enough. |
| `docs/evidence/screenshots/` | Readable ERD, selected UI states, policy and Skills setup captures. |
| `docs/evidence/logs/` | Sanitised build output and representative tool/transaction traces. |
| `docs/PROMPT-LOG.md` | Exact application prompts, inputs/outputs and iterations; separately labelled Cursor examples. |
| `docs/AI-DECISIONS.md` | AI-assisted architecture decisions, rejected suggestions and reasons. |
| `docs/PROJECT-BRIEF.md` | Approved problem, audience, API documentation link and four core features. |
| `docs/submission/` | Report draft/PDF, demo script and final submission links. |

After each completed feature, spend roughly five minutes recording the result and linking the relevant commit/PR. Reuse existing tests, recorded results, code references and screenshots across criteria; link to the original evidence instead of copying it into multiple documents. The suggested locations and capture formats are organisational aids, not a requirement to create a separate file or screenshot for each checkbox. Do not add duplicate screenshots, parallel documentation, a new test framework or other testing infrastructure solely for evidence collection. Preserve the explicitly required ERD screenshot and essential security, permission, lifecycle and transaction verification: where existing results do not establish those behaviours, record the missing check or perform the focused verification needed. A code reference explains enforcement but does not replace a required observed result.

Suggested verification row (split a grouped checklist item into rows when its checks have different outcomes):

| ID / criterion | Date / commit / environment | Actor / fixture | Action or input | Expected | Actual / pass, fail or blocked | Evidence path / follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| To fill | To fill | To fill | To fill | To fill | Not run | To fill |

For AI cases also record model identifier, prompt version, relevant source data, tool sequence and acceptance/persistence outcome. Use fictional test records. Remove credentials, tokens and unnecessary personal/confidential content from captures. Never publish `.env.local` or service-role secrets.

## 3. Assessment coverage index

This table maps **every rubric criterion** to collection phases below. Detailed requirements outside the rubric also appear in those phases and the final Quickscan. Percentages are deliberately not recalculated; see ambiguity A5.

| Criterion / page | What must be demonstrated | Evidence collected below |
| --- | --- | --- |
| 1.1 / p. 18 | Correct Next.js, TypeScript and Tailwind structure; development and Vercel operation without critical runtime errors | B2, F1, H2: dependency/structure notes, local build/start and production smoke results |
| 1.2 / p. 18 | Network API retrieval plus meaningful LLM interpretation/enrichment using user input | D1–D2: external species request → proposal → accepted stored result |
| 1.3 / p. 18 | Working autonomous multi-step agent with bounded execution (`maxSteps` wording) | D3, E4: code plus actual multi-step trace and limit/failure case |
| 1.4 / p. 18 | Maintainable typed code with clear component, server/client, utility and data responsibilities | B2, C2, G1: small annotated examples and file references |
| 1.5 / p. 18 | At least 20 meaningful small commits and five PRs merged to main | B4, H3: history and merged PR links |
| 2.1 / pp. 18–19 | At least four tables with suitable relations and constraints | C1: Amber's six-table ERD, migration references and representative constraint results |
| 2.2 / p. 19 | Relevant-entity CRUD through React Query, caching and UI synchronisation | C2–C3, E1: operation map and mutation/read-back/UI results |
| 2.3 / p. 19 | Supabase Auth and effective ownership-based RLS | C3–C4, E1–E5: account/session checks and actual allowed/denied operations |
| 3.1 / p. 19 | Explain and justify the AI implementation with concrete examples | D1–D3, G1: full dataflow explanation and code |
| 3.2 / p. 19 | Explain ERD/security and reflect on AI/data-storage risks | C1, E2–E3, G2: readable ERD, policies, transactions and risk discussion |
| 3.3 / p. 19 | Deliberate agent behaviour, limits, system prompts and error handling | D3, E3–E4, G1: instructions, limits and representative failure evidence |
| 3.4 / p. 19 | Critical, iterative prompt use and its effects | B5, D4, G3–G4: application iterations and separately labelled development prompts |
| 3.5 / pp. 19–20 | Critical reflection on AI tools, learning and limiting overreliance | B5, G3: three experienced limitations, code checks and future improvements |
| 4.1 / p. 20 | Registration/login, one complete AI use case and two additional case-specific features | B1, F1, H4: agreed feature map and timed demonstration |

## 4. Collect progressively in the locked execution order

### Phase B — Baseline and evidence habits (EO 0)

- [ ] **B1 [M] Case and four-feature map:** locate the submitted case and teacher approval; do not manufacture retrospective approval. Check the case covers problem, concrete AI interpretation, API documentation link and four features in at most 250 words (A p. 5). Save/link in `docs/PROJECT-BRIEF.md`. A workable demonstration grouping from the locked scope is (1) registration/login, (2) AI-enriched species creation, (3) report draft CRUD/submission, (4) role-aware review and archive browsing. Reconcile this grouping with the approved case; it is a presentation mapping, not a scope reduction. The Assistant and other locked workflows still need verification. See A3 below.
- [ ] **B2 [M] Baseline implementation evidence:** record actual package/lockfile versions, local build/start result and Vercel URL/result. Map existing directories to A p. 17: Cursor rules, Skills configuration, `PROJECT-BRIEF`, `PROMPT-LOG`, `AI-DECISIONS`, App Router/API agent/auth routes, components, hooks, library utilities, types, environment template and README. Explain version-dependent filename differences instead of reorganising the application. Save `verification.md` plus a sanitised build log. (A pp. 7–8, 14, 17; 1.1, 1.4; EO 0.1–0.5.)
- [ ] **B3 [M] Skills.sh:** capture evidence of installation and at least **two active skills**, including **`vercel-react-best-practices`**. Record names, configuration location and how they are used; a screenshot/configuration excerpt is sufficient. Do not imply these development skills are runtime agent tools. Link the existing configuration/commit evidence in the index; use `screenshots/skills-setup.png` only if a screenshot is useful. (A pp. 3, 14; EO 0.6.)
- [ ] **B4 [M] Git history, ongoing:** preserve the actual initial setup/configuration commit and record small meaningful commits and feature PR/merge links as work happens. A p. 7 asks for PRs per new feature and regular main merges; criterion 1.5 requires **≥20 commits and ≥5 merged-to-main PRs**. Record any historical shortfall honestly; do not fabricate commits or PR history to simulate past work. Save links in `index.md`. (EO 0.8, 9.10.)
- [ ] **B5 [M] Start the process log now:** preserve initial and changed Cursor instructions/rules, application prompt versions and AI-assisted architectural decisions. For each useful example: exact prompt → observed output/problem → checked or changed code/instruction → observed effect. Distinguish original history from later recollection. The supplied `.mdc` files are available examples, not proof of when they were installed or what effect they had. (A pp. 10–12, 15–17; 3.4–3.5; `PROMPT-LOG.md`, `AI-DECISIONS.md`.)
- [ ] **B6 [P] Reconcile baseline:** compare current repository/TODO/status against EO without rewriting the locked plan. Record implemented-but-unverified, verified, missing and blocked items distinctly in `verification.md`; link the current repository `TODO.md` and record the version/date reviewed.

### Phase C — Database and data-access evidence (EO 1–2; refresh at EO 10.2)

- [ ] **C1 [M] Schema evidence:** capture a readable **Supabase Schema Visualizer ERD screenshot** of the actual six application tables: `profiles`, `species_database`, `specimens`, `reports`, `species_knowledge_index`, `species_knowledge_sources`. Add focused crops if one image is unreadable. Link actual migrations/definitions and explain PKs, FKs, cardinalities, NOT NULL/UNIQUE/CHECK constraints. Record representative successful/invalid inserts, including duplicate external species ID and mismatched report/specimen species. Save `screenshots/erd.png` and `verification.md`. Do not count the separate external Species API table as an application table. (A pp. 9–10, 16; 2.1, 3.2; DB §§4–5.)
- [ ] **C2 [M] React Query evidence:** link the provider/query client, one authenticated read hook and one mutation hook. Record create/read/update/delete where permitted, cache invalidation or update, and the resulting UI synchronisation. Add one loading/error example. Explain the server/client split with a small code example, rather than copying entire files into the report. (A p. 9; 1.4, 2.2; EO 2, 4; `verification.md` and report code references.)
- [ ] **C3 [M/P] Operation coverage map:** record for **each of the six tables** the implemented UI/query/mutation or controlled workflow, permitted role, evidence row and deliberately prohibited operations. Full CRUD is directly demonstrated through own drafts; join-table writes and account handling follow controlled workflows. Record deny results for prohibited operations instead of adding generic CRUD screens. (A p. 9 versus 2.2–2.3 p. 19; DB §6; ambiguity A1.)
- [ ] **C4 [M/P] Auth and RLS verification:** save an enabled-RLS/policy screenshot plus exact policy/function references and test results. Verify registration creates an Employee profile, login/session restore/logout behaviour, rejection of unauthenticated access, and blocked self-assignment of a higher role. Use at least two distinct ordinary users plus Senior and Management fixtures to exercise DB §6 across all six tables. Record actor, operation, expected/actual result and row state. A hidden button, policy screenshot or privileged SQL-editor success alone does not prove RLS: test through authenticated application/API access and confirm denied updates/deletes left data unchanged. (A pp. 9–10, 13; 2.3, 3.2; EO 1.11–1.12, 2.2–2.5.)

### Phase D — First complete external-data AI flow (EO 3)

- [ ] **D1 [M] End-to-end species evidence:** capture one real run: Management user selection/input → dedicated Species API network/tool call → validated relevant API data → model input → interpreted/enriched proposal → explicit human acceptance → stored `species_database` row → UI read-back. Preserve a compact input/output trace, proposal/result screenshot and relevant code references. Explain what AI added beyond repeating the API response, separating API facts from proposed operational recommendations. (A pp. 5–7, 10, 14; 1.2, 3.1, 4.1; DB §7.7; EO 3.2–3.6.)
- [ ] **D2 [M/P] Prove persistence and boundaries:** save before/after results showing an unaccepted/dismissed proposal does not write, accepted valid data does persist, invalid/duplicate input does not overwrite an existing species, and unauthorised creation fails. Include the accepting profile/audit field. This is the primary evidence of externally sourced, AI-enriched data saved to Amber; weather and ordinary chat remain temporary. (A pp. 5, 7; DB §§6, 7.7–7.8; EO 3.7–3.9; `verification.md`.)
- [ ] **D3 [M] Explain the bounded agent:** collect the actual system instruction, tool description/schema/execute code, preprocessing, model-input assembly, output handling and stopping condition. Save a trace where later tool steps use earlier results; configuring a step limit alone is insufficient. Record a tool failure/invalid output and a limit-exhaustion outcome with honest UI feedback. Explain the installed SDK equivalent of the assignment's `maxSteps` term (A2). Use EO 7 evidence as well if it supplies the clearest multi-step example. (A pp. 10, 18–19; 1.3, 3.1, 3.3; CR §§3–6.)
- [ ] **D4 [M] Capture application prompt iterations:** accumulate **three successful and three less successful application-prompt examples**, with exact prompt/input, output, explanation and improvements for the weaker cases. Use genuine observations, including earlier variants of the same feature where appropriate; do not create six new features. Include at least one complete prompt → output → revision → new output sequence. Explain effects of structure, role, constraints, context and data quality. Label Cursor prompts separately: they do not replace these application examples. (A p. 11, Prompt design Q1–6; 3.4; `PROMPT-LOG.md`.)

### Phase E — Collect existing workflow verification as each phase completes (EO 4–8)

These are compact test-result bundles for the locked scope. Reuse development checks; the assignment does not prescribe a new automated test framework or a screenshot per case.

- [ ] **E1 [M/P] Reports and ownership (EO 4):** record author draft create/read/edit/delete and submission; A's draft remains invisible/unmodifiable/undeletable to B, including Senior/Management when not the author. Record rejected spoofed ownership, species/specimen mismatch, incomplete submission and submitted-content edits. Show the author overview and React Query UI updates. Save one draft/form screenshot and table of results. (A pp. 9, 13; 2.2–2.3, 4.1; DB §§3–6.)
- [ ] **E2 [P] Review and lifecycle (EO 5):** record permitted/forbidden transitions; flagged submitted reports are readable but not reviewable/withdrawable by Senior, and reviewable by Management. A retained flag does not block Senior withdrawal after review. Verify active/archive browsing, archive/seal retention of source links, Management sealed access via the Management interface, and author UUID/status-only references for sealed/withdrawn reports (including a Management author's own overview). Withdrawn contents are inaccessible to every application role. (DB §§3, 5–6; supports 2.3, 3.2, 4.1; `verification.md`.)
- [ ] **E3 [P] Accepted knowledge and transactions (EO 6):** record independent acceptance/dismissal/regeneration of summary, keywords and knowledge changes; regenerated proposals need fresh acceptance. Accepted report AI fields may be saved while submitted, subject to review permissions; a valid report may be approved without accepting knowledge. Verify new same-species source links only reference currently reviewed/active reports, stale proposals are rejected within the acceptance transaction, and pending entries return to reviewed only after human review. Include before/after results for failed acceptance and withdrawal: no partial writes; withdrawal removes all of that report's source links, marks every affected entry pending, retains guidance and unrelated links. A failed acceptance must not undo a separately completed approval. Record Management knowledge deletion cascading only its source links. (DB §§5–7.6; supports 2.1–2.3, 3.2–3.3; `verification.md` and selected transaction/code references.)
- [ ] **E4 [M/P] Operational Assistant (EO 7):** capture **streaming in the chat interface**, a genuine bounded multi-tool run using relevant database/external inputs, the fixed-location Open-Meteo behaviour and API-grounded species answers. A short clip or live demonstration shows streaming better than a final-answer screenshot. Verify all three roles; pending guidance and draft/submitted/withdrawn reports cannot support operational answers, and unaccepted proposals are not evidence. Employee/Senior sealed-source lookup exposes only permitted linked report ID/status, not contents in model context; Management may retrieve contents. Include missing-data/tool-failure feedback and one untrusted-data instruction attempt without broader access or invented facts. Ordinary answers/weather remain temporary. (A pp. 10, 13–14; 1.2–1.3, 3.3; DB §§7.1–7.3, 7.7–7.8; `verification.md`, selected trace/clip.)
- [ ] **E5 [P] Specimens/personnel (EO 4.1–4.3, 8):** record Management creation, Senior/Management permitted specimen edits and Management-only lysine edits; record own-profile access, Management personnel/role actions, rejection of forbidden field changes, and account-deletion results. Auth deletion retains the internal profile UUID, anonymises display name and preserves historical authorship. Link to existing checks rather than duplicate them. (DB §§1, 4–6; supports 2.1–2.3, 3.2; `verification.md`.)

### Phase F — Integration and feature freeze (EO 9)

- [ ] **F1 [M/P] Final deployed smoke run:** record date, commit, production URL, role and outcome for registration/login, species enrichment/persistence, reports, review/knowledge, Assistant and remaining locked operations. Re-run representative invalid/unauthorised/failure paths after integration. Link relevant earlier checks; retest changed behaviour rather than starting the entire evidence collection again. (A pp. 7, 13–14; 1.1–1.3, 2.2–2.3, 4.1; EO 9.1–9.8.)
- [ ] **F2 [M/P] Freeze evidence:** record final build and production runtime results, final prompt/instruction versions, environment-variable **names/configuration needs without secret values**, open defects and limitations. Distinguish failed/blocked from passed; do not replace missing evidence with an unchecked assertion of success. Stop adding features at EO 9.11. (A pp. 10–11, 14; EO 9.9–9.11; `index.md`, `verification.md`.)

## 5. Assemble the technical report from collected evidence (EO 10.3–10.9)

The report must be a PDF, **2,500–3,000 words excluding contents and appendices**. Use concise explanations in the body and exact prompts/longer supporting material in appendices. The suggested headings on A p. 16 do not remove the explicit Prompt design questions on p. 11: include a clearly identifiable prompt-design section.

- [ ] **G1 [M] Technical AI implementation / agent design:** answer all eight A p. 10 questions with concrete code: external retrieval; preprocessing; prompt plus data; output handling; bounded steps; tools and skills used and why; errors/fallbacks; autonomy/reliability/predictability. Explain development skills separately from runtime tools. Reference D1–D3/E4, actual source paths and the submitted commit. (3.1, 3.3.)
- [ ] **G2 [M] Database design:** answer all seven A pp. 10–11 questions: readable actual ERD; relationships/keys/cardinalities; RLS approach; concrete policies; database input and stored AI output; risks such as incorrect accepted guidance, stale evidence and data quality; possible reliability/scaling improvements. Describe future improvements as proposals, not implemented scope. Explain Amber's shared-role exceptions and controlled writes. Reference C1–C4/E2–E3. (3.2.)
- [ ] **G3 [M] AI-assisted development and reflection:** answer all eight A p. 11 questions: initial/evolved Cursor instructions and effects; useful rules; generated-code verification; degree of control; manual rewrites; **at least three actual limitations/uncertainties, each with cause and effect**; reliability measures; **three practical lessons for another student**. Add critical learning/improvement conclusions. Use real examples from B5; say when an explanation is a hypothesis. (3.4–3.5.)
- [ ] **G4 [M] Prompt design:** answer all six A p. 11 questions using D4's application prompts, six examples and genuine iterations. Explain why changes affected results and the role of input-data quality. (3.3–3.4.)
- [ ] **G5 [M] Appendices:** include an overview of all used AI prompts, full final implemented agent instructions for the workflows, application/system prompts and model-input templates, plus used Cursor prompts/instructions/rules. Link logged examples to versions and outcomes; do not silently substitute representative excerpts for the assignment's “all prompts” wording. Redact secrets, identify missing history, and use ambiguity A4 if completeness needs clarification. (A pp. 12, 15–16; EO 10.7.)
- [ ] **G6 [M] Presentation and completeness:** title page has student name, submission date and leerlijn title; include GitHub, Vercel and Supabase REST API base URLs. Add accurate contents/page numbering and readable language. Follow A p. 16's recommended order: title, summary (max 150 words), contents, introduction, AI implementation, database, AI-assisted development, conclusion and appendices, with G4 explicitly covered. Record word count and inspect the final PDF for readable images/code and working links. (A pp. 14–16; EO 10.8–10.9.)
- [ ] **G7 [O] Introduction UI illustrations:** use 1–3 representative UI screenshots already collected, if helpful; A p. 16 labels these a tip. They need not become a separate screenshot exercise.

## 6. Final hand-in and demonstration (EO 10)

- [ ] **H1 [M] Required products present:** Next.js source project with README; configured Supabase backend; technical report PDF; live demonstration or video. Check the submission channel's upload/access instructions rather than inventing a ZIP requirement. (A pp. 4, 8–9, 12–14.)
- [ ] **H2 [M] README and access:** installation instructions allow another developer to run the submitted project; include dependency/setup commands, required environment-variable names with safe placeholders and the **Supabase REST API base URL**. Include that URL in the report too. Confirm GitHub repository is **public**, production URL works and links resolve. Verify required teacher **administrator access within the Supabase team** has been arranged, and record confirmation privately. This checklist does not itself grant access or change visibility. (A pp. 8–9, 14; 1.1; EO 10.1, 10.9.)
- [ ] **H3 [M] Final history check:** record the submitted commit, count/link ≥20 meaningful commits and ≥5 PRs actually merged to main. Confirm final report references match that version. (1.5; EO 9.10.)
- [ ] **H4 [M] Rehearse an 8–12 minute demo, maximum 12 minutes:** use the run sheet below; demonstrate all four agreed core features and at least one invalid-input/error path. Save `docs/submission/demo-script.md`; record duration and use `.mp4` or `.mov` if submitting video. A live demo does not require a separate video. (A p. 13; 4.1; EO 10.10.)
- [ ] **H5 [M] Run A pp. 14–15 Quickscan line by line:** verify title/PDF/URLs/admin access, all products, language, word count, presentation format/length, contents/page numbers, public repository, two skills, README, required stack, ≥4 related tables/Auth, React Query CRUD, working AI SDK agent, external API tool calling, meaningful interpretation, streaming chat, deployed four features, prompt/agent appendices and documented AI-assisted architecture decisions. Record gaps before submission. AI use is permitted and expected; disclose it through the required process evidence. (EO 10.11.)
- [ ] **H6 [M] Submit and retain confirmation:** record submitted files/links/version and receipt in `index.md` or a private submission record. Use the actual confirmed deadline; the assignment PDF does not establish the current hand-in date. (EO 10.12.)

**Provisional run sheet:** aim for roughly 9½ minutes of planned content, leaving about 2½ minutes within the **12-minute maximum** for role switching, API responses and unexpected delays. These timings are rehearsal estimates, not assessment requirements or guaranteed response times. Measure the complete elapsed run, including transitions and waiting; shorten narration or optional detail if necessary while retaining the required demonstrations. Do not fill the buffer with extra material.

| Planned content time (delays use the reserve) | Demonstration and supporting evidence |
| --- | --- |
| 0:00–0:45 | Start locally and show global project structure; A p. 13 allows 30–60 seconds for this. |
| 0:45–2:30 | Show database connection and Supabase dashboard: tables, relations, enabled RLS, one ownership link and policy. Demonstrate A's private draft cannot be read/changed/deleted by B; explain legitimate shared reviewed reports. |
| 2:30–3:30 | Open production URL; demonstrate registration and login with prepared test arrangements. |
| 3:30–5:30 | Complete external species AI use case: user input, tool retrieval, enriched proposal, acceptance and persisted read-back. |
| 5:30–7:15 | Own report draft operations/submission, then role-aware review/archive feature; include an invalid input or forbidden action and the observed response. |
| 7:15–8:45 | Assistant streaming, bounded tool use and meaningful answer; briefly show a failure/missing-data case. |
| 8:45–9:30 | Explain one relevant code path and human-approval boundary; acknowledge actual limitations. |
| Up to 2:30 reserve, used as needed throughout | Allow for role changes, API latency and unexpected delays; finish the entire demonstration within 12:00. |

Prepare fictional fixtures, suitable roles, an unused external species ID and links before rehearsal. With deployment protection reported as enabled, check the intended presenter/assessor access arrangements before the demo; do not assume that possessing the production URL grants access. This is preparation for H2/H4, not a request to disable protection or change deployment settings. Do not spend demo time populating an entire park. Keep detailed transaction/RLS results in the evidence pack rather than attempting to narrate every matrix cell live.

## 7. Ambiguities to retain and resolve without changing scope

| ID | Source discrepancy / uncertainty | Evidence action and boundary |
| --- | --- | --- |
| **A1** | A p. 9 says CRUD for **all tables**; criterion 2.2 says **relevant entities**. A pp. 9/19 also says users access only their own data, whereas Amber intentionally shares reviewed information and uses role-based review. | Preserve DB §6. Show full own-draft CRUD, six-table operation mapping and blocked operations, with reasons for retention/controlled joins. Obtain or retain teacher clarification on acceptance of these deliberate exceptions; this checklist does not claim approval or permit extra writes. |
| **A2** | A pp. 10/18–19 uses `maxSteps`; CR §§3–4/10 describes later `stopWhen`/`stepCountIs` patterns and warns installed versions are unknown. | Record actual versions and equivalent bounded multi-step behaviour, code and trace. Explain terminology in the report; do not replace the locked harness merely to copy an older API name. Clarify with the assessor if literal syntax is expected. |
| **A3** | A pp. 5–6 requires an approved case and free external API. The locked Species API is in a separate Supabase project; supplied files do not establish teacher approval of this source or the final four-feature grouping. | Retain case approval/API documentation and clarify acceptance of the separate Species API as the external source if not already documented. Keep Open-Meteo in its locked temporary-context role. Do not invent a third-party API requirement or redesign the project. |
| **A4** | A p. 11 explicitly distinguishes application prompt design from Cursor prompting, while criterion 3.4 refers to prompts in the development process. A pp. 12/15 says all prompts; p. 16 specifies application prompts and Cursor instructions. | Maintain both categories, complete available prompt records and final instructions. If historic Cursor exchanges are incomplete, disclose the gap and seek clarification about acceptable coverage; do not reconstruct conversations as original evidence. |
| **A5** | Rubric group weights total 95% (25 + 15 + 45 + 10), while the five 10% criteria under the 45% report group make individual rows total 100%. | Cover every criterion. Do not derive a score or assume which weight is erroneous; ask the assessor only if weighting affects planning. |
| **A6** | A p. 7 first qualifies enrichment storage as “where needed”, but its explicit requirements and p. 5 require stored results. | Use the locked species acceptance/persistence flow for clear evidence. Do not persist chat/weather merely to increase the amount stored. |
| **A7** | A p. 17 illustrates configuration/layout names; supplied rules preserve Amber's intentional architecture and CR warns against mixing dependency versions. | Map actual files to required responsibilities and document genuine version-dependent differences. Optional `components.mdc`/`api.mdc` in the figure are not new mandatory files. Resolve any material mismatch rather than silently restructuring or claiming exact conformity. |

- [ ] **[P] Record dispositions:** add existing teacher clarification or outstanding questions for A1–A4/A7 to `index.md`; record the outcome or outstanding gaps in the current TODO/project-state reconciliation. Keep unresolved issues visible in the final review. No clarification is assumed to have happened.

## 8. Optional material — only after mandatory coverage and feature freeze

- [ ] **[O]** One simple dataflow illustration, extra UI screenshots or a short backup clip for a live demo, using existing verified behaviour.
- [ ] **[O]** Extra AI evaluation cases, latency/token observations or automated checks if they resolve a concrete uncertainty. No external tracing platform or full course production checklist is required by this PDF.

**Deferred scope, not checklist obligations:** RAG/vector retrieval, custom MCP, agent-suggested updates to existing species entries, automated discrepancy scanning, extra integrations and visual polish. Their appearance in lessons or the stretch list does not make them assessment requirements. Do not count them as complete or spend submission time implementing them before the locked work and evidence are ready.
