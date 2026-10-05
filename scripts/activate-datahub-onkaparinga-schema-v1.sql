-- Data Hub 6.2D3E — Onkaparinga v1 governed schema ACTIVATION.
--
-- Run ONCE, manually, against a target database, after
-- scripts/create-datahub-governed-schema-immutability.sql has already
-- been applied. NEVER run automatically by application startup, CI,
-- Vercel, Prisma generation, or any migration runner. NEVER run against
-- Production or Neon Preview by this task — verification is via a local
-- disposable Postgres container only (see
-- tests/postgres-proof/datahubOnkaparingaSchemaV1Activation.postgres-proof.test.ts).
-- Production/Preview execution is a separate, later, explicit operator
-- action, outside this PR's scope.
--
-- USAGE (illustrative — never invoked by this task):
--   psql "$DATABASE_URL" -v actor_user_id=usr_abc123 \
--     -f scripts/activate-datahub-onkaparinga-schema-v1.sql
--
-- WHAT THIS DOES, in one transaction:
--   1. Requires an operator-supplied actor_user_id psql variable; fails
--      BEFORE any read of governed state if it is missing.
--   2. Resolves the target SourceSystem/organisation by the same exact
--      natural-key lookup as the D3B seed (name = "City of Onkaparinga
--      operational export", exactly one active row).
--   3. Validates the actor exists AND belongs to that SAME organisation
--      — never invents a fake/system user; fails closed otherwise.
--   4. Reads the current SourceSchemaVersion status:
--        RETIRED -> RAISE (terminal, never reactivated)
--        ACTIVE with the exact expected activated state already present
--          -> NOTICE + exit successfully, ZERO mutation, ZERO second
--             audit event (idempotent no-op)
--        ACTIVE but the state differs from expected -> RAISE (manual
--          drift; never silently "fixed")
--        DRAFT -> proceed to full precheck below
--   5. Full precheck (DRAFT path only): re-validates the COMPLETE
--      governed definition — DatasetType identity, SourceSchemaVersion
--      identity, all 14 worksheets, all 295 columns, all 14 mapping
--      profiles (each currently inactive with a NULL active pointer —
--      this is proven by the SAME exact-row-equality diff the D3B seed
--      itself uses, since d3b_exp_wp below hard-codes active=false /
--      active_profile_version_id=NULL), and all 14 v1 profile versions
--      — using the IDENTICAL manifest and the IDENTICAL temp-table-diff
--      technique the D3B seed (scripts/seed-datahub-onkaparinga-schema-
--      v1.sql) uses for its own validation. See the "WHY THE MANIFEST IS
--      DUPLICATED, NOT SHARED" note below for why this is a deliberate,
--      test-enforced duplication rather than a shared SQL module.
--   6. UPDATEs source_schema_versions to ACTIVE (status + activated_at
--      only) — asserts exactly one row changed.
--   7. UPDATEs all 14 worksheet_mapping_profiles rows to active=true
--      with active_profile_version_id pointing at their own v1 version
--      — asserts exactly 14 rows changed. This MUST run AFTER step 6 in
--      the same transaction: the 6.2D3E immutability trigger on
--      worksheet_mapping_profiles only permits changing
--      active/active_profile_version_id/updated_at once the OWNING
--      WORKSHEET's SourceSchemaVersion is ACTIVE or RETIRED, and a
--      trigger's subquery sees this transaction's own prior write —
--      running step 7 before step 6 would be rejected by that same
--      trigger as "profile identity mutation attempted while schema is
--      still DRAFT... " no — actually while DRAFT the profile trigger
--      permits ANY change (see the migration's own comments), so
--      ordering is not strictly required for the trigger to permit it,
--      but this script still performs 6 before 7 to match the spec's
--      own conceptual transaction order (Section 16) and because
--      activation is defined as "the schema becomes ACTIVE, then its
--      profiles are marked active" — not the reverse.
--   8. INSERTs exactly one audit_logs row: organisation_id, user_id
--      (the validated actor), action='DATA_HUB_SOURCE_SCHEMA_ACTIVATED',
--      resource_type='source_schema_version',
--      resource_id='dhcfg-onk-mwco-sv1', a compact before/after
--      lifecycle JSON (status/activated_at/active profile count only —
--      never raw workbook data, PII, credentials, secrets, or the full
--      schema payload), created_at=now().
--   9. Postvalidates the complete ACTIVE state (status, activated_at,
--      all 14 pointers) before COMMIT.
--
-- WHY THE MANIFEST IS DUPLICATED, NOT SHARED (an explicit, documented
-- engineering tradeoff — flagged rather than silently done): this repo
-- has no cross-script SQL "include"/shared-function convention for hand-
-- written migration scripts (every prior script, D3A through D3D, is
-- fully self-contained). Extracting the manifest + its drift-validation
-- logic into a genuinely shared third script/function would be the
-- cleanest long-term factoring, but was judged out of proportion for a
-- single-configuration, run-once-ever activation script under this
-- phase's own time budget. Instead, the manifest embedded below is
-- BYTE-IDENTICAL to config/data-hub/onkaparinga-monthly-operations-v1.json
-- and to the manifest embedded in scripts/seed-datahub-onkaparinga-
-- schema-v1.sql — all three are asserted byte-identical by
-- tests/containment/dataHubOnkaparingaSchemaV1Definitions.test.ts, so
-- the three copies can never silently diverge; a future edit to any one
-- of them fails that test until all three are updated together. The
-- drift-validation SQL itself (the d3b_exp_* temp-table-diff technique)
-- is copied verbatim from the D3B seed for the identical reason.
--
-- NEVER TOUCHES: import_batches (any column), uploads, source_systems
-- (any column other than the read-only lookup above), source_mappings,
-- mapping_versions, reporting-period fields, or any canonical domain
-- table (illegal_dumping, etc.). Confirmed by this script's own DML
-- surface below and proven by the accompanying real-Postgres proof.

\set ON_ERROR_STOP on
\if :{?actor_user_id}
\else
  \echo 'ERROR: D3E activation requires -v actor_user_id=<user id>'
  \quit
\endif

BEGIN;

-- psql does NOT perform :'variable' substitution inside a dollar-quoted
-- string (it deliberately protects embedded function/DO-block bodies
-- from accidental interpolation of their own `:=` assignment syntax) —
-- so the actor id cannot be referenced directly inside the DO block
-- below. Bridge it via a transaction-scoped custom GUC instead, read
-- back with current_setting() inside the block.
SET LOCAL datahub.d3e_actor_user_id = :'actor_user_id';

DO $d3e_activate$
DECLARE
  -- Byte-identical to config/data-hub/onkaparinga-monthly-operations-v1.json
  -- and to the manifest embedded in scripts/seed-datahub-onkaparinga-
  -- schema-v1.sql — see this file's own header comment above.
  c_manifest CONSTANT jsonb := $manifest$
{
  "manifestVersion": 1,
  "phase": "6.2D3B",
  "sourceSystemName": "City of Onkaparinga operational export",
  "datasetType": {
    "name": "Monthly waste and collection operations",
    "description": "Governed monthly workbook dataset for the City of Onkaparinga operational export.",
    "active": true
  },
  "schemaVersion": {
    "versionNumber": 1,
    "label": "Version derived from the June 2026 workbook"
  },
  "mappingProfile": {
    "name": "June-v1 treatment"
  },
  "draftPolicy": {
    "schemaStatus": "DRAFT",
    "schemaActivatedAt": null,
    "worksheetPresence": "OPTIONAL",
    "columnPresence": "OPTIONAL",
    "columnDeclaredType": "UNKNOWN",
    "columnLogicalFieldKey": null,
    "profileActive": false,
    "profileActiveVersionId": null,
    "profileVersionNumber": 1,
    "profileDocumentVersion": 1
  },
  "worksheets": [
    {
      "ordinal": 0,
      "logicalKey": "overview",
      "name": "Overview",
      "role": "SUMMARY",
      "disposition": "RECONCILIATION_SUMMARY",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Runs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Loads", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Pres Rate", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Contam Rate", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Weight", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Ave Wt / Bin", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 1,
      "logicalKey": "trends",
      "name": "Trends",
      "role": "SUMMARY",
      "disposition": "RECONCILIATION_SUMMARY",
      "headerRowOneBased": null,
      "columns": []
    },
    {
      "ordinal": 2,
      "logicalKey": "runs",
      "name": "Runs",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Vehicles", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Drivers", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Loads", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Booked", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Performed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Not Presented", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Contaminated", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Total Weight", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Ave Bin Weight", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Bins Per Hour", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Weight Per Hour", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Travel Time Hrs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Time Hrs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Duration", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Travel Distance Kms", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Distance Kms", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Total Distance", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 3,
      "logicalKey": "driver_run",
      "name": "Driver Run",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Driver Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Employee Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Vehicle", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Number", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Waste Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Shift Start Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Shift Start Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Shift End Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Shift End Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Shift Duration", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Start Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run End Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Time Hrs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Depart Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Depart Odo", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Return Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Return Odo", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Loads", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Performed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Total Weight", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Travel Time Hrs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Time Hrs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Travel Kms", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Kms", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 1 Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 1 Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 1 Duration Mins", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 2 Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 2 Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rest 2 Duration Mins", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 4,
      "logicalKey": "loads",
      "name": "Loads",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Run Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Run Number", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Waste Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Load Number", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Driver", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Vehicle", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Vehicle Rego", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Depart Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Depart Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Depart Odo", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Mins To Col Start", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Kms To Col Start", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Col Start Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Col Start Lat", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col Start Lng", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col Start Location", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col Start Odometer", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Col End Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Col End Lat", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col End Lng", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col End Location", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Col End Odometer", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Distance", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Performed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Mins To Tip", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Kms To Tip", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Arrival", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Arrive Odometer", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Departure", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tipping Facility", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Net Weight", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tipping Weight Net", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tipping Weight Gross", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tipping Weight Tare", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tipping Docket", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Disposal Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Split Percentage", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Global Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Depot Travel Mins", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Depot Travel Kms", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tip Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot First Job Time Mins", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot First Job Distance", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Return Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Return Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Depot Return Odo", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 5,
      "logicalKey": "jobs",
      "name": "Jobs",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Run Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Vehicle", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Driver", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Code", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Status", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Property Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Unit Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street No", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Suburb", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Postcode", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Commenced Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Commenced Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Completed Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Completed Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Duration", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Job Lat", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Job Lng", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Collection Lat", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Collection Lng", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Site Collection Delta", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Booked", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collections Performed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Missed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Not Presented", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Not Accessible", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Contaminated", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Allocated Sequence", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Collection Sequence", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Global Uuid", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Exception 1", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Count 1", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Exception 2", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Count 2", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Exception 3", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Count 3", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Exception 4", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Count 4", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Exception 5", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Count 5", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Street Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Site Category", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 6,
      "logicalKey": "tickets",
      "name": "Tickets",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Priority", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Movement", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Category", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Asset Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Serial", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Rfid", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Site Category", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Property Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Account Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Lot Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Unit Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Suburb", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Postcode", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Zone", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Requested Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Requested Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Status", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Closed Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Closed Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "First Service", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Final Service", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Type Of Service", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Notes", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Other Details Columns", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Created By", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Call Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Call Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Reported By", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Contact Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Tasks Completed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Tasks Incomplete", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Full Address", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" }
      ]
    },
    {
      "ordinal": 7,
      "logicalKey": "ticket_tasks",
      "name": "Ticket Tasks",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Ticket Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Ticket Category", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Ticket Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Ticket Status", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Call Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Call Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Auth Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Auth Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Auth Agent", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Auth Result", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Auth Note", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Property Category", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Property Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Lot Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Unit Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Address", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Suburb", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Postcode", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Zone", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Task", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Task Detail", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Task Result", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Task Commenced", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Task Completed", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Handheld", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "User", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Notes", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Type Of Service", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Driver Notes", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Service Exceptions", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Resolution Note", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Notes", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" }
      ]
    },
    {
      "ordinal": 8,
      "logicalKey": "vouchers",
      "name": "Vouchers",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Voucher Number", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Customer Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Phone Number", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Address", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Status", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Expiration", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Created Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Created Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Booked By", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" }
      ]
    },
    {
      "ordinal": 9,
      "logicalKey": "prestart_checks",
      "name": "Prestart Checks",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Vehicle", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Driver", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Result", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Problem Count", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Time", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 10,
      "logicalKey": "contamination_inspections",
      "name": "Contamination Inspections",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Username", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Property Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Site Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Site Full Address", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Suburb", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Asset Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Asset Type Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Serial", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Result", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Level", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Contaminants", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 11,
      "logicalKey": "service_exception_totals",
      "name": "Service Exception Totals",
      "role": "SUMMARY",
      "disposition": "RECONCILIATION_SUMMARY",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Category", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Garbage", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Organics", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Bin Repairs", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Illegal Dumping", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Garbage", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Recycling", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Sweeper", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Waste Services", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Waste and Recycling", "sensitivityClass": "CONFIDENTIAL" }
      ]
    },
    {
      "ordinal": 12,
      "logicalKey": "service_exceptions",
      "name": "Service Exceptions",
      "role": "DATA",
      "disposition": "STAGING_DATASET",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Id", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Classification", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Category", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Recorded Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Recorded Time", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Property Id", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Waste Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Type", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Run Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Run Number", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Code", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Service Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Run Date", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Vehicle", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Driver", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Unit No", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street No", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Street Name", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Suburb", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Postcode", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Geocoded Address", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Lat", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Lng", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" },
        { "header": "Google Maps Link", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" }
      ]
    },
    {
      "ordinal": 13,
      "logicalKey": "definitions",
      "name": "Definitions",
      "role": "METADATA",
      "disposition": "METADATA",
      "headerRowOneBased": 3,
      "columns": [
        { "header": "Sheet", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Field", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Defintion", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "Format", "sensitivityClass": "CONFIDENTIAL" },
        { "header": "3Logix Notes", "sensitivityClass": "PERSONALLY_IDENTIFIABLE" }
      ]
    }
  ]
}
$manifest$;

  c_id_prefix CONSTANT text := 'dhcfg-onk-mwco-';
  c_id_like   CONSTANT text := 'dhcfg-onk-mwco-%';
  c_dt_id     CONSTANT text := 'dhcfg-onk-mwco-dt';
  c_sv_id     CONSTANT text := 'dhcfg-onk-mwco-sv1';

  v_ss_name      text := c_manifest->>'sourceSystemName';
  v_dt_name      text := c_manifest->'datasetType'->>'name';
  v_dt_desc      text := c_manifest->'datasetType'->>'description';
  v_sv_label     text := c_manifest->'schemaVersion'->>'label';
  v_profile_name text := c_manifest->'mappingProfile'->>'name';

  v_actor_user_id CONSTANT text := current_setting('datahub.d3e_actor_user_id', true);

  v_ss_id  text;
  v_org_id text;
  v_current_status text;
  v_current_activated_at timestamptz;
  v_n      integer;
  v_diff   integer;
  v_rows   integer;
  v_active_correct_count integer;
  v_audit_id text;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  -- ── 0. Actor must be supplied — fail before any read of governed state. ──
  IF v_actor_user_id IS NULL OR btrim(v_actor_user_id) = '' THEN
    RAISE EXCEPTION 'D3E activation: actor_user_id was not provided (pass -v actor_user_id=<user id> to psql)';
  END IF;

  -- ── 1. Resolve the target SourceSystem: exact name, exactly one active row (same as D3B). ──
  SELECT count(*) INTO v_n FROM public.source_systems WHERE name = v_ss_name AND active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: expected exactly one active source_systems row named "%", found %', v_ss_name, v_n;
  END IF;
  SELECT id, organisation_id INTO v_ss_id, v_org_id FROM public.source_systems WHERE name = v_ss_name AND active;

  -- ── 2. Actor must exist and belong to the SAME organisation. Never invent a fake/system user. ──
  SELECT count(*) INTO v_n FROM public.users WHERE id = v_actor_user_id AND organisation_id = v_org_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: actor_user_id % does not exist or does not belong to organisation % — refusing to activate', v_actor_user_id, v_org_id;
  END IF;

  -- ── 3. Current-state gate. ──
  SELECT status, activated_at INTO v_current_status, v_current_activated_at
    FROM public.source_schema_versions
    WHERE id = c_sv_id AND organisation_id = v_org_id AND dataset_type_id = c_dt_id;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'D3E activation: governed SourceSchemaVersion % not found for organisation % — has the D3B seed been applied?', c_sv_id, v_org_id;
  END IF;

  IF v_current_status = 'RETIRED' THEN
    RAISE EXCEPTION 'D3E activation: SourceSchemaVersion % is RETIRED — RETIRED is terminal and can never be (re)activated', c_sv_id;
  END IF;

  IF v_current_status = 'ACTIVE' THEN
    -- Idempotent-rerun path: verify the EXACT expected activated state
    -- (not merely the status column) before deciding no-op vs RAISE.
    SELECT count(*) INTO v_n
      FROM public.worksheet_mapping_profiles wmp
      JOIN public.source_schema_worksheets ssw ON ssw.id = wmp.source_schema_worksheet_id
      WHERE ssw.source_schema_version_id = c_sv_id;
    SELECT count(*) INTO v_active_correct_count
      FROM public.worksheet_mapping_profiles wmp
      JOIN public.source_schema_worksheets ssw ON ssw.id = wmp.source_schema_worksheet_id
      WHERE ssw.source_schema_version_id = c_sv_id
        AND wmp.active = true
        AND wmp.active_profile_version_id = wmp.source_schema_worksheet_id || '-wp-v1';
    IF v_n = 14 AND v_active_correct_count = 14 AND v_current_activated_at IS NOT NULL THEN
      RAISE NOTICE 'D3E activation: SourceSchemaVersion % is already ACTIVE (activated_at=%) with all 14 profiles correctly activated — no-op, zero mutation, zero new audit event', c_sv_id, v_current_activated_at;
      RETURN;
    ELSE
      RAISE EXCEPTION 'D3E activation: SourceSchemaVersion % is ACTIVE but the activated state does not exactly match expectations (% of % profiles correctly activated, activated_at=%) — manual drift, refusing to proceed', c_sv_id, v_active_correct_count, v_n, v_current_activated_at;
    END IF;
  END IF;

  -- v_current_status = 'DRAFT' from here.

  -- ── 4. Manifest self-check (fail loud on any governance drift), identical to D3B's own. ──
  IF (c_manifest->>'manifestVersion') IS DISTINCT FROM '1'
     OR (c_manifest->'schemaVersion'->>'versionNumber') IS DISTINCT FROM '1'
     OR (c_manifest->'datasetType'->'active') IS DISTINCT FROM 'true'::jsonb
     OR v_ss_name IS NULL OR v_dt_name IS NULL OR v_sv_label IS NULL OR v_profile_name IS NULL THEN
    RAISE EXCEPTION 'D3E activation: manifest header fields are missing or unexpected';
  END IF;
  IF jsonb_array_length(c_manifest->'worksheets') <> 14 THEN
    RAISE EXCEPTION 'D3E activation: manifest must define exactly 14 worksheets, found %', jsonb_array_length(c_manifest->'worksheets');
  END IF;

  -- ── 5. Expected governed rows (deterministic ids; same scheme as D3B). ──
  CREATE TEMP TABLE d3e_exp_ws ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') AS id,
           v_org_id AS organisation_id,
           c_sv_id AS source_schema_version_id,
           ws->>'logicalKey' AS logical_key,
           ws->>'name' AS expected_name,
           (ws->>'ordinal')::int AS ordinal_hint,
           'OPTIONAL'::text AS presence,
           ws->>'role' AS role
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  CREATE TEMP TABLE d3e_exp_col ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-c' || lpad((c.pos - 1)::text, 3, '0') AS id,
           v_org_id AS organisation_id,
           c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') AS source_schema_worksheet_id,
           (c.pos - 1)::int AS ordinal,
           c.col->>'header' AS source_header,
           NULL::text AS logical_field_key,
           'OPTIONAL'::text AS presence,
           'UNKNOWN'::text AS declared_type,
           c.col->>'sensitivityClass' AS sensitivity_class
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws),
           jsonb_array_elements(ws->'columns') WITH ORDINALITY AS c(col, pos);

  CREATE TEMP TABLE d3e_exp_wp ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp' AS id,
           v_org_id AS organisation_id,
           c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') AS source_schema_worksheet_id,
           v_profile_name AS name,
           false AS active,
           NULL::text AS active_profile_version_id,
           NULL::text AS created_by
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  CREATE TEMP TABLE d3e_exp_wpv ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp-v1' AS id,
           v_org_id AS organisation_id,
           c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp' AS worksheet_mapping_profile_id,
           1 AS version_number,
           ws->>'disposition' AS disposition,
           jsonb_build_object('documentVersion', 1, 'schemaStatus', 'DRAFT', 'headerRowOneBased', ws->'headerRowOneBased') AS profile_document,
           NULL::text AS created_by
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  -- ── 6. Full precheck: the persisted D3B configuration must EXACTLY match
  -- the manifest — same exact-row-equality diff technique as the D3B seed's
  -- own Section 5 validation. Any drift RAISEs and rolls back the entire
  -- transaction; no partial activation. ──
  SELECT count(*) INTO v_n FROM public.dataset_types
    WHERE id = c_dt_id AND organisation_id = v_org_id AND source_system_id = v_ss_id AND name = v_dt_name
      AND description IS NOT DISTINCT FROM v_dt_desc AND active = true;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: dataset_types row % does not match its governed definition — refusing to activate', c_dt_id;
  END IF;

  SELECT count(*) INTO v_n FROM public.source_schema_versions
    WHERE id = c_sv_id AND organisation_id = v_org_id AND dataset_type_id = c_dt_id AND version_number = 1
      AND label = v_sv_label AND status = 'DRAFT' AND activated_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: source_schema_versions row % does not match its expected pre-activation DRAFT definition — refusing to activate', c_sv_id;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role
       FROM public.source_schema_worksheets WHERE source_schema_version_id = c_sv_id
     EXCEPT SELECT * FROM d3e_exp_ws)
    UNION ALL
    (SELECT * FROM d3e_exp_ws
     EXCEPT SELECT id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role
       FROM public.source_schema_worksheets WHERE source_schema_version_id = c_sv_id)
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3E activation: source_schema_worksheets differ from the governed definition in % row(s) — refusing to activate', v_diff;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class
       FROM public.source_schema_columns WHERE source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws)
     EXCEPT SELECT * FROM d3e_exp_col)
    UNION ALL
    (SELECT * FROM d3e_exp_col
     EXCEPT SELECT id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class
       FROM public.source_schema_columns WHERE source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws))
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3E activation: source_schema_columns differ from the governed definition in % row(s) — refusing to activate', v_diff;
  END IF;

  -- This diff ALSO proves every profile is currently active=false with a
  -- NULL active_profile_version_id (d3e_exp_wp hard-codes those values),
  -- satisfying Section 15's "active pointers currently NULL, profiles
  -- currently inactive" precheck without a separate query.
  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by
       FROM public.worksheet_mapping_profiles WHERE source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws)
     EXCEPT SELECT * FROM d3e_exp_wp)
    UNION ALL
    (SELECT * FROM d3e_exp_wp
     EXCEPT SELECT id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by
       FROM public.worksheet_mapping_profiles WHERE source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws))
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3E activation: worksheet_mapping_profiles differ from the governed pre-activation definition in % row(s) — refusing to activate', v_diff;
  END IF;

  -- profile_document.schemaStatus is compared as the literal historical
  -- string "DRAFT" here — Section 12: this field is non-authoritative
  -- historical/config metadata, frozen at seed time, and is NEVER
  -- rewritten by activation (WorksheetMappingProfileVersion is immutable).
  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by
       FROM public.worksheet_mapping_profile_versions WHERE worksheet_mapping_profile_id IN (SELECT id FROM d3e_exp_wp)
     EXCEPT SELECT * FROM d3e_exp_wpv)
    UNION ALL
    (SELECT * FROM d3e_exp_wpv
     EXCEPT SELECT id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by
       FROM public.worksheet_mapping_profile_versions WHERE worksheet_mapping_profile_id IN (SELECT id FROM d3e_exp_wp))
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3E activation: worksheet_mapping_profile_versions differ from the governed definition in % row(s) — refusing to activate', v_diff;
  END IF;

  -- ── 7. Capture the compact audit "before" state. ──
  v_before := jsonb_build_object(
    'status', v_current_status,
    'activatedAt', v_current_activated_at,
    'activeProfileCount', 0
  );

  -- ── 8. The activation mutation itself. Step order matters: the schema
  -- version flips to ACTIVE FIRST, so the 6.2D3E immutability trigger on
  -- worksheet_mapping_profiles (which permits only the lifecycle-pointer
  -- fields once the owning worksheet's schema is ACTIVE/RETIRED) sees the
  -- correct in-transaction parent state when the profile UPDATE runs. ──
  UPDATE public.source_schema_versions
    SET status = 'ACTIVE', activated_at = now()
    WHERE id = c_sv_id AND organisation_id = v_org_id AND dataset_type_id = c_dt_id
      AND status = 'DRAFT' AND activated_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'D3E activation: expected to activate exactly 1 source_schema_versions row, affected %', v_rows;
  END IF;

  UPDATE public.worksheet_mapping_profiles
    SET active = true,
        active_profile_version_id = source_schema_worksheet_id || '-wp-v1',
        updated_at = now()
    WHERE organisation_id = v_org_id
      AND source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws)
      AND active = false
      AND active_profile_version_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 14 THEN
    RAISE EXCEPTION 'D3E activation: expected to activate exactly 14 worksheet_mapping_profiles rows, affected %', v_rows;
  END IF;

  -- ── 9. Audit event — exactly one, within this same transaction. ──
  v_after := jsonb_build_object(
    'status', 'ACTIVE',
    'activatedAt', (SELECT activated_at FROM public.source_schema_versions WHERE id = c_sv_id),
    'activeProfileCount', 14
  );
  v_audit_id := 'aud-' || substr(md5(random()::text || clock_timestamp()::text || c_sv_id), 1, 24);
  INSERT INTO public.audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at)
    VALUES (v_audit_id, v_org_id, v_actor_user_id, 'DATA_HUB_SOURCE_SCHEMA_ACTIVATED', 'source_schema_version', c_sv_id, v_before, v_after, now());

  -- ── 10. Postvalidate the complete ACTIVE state before COMMIT. ──
  SELECT count(*) INTO v_n FROM public.source_schema_versions
    WHERE id = c_sv_id AND status = 'ACTIVE' AND activated_at IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: postvalidation failed — source_schema_versions % is not in the expected ACTIVE state', c_sv_id;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.worksheet_mapping_profiles wmp
    WHERE wmp.source_schema_worksheet_id IN (SELECT id FROM d3e_exp_ws)
      AND wmp.active = true
      AND wmp.active_profile_version_id = wmp.source_schema_worksheet_id || '-wp-v1';
  IF v_n <> 14 THEN
    RAISE EXCEPTION 'D3E activation: postvalidation failed — expected 14 correctly-activated profiles, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
    WHERE id = v_audit_id AND organisation_id = v_org_id AND user_id = v_actor_user_id
      AND action = 'DATA_HUB_SOURCE_SCHEMA_ACTIVATED' AND resource_type = 'source_schema_version' AND resource_id = c_sv_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3E activation: postvalidation failed — audit_logs entry % was not found as expected', v_audit_id;
  END IF;

  RAISE NOTICE 'D3E activation: SourceSchemaVersion % is now ACTIVE, 14 profiles activated, audit event % recorded', c_sv_id, v_audit_id;
END
$d3e_activate$;

COMMIT;
