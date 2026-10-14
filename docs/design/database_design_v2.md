1. Core user stories: 


### Specimens
- As an authenticated user I want to be able to select individual specimens.
- As a management operator I want to create specimens. 
- As a senior/management operator I want to update the `status` of specimens.
- As a senior/management operator I want to update measurements like height, weight, length or speed of specimens.
- As a senior/management operator I want to update the location of specimens. 
- As a senior/management operator I want to update the nickname of the specimen. 
- As a senior/management operator I want to update the date of birth of the specimen. 
- As a management operator I want to update the lysine protocol. 


### Reports
- As an employee/senior/management operator I want to create reports.
- As an employee/senior/management operator I want to select the type of report I am creating; care, behavioural, medical, security or incident.
- As an employee/senior/management operator I want to save my reports as draft.
- As an employee/senior/management operator I want to access my saved draft reports.
- As an employee/senior/management operator I want to edit or delete my drafts.
- As an employee/senior/management operator I want to submit my final draft.
- As a report author, I want to see an overview of all my submitted reports and drafts.
- As a report author, I want to see the review status of my submitted reports in the overview.
- As a report author, for WITHDRAWN or SEALED reports, I want to see the UUID for the specific report and a status message 'WITHDRAWN' or 'SEALED'.
- As a report author, I want to be able to click reports in my overview to open them, with the exception of withdrawn or sealed reports; they are non-clickable, but do show up in the overview. 
- As a senior/management operator I want to see all active submitted reports awaiting review.
- As a senior/management operator I want to open an active submitted report.
- As a senior/management operator I want to analyse the report with the AI Agent.
- As a senior/management operator I want to accept, ignore or have the agent re-analyse individual generated content (AI summary, AI keywords, knowledge_index updates)
- As a senior/management operator I want to accept the report and change its review status to reviewed.
- As a senior/management operator I want to deny a report by changing its `record_status` to withdrawn.
- As a senior/management operator I want to flag a report for review by a management operator.
- As an authenticated user I want to see all current reviewed reports whose record status is active
- As an authenticated user I want to search all archived reports
- As a management operator I want to seal and unseal reports
- As a management operator I want to read sealed reports, including my own via a management interface
- As a management operator I want to archive reports that are no longer operationally current.


### Agent
- As an authenticated user I want to ask the Agent questions.
- As an authenticated user I want the Agent to answer my questions using the approved knowledge, recent accessible reports and relevant external species data.
- As an authenticated user I want the Agent to tell me when the source of a recommendation is sealed, while still providing the approved operational guidance without exposing or inventing confidential details.
- As an authenticated user I want the Agent to answer my questions using the Open Meteo weather API if my question relates to the weather
- As an authenticated user I want the Agent to answer my questions about all species living in the external database (only using the information provided in that database).
- As a senior/management operator I want the Agent to suggest keywords, summaries and updates to the `species_knowledge_index`.
- As a senior/management operator I want the Agent to write the suggestions into the database after my review and permission. 


### Species Knowledge Index
- As an authenticated user, I want to read reviewed entries of the Species Knowledge Index.
- As a senior/management operator I want to review pending entries of the Species Knowledge Index
- As a management operator, I want to delete entries of the Species Knowledge Index

### Species database
- As a senior/management operator I want to update the `species_database`
- As a management operator, I want to create an entry in `species_database` using the Agent to retrieve and enrich species data from the external API, after reviewing and explicitly accepting the proposed entry.

### User management
- As an authenticated user, I want to see my own profile
- As a management operator, I want to change an employee’s role, so that senior and management permissions can be assigned appropriately.
- As a management operator, I want to delete personnel authentication accounts without deleting their profiles, reports or historical authorship.
- As a management operator, I want to view personnel accounts.
- As an authenticated user, I want to delete my own authentication account without deleting my profile, reports or historical authorship.* 

*This might not make sense for a real operational employee OS, but because this application will be published online and users can create their own accounts, they must also be able to remove their authentication accounts. The Supabase Auth identity, including the email address and login credentials, is deleted while the permanent internal profiles row, its UUID and its historical report relationships are retained. This prevents account deletion from creating missing historical data in the AI workflow. 


### Stretch functionality
- As a senior/management operator I want to order the Agent to compare the `species_database` to the current `species_knowledge_index` and recent reports and flag potential discrepancies.
- As a senior/management operator I want the Agent to suggest updates to the `species_database`.



2. Roles:

employee: create, save draft, edit draft, delete draft, submit draft, open reviewed active reports, search archived reports, talk to the Agent
senior: employee capabilities + review submitted reports, use the Agent to analyse submitted reports, use the Agent to edit the `species_knowledge_index`
Management operator: senior capabilities + seal/unseal reports, read sealed reports, archive reports, update employee's role,  

| Capability                                                       | Employee | Senior | Management |
| ---------------------------------------------------------------- | :------: | :----: | :--------: |
| Create and manage own drafts                                     |     ✓    |    ✓   |      ✓     |
| Submit own reports                                               |     ✓    |    ✓   |      ✓     |
| View reviewed active reports                                     |     ✓    |    ✓   |      ✓     |
| Search archived reports                                          |     ✓    |    ✓   |      ✓     |
| Ask the Agent questions                                          |     ✓    |    ✓   |      ✓     |
| Review submitted reports                                         |          |    ✓   |      ✓     |
| Analyse reports with the Agent                                   |          |    ✓   |      ✓     |
| Accept Agent-generated summaries, keywords and knowledge changes |          |    ✓   |      ✓     |
| Withdraw invalid reports                                         |          |    ✓   |      ✓     |
| Flag a report for management                                     |          |    ✓   |      ✓     |
| Archive reports                                                  |          |        |      ✓     |
| Seal or unseal reports                                           |          |        |      ✓     |
| Read sealed reports                                              |          |        |      ✓     |
| Create `species_database` entries	  		           |          |        |      ✓     |
| Update `species_database` entries			           |          |    ✓   |      ✓     |
| Update personnel roles					   |	      |        |      ✓     |
| View personnel profiles, incl. whose Auth identity was removed   |          |        |      ✓     |
| View own profile						   |     ✓    |    ✓  |      ✓     |
| Delete personnel accounts				           |          |        |      ✓     |
| Delete own account						   |     ✓    |    ✓  |       ✓    |
| View/select all specimens					   |     ✓    |    ✓  |       ✓    |
| Create specimens						   |          |        |      ✓     |
| Update specimens (status, measurements, location, nickname, dob) |          |    ✓   |      ✓     |
| Update lysine protocol					   |          |        |      ✓     |
| Read species knowledge index entries				   |    ✓     |   ✓   |      ✓      |
| Review pending species knowledge index entries         	   |   	      |   ✓    |     ✓      |
| Delete species knowledge index entries	  		   | 	      |        |      ✓      |



3. Report lifecycle:

Draft: submitted_at, reviewed_at, reviewed_by, review_note, ai_summary and ai_keywords are NULL; the management-review flag is false and its timestamp/requester are NULL.
Submitted: submitted_at is populated; reviewed_at and reviewed_by remain NULL. Authorised reviewers may save accepted AI fields, a review note and management-review-request metadata under Section 6’s rules.
Reviewed: submitted_at, reviewed_at and reviewed_by are populated.
Once submitted, created_by, species_id, specimen_id, report_type, title, and body cannot change.
Only review metadata, accepted AI fields and permitted status fields may subsequently change.


| `review_status` | `record_status` | Meaning                                            |
| --------------- | --------------- | -------------------------------------------------- |
| `draft`         | `active`        | Private working copy; creator may edit or delete   |
| `submitted`     | `active`        | Awaiting senior review; creator may no longer edit |
| `reviewed`      | `active`        | Approved and published                             |
| `reviewed`      | `archived`      | Valid historical record                            |
| `reviewed`      | `withdrawn`     | Rejected as unreliable or irrelevant               |
| `reviewed`      | `sealed`        | Valid but confidential                             |
When a senior or management member denies a submitted report, the report is withdrawn. The system must change review_status to reviewed and record_status to withdrawn together. It must also record reviewed_at and reviewed_by. The report must never be left in the invalid submitted/withdrawn state.
Withdrawn: The report is no longer accessible to its author or any other application role. Its author retains a status-only overview reference.
Sealed: The report is accessible only to management via the management interface. Its author retains a status-only overview reference, including when the author is a management operator.


| From               	       | To                   | Actor                                                  |
| ---------------------------- | -------------------- | ------------------------------------------------------ |
| New report         	       | `draft/active`       | Author                                                 |
| `draft/active`     	       | `submitted/active`   | Author                                                 |
| `draft/active`     	       | Hard delete          | Author                                                 |
| `submitted/active` 	       | `reviewed/active`    | Senior or management                                   |
| `submitted/active` 	       | `reviewed/withdrawn` | Senior or management                                   |
| `reviewed/active`  	       | `reviewed/withdrawn` | Senior or management  				       |
| `reviewed/active`  	       | `reviewed/archived`  | Management                                             |
| `reviewed/active`  	       | `reviewed/sealed`    | Management                                             |
| `reviewed/sealed`    	       | `reviewed/active`    | Management                                             |


### Permitted `review_status` transitions. 

| From        | To              |
| ----------- | --------------  |
| `draft`     | `submitted`     |
| `submitted` | `reviewed`      |

Backwards `review_status` transitions are not allowed. 



4. Final table definitions:



### `profiles`

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `id` | `uuid` | No | gen_random_uuid() | Primary key | Permanent internal application identity. |
| `auth_user_id` | `uuid` | Yes | None | UNIQUE; foreign key to `auth.users(id)`; `ON DELETE SET NULL` | Uses the UUID created by Supabase Auth. |
| `display_name` | `text` | No | None | CHECK (btrim(display_name) <> '') |Populated during profile creation using the part of the email address before @. If that part contains a + followed by a non-empty suffix, use everything after the first + instead. Whenever auth_user_id is NULL, display_name must equal the profile's own id converted to text (id::text). Enforce this through a BEFORE INSERT OR UPDATE trigger on profiles.|
| `role` | `text` | No | `'employee'` | Check: value must be `'employee'`, `'senior'`, or `'management'` | Role changes are restricted to management users. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the profile was created. |
| `updated_at` | `timestamptz` | No | `now()` | Maintained by the shared `set_updated_at` trigger | Must be updated whenever the profile is changed. |
| `updated_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Records the user responsible for the most recent profile change. |



### `specimens`
table constraints:
UNIQUE (id, species_id)

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key | Internal identifier for the individual specimen. |
| `species_id` | `uuid` | No | None | Foreign key to `species_database(id)`; `ON DELETE RESTRICT`; | Identifies the species to which the specimen belongs. |
| `asset_code` | `text` | No | None | Unique; check that the trimmed value is not empty | Human-readable internal identifier, such as `RAPT-01`. |
| `nickname` | `text` | Yes | `NULL` | — | Optional informal name for the specimen. |
| `date_of_birth` | `date` | Yes | `NULL` | — | No automatic default: the database insertion date is not necessarily the birth date. |
| `weight_kg` | `numeric(10, 2)` | Yes | `NULL` | Check: value must be `NULL` or greater than `0` | Current recorded weight in kilograms. |
| `length_m` | `numeric(7, 2)` | Yes | `NULL` | Check: value must be `NULL` or greater than `0` | Current recorded body length in metres. |
| `height_m` | `numeric(7, 2)` | Yes | `NULL` | Check: value must be `NULL` or greater than `0` | Current recorded height in metres. |
| `speed_kmh` | `numeric(7, 2)` | Yes | `NULL` | Check: value must be `NULL` or greater than or equal to `0` | Recorded or estimated maximum speed. |
| `lysine_protocol` | `text` | No | `'standard'` | Check: value must be `'standard'`, `'increased'`, `'reduced'`, `'suspended'`, or `'not_applicable'` | Current lysine-management protocol. |
| `location` | `text` | No | `'lab'` | Check that the trimmed value is not empty | Current recorded location. A separate location table could be introduced in a later version. |
| `status` | `text` | No | `'active'` | Check: value must be `'active'`, `'quarantine'`, `'under_treatment'`, `'transferred'`, `'deceased'`, or `'missing'` | Operational status of the specimen. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the specimen row was created. |
| `updated_at` | `timestamptz` | No | `now()` | Maintained by the shared `set_updated_at` trigger | Records the most recent update time. |
| `updated_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Records the user responsible for the most recent change. |


### `reports`
table constraints:
UNIQUE (id, species_id)
foreign key (specimen_id, species_id) references specimens (id, species_id)
`CHECK` constraint:
  - When `management_review_requested = false`,
    `management_review_requested_at` and
    `management_review_requested_by` must both be `NULL`.
  - When `management_review_requested = true`, both fields must be populated.
Lifecycle enforcement:
- `CHECK` constraints enforce the valid field combinations for each
  `review_status` and `record_status` described in Report lifecycle.
- A `BEFORE UPDATE` trigger enforces the permitted status transitions
  described in Report lifecycle.
- The same trigger prevents the immutable fields listed in Report lifecycle
  from changing after submission.
- The same trigger permits management_review_requested to change from false to true only while the report is submitted/active. Once set, management_review_requested, management_review_requested_at, and management_review_requested_by remain unchanged as historical review-request metadata.

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key | Internal identifier for the report. |
| `species_id` | `uuid` | No | None | Foreign key to `species_database(id)`; `ON DELETE RESTRICT` | Identifies the species discussed in the report. |
| `specimen_id` | `uuid` | Yes | `NULL` | Part of composite foreign key with `species_id` to `specimens(id, species_id)`; `ON DELETE RESTRICT` | Optionally links the report to one individual specimen. The composite relationship prevents species–specimen mismatches. |
| `created_by` | `uuid` | No | None | Foreign key to `profiles(id)` | Set to the internal profile ID resolved by matching profiles.auth_user_id to auth.uid() when the report is created. Must remain unchanged afterwards. |
| `title` | `text` | Yes | None | Check that the trimmed value is not empty | Original report title. Only nullable when in 'draft'. Becomes immutable after submission. |
| `body` | `text` | Yes | None | Check that the trimmed value is not empty | Original report contents. Only nullable when in 'draft'. Becomes immutable after submission. |
| `ai_summary` | `text` | Yes | `NULL` | — | Stores only the AI-generated summary accepted by the reviewer. |
| `ai_keywords` | `text[]` | Yes | `NULL` | — | Stores only the AI-generated keywords accepted by the reviewer. |
| `report_type` | `text` | Yes | None | Check: value must be `'care'`, `'behaviour'`, `'medical'`, `'security'`, or `'incident'` | Only nullable when in 'draft'. Describes the category of the report. |
| `review_status` | `text` | No | `'draft'` | Check: value must be `'draft'`, `'submitted'`, or `'reviewed'` | Tracks the report-review workflow. |
| `record_status` | `text` | No | `'active'` | Check: value must be `'active'`, `'archived'`, `'withdrawn'`, or `'sealed'` | Describes how the organisational record is currently treated. |
| `submitted_at` | `timestamptz` | Yes | `NULL` | — | Set when the creator submits the report for review. |
| `reviewed_at` | `timestamptz` | Yes | `NULL` | — | Set when a senior or management user completes the review. |
| `reviewed_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Identifies the senior or management user who completed the review. |
| `review_note` | `text` | Yes | `NULL` | — | Optional internal explanation for approval, withdrawal, sealing, or another review decision. |
| `management_review_requested` | `boolean` | No | `false` | — | Indicates whether management review was requested. |
| `management_review_requested_at` | `timestamptz` | Yes | `NULL` | — | Time at which the report was flagged for management review. If `management_review_requested` = false, this value must be set to `NULL`; once populated, it is immutable.|
| `management_review_requested_by` | `uuid` | Yes | `NULL` | foreign key to `profiles(id)` | User who flagged the report for management review. If `management_review_requested` = false, this value must be set to `NULL`; once populated, it is immutable. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the draft was first created. |
| `updated_at` | `timestamptz` | No | `now()` | Maintained by the shared `set_updated_at` trigger | Records the most recent change. |
| `updated_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Records the user responsible for the most recent change. |


### `species_knowledge_index`
table constraints:
UNIQUE (species_id, canonical_topic)
UNIQUE (id, species_id)

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key | Internal identifier for the knowledge entry. |
| `species_id` | `uuid` | No | None | Foreign key to `species_database(id)`; `ON DELETE RESTRICT` | Identifies the species to which the guidance applies. |
| `canonical_topic` | `text` | No | None | Check that the trimmed value is not empty; unique together with `species_id` | Normalised topic name, such as `transport`, `feeding`, or `containment`. |
| `status` | `text` | No | `'reviewed'` | Check: value must be `'pending'`, `'reviewed'` | Pending entries are not authoritative operational guidance and cannot support operational answers or recommendations. Authorised Senior/Management review workflows may retrieve them for reassessment and duplicate detection. |
| `search_terms` | `text[]` | No | `'{}'::text[]` | — | Alternative terms that help the Agent retrieve the relevant entry. |
| `guidance_summary` | `text` | No | None | Check that the trimmed value is not empty | Current human-approved operational guidance. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the knowledge entry was first created. |
| `created_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | The human reviewer who approved the initial entry. Nullable for seeded system data. |
| `updated_at` | `timestamptz` | No | `now()` | Maintained by the shared `set_updated_at` trigger | Records when the knowledge entry was most recently changed. |
| `updated_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | The profile responsible for the most recent change. Users that withdraw source reports change the status of entries to `pending`, which is automatically recorded in the `updated_at` and `updated_by` fields |


### `species_knowledge_sources`
table constraints:
primary key (knowledge_index_id, report_id)
foreign key (report_id, species_id) references reports (id, species_id) ON DELETE RESTRICT
foreign key (knowledge_index_id, species_id) references species_knowledge_index (id, species_id) ON DELETE CASCADE

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `knowledge_index_id` | `uuid` | No | None | Part of composite foreign key with `species_id` to `species_knowledge_index(id, species_id)`; `ON DELETE CASCADE` | Identifies the knowledge entry supported by the report. |
| `report_id` | `uuid` | No | None | Part of composite foreign key with `species_id` to `reports(id, species_id)`; `ON DELETE RESTRICT` | Identifies the report that supports the knowledge entry. |
| `species_id`| `uuid`| No| None | Foreign key to `species_database(id)`; `ON DELETE RESTRICT` | Identifies the species shared by the report and the knowledge entry. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the source relationship was accepted and created. |
| `created_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Identifies the senior or management user who accepted the relationship. |


### `species_database`

| Column | Type | Nullable | Default | Constraints / relationships | Notes |
|---|---|:---:|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key | Internal identifier used by relationships within the main application database. |
| `external_species_id` | `text` | No | None | Unique; check that the trimmed value is not empty | Stable identifier used to match this row to the external Species API. This cannot be a direct foreign key because the external data is stored in a separate Supabase project. |
| `display_name` | `text` | No | None | Check that the trimmed value is not empty | User-facing species name. It does not need to be unique because `external_species_id` provides the external identity. |
| `general_description` | `text` | No | None | Check that the trimmed value is not empty | General introductory description displayed on the species page. |
| `diet_preferences` | `text` | No | None | Check that the trimmed value is not empty | Authored description of diet, feeding preferences and relevant dietary considerations. |
| `habitat_preferences` | `text` | No | None | Check that the trimmed value is not empty | Authored description of preferred habitat and enclosure conditions. |
| `handling_guidance` | `text` | No | None | Check that the trimmed value is not empty | General handling instructions and operational precautions. |
| `minimum_handlers` | `smallint` | No | None | Check: value must be greater than `0` | Minimum number of qualified personnel required for ordinary handling operations. Exceptional situations belong in `handling_guidance` or the knowledge index. |
| `safety_class` | `text` | No | None | Check: value must be `'low'`, `'moderate'`, `'high'`, or `'critical'` | Concise classification used for filtering, warnings and UI badges. |
| `created_at` | `timestamptz` | No | `now()` | — | Records when the local species entry was created. |
| `updated_at` | `timestamptz` | No | `now()` | Maintained by the shared `set_updated_at` trigger | Records when the local species entry was most recently changed. |
| `updated_by` | `uuid` | Yes | `NULL` | Foreign key to `profiles(id)` | Identifies the senior or management user who approved the most recent change. Nullable for initially seeded data. |


NOTE: The migration will add indexes to foreign-key columns and columns used by Row Level Security policies where required for efficient queries.


5. Relationships and deletion behaviour


### profiles
- Account deletion removes the authentication account and anonymises profiles.display_name, while retaining profiles.id and historical references to the profile.

#### Authentication account
- Relationship: optional one-to-one. Each profile references zero or one authentication account; each authentication account is linked to zero or one profile.
- Foreign key: profiles.auth_user_id → auth.users(id), UNIQUE.
- Deletion behaviour: ON DELETE SET NULL. Deleting the authentication account clears profiles.auth_user_id; the profile and its historical relationships are retained.

#### Updated by
- Relationship: many-to-one, self-referencing. Each profile references zero or one editor profile; an editor profile may be referenced by zero or many profiles.
- Foreign key: profiles.updated_by → profiles.id.
- updated_by records the profile responsible for the most recent profile change.
- Account deletion retains the editor’s profile, so updated_by references remain intact.


### specimens

- UNIQUE (id, species_id) supports the composite foreign key from reports(specimen_id, species_id), ensuring that a report’s linked specimen belongs to the report’s species.

#### Specimen species
- Relationship: many-to-one. Each specimen references exactly one species; a species may be referenced by zero or many specimens.
- Foreign key: specimens.species_id → species_database.id.
- Deletion behaviour: ON DELETE RESTRICT. A species cannot be deleted while specimens reference it. Deleting a specimen does not delete its species.

#### Updated by
- Relationship: many-to-one. Each specimen references zero or one editor profile; an editor profile may be referenced by zero or many specimens.
- Foreign key: specimens.updated_by → profiles.id.
- updated_by records the profile responsible for the most recent specimen change.
- Account deletion retains the editor’s profile, so updated_by references remain intact. 


### reports

- UNIQUE (id, species_id) supports the composite foreign key from species_knowledge_sources(report_id, species_id), ensuring that a knowledge source's linked report concerns the same species as the knowledge entry.

#### Species
- Relationship: many-to-one. Each report references exactly one species: a species may be referenced by zero or many reports.
- Foreign key: reports.species_id → species_database.id.
- Deletion behaviour: ON DELETE RESTRICT. A species cannot be deleted while reports reference it. Deleting a report does not delete its species.

#### Specimen
- Relationship: many-to-one. Each report references zero or one specimen; a specimen may be referenced by zero or many reports.
- Foreign key: reports(specimen_id, species_id) → specimens(id, species_id).
- When a specimen is referenced, it must belong to the report’s species.
- Deletion behaviour: ON DELETE RESTRICT. A specimen cannot be deleted while reports reference it. Deleting a report does not delete its specimen.
- The report form filters the specimen list by the selected species.

#### Created by
- Relationship: many-to-one. Each report is created by exactly one creator; a creator may create many reports.
- Foreign key: reports.created_by → profiles.id.
- created_by records the profile responsible for the creation of the report.
- Account deletion retains the creator’s profile, so created_by references remain intact. 

#### Reviewed by
- Relationship: many-to-one. Each report references zero or one reviewer profile; a reviewer profile may be referenced by zero or many reports.
- Foreign key: reports.reviewed_by → profiles.id.
- reviewed_by records the profile who completed the most recent review.
- Account deletion retains the reviewer's profile, so reviewed_by references remain intact.

#### Management review requested by
- Relationship: many-to-one. Each report references zero or one requester profile; a requester profile may be referenced by zero or many reports.
- Foreign key: reports.management_review_requested_by → profiles.id.
- management_review_requested_by records the profile responsible for the management-review request.
- Account deletion retains the requester's profile, so management_review_requested_by references remain intact.

#### Updated by
- Relationship: many-to-one. Each report references zero or one editor profile; an editor profile may be referenced by zero or many reports.
- Foreign key: reports.updated_by → profiles.id.
- updated_by records the profile responsible for the most recent report change.
- Account deletion retains the editor’s profile, so updated_by references remain intact. 


### species_knowledge_index

- UNIQUE (species_id, canonical_topic) allows only one knowledge entry per topic per species.
- UNIQUE (id, species_id) supports the composite foreign key from species_knowledge_sources(knowledge_index_id, species_id), ensuring that each source link matches its knowledge entry’s species.

#### Species
- Relationship: many-to-one. Each knowledge index entry references exactly one species: a species may be referenced by zero or many knowledge index entries.
- Foreign key: species_knowledge_index.species_id → species_database.id.
- Deletion behaviour: ON DELETE RESTRICT. A species cannot be deleted while species knowledge entries reference it. Deleting a knowledge entry does not delete its species.

#### Created by
- Relationship: many-to-one. Each knowledge entry references zero or one creator profile; a creator profile may be referenced by zero or many knowledge entries. Seeded system entries may have no creator profile.
- Foreign key: species_knowledge_index.created_by → profiles.id.
- created_by records the profile responsible for the review/creation of the species knowledge entry (NULLABLE for seeded system data, should be populated in the normal flow)
- Account deletion retains the creator’s profile, so created_by references remain intact. 

#### Updated by
- Relationship: many-to-one. Each species knowledge entry references zero or one human reviewer profile; a human reviewer profile may be referenced by zero or many species knowledge entries.
- Foreign key: species_knowledge_index.updated_by → profiles.id.
- updated_by records the user responsible for the most recent change to the knowledge entry, this includes users who withdraw source reports causing the entry `status` to pending 
- Account deletion retains the human reviewer’s profile, so updated_by references remain intact. 


### species_knowledge_sources

- Composite primary key: primary key (knowledge_index_id, report_id) prevents the same report being linked to the same knowledge entry more than once
- Both composite foreign keys use the same species_id, ensuring that the linked report and knowledge entry concern the same species.

- Each row links one knowledge entry to one supporting report. Together, these links form a many-to-many relationship: a knowledge entry may have several supporting reports, and a report may support several knowledge entries. Either may also have no links.

#### knowledge_index_id
- Relationship: many-to-one. Each knowledge sources row references exactly one knowledge entry; a knowledge entry may be referenced by zero or many knowledge sources rows.
- Foreign key: species_knowledge_sources(knowledge_index_id, species_id) → species_knowledge_index(id, species_id).
- Deletion behaviour: ON DELETE CASCADE. Deleting a knowledge entry deletes the species_knowledge_sources rows referencing it. The supporting reports are retained.

#### Reports
- Relationship: many-to-one. Each species_knowledge_sources row references exactly one report; a report may be referenced by zero or many species_knowledge_sources rows.
- Foreign key: species_knowledge_sources(report_id, species_id) → reports(id, species_id).
- Deletion behaviour: ON DELETE RESTRICT. A report cannot be deleted while species_knowledge_sources rows reference it. Deleting a species_knowledge_sources row does not delete its report.

#### Species
- Relationship: many-to-one. Each species_knowledge_sources row references exactly one species; a species may be referenced by zero or many species_knowledge_sources rows.
- Foreign key: species_knowledge_sources.species_id → species_database.id.
- Deletion behaviour: ON DELETE RESTRICT. A species cannot be deleted while species_knowledge_sources rows reference it.

#### Created by
- Relationship: many-to-one. Each knowledge source references zero or one creator profile; a creator profile may be referenced by zero or many knowledge sources. Seeded system entries may have no creator profile.
- Foreign key: species_knowledge_sources.created_by → profiles.id.
- created_by records the senior or management profile that accepted the relationship between the knowledge entry and the report.
- Account deletion retains the creator’s profile, so created_by references remain intact. 

- Only reviewed, active reports may be added as knowledge sources. Withdrawing a supporting report must remove its species_knowledge_sources rows and mark every affected knowledge entry as pending, in the same transaction as the withdrawal.
- Sealing or archiving a supporting report retains its existing species_knowledge_sources links and does not, by itself, change the status of the linked knowledge entries. Access to sealed report contents remains restricted to management.
- Source eligibility and report-withdrawal consequences require database-level transactional enforcement. Insertion into species_knowledge_sources must verify that the referenced report is currently reviewed/active. Withdrawing a supporting report must transactionally identify the affected knowledge entries, remove the source links and set those entries to pending. The migration will implement this through a database function and/or triggers so that partial updates cannot occur.


### species_database

#### Updated by
- Relationship: many-to-one. Each species_database entry references zero or one editor profile; an editor profile may be referenced by zero or many species_database entries.
- Foreign key: species_database.updated_by → profiles.id.
- updated_by records the profile responsible for the most recent change in the species_database entry.
- Account deletion retains the editor’s profile, so updated_by references remain intact. 


6. Row Level Security

- These permissions apply to authenticated users with a linked application profile; unauthenticated access to the six application tables is denied.
- Unlisted operations and field changes are denied.
- Controlled workflows check the caller’s permissions and enforce the associated lifecycle and transaction rules; their internal writes do not grant users unrestricted direct table access.

### profiles

| Operation | Employee                                   | Senior                                     | Management                                           |
| --------- | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `SELECT`  | Own profile                                | Own profile                                | All personnel profiles, including retained profiles  |
| `INSERT`  | Through account-registration workflow only | Through account-registration workflow only | Through account-registration workflow only           |
| `UPDATE`  | Not permitted                              | Not permitted                              | Role changes only, subject to the restrictions below |
| `DELETE`  | Not permitted                              | Not permitted                              | Not permitted                                        |

- Registration: the controlled registration workflow creates the profile with role employee. Users cannot choose their initial role or directly insert arbitrary profiles. This applies even if an existing management user creates another account.
- display_name: user-initiated editing is deferred for all roles. Automatic replacement with the profile UUID on account deletion remains permitted.
- role: management may change roles of Employees, Seniors, and Management accounts. 
- System-maintained fields: identity fields, creation timestamps and audit fields cannot be edited freely by users; controlled workflows maintain them.
- Account deletion: authenticated users may invoke the controlled workflow for their own authentication account. Management may invoke it for another personnel account. The workflow deletes the Supabase Auth identity, sets profiles.auth_user_id to NULL and anonymises profiles.display_name, while retaining the profile and all historical references. It must run through trusted server-side logic; clients receive no unrestricted access to auth.users and no service-role credentials.


### specimens

| Operation | Employee      | Senior                                           | Management                           |
| --------- | ------------- | ------------------------------------------------ | ------------------------------------ |
| `SELECT`  | All specimens | All specimens                                    | All specimens                        |
| `INSERT`  | Not permitted | Not permitted                                    | May create specimens                 |
| `UPDATE`  | Not permitted | Nickname, dob, measurements, location and status | Same as senior, plus lysine protocol |
| `DELETE`  | Not permitted | Not permitted                                    | Not permitted                        |

- Specimens are retained through `status` changes, instead of allowing a deletion. This way, the specimen data will not be lost upon transfer or death, and can still serve to support recommendations or reports.
- System-maintained fields: identity fields, creation timestamps and audit fields cannot be edited freely by users; controlled workflows maintain them.


### reports

#### `SELECT`

| Report category                   | Employee                  | Senior                    | Management    		|
| --------------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Own `draft/active`                | Full access               | Full access               | Full access   		|
| Another user’s `draft/active`     | Not permitted             | Not permitted             | Not permitted 		|
| Own `submitted/active`            | Full access               | Full access               | Full access   		|
| Another user’s `submitted/active` | Not permitted             | Full access               | Full access   		|
| `reviewed/active`                 | Full access               | Full access               | Full access   		|
| `reviewed/archived`               | Full access               | Full access               | Full access   		|
| `reviewed/sealed`                 | Own: status-only overview | Own: status-only overview | Full access   		|
| `reviewed/withdrawn`              | Own: status-only overview | Own: status-only overview | Own: status-only overview |

“Full access” means permission to read all report fields, not permission to update or delete the report. “Own: status-only overview” means access only to the author’s report UUID and record_status through the restricted overview query; it does not grant access to the report row or its contents. For those cells, reports belonging to other users are inaccessible.
A separate controlled source lookup may return the report ID and `record_status = 'sealed'` to Employee and Senior users when the report is linked through `species_knowledge_sources` to a knowledge entry they are permitted to access. This lookup exposes no other fields from the sealed report and does not permit discovery of unrelated sealed reports.

#### `INSERT`

| Operation | Employee                              | Senior                                | Management                            |
| --------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| `INSERT`  | May create own `draft/active` reports | May create own `draft/active` reports | May create own `draft/active` reports |

- created_by must equal the current user’s internal profiles.id, resolved by matching profiles.auth_user_id to auth.uid(). No role may create a report on another user’s behalf.
- species_id is mandatory. specimen_id is optional and must match the selected species.
- The author may supply title, body and report_type, subject to their existing constraints; these fields may remain NULL while the report is a draft.
- review_status must be 'draft'; record_status must be 'active'.
- submitted_at, reviewed_at, reviewed_by, review_note, ai_summary and ai_keywords must initially be NULL.
- management_review_requested must initially be false; its timestamp and requester must be NULL.
- Identifiers, timestamps and audit fields are populated through database defaults or controlled system logic, rather than freely chosen by the author.

#### `UPDATE`

| Action                                        | Employee      | Senior        | Management |
| --------------------------------------------- | ------------- | ------------- | ---------- |
| Edit own `draft/active` content               | Permitted     | Permitted     | Permitted  |
| Submit own `draft/active` report              | Permitted     | Permitted     | Permitted  |
| Review an unflagged `submitted/active` report | Not permitted | Permitted     | Permitted  |
| Review a flagged `submitted/active` report    | Not permitted | Not permitted | Permitted  |

Only the changes explicitly listed in this subsection are permitted. id, created_by and created_at remain unchanged. Once submitted, species_id, specimen_id, report_type, title, body and submitted_at also remain unchanged. The system maintains updated_at and records the acting user’s internal profiles.id in updated_by for every permitted update.

- Edit draft: change title, body, report_type, species_id and specimen_id, maintaining species–specimen consistency.
- Submit: change 'draft' to 'submitted' and record submitted_at. Required submission fields must be populated.
- Review: save explicitly accepted AI fields and a review_note; approve the report as reviewed/active or reject it as reviewed/withdrawn. Completing review records reviewed_at and reviewed_by.
- Request management review: senior or management may set management_review_requested on a submitted/active report, with its timestamp and requester recorded. This does not itself complete the review.
- Seniors may review only submitted/active reports where management_review_requested = false.
- Management may review both flagged and unflagged submitted/active reports.
- While a report is submitted/active and flagged for management review, seniors may still read it, but may not change its AI fields, review note or review outcome—including withdrawing it.
- The flag and its requester/timestamp remain as historical metadata after management completes the review.

##### Withdraw a report

| Starting state                                            | Employee      | Senior        | Management |
| --------------------------------------------------------- | ------------- | ------------- | ---------- |
| `submitted/active`, `management_review_requested = false` | Not permitted | Permitted     | Permitted  |
| `submitted/active`, `management_review_requested = true`  | Not permitted | Not permitted | Permitted  |
| `reviewed/active`                                         | Not permitted | Permitted     | Permitted  |

* Authorship alone does not grant withdrawal permission. Senior and management users exercise this permission through their role.
* Withdrawing a submitted report changes `review_status` to `'reviewed'` and `record_status` to `'withdrawn'` together. The system populates `reviewed_at` with the review time and `reviewed_by` with the acting user's internal `profiles.id`.
* Withdrawing an already reviewed report changes `record_status` to `'withdrawn'`. Its existing `review_status`, `reviewed_at` and `reviewed_by` remain unchanged.
* The acting user may provide a `review_note` explaining the withdrawal. The system maintains `updated_at` and records the acting user's internal `profiles.id` in `updated_by`.
* Original report content, authorship and submission metadata remain unchanged. Withdrawal does not change accepted AI fields or management-review-request metadata.
* A retained management-review flag does not prevent a senior user from withdrawing an already reviewed, active report; the flag restricts review authority only while the report is submitted.
* As specified in Section 5, withdrawal must identify every knowledge entry supported by the report, remove the report's `species_knowledge_sources` rows and set every affected knowledge entry to `'pending'`, even when other supporting reports remain. The guidance text and other source links are retained.
* The report withdrawal, source-link removal and affected knowledge-entry status changes must occur in one database transaction: either all succeed or none take effect. If the report has no source links, no knowledge entries require changes.
* Pending entries are not authoritative operational guidance and cannot support operational answers or recommendations. Authorised Senior/Management review workflows may retrieve them for reassessment and duplicate detection.
* After withdrawal, no application role may read the report's contents. Its author retains access only to its UUID and `'withdrawn'` status through the restricted overview query. The Agent must not retrieve or use the withdrawn report as evidence.
* Withdrawal retains the report row. No transition out of `'withdrawn'` is permitted by the current lifecycle.

##### Archive, seal and unseal reports

| Action  | Starting state    | Resulting state     | Employee      | Senior        | Management |
| ------- | ----------------- | ------------------- | ------------- | ------------- | ---------- |
| Archive | `reviewed/active` | `reviewed/archived` | Not permitted | Not permitted | Permitted  |
| Seal    | `reviewed/active` | `reviewed/sealed`   | Not permitted | Not permitted | Permitted  |
| Unseal  | `reviewed/sealed` | `reviewed/active`   | Not permitted | Not permitted | Permitted  |

* These actions change `record_status`; `review_status` remains `'reviewed'`.
* Management may provide a `review_note` explaining the action. The system maintains `updated_at` and records the acting user's internal `profiles.id` in `updated_by`.
* Original report content, authorship, submission metadata, completed-review metadata, accepted AI fields and management-review-request metadata remain unchanged.
* Existing `species_knowledge_sources` links are retained. These actions do not change the status of linked knowledge entries.
* Archived reports remain readable by all authenticated users. Sealed report contents are readable only by management; other authors retain only their own UUID-and-status overview reference. Unsealing restores normal access to the reviewed, active report.
* No other archive, seal or unseal transitions are permitted in the current lifecycle.

#### DELETE

| Operation | Employee                        | Senior                          | Management                      |
| --------- | ------------------------------- | ------------------------------- | ------------------------------- |
| `DELETE`  | Own `draft/active` reports only | Own `draft/active` reports only | Own `draft/active` reports only |

* Deletion permanently removes the draft row.
* No role may delete another user's draft or any submitted or reviewed report, regardless of its `record_status`.


### species_knowledge_index

| Operation | Employee                                | Senior                            | Management                       |
| --------- | --------------------------------------- | --------------------------------- | -------------------------------- |
| `SELECT`  | Entries with `status = 'reviewed'` only | All entries, including `pending`  | All entries, including `pending` |
| `INSERT`  | Not permitted                           | May create human-approved entries | Same as senior                   |
| `UPDATE`  | Not permitted                           | May edit and review entries       | Same as senior                   |
| `DELETE`  | Not permitted                           | Not permitted                     | Permitted                        |

- Creation: species_id is required, alongside canonical_topic and guidance_summary. search_terms may start empty. New human-approved entries have status = 'reviewed'.
- Editing: seniors and management may change canonical_topic, search_terms and guidance_summary. AI proposals require explicit human acceptance before saving.
- Status: setting an entry to reviewed requires human review. Withdrawal of a supporting report automatically sets affected entries to pending, as specified in Section 5. Status is a workflow decision, not an unrestricted label.
- Identity and audit: keep id, species_id, created_at and created_by unchanged during updates; the system maintains updated_at and updated_by. Keeping species_id fixed prevents an existing entry from being reassigned to another species.
- Retrieval: the Agent uses only reviewed entries for recommendations, regardless of the requesting user’s role.
- Deletion: management may permanently delete an entry; its source links are deleted, while the supporting reports remain.


### species_knowledge_sources

| Operation | Employee                                        | Senior                                         | Management                                     |
| --------- | ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `SELECT`  | Links belonging to `reviewed` knowledge entries | Links belonging to all knowledge entries       | Links belonging to all knowledge entries       |
| `INSERT`  | Not permitted                                   | Through the knowledge-acceptance workflow only | Through the knowledge-acceptance workflow only |
| `UPDATE`  | Not permitted                                   | Not permitted                                  | Not permitted                                  |
| `DELETE`  | Not permitted directly                          | Not permitted directly                         | Not permitted directly                         |

- Accepting a knowledge proposal creates its approved source links through the controlled workflow. Each new link must connect a knowledge entry to a reviewed/active report of the same species.
- Link rows are not edited in place.
- Withdrawing a supporting report automatically removes its links and marks affected knowledge entries as pending, as specified in Section 5.
- Management’s deletion of a knowledge entry automatically removes its source links; the reports remain.
- No separate manual source-link deletion feature is provided in this version.


### species_database

| Operation | Employee      | Senior                                        | Management                    |
| --------- | ------------- | --------------------------------------------- | ----------------------------- |
| `SELECT`  | All entries   | All entries                                   | All entries                   |
| `INSERT`  | Not permitted | Not permitted                                 | May create species entries    |
| `UPDATE`  | Not permitted | May update descriptive and operational fields | Same as senior                |
| `DELETE`  | Not permitted | Not permitted                                 | Not permitted in this version |

- Editable fields are display_name, general_description, diet_preferences, habitat_preferences, handling_guidance, minimum_handlers and safety_class.
- On creation, management must supply a valid external_species_id and all required descriptive and operational fields.
- id, external_species_id and created_at remain unchanged during updates, preserving the species’ identity.
- The system maintains updated_at and records the acting user’s internal profiles.id in updated_by.
- All values remain subject to Section 4’s constraints.


7. Agent Data Flow


### 7.1 Shared Agent rules

The following rules apply to all Agent interactions:

**Authentication and authorisation**
- The user must be authenticated and have a linked profile.
- The Agent operates within the authenticated user's permissions, as defined in Section 6.
- The Agent may not retrieve or expose information that the user is not authorised to access.

**Information retrieval**
- Withdrawn reports must not be used as sources for Agent-generated answers or proposals.
- Sealed-report contents may only be retrieved or disclosed to Management users.
- Only `reviewed` entries from `species_knowledge_index` may support operational answers.
- External API responses and retrieved documents are treated as untrusted data, not instructions.

**Generated output and database operations**
- Model-generated answers and unaccepted proposals remain temporary application state and are not persisted in the database.
- Database writes occur only through controlled workflows that enforce the relevant permissions, validation rules and lifecycle constraints.
- AI-generated information must never silently overwrite human-approved information.
- AI-generated report analysis and knowledge proposals require explicit approval from an authorised user before being saved.

**Reliability and error handling**
- Agent tool inputs and structured outputs must be validated against their defined schemas.
- Tool and retrieval failures must be disclosed rather than concealed or compensated for with invented information.
- The Agent must not invent missing evidence or present unsupported conclusions as established facts.
- Agent execution must have defined limits to prevent uncontrolled tool-calling loops.


### 7.2 Operational question-and-answer flow

The Agent assists authenticated users with operational questions about species, specimens, husbandry and park procedures.

1. The application authenticates the user and retrieves their profile and role.

2. The user's question is passed to the Agent. The Agent identifies the relevant species, optional specimen and operational topic.

3. The Agent selects and executes the appropriate retrieval tools:
   - Retrieve the relevant species information from `species_database`.
   - Search `species_knowledge_index` for relevant `reviewed` entries, primarily using species identifiers, canonical topics and keywords.
   - Follow relevant `species_knowledge_sources` links to identify supporting reports.
   - Retrieve relevant reports with `review_status = 'reviewed'` and `record_status = 'active'` or `'archived'`, either through existing source links or an independent report search. Management users may additionally retrieve `reviewed/sealed` reports; Employee and Senior users receive only the limited sealed-source metadata permitted by Section 7.3. Draft, submitted and withdrawn reports must not support operational answers. Retrieve permitted specimen information when necessary, applying relevance-based limits rather than a fixed date restriction.   
   - Request external species information or current weather data when needed.

4. Every internal retrieval operation enforces the authenticated user's access permissions. External API responses are validated before being supplied to the model.

5. The Agent may perform multiple tool calls, using earlier results to determine whether additional information is required. Execution is subject to a defined step limit.

6. The Agent generates an operational answer using the permitted information retrieved. It distinguishes established information from uncertainty and discloses relevant missing information or retrieval failures.

7. The answer is streamed to the application UI. Ordinary answers are temporary application state and are not persisted in the database.


### 7.3 Sealed-source handling

Sealed reports remain valid sources of evidence but require additional access restrictions.

- The Agent may use the human-approved `guidance_summary` of a `reviewed` knowledge entry for operational answers when that entry is visible to the authenticated user.
- For Employee and Senior operational questions, the Agent must not retrieve sealed-report contents into the user-facing Agent context and must not expose, paraphrase or infer confidential details from those reports.
- The Agent may state that some supporting evidence is sealed when this is relevant to the answer.
- The Agent must not invent or speculate about the contents of sealed evidence.
- Sealed-report contents may be retrieved for Agent analysis only when the authenticated user has the Management role. For Employee and Senior users, a controlled lookup of sources linked to an accessible knowledge entry returns only the sealed report's ID and `record_status = 'sealed'`; its contents must not enter the Agent's context. The Agent may identify the report as sealed supporting evidence but must not infer or speculate about its contents.
- Management users may retrieve sealed reports directly because their permissions allow access to those reports.


### 7.4 Report-analysis flow

The Agent analyses submitted reports and generates structured proposals for report metadata and the species knowledge index. The report under review is treated as proposed new evidence, not as approved operational knowledge. Agent-generated analysis does not itself modify human-approved knowledge.

1. A Senior or Management user requests analysis of a `submitted/active` report. The Agent receives the report and its relevant metadata, including the associated species and, where applicable, specimen. Analysis does not grant permission to save AI fields or complete the review: those actions remain subject to Section 6, including the Management-only review restriction for flagged reports.

2. The Agent analyses the report and generates structured report-level proposals, including:
   - an `ai_summary`;
   - relevant `ai_keywords`;
   - one or more canonical topics that describe the operational knowledge contained in the report.

3. For each identified canonical topic, the Agent searches `species_knowledge_index` for an existing entry for the same species and topic, including entries with `status = 'pending'`.

4. If no suitable knowledge entry exists, the Agent may generate a proposal for a new `species_knowledge_index` entry, including:
   - `canonical_topic`;
   - `search_terms`;
   - a proposed `guidance_summary`;
   - the report as supporting evidence.

5. If a matching knowledge entry already exists, the Agent retrieves:
   - the current knowledge entry, including its status and existing `guidance_summary`;
   - its existing `species_knowledge_sources` links;
   - the linked `reviewed/active` and `reviewed/archived` reports that the authenticated user may read;
   - linked `reviewed/sealed` report contents only for Management users; for Employee and Senior users, only the limited sealed-source metadata defined in Section 7.3.

   If the knowledge entry is `pending`, its retained guidance is treated as material for reassessment, not as authoritative operational guidance.

6. The Agent compares the new report with the existing body of evidence. It determines whether the new evidence:
   - supports the existing guidance;
   - adds relevant detail without changing the guidance;
   - conflicts with existing evidence;
   - or provides sufficient new information to justify a revised recommendation.

7. Where appropriate, the Agent generates a structured proposal containing:
   - a revised `guidance_summary`;
   - updated canonical-topic or search-term proposals where necessary;
   - the relationship between the new report and the existing evidence;
   - any uncertainty or conflict that requires human review.

8. The Agent may use the submitted report under review to generate a temporary proposal, together with existing reviewed knowledge and the accessible linked reports described in step 5. Draft and withdrawn reports must not be used as evidence. Sealed-source metadata indicates that supporting evidence exists but does not establish what that evidence says. Any proposal based on incomplete access must disclose that limitation. Before a knowledge-index proposal based on the submitted report can be persisted, that report must become `reviewed/active`. Accepted report-level `ai_summary` and `ai_keywords` may be saved while the report remains `submitted/active`, subject to Section 6’s review permissions. Every new source link requires a report that is currently `reviewed/active`, as specified in Section 7.5. Existing links to archived or sealed reports may be retained according to Sections 5 and 6.
For knowledge-index updates, the workflow must also verify that the target entry and the supporting evidence used to generate the proposal have not changed since generation, with the exception of the report's expected approval transition and associated review/audit changes provided the underlying report content is unchanged and its current state and permissions are revalidated. If they have changed, persistence is rejected and the proposal requires reassessment and renewed human acceptance. This check and the dependent writes must occur within the same transaction.	

9. The Agent must not treat its own previous generated proposals as approved evidence. Existing knowledge entries with `status = 'reviewed'` remain authoritative operational guidance until explicitly updated or moved to `pending`. Pending entries may be examined during reassessment but must not be treated as authoritative guidance.

10. All generated report analysis and knowledge-index changes remain proposals. Approval and persistence are handled separately as defined in Section 7.5.


### 7.5 Approval and database-write sequence

Agent-generated report analysis and knowledge proposals remain temporary until explicitly accepted by an authorised human reviewer. The Agent does not directly approve or persist its own proposals.

1. A Senior or Management user reviews the Agent-generated report analysis and decides which proposed ai_summary and ai_keywords, if any, are accepted. The reviewer may independently accept, dismiss or request regeneration of each proposed summary, keyword set or knowledge-index change. Dismissed proposals are not persisted, and regenerated proposals require fresh explicit acceptance.

2. Report approval follows the permissions defined in Section 6:
   - an unflagged submitted/active report may be reviewed by Senior or Management;
   - a report with management_review_requested = true may be reviewed only by Management.
     Accepted AI fields are stored only as part of this controlled review workflow.
3. If the report is approved, it becomes reviewed/active and the system records the reviewer and review timestamp. If the report is rejected, it becomes reviewed/withdrawn and must not be used as a knowledge source.

4. Knowledge-index proposals are approved separately from the Agent’s analysis. Only Senior or Management users may accept a proposed creation or update of species_knowledge_index. Employees may not write to the knowledge index.

5. When a new knowledge proposal is accepted:
   - a new species_knowledge_index entry is created with status = 'reviewed';
   - the accepting reviewer is recorded in created_by;
   - accepted canonical_topic, search_terms and guidance_summary values are persisted;
   - approved source relationships are created through species_knowledge_sources.

6. When an update to an existing knowledge entry is accepted:
   - the accepted canonical_topic, search_terms and/or guidance_summary are persisted;
   - updated_by and updated_at identify the reviewer and change;
   - a pending entry may return to reviewed only through explicit human review;
   - newly accepted supporting reports may be added as source links;
   - existing source links are retained unless another defined lifecycle rule removes them.

7. A species_knowledge_sources row may be created only when the supporting report is already reviewed/active, concerns the same species as the knowledge entry, and the source relationship has been explicitly accepted by an authorised reviewer. Source links are created only through the controlled knowledge-acceptance workflow.

8. Each knowledge-acceptance operation must save the accepted knowledge-entry changes and any newly accepted source links in one database transaction. If any required write fails, none of that operation’s changes are persisted.

   If report approval is included in the same operation, the transaction must:
   1. approve the report as `reviewed/active`;
   2. create or update the accepted `species_knowledge_index` entry;
   3. insert the accepted `species_knowledge_sources` links.

	If the report was approved separately beforehand, that earlier approval remains unchanged if knowledge acceptance fails. Source eligibility must still be revalidated within the knowledge-acceptance transaction.

9. Knowledge proposals do not have to be accepted when the report itself is approved. A valid report may become reviewed/active while its Agent-generated knowledge proposal remains unaccepted and temporary.

10. Failure of validation, authorisation or any required database write must not be concealed or replaced with assumed success. No proposal is treated as approved unless the controlled persistence operation completes successfully.


### 7.6 Withdrawal behaviour

Withdrawal immediately removes the report from the Agent's usable evidence base and changes every affected knowledge entry to `pending`.

1. The Agent must never retrieve or use a `withdrawn` report as evidence.

2. When a supporting report is withdrawn, the existing controlled withdrawal workflow:
   - removes every `species_knowledge_sources` link belonging to that report;
   - changes every affected `species_knowledge_index` entry to `pending`;
   - retains the knowledge entry's existing `guidance_summary` and remaining source links.

3. Knowledge entries with `status = 'pending'` must not be used by the Agent for operational answers or recommendations, even when other supporting source links remain.

4. Withdrawal does not cause the Agent to generate replacement guidance automatically. Reassessment of the affected knowledge entry requires a separate human review before its status may return to `reviewed`.

5. Any temporary Agent proposal that depends on a report that becomes withdrawn before acceptance must no longer be eligible for persistence. The controlled acceptance workflow must revalidate source eligibility at write time rather than relying on the report's state when the proposal was originally generated.

6. Once an affected knowledge entry has been reviewed again and returned to `reviewed`, it may again be used by the Agent according to the normal retrieval rules.


### 7.7 External tools and data boundaries

The Agent may access application and external data only through explicitly defined tools. It has no unrestricted database access and may not make arbitrary external requests.

1. Internal application tools
   - Internal retrieval tools may access only the tables and fields required for their defined purpose.
   - Database operations execute within the authenticated user's permissions and the workflow constraints defined in Section 6.
   - Tool results should be restricted to the records and fields relevant to the current task rather than returning complete tables or datasets.
   - Write operations occur only through the controlled workflows defined in Sections 7.5 and 7.6, and the species-data acceptance workflow described in this section, subject to Section 6’s permissions.

2. External Species API
- When answering factual questions about species in the external database, the Agent must ground its species facts exclusively in the retrieved external API data and disclose missing information. For species-creation proposals, it may interpret that data and propose operational guidance, but must distinguish proposed recommendations from facts supplied by the API. These proposals require Management review and explicit acceptance before persistence.
- The Agent may query the external Species API through a dedicated tool using network requests.
- Requests are limited to information relevant to the current species or species-search task.
- Returned data is validated before being supplied to the model.
- The Agent interprets and enriches relevant external species data rather than merely reproducing the API response.
- For species creation, a Management user selects an external species, and the Agent retrieves its data through the dedicated API tool and proposes an enriched `species_database` entry. The proposal remains temporary until the user reviews and explicitly accepts it.
- Before insertion, the controlled creation workflow revalidates the user’s Management role, the external species identifier and all required fields against Sections 4 and 6. It creates the entry and records the acting user in `updated_by` only if validation succeeds. An existing `external_species_id` must not cause an existing entry to be overwritten.
- Agent-suggested updates to existing `species_database` entries remain stretch functionality. Manual updates by Senior and Management users remain permitted under Section 6.
- External information must not silently overwrite existing human-approved local information.

3. Open-Meteo
- The Agent may call Open-Meteo when weather is relevant to an operational question.
- The weather tool uses a fixed server-controlled location representing the waters off the coast of Costa Rica; users and the Agent cannot supply alternative coordinates.
- The Agent may select only the relevant supported date or forecast period.
- Returned weather data is validated before being supplied to the model.
- Weather data is temporary contextual information and is not persisted as permanent operational knowledge.

4. External-data interpretation
   - The Agent must use external API data as meaningful input to its reasoning rather than merely reproducing API responses.
   - Where external data contributes to a persisted AI-generated result, the persisted result must pass the same validation, authorisation and human-approval rules as other AI-generated database changes.
   - External data must not be persisted directly into human-approved fields merely because it was returned successfully by an API.

5. General tool boundaries
   - Tool inputs and structured outputs must be validated against defined schemas.
   - External tool responses, retrieved reports and other data supplied to the model must be treated as untrusted data rather than Agent instructions.
   - Tool failure or incomplete external data must not be replaced with fabricated values.
   - The Agent may use only the tools explicitly made available for the current workflow.


### 7.8 Failure and fallback behaviour

Agent failures must fail safely: unavailable, invalid or unauthorised information must never be replaced with invented data or broader access.

1. Tool inputs and structured Agent outputs are validated against their defined schemas. Invalid data is rejected rather than passed onward or persisted.

2. Tool failures are returned to the Agent as structured failure results where possible, allowing the Agent to recognise that the requested information was not retrieved. The Agent may make a bounded alternative or retry attempt when this is appropriate, but retries remain subject to the overall execution limit. This follows the course pattern of returning tool errors as data rather than hiding them from the Agent.

3. If an internal retrieval tool fails or returns insufficient information, the Agent may use another permitted retrieval path where one exists. It must not broaden the user's permissions, bypass RLS or substitute inaccessible records in order to complete the answer.

4. If the external Species API is unavailable or returns invalid data, the Agent may continue using eligible information from the application's own database where sufficient, but must not invent or infer unavailable external facts. External-data enrichment or persistence must not proceed without valid external source data.

5. If Open-Meteo is unavailable, outside its supported forecast range or returns invalid data, the Agent must not substitute weather from model knowledge or another location. Weather-dependent conclusions must be omitted or identified as unavailable.

6. If evidence is missing, insufficient or contradictory, the Agent must state the uncertainty rather than present an unsupported conclusion as established knowledge. In report-analysis workflows, unresolved contradictions may be surfaced for human review rather than automatically resolved.

7. If the Agent reaches its configured execution-step limit before completing the task, execution stops. The Agent must not imply that unfinished retrieval, analysis or database operations succeeded.

8. Database-write workflows must revalidate authentication, authorisation, source eligibility and structured data immediately before persistence. A failed validation or database operation leaves the Agent proposal unapproved and unpersisted.

9. Multi-step database changes that depend on one another must be transactional where specified elsewhere in this design. If any required write fails, dependent writes must not remain partially applied.

10. Ordinary Agent answers and unaccepted proposals remain temporary application state. Failure does not convert temporary output into persisted information or human-approved knowledge.
