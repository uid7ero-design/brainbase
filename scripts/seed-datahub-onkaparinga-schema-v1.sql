-- Data Hub 6.2D3B — governed CONFIGURATION seed: the first
-- repository-governed DatasetType + June-v1 SourceSchemaVersion +
-- worksheet/column/profile definitions for the SourceSystem named
-- exactly "City of Onkaparinga operational export".
--
-- NOT a schema migration. It creates no table/column/constraint/index and
-- depends on the 6.2D3A foundation (scripts/create-datahub-source-schema-
-- profiles.sql) already being present. NOT run automatically by this
-- task, and NEVER run against Production or Neon Preview by this task —
-- verification is via a local disposable Postgres container only (see
-- scripts/tests/verify-datahub-onkaparinga-schema-v1.sh). Production
-- application is a separate, reviewed, post-merge handoff.
--
-- SAFE STRUCTURAL METADATA ONLY. The embedded manifest below is
-- byte-identical to config/data-hub/onkaparinga-monthly-operations-v1.json
-- (asserted by tests/containment/dataHubOnkaparingaSchemaV1Definitions.
-- test.ts). It holds sheet names/order, literal header text (typos and
-- duplicate headers preserved exactly), roles, dispositions and the
-- committed per-column sensitivity classes. It holds NO row counts,
-- totals, sample values, organisation ids, source-system ids, secrets or
-- personal data.
--
-- ZERO RUNTIME BEHAVIOR CHANGE. Nothing reads these rows yet. XLSX mapping
-- selection, XLSX confirmation, canonical import, reconciliation execution
-- and ImportBatch schema selection all remain disabled. The seed:
--   * never UPDATEs or DELETEs any row, in any table;
--   * never touches import_batches (dataset_type_id /
--     source_schema_version_id stay NULL on every batch);
--   * never touches source_systems.reporting_period_required;
--   * never touches source_mappings / mapping_versions;
--   * leaves the schema version DRAFT (activated_at NULL), every
--     worksheet/column OPTIONAL, every column UNKNOWN-typed with a NULL
--     logical_field_key, and every profile active=false with a NULL
--     active_profile_version_id.
--
-- TARGET RESOLUTION: the SourceSystem is located by EXACT name and there
-- must be EXACTLY ONE active matching row across all tenants; the
-- DatasetType inherits that row's organisation_id. No organisation_id or
-- source_system_id is hard-coded anywhere in this repository.
--
-- DETERMINISTIC IDS: every created row gets a fixed id derived from the
-- constant prefix 'dhcfg-onk-mwco-' plus the worksheet logical key and
-- zero-based column ordinal (see c_* constants and the d3b_exp_* tables).
--
-- ALL-OR-NOTHING STATE MACHINE (single transaction):
--   * FRESH    — no DatasetType with this (source system, name) and no row
--                in any of the six D3A tables carrying a D3B id / D3B
--                parent: insert everything, then validate.
--   * COMPLETE — every governed row exists EXACTLY as defined and nothing
--                extra hangs off the D3B schema version / worksheets /
--                profiles: ZERO writes (validation only).
--   * ANYTHING ELSE (partial state, manual edits, extra rows, id
--     collisions, activation by a later phase) — RAISE; the whole
--     transaction rolls back and nothing is written.
-- Because a successful run always commits the complete set atomically, a
-- partial state can only come from manual drift, which is never silently
-- accepted or "repaired".
--
-- NOTE: once a later phase (D3C/D3D) legitimately activates v1 or edits
-- its governed fields, this D3B seed will (correctly) refuse to rerun —
-- it asserts the exact D3B state and never "downgrades" it.

BEGIN;

DO $d3b$
DECLARE
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

  -- The D3B DRAFT invariants, hard-coded independently of the manifest:
  -- a manifest edit alone can never activate, require or type anything.
  c_draft_policy CONSTANT jsonb := '{"schemaStatus": "DRAFT", "schemaActivatedAt": null, "worksheetPresence": "OPTIONAL", "columnPresence": "OPTIONAL", "columnDeclaredType": "UNKNOWN", "columnLogicalFieldKey": null, "profileActive": false, "profileActiveVersionId": null, "profileVersionNumber": 1, "profileDocumentVersion": 1}';

  c_id_prefix CONSTANT text := 'dhcfg-onk-mwco-';
  c_id_like   CONSTANT text := 'dhcfg-onk-mwco-%';
  c_dt_id     CONSTANT text := 'dhcfg-onk-mwco-dt';
  c_sv_id     CONSTANT text := 'dhcfg-onk-mwco-sv1';

  v_ss_name      text := c_manifest->>'sourceSystemName';
  v_dt_name      text := c_manifest->'datasetType'->>'name';
  v_dt_desc      text := c_manifest->'datasetType'->>'description';
  v_sv_label     text := c_manifest->'schemaVersion'->>'label';
  v_profile_name text := c_manifest->'mappingProfile'->>'name';

  v_ss_id  text;
  v_org_id text;
  v_n      integer;
  v_hits   integer;
  v_diff   integer;
BEGIN
  -- ── 0. D3A foundation must already exist (this is not a migration) ──
  IF to_regclass('public.dataset_types') IS NULL
     OR to_regclass('public.source_schema_versions') IS NULL
     OR to_regclass('public.source_schema_worksheets') IS NULL
     OR to_regclass('public.source_schema_columns') IS NULL
     OR to_regclass('public.worksheet_mapping_profiles') IS NULL
     OR to_regclass('public.worksheet_mapping_profile_versions') IS NULL THEN
    RAISE EXCEPTION 'D3B seed: the 6.2D3A source-schema foundation tables are missing — apply scripts/create-datahub-source-schema-profiles.sql first';
  END IF;

  -- ── 1. Manifest self-check (fail loud on any governance drift) ──
  IF c_manifest->'draftPolicy' IS DISTINCT FROM c_draft_policy THEN
    RAISE EXCEPTION 'D3B seed: manifest draftPolicy % differs from the hard-coded D3B DRAFT policy %', c_manifest->'draftPolicy', c_draft_policy;
  END IF;
  IF (c_manifest->>'manifestVersion') IS DISTINCT FROM '1'
     OR (c_manifest->'schemaVersion'->>'versionNumber') IS DISTINCT FROM '1'
     OR (c_manifest->'datasetType'->'active') IS DISTINCT FROM 'true'::jsonb
     OR v_ss_name IS NULL OR v_dt_name IS NULL OR v_sv_label IS NULL OR v_profile_name IS NULL THEN
    RAISE EXCEPTION 'D3B seed: manifest header fields are missing or unexpected';
  END IF;
  IF jsonb_array_length(c_manifest->'worksheets') <> 14 THEN
    RAISE EXCEPTION 'D3B seed: manifest must define exactly 14 worksheets, found %', jsonb_array_length(c_manifest->'worksheets');
  END IF;
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(c_manifest->'worksheets') WITH ORDINALITY AS w(ws, pos)
    WHERE (ws->>'ordinal')::int IS DISTINCT FROM (pos - 1)::int
       OR (ws->>'logicalKey') !~ '^[a-z][a-z0-9_]*$'
       OR NOT ((ws->>'role', ws->>'disposition') IN (('DATA', 'STAGING_DATASET'), ('SUMMARY', 'RECONCILIATION_SUMMARY'), ('METADATA', 'METADATA')))
       OR ((ws->'headerRowOneBased') = 'null'::jsonb) IS DISTINCT FROM (jsonb_array_length(ws->'columns') = 0);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D3B seed: % manifest worksheet(s) have a non-contiguous ordinal, invalid logical key, unapproved role/disposition pair, or header-row/column mismatch', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws),
         jsonb_array_elements(ws->'columns') AS c(col)
    WHERE (col->>'sensitivityClass') NOT IN ('CONFIDENTIAL', 'PERSONALLY_IDENTIFIABLE')
       OR (col->>'header') IS NULL OR (col->>'header') = '';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D3B seed: % manifest column(s) have an empty header or a sensitivity class outside CONFIDENTIAL/PERSONALLY_IDENTIFIABLE', v_n;
  END IF;

  -- ── 2. Resolve the target SourceSystem: exact name, exactly one active row ──
  SELECT count(*) INTO v_n FROM public.source_systems WHERE name = v_ss_name AND active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3B seed: expected exactly one active source_systems row named "%", found %', v_ss_name, v_n;
  END IF;
  SELECT id, organisation_id INTO v_ss_id, v_org_id FROM public.source_systems WHERE name = v_ss_name AND active;

  -- ── 3. Expected governed rows (deterministic ids; D3B invariants hard-coded) ──
  CREATE TEMP TABLE d3b_exp_ws ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') AS id,
           v_org_id AS organisation_id,
           c_sv_id AS source_schema_version_id,
           ws->>'logicalKey' AS logical_key,
           ws->>'name' AS expected_name,
           (ws->>'ordinal')::int AS ordinal_hint,
           'OPTIONAL'::text AS presence,
           ws->>'role' AS role
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  CREATE TEMP TABLE d3b_exp_col ON COMMIT DROP AS
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

  CREATE TEMP TABLE d3b_exp_wp ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp' AS id,
           v_org_id AS organisation_id,
           c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') AS source_schema_worksheet_id,
           v_profile_name AS name,
           false AS active,
           NULL::text AS active_profile_version_id,
           NULL::text AS created_by
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  CREATE TEMP TABLE d3b_exp_wpv ON COMMIT DROP AS
    SELECT c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp-v1' AS id,
           v_org_id AS organisation_id,
           c_id_prefix || 'sv1-ws-' || (ws->>'logicalKey') || '-wp' AS worksheet_mapping_profile_id,
           1 AS version_number,
           ws->>'disposition' AS disposition,
           jsonb_build_object('documentVersion', 1, 'schemaStatus', 'DRAFT', 'headerRowOneBased', ws->'headerRowOneBased') AS profile_document,
           NULL::text AS created_by
      FROM jsonb_array_elements(c_manifest->'worksheets') AS w(ws);

  -- ── 4. State detection ──
  SELECT count(*) INTO v_n FROM public.dataset_types WHERE source_system_id = v_ss_id AND name = v_dt_name;
  SELECT (SELECT count(*) FROM public.dataset_types WHERE id LIKE c_id_like)
       + (SELECT count(*) FROM public.source_schema_versions WHERE id LIKE c_id_like OR dataset_type_id = c_dt_id)
       + (SELECT count(*) FROM public.source_schema_worksheets WHERE id LIKE c_id_like OR source_schema_version_id = c_sv_id)
       + (SELECT count(*) FROM public.source_schema_columns WHERE id LIKE c_id_like OR source_schema_worksheet_id IN (SELECT id FROM d3b_exp_ws))
       + (SELECT count(*) FROM public.worksheet_mapping_profiles WHERE id LIKE c_id_like OR source_schema_worksheet_id IN (SELECT id FROM d3b_exp_ws))
       + (SELECT count(*) FROM public.worksheet_mapping_profile_versions WHERE id LIKE c_id_like OR worksheet_mapping_profile_id IN (SELECT id FROM d3b_exp_wp))
    INTO v_hits;

  IF v_n = 0 AND v_hits = 0 THEN
    -- FRESH: insert the complete governed set. INSERT only — profiles are
    -- created with a NULL active pointer and are never updated to point at
    -- their version in D3B.
    INSERT INTO public.dataset_types (id, organisation_id, source_system_id, name, description, active, created_by)
      VALUES (c_dt_id, v_org_id, v_ss_id, v_dt_name, v_dt_desc, true, NULL);
    INSERT INTO public.source_schema_versions (id, organisation_id, dataset_type_id, version_number, label, status, created_by, activated_at)
      VALUES (c_sv_id, v_org_id, c_dt_id, 1, v_sv_label, 'DRAFT', NULL, NULL);
    INSERT INTO public.source_schema_worksheets (id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role)
      SELECT id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role FROM d3b_exp_ws;
    INSERT INTO public.source_schema_columns (id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class)
      SELECT id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class FROM d3b_exp_col;
    INSERT INTO public.worksheet_mapping_profiles (id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by)
      SELECT id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by FROM d3b_exp_wp;
    INSERT INTO public.worksheet_mapping_profile_versions (id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by)
      SELECT id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by FROM d3b_exp_wpv;
    RAISE NOTICE 'D3B seed: FRESH — inserted the governed D3B definition set for source system "%"', v_ss_name;
  ELSE
    RAISE NOTICE 'D3B seed: existing D3B state detected — validating exactly (zero writes)';
  END IF;

  -- ── 5. Exact validation (runs after a FRESH insert AND on every rerun) ──
  SELECT count(*) INTO v_n FROM public.dataset_types
    WHERE id LIKE c_id_like OR (source_system_id = v_ss_id AND name = v_dt_name);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3B seed: expected exactly one D3B dataset_types row (by fixed id or natural key), found % — partial/manual drift', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.dataset_types
    WHERE id = c_dt_id AND organisation_id = v_org_id AND source_system_id = v_ss_id AND name = v_dt_name
      AND description IS NOT DISTINCT FROM v_dt_desc AND active = true AND created_by IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3B seed: dataset_types row % does not match its governed definition (id/organisation/source system/name/description/active/created_by)', c_dt_id;
  END IF;

  SELECT count(*) INTO v_n FROM public.source_schema_versions
    WHERE id LIKE c_id_like OR (dataset_type_id = c_dt_id AND version_number = 1);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3B seed: expected exactly one D3B source_schema_versions row (by fixed id or natural key), found % — partial/manual drift', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.source_schema_versions
    WHERE id = c_sv_id AND organisation_id = v_org_id AND dataset_type_id = c_dt_id AND version_number = 1
      AND label = v_sv_label AND status = 'DRAFT' AND activated_at IS NULL AND created_by IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D3B seed: source_schema_versions row % does not match its governed DRAFT definition (label/status/activated_at/created_by)', c_sv_id;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role
       FROM public.source_schema_worksheets
      WHERE id LIKE c_id_like OR source_schema_version_id = c_sv_id
     EXCEPT SELECT * FROM d3b_exp_ws)
    UNION ALL
    (SELECT * FROM d3b_exp_ws
     EXCEPT SELECT id, organisation_id, source_schema_version_id, logical_key, expected_name, ordinal_hint, presence, role
       FROM public.source_schema_worksheets)
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3B seed: source_schema_worksheets differ from the governed definition in % row(s) (missing, extra or edited) — partial/manual drift', v_diff;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class
       FROM public.source_schema_columns
      WHERE id LIKE c_id_like OR source_schema_worksheet_id IN (SELECT id FROM d3b_exp_ws)
     EXCEPT SELECT * FROM d3b_exp_col)
    UNION ALL
    (SELECT * FROM d3b_exp_col
     EXCEPT SELECT id, organisation_id, source_schema_worksheet_id, ordinal, source_header, logical_field_key, presence, declared_type, sensitivity_class
       FROM public.source_schema_columns)
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3B seed: source_schema_columns differ from the governed definition in % row(s) (missing, extra or edited) — partial/manual drift', v_diff;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by
       FROM public.worksheet_mapping_profiles
      WHERE id LIKE c_id_like OR source_schema_worksheet_id IN (SELECT id FROM d3b_exp_ws)
     EXCEPT SELECT * FROM d3b_exp_wp)
    UNION ALL
    (SELECT * FROM d3b_exp_wp
     EXCEPT SELECT id, organisation_id, source_schema_worksheet_id, name, active, active_profile_version_id, created_by
       FROM public.worksheet_mapping_profiles)
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3B seed: worksheet_mapping_profiles differ from the governed inactive definition in % row(s) (missing, extra, activated or edited) — partial/manual drift', v_diff;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by
       FROM public.worksheet_mapping_profile_versions
      WHERE id LIKE c_id_like OR worksheet_mapping_profile_id IN (SELECT id FROM d3b_exp_wp)
     EXCEPT SELECT * FROM d3b_exp_wpv)
    UNION ALL
    (SELECT * FROM d3b_exp_wpv
     EXCEPT SELECT id, organisation_id, worksheet_mapping_profile_id, version_number, disposition, profile_document, created_by
       FROM public.worksheet_mapping_profile_versions)
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D3B seed: worksheet_mapping_profile_versions differ from the governed definition in % row(s) (missing, extra or edited) — partial/manual drift', v_diff;
  END IF;

  RAISE NOTICE 'D3B seed: validated — 1 dataset type, 1 DRAFT schema version, % worksheets, % columns, % inactive profiles, % profile versions',
    (SELECT count(*) FROM d3b_exp_ws), (SELECT count(*) FROM d3b_exp_col), (SELECT count(*) FROM d3b_exp_wp), (SELECT count(*) FROM d3b_exp_wpv);
END
$d3b$;

COMMIT;
