-- BrainBase Assurance — SYNTHETIC DEMO FIXTURE. DISPOSABLE ENVIRONMENTS ONLY.
--
-- NEVER run against Production. Intended for a local database, a Neon
-- disposable/dev branch, or the verify-assurance-ui-services.sh harness.
--
-- Creates ONE obviously-synthetic organisation ('assurance-demo-org',
-- "[DEMO] Riverside Shire Council (synthetic)") and a coherent, connected
-- Assurance scenario inside it. Every identity is namespaced so it cannot
-- be mistaken for real data and can be removed with
-- scripts/assurance-demo/cleanup-assurance-demo.sql:
--   organisation id  assurance-demo-org
--   user ids         assurance-demo-*            (no passwords; cannot log in)
--   record UUIDs     a55de000-0000-4000-8000-*
--   references       *-DEMO-###
--   names            prefixed/suffixed "Demo" / "(DEMO)" / "(synthetic)"
--
-- How to view it: sign in as a BrainBase super_admin and impersonate the
-- "[DEMO] Riverside Shire Council (synthetic)" organisation (existing
-- org_override mechanism). The demo users have no credentials.
--
-- REQUIRED GUARD — run this in the SAME session first, deliberately:
--   SET assurance.demo_fixture = 'disposable-only';
--
-- Prerequisites: A0.1B + A0.1C + A0.1D-1/2/3 + A0.1E-1 (Audit) applied. Registers the 'assurance' module key (idempotent)
-- and enables it for the demo organisation only.
--
-- Scenario (dates are relative to now()):
--   1. Inspection chain (closed action):
--      INS-DEMO-001 depot safety walk (template v1, completed) -> item
--      "Drain grates secured" FAILED -> FND-DEMO-001 hazard -> ACT-DEMO-001
--      re-secure grate (Organiser task linked) -> evidence (incl. one
--      removed link kept as history) -> verification #1 REJECTED,
--      #2 ACCEPTED (independent WHS advisor) -> action CLOSED. The finding is
--      deliberately left AWAITING_VERIFICATION: closing an action never
--      closes its finding — James can close it from the UI.
--      Template v2 exists; INS-DEMO-001 still shows v1 (immutability).
--   2. Incident chain (awaiting verification):
--      INC-DEMO-001 slip in wash bay + INC-DEMO-002 near miss -> INV-DEMO-001
--      (M:N, in progress) and INV-DEMO-002 (completed; incident still open)
--      -> FND-DEMO-002 non-conformance -> ACT-DEMO-002 non-slip coating by
--      contractor (deadline extended; work done; evidence attached;
--      AWAITING_VERIFICATION) + ACT-DEMO-003 housekeeping (OVERDUE).
--   3. Other states: planned playground inspection due in 3 days; ad hoc
--      car-park lighting inspection in progress with an observation and an
--      open finding; a RESTRICTED security incident; a closed
--      environmental incident; a newly reported missed-collection incident.
--   4. Audit chain (A0.1E-1): AUD-DEMO-001 against "Synthetic Waste Operations
--      Procedure v1" rates criteria Compliant / Partial / Non-compliant / N/A /
--      Observation; the non-compliant criterion was raised as FND-DEMO-004 ->
--      ACT-DEMO-004 -> evidence -> independent verification (accepted, action
--      not yet closed). AUD-DEMO-002 is a planned ad hoc contractor audit.

BEGIN;

DO $$
BEGIN
  IF current_setting('assurance.demo_fixture', true) IS DISTINCT FROM 'disposable-only' THEN
    RAISE EXCEPTION 'Refusing to seed Assurance demo data. Run "SET assurance.demo_fixture = ''disposable-only'';" first, and ONLY in a disposable environment.';
  END IF;
  IF EXISTS (SELECT 1 FROM organisations WHERE id = 'assurance-demo-org') THEN
    RAISE EXCEPTION 'Assurance demo organisation already exists. Run scripts/assurance-demo/cleanup-assurance-demo.sql first.';
  END IF;
  IF to_regclass('public.assurance_inspection_template_versions') IS NULL THEN
    RAISE EXCEPTION 'Assurance A0.1D-3 schema is missing; apply A0.1B..A0.1D-3 first.';
  END IF;
  IF to_regclass('public.assurance_audit_template_versions') IS NULL THEN
    RAISE EXCEPTION 'Assurance A0.1E-1 Audit schema is missing; apply A0.1B..A0.1E-1 first.';
  END IF;
END $$;

-- ── Organisation, users, module entitlement ──────────────────────────────

INSERT INTO organisations (id, name, slug, updated_at)
VALUES ('assurance-demo-org', '[DEMO] Riverside Shire Council (synthetic)', 'assurance-demo-riverside', now());

INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
  ('assurance-demo-coordinator', 'assurance-demo-org', 'assurance-demo-coordinator', 'Demo · Jordan Avery (Assurance Coordinator)', 'ADMIN', 'ACTIVE', now()),
  ('assurance-demo-supervisor', 'assurance-demo-org', 'assurance-demo-supervisor', 'Demo · Sam Okafor (Depot Supervisor)', 'MANAGER', 'ACTIVE', now()),
  ('assurance-demo-inspector', 'assurance-demo-org', 'assurance-demo-inspector', 'Demo · Priya Nair (Parks Inspector)', 'MANAGER', 'ACTIVE', now()),
  ('assurance-demo-whs', 'assurance-demo-org', 'assurance-demo-whs', 'Demo · Lee Tran (WHS Advisor)', 'MANAGER', 'ACTIVE', now()),
  ('assurance-demo-viewer', 'assurance-demo-org', 'assurance-demo-viewer', 'Demo · Casey Morgan (Customer Service)', 'VIEWER', 'ACTIVE', now());

INSERT INTO modules (key, name, description, active)
VALUES ('assurance', 'Assurance', 'Incidents, investigations, inspections, findings, corrective actions, evidence and verification.', true)
ON CONFLICT (key) DO NOTHING;

-- Organiser is enabled too, so the corrective actions' linked Organiser
-- tasks are displayed (Assurance only shows task names to organisations
-- entitled to Organiser).
INSERT INTO modules (key, name, description, active)
VALUES ('organiser', 'Organiser', 'Boards, groups and tasks.', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO organisation_modules (organisation_id, module_key, enabled, config, updated_at) VALUES
  ('assurance-demo-org', 'assurance', true, '{}'::jsonb, now()),
  ('assurance-demo-org', 'organiser', true, '{}'::jsonb, now());

-- ── Shared BrainBase entities (People, locations, assets, contractor) ────

INSERT INTO hr_people (id, organisation_id, first_name, last_name, job_title) VALUES
  ('a55de000-0000-4000-8000-000000000101', 'assurance-demo-org', 'Demo', 'Operator A', 'Plant Operator (synthetic)'),
  ('a55de000-0000-4000-8000-000000000102', 'assurance-demo-org', 'Demo', 'Operator B', 'Plant Operator (synthetic)'),
  ('a55de000-0000-4000-8000-000000000103', 'assurance-demo-org', 'Demo', 'WHS Advisor', 'WHS Advisor (synthetic)'),
  ('a55de000-0000-4000-8000-000000000104', 'assurance-demo-org', 'Demo', 'Customer Officer', 'Customer Service Officer (synthetic)');

INSERT INTO locations (id, organisation_id, location_reference, location_type, name, suburb, state, country_code) VALUES
  ('a55de000-0000-4000-8000-000000000201', 'assurance-demo-org', 'LOC-DEMO-DEPOT', 'DEPOT', 'Northern Works Depot (DEMO)', 'Demoville', 'SA', 'AU'),
  ('a55de000-0000-4000-8000-000000000202', 'assurance-demo-org', 'LOC-DEMO-PLAY', 'SITE', 'Riverside Park Playground (DEMO)', 'Demoville', 'SA', 'AU'),
  ('a55de000-0000-4000-8000-000000000203', 'assurance-demo-org', 'LOC-DEMO-CIVIC', 'FACILITY', 'Civic Centre Car Park (DEMO)', 'Demoville', 'SA', 'AU');

INSERT INTO assets (id, organisation_id, asset_reference, asset_type, name) VALUES
  ('a55de000-0000-4000-8000-000000000211', 'assurance-demo-org', 'AST-DEMO-SW12', 'VEHICLE', 'Street sweeper SW-12 (DEMO)'),
  ('a55de000-0000-4000-8000-000000000212', 'assurance-demo-org', 'AST-DEMO-WB3', 'INFRASTRUCTURE', 'Wash bay drain grate WB-3 (DEMO)');

INSERT INTO external_organisations (id, organisation_id, reference, name) VALUES
  ('a55de000-0000-4000-8000-000000000221', 'assurance-demo-org', 'EXT-DEMO-CIVIL', 'Demo Civil Contractors Pty Ltd (SYNTHETIC)');

INSERT INTO assurance_risk_levels (id, organisation_id, code, name, rank, requires_verification) VALUES
  ('a55de000-0000-4000-8000-000000000231', 'assurance-demo-org', 'LOW', 'Low', 1, false),
  ('a55de000-0000-4000-8000-000000000232', 'assurance-demo-org', 'MEDIUM', 'Medium', 2, false),
  ('a55de000-0000-4000-8000-000000000233', 'assurance-demo-org', 'HIGH', 'High', 3, true),
  ('a55de000-0000-4000-8000-000000000234', 'assurance-demo-org', 'EXTREME', 'Extreme', 4, true);

-- Organiser board/task used by the corrective action (display-only link).
INSERT INTO organiser_boards (id, organisation_id, name, created_by)
VALUES ('a55de000-0000-4000-8000-000000000b01', 'assurance-demo-org', '[DEMO] Depot corrective works', 'assurance-demo-coordinator');
INSERT INTO organiser_groups (id, board_id, organisation_id, name)
VALUES ('a55de000-0000-4000-8000-000000000b02', 'a55de000-0000-4000-8000-000000000b01', 'assurance-demo-org', 'This week');
INSERT INTO organiser_items (id, board_id, organisation_id, group_id, name, status) VALUES
  ('a55de000-0000-4000-8000-000000000b11', 'a55de000-0000-4000-8000-000000000b01', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000b02', 'Bolt down wash bay grate WB-3 (DEMO)', 'Done'),
  ('a55de000-0000-4000-8000-000000000b12', 'a55de000-0000-4000-8000-000000000b01', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000b02', 'Book non-slip coating contractor (DEMO)', 'Done');

-- ── Inspection templates (immutable versions) ────────────────────────────

INSERT INTO assurance_inspection_templates (id, organisation_id, template_reference, name, inspection_type, description, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000301', 'assurance-demo-org', 'TPL-DEMO-001', 'Depot Site Safety Walk', 'SITE', 'Monthly WHS walk-through of works depots (synthetic).', 'assurance-demo-coordinator', now() - interval '60 days', now() - interval '5 days'),
  ('a55de000-0000-4000-8000-000000000302', 'assurance-demo-org', 'TPL-DEMO-002', 'Playground Safety Check', 'FACILITY', 'Quarterly playground equipment check (synthetic).', 'assurance-demo-coordinator', now() - interval '40 days', now() - interval '40 days');

INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by, created_at) VALUES
  ('a55de000-0000-4000-8000-000000000311', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000301', 1, 'Depot Site Safety Walk',
   'Walk every bay. Photograph any failed item before raising a finding.',
   '[{"key":"01-walkways-clear","label":"Walkways and exits clear of obstructions","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"02-drain-grates-secured","label":"Drain grates secured and flush with floor","responseType":"PASS_FAIL","guidance":"Check every wash bay grate, including WB-3.","required":true,"options":[]},
     {"key":"03-chemical-storage","label":"Chemical storage bunded and labelled","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"04-fire-extinguishers","label":"Fire extinguishers tagged and in date","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"05-first-aid","label":"First aid kit stocked","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]}]'::jsonb,
   now() - interval '60 days', 'assurance-demo-coordinator', now() - interval '60 days'),
  ('a55de000-0000-4000-8000-000000000313', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000302', 1, 'Playground Safety Check',
   NULL,
   '[{"key":"01-softfall-depth","label":"Softfall depth adequate under all equipment","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"02-swing-chains","label":"Swing chains and shackles intact","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"03-gates-self-close","label":"Perimeter gates self-close and latch","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"04-surface-temp","label":"Slide surface temperature (°C)","responseType":"NUMBER","guidance":"Record on days above 30°C.","required":false,"options":[]}]'::jsonb,
   now() - interval '40 days', 'assurance-demo-coordinator', now() - interval '40 days');

-- ── Scenario 1: inspection -> finding -> action -> evidence -> verification ─

INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, template_version_id, inspection_type, title, status, inspector_user_id, scheduled_at, started_at, completed_at, location_id, summary, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000401', 'assurance-demo-org', 'INS-DEMO-001', 'a55de000-0000-4000-8000-000000000311', 'SITE',
   'Monthly depot safety walk — Northern Works Depot', 'COMPLETED', 'assurance-demo-inspector',
   now() - interval '12 days', now() - interval '12 days', now() - interval '12 days' + interval '50 minutes',
   'a55de000-0000-4000-8000-000000000201', 'One failed item (wash bay grate WB-3). First aid gel replaced on the spot.',
   'assurance-demo-coordinator', now() - interval '14 days', now() - interval '12 days');

-- Version 2 of the depot walk was published AFTER INS-DEMO-001 was planned
-- against version 1 (inserted in that order so the A0.1F binding rule —
-- records bind only to the then-published version — holds; under A0.1F this
-- insert also retires version 1, exactly as publishing v2 would).
INSERT INTO assurance_inspection_template_versions (id, organisation_id, template_id, version_number, title, instructions, checklist, effective_from, created_by, created_at) VALUES
  ('a55de000-0000-4000-8000-000000000312', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000301', 2, 'Depot Site Safety Walk (rev 2 — spill kits)',
   'Walk every bay. Photograph any failed item before raising a finding. Now includes spill kits.',
   '[{"key":"01-walkways-clear","label":"Walkways and exits clear of obstructions","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"02-drain-grates-secured","label":"Drain grates secured and flush with floor","responseType":"PASS_FAIL","guidance":"Check every wash bay grate, including WB-3.","required":true,"options":[]},
     {"key":"03-chemical-storage","label":"Chemical storage bunded and labelled","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"04-fire-extinguishers","label":"Fire extinguishers tagged and in date","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"05-first-aid","label":"First aid kit stocked","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]},
     {"key":"06-spill-kit","label":"Spill kit stocked and accessible","responseType":"PASS_FAIL","guidance":null,"required":true,"options":[]}]'::jsonb,
   now() - interval '5 days', 'assurance-demo-coordinator', now() - interval '5 days');

INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type, outcome, notes, responded_by, responded_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', '01-walkways-clear', 'Walkways and exits clear of obstructions', 'PASS_FAIL', 'PASS', NULL, 'assurance-demo-inspector', now() - interval '12 days' + interval '5 minutes'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', '02-drain-grates-secured', 'Drain grates secured and flush with floor', 'PASS_FAIL', 'FAIL', 'Wash bay grate WB-3 has lifted about 20mm on the north edge — trip hazard for operators hosing down.', 'assurance-demo-inspector', now() - interval '12 days' + interval '15 minutes'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', '03-chemical-storage', 'Chemical storage bunded and labelled', 'PASS_FAIL', 'PASS', NULL, 'assurance-demo-inspector', now() - interval '12 days' + interval '25 minutes'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', '04-fire-extinguishers', 'Fire extinguishers tagged and in date', 'PASS_FAIL', 'PASS', NULL, 'assurance-demo-inspector', now() - interval '12 days' + interval '35 minutes'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', '05-first-aid', 'First aid kit stocked', 'PASS_FAIL', 'OBSERVATION', 'Burn gel past expiry — replaced from store on the spot.', 'assurance-demo-inspector', now() - interval '12 days' + interval '45 minutes');

INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id, responsible_user_id, identified_at, location_id, asset_id, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000701', 'assurance-demo-org', 'FND-DEMO-001', 'HAZARD', 'Unsecured drain grate in wash bay (WB-3)',
   'Grate WB-3 has lifted ~20mm on the north edge, creating a trip hazard in a wet, high-traffic area. Raised from INS-DEMO-001 item "Drain grates secured".',
   'AWAITING_VERIFICATION', 'a55de000-0000-4000-8000-000000000233', 'assurance-demo-supervisor', now() - interval '12 days',
   'a55de000-0000-4000-8000-000000000201', 'a55de000-0000-4000-8000-000000000212', 'assurance-demo-inspector', now() - interval '12 days', now() - interval '3 days');

INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000401', 'a55de000-0000-4000-8000-000000000701', '02-drain-grates-secured', 'assurance-demo-inspector', now() - interval '12 days');

INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, description, priority, status, owner_user_id, evidence_required, verification_required, work_completed_at, work_completed_by, closed_at, closed_by, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000801', 'assurance-demo-org', 'ACT-DEMO-001', 'CORRECTIVE', 'Re-secure and bolt down wash bay grate WB-3',
   'Lift grate, clean seat, replace frame bolts and torque to spec so the grate sits flush.',
   'HIGH', 'CLOSED', 'assurance-demo-supervisor', true, true,
   now() - interval '6 days', 'assurance-demo-supervisor', now() - interval '3 days', 'assurance-demo-coordinator',
   'assurance-demo-coordinator', now() - interval '11 days', now() - interval '3 days');

INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000801', 'a55de000-0000-4000-8000-000000000701', 'assurance-demo-coordinator', now() - interval '11 days');

INSERT INTO assurance_action_tasks (organisation_id, action_id, organiser_item_id, relationship_type, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000801', 'a55de000-0000-4000-8000-000000000b11', 'IMPLEMENTATION', 'assurance-demo-supervisor', now() - interval '10 days');

INSERT INTO assurance_timeframes (id, organisation_id, action_id, timeframe_type, original_due_at, current_due_at, status, created_by, created_at) VALUES
  ('a55de000-0000-4000-8000-000000000c01', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000801', 'ACTION', now() - interval '4 days', now() - interval '4 days', 'MET', 'assurance-demo-coordinator', now() - interval '11 days');

INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, location_id, metadata, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000901', 'assurance-demo-org', 'EVD-DEMO-001', 'PHOTO', 'Photo: grate WB-3 bolted down and flush',
   'Taken after re-torque. Straight edge shows no lip.', 'assurance-demo-supervisor', now() - interval '4 days' - interval '2 hours',
   'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture","held_at":"Records system ref DEMO-PH-0412 (synthetic)"}', 'assurance-demo-supervisor', now() - interval '4 days', now() - interval '4 days'),
  ('a55de000-0000-4000-8000-000000000902', 'assurance-demo-org', 'EVD-DEMO-002', 'DOCUMENT', 'Work order WO-DEMO-4471 completion sheet',
   'Signed completion sheet from the depot fitter (synthetic).', 'assurance-demo-supervisor', now() - interval '6 days',
   NULL, '{"source":"assurance-demo-fixture","held_at":"Asset system WO-DEMO-4471 (synthetic)"}', 'assurance-demo-supervisor', now() - interval '6 days', now() - interval '6 days'),
  ('a55de000-0000-4000-8000-000000000903', 'assurance-demo-org', 'EVD-DEMO-003', 'PHOTO', 'Photo: wash bay grate (wrong bay)',
   NULL, 'assurance-demo-supervisor', now() - interval '6 days',
   'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture"}', 'assurance-demo-supervisor', now() - interval '6 days', now() - interval '6 days'),
  ('a55de000-0000-4000-8000-000000000905', 'assurance-demo-org', 'EVD-DEMO-005', 'PHOTO', 'Photo: grate WB-3 before repair',
   'Taken during INS-DEMO-001 showing the lifted edge.', 'assurance-demo-inspector', now() - interval '12 days' + interval '15 minutes',
   'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture","held_at":"Records system ref DEMO-PH-0398 (synthetic)"}', 'assurance-demo-inspector', now() - interval '12 days', now() - interval '12 days');

INSERT INTO assurance_evidence_inspections (organisation_id, evidence_id, inspection_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000905', 'a55de000-0000-4000-8000-000000000401', 'Condition at time of inspection', 'assurance-demo-inspector', now() - interval '12 days');
INSERT INTO assurance_evidence_findings (organisation_id, evidence_id, finding_id, purpose, created_by, created_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000905', 'a55de000-0000-4000-8000-000000000701', 'Shows the hazard', 'assurance-demo-inspector', now() - interval '12 days'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000901', 'a55de000-0000-4000-8000-000000000701', 'Shows the hazard removed', 'assurance-demo-supervisor', now() - interval '4 days');
INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, purpose, created_by, created_at, removed_at, removed_by, removal_reason) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000903', 'a55de000-0000-4000-8000-000000000801', 'Completion photo', 'assurance-demo-supervisor', now() - interval '6 days',
   now() - interval '5 days', 'assurance-demo-supervisor', 'Photo showed grate WB-1, not WB-3 — replaced with EVD-DEMO-001.'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000902', 'a55de000-0000-4000-8000-000000000801', 'Work order completed', 'assurance-demo-supervisor', now() - interval '6 days', NULL, NULL, NULL),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000901', 'a55de000-0000-4000-8000-000000000801', 'Completion photo (correct bay)', 'assurance-demo-supervisor', now() - interval '4 days', NULL, NULL, NULL);

-- Verification history: #1 rejected, #2 accepted — by the independent WHS advisor.
INSERT INTO assurance_verifications (id, organisation_id, action_id, attempt_number, result, verified_by, verified_at, notes, created_at) VALUES
  ('a55de000-0000-4000-8000-000000000951', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000801', 1, 'REJECTED', 'assurance-demo-whs', now() - interval '5 days',
   'Bolts only hand-tight and the completion photo shows the wrong bay. Torque to spec and re-photograph WB-3.', now() - interval '5 days'),
  ('a55de000-0000-4000-8000-000000000952', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000801', 2, 'ACCEPTED', 'assurance-demo-whs', now() - interval '4 days' + interval '3 hours',
   'Checked on site: grate flush, bolts torqued, no lip under straight edge.', now() - interval '4 days' + interval '3 hours');
INSERT INTO assurance_evidence_verifications (organisation_id, evidence_id, verification_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000901', 'a55de000-0000-4000-8000-000000000952', 'Verification evidence', 'assurance-demo-whs', now() - interval '4 days' + interval '3 hours');

-- ── Scenario 2: incidents -> investigations (M:N) -> finding -> actions ───

INSERT INTO assurance_incidents (id, organisation_id, incident_reference, category, title, description, status, risk_level_id, occurred_at, reported_at, reported_by_user_id, owner_user_id, location_id, asset_id, immediate_response, restricted, closed_at, closed_by, closure_summary, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000501', 'assurance-demo-org', 'INC-DEMO-001', 'INJURY_SAFETY', 'Operator slipped on wet surface in wash bay',
   'While hosing down street sweeper SW-12, Demo Operator A slipped on the wet concrete near grate WB-3 and bruised their left knee. No lost time (synthetic).',
   'UNDER_INVESTIGATION', 'a55de000-0000-4000-8000-000000000233', now() - interval '14 days' + interval '9 hours', now() - interval '14 days' + interval '10 hours',
   'assurance-demo-supervisor', 'assurance-demo-coordinator', 'a55de000-0000-4000-8000-000000000201', 'a55de000-0000-4000-8000-000000000212',
   'First aid applied. Wash bay coned off for the rest of the shift.', false, NULL, NULL, NULL,
   'assurance-demo-supervisor', now() - interval '14 days' + interval '10 hours', now() - interval '9 days'),
  ('a55de000-0000-4000-8000-000000000502', 'assurance-demo-org', 'INC-DEMO-002', 'NEAR_MISS', 'Near miss: visitor caught foot on raised grate edge',
   'A delivery driver (synthetic) caught a foot on the lifted edge of grate WB-3 but did not fall.',
   'UNDER_INVESTIGATION', 'a55de000-0000-4000-8000-000000000232', now() - interval '20 days', now() - interval '20 days' + interval '1 hour',
   'assurance-demo-supervisor', 'assurance-demo-supervisor', 'a55de000-0000-4000-8000-000000000201', 'a55de000-0000-4000-8000-000000000212',
   NULL, false, NULL, NULL, NULL,
   'assurance-demo-supervisor', now() - interval '20 days' + interval '1 hour', now() - interval '9 days'),
  ('a55de000-0000-4000-8000-000000000503', 'assurance-demo-org', 'INC-DEMO-003', 'SECURITY', 'Aggressive customer at Civic Centre service counter',
   'RESTRICTED (synthetic): a customer became verbally aggressive toward a customer service officer. Police not called. Officer offered EAP.',
   'UNDER_REVIEW', 'a55de000-0000-4000-8000-000000000233', now() - interval '3 days', now() - interval '3 days' + interval '30 minutes',
   'assurance-demo-coordinator', 'assurance-demo-coordinator', 'a55de000-0000-4000-8000-000000000203', NULL,
   'Officer relieved from counter for the afternoon.', true, NULL, NULL, NULL,
   'assurance-demo-coordinator', now() - interval '3 days' + interval '30 minutes', now() - interval '2 days'),
  ('a55de000-0000-4000-8000-000000000504', 'assurance-demo-org', 'INC-DEMO-004', 'ENVIRONMENTAL', 'Minor hydraulic oil leak from street sweeper SW-12',
   'Approx. 1 L of hydraulic oil leaked onto the depot hardstand (synthetic).', 'CLOSED', 'a55de000-0000-4000-8000-000000000231',
   now() - interval '30 days', now() - interval '30 days' + interval '20 minutes', 'assurance-demo-supervisor', 'assurance-demo-supervisor',
   'a55de000-0000-4000-8000-000000000201', 'a55de000-0000-4000-8000-000000000211', 'Spill kit used; absorbent disposed of as hazardous waste.', false,
   now() - interval '25 days', 'assurance-demo-coordinator', 'Hose fitting replaced; no stormwater entry. No further action required.',
   'assurance-demo-supervisor', now() - interval '30 days' + interval '20 minutes', now() - interval '25 days'),
  ('a55de000-0000-4000-8000-000000000505', 'assurance-demo-org', 'INC-DEMO-005', 'OPERATIONAL_SERVICE', 'Missed bin collection — Elm Street (synthetic)',
   'Customer reported their kerbside bin was not collected on the scheduled day (synthetic address).', 'REPORTED', 'a55de000-0000-4000-8000-000000000231',
   now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 'assurance-demo-viewer', NULL,
   NULL, NULL, NULL, false, NULL, NULL, NULL,
   'assurance-demo-viewer', now() - interval '1 day' + interval '2 hours', now() - interval '1 day' + interval '2 hours');

INSERT INTO assurance_incident_people (organisation_id, incident_id, person_id, role, notes, created_by) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000501', 'a55de000-0000-4000-8000-000000000101', 'INJURED_PERSON', 'Bruised left knee; first aid only (synthetic).', 'assurance-demo-supervisor'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000501', 'a55de000-0000-4000-8000-000000000102', 'WITNESS', NULL, 'assurance-demo-supervisor'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000503', 'a55de000-0000-4000-8000-000000000104', 'AFFECTED_PERSON', NULL, 'assurance-demo-coordinator');

INSERT INTO assurance_investigations (id, organisation_id, investigation_reference, title, scope, status, risk_level_id, lead_user_id, started_at, target_completion_at, completed_at, completed_by, conclusion, restricted, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000601', 'assurance-demo-org', 'INV-DEMO-001', 'Wash bay slip and trip hazards',
   'Why operators and visitors are slipping/tripping in the depot wash bay: surface, drainage, housekeeping and supervision. Out of scope: vehicle design.',
   'IN_PROGRESS', 'a55de000-0000-4000-8000-000000000233', 'assurance-demo-whs', now() - interval '13 days', now() + interval '7 days', NULL, NULL, NULL, false,
   'assurance-demo-coordinator', now() - interval '13 days', now() - interval '2 days'),
  ('a55de000-0000-4000-8000-000000000602', 'assurance-demo-org', 'INV-DEMO-002', 'Depot drainage maintenance review',
   'Whether grate and drain maintenance schedules at all works depots are adequate.',
   'COMPLETED', 'a55de000-0000-4000-8000-000000000232', 'assurance-demo-supervisor', now() - interval '12 days', now() - interval '3 days',
   now() - interval '2 days', 'assurance-demo-supervisor',
   'Grate inspections were not on the planned maintenance schedule. Added quarterly grate checks for all depots. Note: this conclusion does not close INC-DEMO-001, which remains under INV-DEMO-001.',
   false, 'assurance-demo-coordinator', now() - interval '12 days', now() - interval '2 days');

INSERT INTO assurance_investigation_incidents (organisation_id, investigation_id, incident_id, relationship, created_by, created_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000501', 'PRIMARY', 'assurance-demo-coordinator', now() - interval '13 days'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000502', 'RELATED', 'assurance-demo-coordinator', now() - interval '13 days'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000602', 'a55de000-0000-4000-8000-000000000501', 'CONTEXT', 'assurance-demo-coordinator', now() - interval '12 days');

INSERT INTO assurance_investigation_people (organisation_id, investigation_id, person_id, role, created_by) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000103', 'LEAD_INVESTIGATOR', 'assurance-demo-coordinator'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000101', 'WITNESS', 'assurance-demo-whs'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000102', 'WITNESS', 'assurance-demo-whs');

INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id, responsible_user_id, responsible_external_organisation_id, identified_at, location_id, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000702', 'assurance-demo-org', 'FND-DEMO-002', 'NON_CONFORMANCE', 'Wash bay floor has no non-slip treatment',
   'The wash bay floor is smooth trowelled concrete with no non-slip coating, contrary to the depot standard for wet areas (synthetic standard).',
   'ACTION_IN_PROGRESS', 'a55de000-0000-4000-8000-000000000233', 'assurance-demo-supervisor', 'a55de000-0000-4000-8000-000000000221',
   now() - interval '9 days', 'a55de000-0000-4000-8000-000000000201', 'assurance-demo-whs', now() - interval '9 days', now() - interval '8 days');

INSERT INTO assurance_incident_findings (organisation_id, incident_id, finding_id, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000501', 'a55de000-0000-4000-8000-000000000702', 'assurance-demo-whs', now() - interval '9 days');
INSERT INTO assurance_investigation_findings (organisation_id, investigation_id, finding_id, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000601', 'a55de000-0000-4000-8000-000000000702', 'assurance-demo-whs', now() - interval '9 days');
INSERT INTO assurance_timeframes (id, organisation_id, finding_id, timeframe_type, original_due_at, current_due_at, status, created_by, created_at)
VALUES ('a55de000-0000-4000-8000-000000000c02', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000702', 'CLOSURE', now() + interval '10 days', now() + interval '10 days', 'ACTIVE', 'assurance-demo-whs', now() - interval '9 days');

INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, description, priority, status, owner_user_id, responsible_external_organisation_id, evidence_required, verification_required, work_completed_at, work_completed_by, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000802', 'assurance-demo-org', 'ACT-DEMO-002', 'CORRECTIVE', 'Apply non-slip coating to wash bay floor',
   'Contractor to grind and apply two-part non-slip epoxy to the full wash bay floor (synthetic scope).', 'HIGH', 'AWAITING_VERIFICATION',
   'assurance-demo-supervisor', 'a55de000-0000-4000-8000-000000000221', true, true, now() - interval '1 day', 'assurance-demo-supervisor',
   'assurance-demo-whs', now() - interval '8 days', now() - interval '1 day'),
  ('a55de000-0000-4000-8000-000000000803', 'assurance-demo-org', 'ACT-DEMO-003', 'PREVENTATIVE', 'Add wash bay to the weekly housekeeping checklist',
   'Update the depot weekly housekeeping sheet to include squeegeeing the wash bay and checking grates.', 'MEDIUM', 'IN_PROGRESS',
   'assurance-demo-inspector', NULL, false, false, NULL, NULL,
   'assurance-demo-whs', now() - interval '8 days', now() - interval '6 days');

INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by, created_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000802', 'a55de000-0000-4000-8000-000000000702', 'assurance-demo-whs', now() - interval '8 days'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000803', 'a55de000-0000-4000-8000-000000000702', 'assurance-demo-whs', now() - interval '8 days');

INSERT INTO assurance_action_tasks (organisation_id, action_id, organiser_item_id, relationship_type, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000802', 'a55de000-0000-4000-8000-000000000b12', 'IMPLEMENTATION', 'assurance-demo-supervisor', now() - interval '7 days');

-- ACT-DEMO-002 deadline was extended once (original_due_at preserved).
INSERT INTO assurance_timeframes (id, organisation_id, action_id, timeframe_type, original_due_at, current_due_at, status, created_by, created_at) VALUES
  ('a55de000-0000-4000-8000-000000000c03', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000802', 'ACTION', now() - interval '2 days', now() + interval '4 days', 'ACTIVE', 'assurance-demo-whs', now() - interval '8 days'),
  ('a55de000-0000-4000-8000-000000000c04', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000803', 'ACTION', now() - interval '2 days', now() - interval '2 days', 'ACTIVE', 'assurance-demo-whs', now() - interval '8 days');
INSERT INTO assurance_timeframe_extensions (organisation_id, timeframe_id, requested_due_at, reason, requested_by, requested_at, status, decided_by, decided_at, decision_notes, previous_due_at, approved_due_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000c03', now() + interval '4 days', 'Contractor needs 48 dry hours for the epoxy to cure; rain forecast.', 'assurance-demo-supervisor', now() - interval '4 days',
        'APPROVED', 'assurance-demo-coordinator', now() - interval '4 days' + interval '2 hours', 'Approved — keep the bay coned off until then.', now() - interval '2 days', now() + interval '4 days');

INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, location_id, metadata, created_by, created_at, updated_at)
VALUES ('a55de000-0000-4000-8000-000000000904', 'assurance-demo-org', 'EVD-DEMO-004', 'DOCUMENT', 'Contractor completion certificate — non-slip coating (synthetic)',
        'Certificate from Demo Civil Contractors confirming product, cure time and slip rating (synthetic).', 'assurance-demo-supervisor', now() - interval '1 day',
        'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture","held_at":"Contracts folder DEMO-CC-2026-118 (synthetic)"}', 'assurance-demo-supervisor', now() - interval '1 day', now() - interval '1 day');
INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000904', 'a55de000-0000-4000-8000-000000000802', 'Contractor sign-off', 'assurance-demo-supervisor', now() - interval '1 day');
INSERT INTO assurance_evidence_incidents (organisation_id, evidence_id, incident_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000905', 'a55de000-0000-4000-8000-000000000501', 'Grate condition near the slip location', 'assurance-demo-whs', now() - interval '9 days');

-- ── Scenario 3: other states ─────────────────────────────────────────────

INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, template_version_id, inspection_type, title, status, inspector_user_id, scheduled_at, started_at, completed_at, location_id, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000402', 'assurance-demo-org', 'INS-DEMO-002', 'a55de000-0000-4000-8000-000000000313', 'FACILITY',
   'Quarterly playground safety check — Riverside Park', 'PLANNED', 'assurance-demo-inspector', now() + interval '3 days', NULL, NULL,
   'a55de000-0000-4000-8000-000000000202', 'assurance-demo-coordinator', now() - interval '2 days', now() - interval '2 days'),
  ('a55de000-0000-4000-8000-000000000403', 'assurance-demo-org', 'INS-DEMO-003', NULL, 'SITE',
   'Ad hoc lighting check — Civic Centre car park', 'IN_PROGRESS', 'assurance-demo-inspector', NULL, now() - interval '2 hours', NULL,
   'a55de000-0000-4000-8000-000000000203', 'assurance-demo-inspector', now() - interval '2 hours', now() - interval '1 hour');

INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type, outcome, notes, responded_by, responded_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000403', 'adhoc-exit-signage-demo01', 'Exit signage illuminated', 'PASS_FAIL', 'PASS', NULL, 'assurance-demo-inspector', now() - interval '100 minutes'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000403', 'adhoc-lamp-4-demo01', 'Car park lamp 4 operating', 'PASS_FAIL', 'OBSERVATION', 'Lamp 4 flickers intermittently; still gives light. Likely failing driver.', 'assurance-demo-inspector', now() - interval '90 minutes');

INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id, responsible_user_id, identified_at, location_id, created_by, created_at, updated_at)
VALUES ('a55de000-0000-4000-8000-000000000703', 'assurance-demo-org', 'FND-DEMO-003', 'OBSERVATION', 'Car park lamp 4 flickering',
        'Lamp 4 in the Civic Centre car park flickers intermittently (synthetic). Not yet dark, but likely to fail.', 'OPEN',
        'a55de000-0000-4000-8000-000000000231', NULL, now() - interval '85 minutes', 'a55de000-0000-4000-8000-000000000203',
        'assurance-demo-inspector', now() - interval '85 minutes', now() - interval '85 minutes');
INSERT INTO assurance_inspection_findings (organisation_id, inspection_id, finding_id, item_key, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000403', 'a55de000-0000-4000-8000-000000000703', 'adhoc-lamp-4-demo01', 'assurance-demo-inspector', now() - interval '85 minutes');
INSERT INTO assurance_timeframes (id, organisation_id, finding_id, timeframe_type, original_due_at, current_due_at, status, created_by, created_at)
VALUES ('a55de000-0000-4000-8000-000000000c05', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000703', 'CLOSURE', now() + interval '14 days', now() + interval '14 days', 'ACTIVE', 'assurance-demo-inspector', now() - interval '85 minutes');

-- ── Scenario 4: Audit -> Finding -> Action -> Evidence -> Verification (A0.1E-1) ─
-- AUD-DEMO-001 is a completed internal audit against a synthetic procedure.
-- One criterion was rated NON_COMPLIANT and the auditor chose to raise
-- FND-DEMO-004, whose corrective action has been independently verified and
-- is ready for explicit closure. Another PARTIAL criterion deliberately has
-- no finding (the auditor judged the recommendation sufficient).

INSERT INTO assurance_audit_templates (id, organisation_id, template_reference, name, audit_type, description, created_by, created_at, updated_at)
VALUES ('a55de000-0000-4000-8000-000000000321', 'assurance-demo-org', 'ATP-DEMO-001', 'Waste Operations Compliance Audit', 'INTERNAL',
        'Annual internal audit of kerbside waste operations against the (synthetic) procedure.', 'assurance-demo-coordinator',
        now() - interval '45 days', now() - interval '45 days');

INSERT INTO assurance_audit_template_versions (id, organisation_id, template_id, version_number, title, standard_reference, instructions, criteria, effective_from, created_by, created_at)
VALUES ('a55de000-0000-4000-8000-000000000331', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000321', 1,
        'Waste Operations Compliance Audit', 'Synthetic Waste Operations Procedure v1',
        'Sample at least 20 records per criterion. Note the records sighted.',
        '[{"key":"01-route-sheets","label":"Collection route sheets are completed and filed for every shift","responseType":"COMPLIANCE_RATING","guidance":"Procedure s.3.1","required":true,"options":[]},
          {"key":"02-contamination-reports","label":"Bin contamination is reported to customers within 5 business days","responseType":"COMPLIANCE_RATING","guidance":"Procedure s.4.2","required":true,"options":[]},
          {"key":"03-pre-start-checks","label":"Vehicle pre-start checks are recorded before every shift","responseType":"COMPLIANCE_RATING","guidance":"Procedure s.5.1 — sample pre-start books","required":true,"options":[]},
          {"key":"04-hazardous-waste","label":"Hazardous waste found in kerbside bins is handled by a licensed contractor","responseType":"COMPLIANCE_RATING","guidance":"Procedure s.6.4","required":true,"options":[]},
          {"key":"05-driver-induction","label":"New drivers complete the route induction before driving solo","responseType":"COMPLIANCE_RATING","guidance":"Procedure s.2.3","required":false,"options":[]}]'::jsonb,
        now() - interval '45 days', 'assurance-demo-coordinator', now() - interval '45 days');

INSERT INTO assurance_audits (id, organisation_id, audit_reference, template_version_id, audit_type, title, scope, standard_reference, status, auditor_user_id,
                              scheduled_at, started_at, completed_at, location_id, summary, recommendations, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000411', 'assurance-demo-org', 'AUD-DEMO-001', 'a55de000-0000-4000-8000-000000000331', 'INTERNAL',
   'Internal Waste Operations Compliance Audit',
   'Kerbside waste collection operations run from the Northern Works Depot, July–September records (synthetic). Excludes commercial collections.',
   'Synthetic Waste Operations Procedure v1', 'COMPLETED', 'assurance-demo-whs',
   now() - interval '10 days', now() - interval '9 days', now() - interval '8 days',
   'a55de000-0000-4000-8000-000000000201',
   'Largely compliant. Pre-start checks were missing for 6 of 20 sampled shifts; contamination reporting is sometimes late.',
   'Consider a weekly supervisor spot-check of contamination notices. Move pre-start checks to a digital form with sign-off.',
   'assurance-demo-coordinator', now() - interval '20 days', now() - interval '8 days'),
  ('a55de000-0000-4000-8000-000000000412', 'assurance-demo-org', 'AUD-DEMO-002', NULL, 'CONTRACTOR',
   'Contractor WHS compliance audit — Demo Civil Contractors',
   'Site safety documentation for the wash bay coating works (synthetic).',
   'Synthetic Contractor WHS Requirements v2', 'PLANNED', 'assurance-demo-whs',
   now() + interval '10 days', NULL, NULL,
   'a55de000-0000-4000-8000-000000000201', NULL, NULL,
   'assurance-demo-coordinator', now() - interval '1 day', now() - interval '1 day');
UPDATE assurance_audits SET external_organisation_id = 'a55de000-0000-4000-8000-000000000221'
WHERE organisation_id = 'assurance-demo-org' AND id = 'a55de000-0000-4000-8000-000000000412';

INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type, outcome, notes, responded_by, responded_at) VALUES
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', '01-route-sheets', 'Collection route sheets are completed and filed for every shift', 'COMPLIANCE_RATING', 'COMPLIANT', '20 of 20 sampled route sheets complete.', 'assurance-demo-whs', now() - interval '9 days' + interval '1 hour'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', '02-contamination-reports', 'Bin contamination is reported to customers within 5 business days', 'COMPLIANCE_RATING', 'PARTIAL', '16 of 20 notices sent within 5 days; 4 sent in 6–8 days during a staff shortage.', 'assurance-demo-whs', now() - interval '9 days' + interval '2 hours'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', '03-pre-start-checks', 'Vehicle pre-start checks are recorded before every shift', 'COMPLIANCE_RATING', 'NON_COMPLIANT', 'No pre-start record for 6 of 20 sampled shifts (trucks WC-04 and WC-07).', 'assurance-demo-whs', now() - interval '9 days' + interval '3 hours'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', '04-hazardous-waste', 'Hazardous waste found in kerbside bins is handled by a licensed contractor', 'COMPLIANCE_RATING', 'NOT_APPLICABLE', 'No hazardous waste events in the audit period.', 'assurance-demo-whs', now() - interval '9 days' + interval '4 hours'),
  ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', '05-driver-induction', 'New drivers complete the route induction before driving solo', 'COMPLIANCE_RATING', 'OBSERVATION', 'Inductions complete, but sign-off sheets are kept in two different places.', 'assurance-demo-whs', now() - interval '9 days' + interval '5 hours');

INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, status, risk_level_id, responsible_user_id, identified_at, location_id, created_by, created_at, updated_at)
VALUES ('a55de000-0000-4000-8000-000000000704', 'assurance-demo-org', 'FND-DEMO-004', 'NON_CONFORMANCE', 'Vehicle pre-start checks not recorded for every shift',
        'AUD-DEMO-001 criterion 3 (Procedure s.5.1): no pre-start record for 6 of 20 sampled shifts on trucks WC-04 and WC-07 (synthetic).',
        'AWAITING_VERIFICATION', 'a55de000-0000-4000-8000-000000000233', 'assurance-demo-supervisor', now() - interval '9 days' + interval '3 hours',
        'a55de000-0000-4000-8000-000000000201', 'assurance-demo-whs', now() - interval '9 days' + interval '3 hours', now() - interval '2 days');
INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, criterion_key, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000411', 'a55de000-0000-4000-8000-000000000704', '03-pre-start-checks', 'assurance-demo-whs', now() - interval '9 days' + interval '3 hours');

INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, description, priority, status, owner_user_id, evidence_required, verification_required, work_completed_at, work_completed_by, created_by, created_at, updated_at)
VALUES ('a55de000-0000-4000-8000-000000000804', 'assurance-demo-org', 'ACT-DEMO-004', 'CORRECTIVE', 'Move vehicle pre-start checks to a digital form with supervisor sign-off',
        'Replace paper pre-start books with the (synthetic) fleet app form; supervisor reviews completion daily.', 'HIGH', 'AWAITING_VERIFICATION',
        'assurance-demo-supervisor', true, true, now() - interval '3 days', 'assurance-demo-supervisor',
        'assurance-demo-whs', now() - interval '8 days', now() - interval '2 days');
INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000804', 'a55de000-0000-4000-8000-000000000704', 'assurance-demo-whs', now() - interval '8 days');
INSERT INTO assurance_timeframes (id, organisation_id, action_id, timeframe_type, original_due_at, current_due_at, status, created_by, created_at)
VALUES ('a55de000-0000-4000-8000-000000000c06', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000804', 'ACTION', now() + interval '6 days', now() + interval '6 days', 'ACTIVE', 'assurance-demo-whs', now() - interval '8 days');

INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, location_id, metadata, created_by, created_at, updated_at) VALUES
  ('a55de000-0000-4000-8000-000000000906', 'assurance-demo-org', 'EVD-DEMO-006', 'SYSTEM_RECORD', 'Fleet app pre-start completion report (14 days)',
   '100% of shifts have a completed digital pre-start with supervisor sign-off (synthetic).', 'assurance-demo-supervisor', now() - interval '3 days',
   'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture","held_at":"Fleet app report DEMO-FA-0931 (synthetic)"}', 'assurance-demo-supervisor', now() - interval '3 days', now() - interval '3 days'),
  ('a55de000-0000-4000-8000-000000000907', 'assurance-demo-org', 'EVD-DEMO-007', 'DOCUMENT', 'Audit sample: pre-start books WC-04 and WC-07',
   'Scans of the sampled pages showing the missing entries (synthetic).', 'assurance-demo-whs', now() - interval '9 days' + interval '3 hours',
   'a55de000-0000-4000-8000-000000000201', '{"source":"assurance-demo-fixture","held_at":"Audit working papers DEMO-AWP-001 (synthetic)"}', 'assurance-demo-whs', now() - interval '9 days', now() - interval '9 days');
INSERT INTO assurance_evidence_audits (organisation_id, evidence_id, audit_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000907', 'a55de000-0000-4000-8000-000000000411', 'Audit sample', 'assurance-demo-whs', now() - interval '9 days');
INSERT INTO assurance_evidence_findings (organisation_id, evidence_id, finding_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000907', 'a55de000-0000-4000-8000-000000000704', 'Shows the gap', 'assurance-demo-whs', now() - interval '9 days');
INSERT INTO assurance_evidence_actions (organisation_id, evidence_id, action_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000906', 'a55de000-0000-4000-8000-000000000804', 'Shows the fix in operation', 'assurance-demo-supervisor', now() - interval '3 days');

-- Independent verification by the coordinator (not the owner / work completer).
INSERT INTO assurance_verifications (id, organisation_id, action_id, attempt_number, result, verified_by, verified_at, notes, created_at)
VALUES ('a55de000-0000-4000-8000-000000000953', 'assurance-demo-org', 'a55de000-0000-4000-8000-000000000804', 1, 'ACCEPTED', 'assurance-demo-coordinator',
        now() - interval '2 days', 'Spot-checked 10 shifts in the fleet app: all pre-starts present and signed off.', now() - interval '2 days');
INSERT INTO assurance_evidence_verifications (organisation_id, evidence_id, verification_id, purpose, created_by, created_at)
VALUES ('assurance-demo-org', 'a55de000-0000-4000-8000-000000000906', 'a55de000-0000-4000-8000-000000000953', 'Verification evidence', 'assurance-demo-coordinator', now() - interval '2 days');

INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at) VALUES
  ('assurance-demo-audit-101', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_audit.created', 'assurance_audit', 'a55de000-0000-4000-8000-000000000411', NULL, '{"fixture":"assurance-demo","status":"PLANNED"}', now() - interval '20 days'),
  ('assurance-demo-audit-102', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_audit.started', 'assurance_audit', 'a55de000-0000-4000-8000-000000000411', '{"status":"PLANNED"}', '{"fixture":"assurance-demo","status":"IN_PROGRESS"}', now() - interval '9 days'),
  ('assurance-demo-audit-103', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_finding.created', 'assurance_finding', 'a55de000-0000-4000-8000-000000000704', NULL, '{"fixture":"assurance-demo","status":"OPEN","audit_id":"a55de000-0000-4000-8000-000000000411","audit_criterion_key":"03-pre-start-checks"}', now() - interval '9 days' + interval '3 hours'),
  ('assurance-demo-audit-104', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_audit.completed', 'assurance_audit', 'a55de000-0000-4000-8000-000000000411', '{"status":"IN_PROGRESS"}', '{"fixture":"assurance-demo","status":"COMPLETED"}', now() - interval '8 days'),
  ('assurance-demo-audit-105', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_action.created', 'assurance_action', 'a55de000-0000-4000-8000-000000000804', NULL, '{"fixture":"assurance-demo","status":"OPEN"}', now() - interval '8 days'),
  ('assurance-demo-audit-106', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_action.work_completed', 'assurance_action', 'a55de000-0000-4000-8000-000000000804', '{"status":"IN_PROGRESS"}', '{"fixture":"assurance-demo","status":"AWAITING_VERIFICATION"}', now() - interval '3 days'),
  ('assurance-demo-audit-107', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_action.verification_recorded', 'assurance_action', 'a55de000-0000-4000-8000-000000000804', NULL, '{"fixture":"assurance-demo","result":"ACCEPTED","attempt_number":1}', now() - interval '2 days'),
  ('assurance-demo-audit-108', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_audit.created', 'assurance_audit', 'a55de000-0000-4000-8000-000000000412', NULL, '{"fixture":"assurance-demo","status":"PLANNED"}', now() - interval '1 day'),
  ('assurance-demo-audit-109', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_audit_template.created', 'assurance_audit_template', 'a55de000-0000-4000-8000-000000000321', NULL, '{"fixture":"assurance-demo","version_number":1}', now() - interval '45 days');

-- ── History (audit_logs) so the detail pages show a timeline ─────────────
-- after_state carries identifiers/statuses only, tagged fixture=assurance-demo.

INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, created_at) VALUES
  ('assurance-demo-audit-001', 'assurance-demo-org', 'assurance-demo-inspector', 'assurance_inspection.created', 'assurance_inspection', 'a55de000-0000-4000-8000-000000000401', NULL, '{"fixture":"assurance-demo","status":"PLANNED"}', now() - interval '14 days'),
  ('assurance-demo-audit-002', 'assurance-demo-org', 'assurance-demo-inspector', 'assurance_inspection.started', 'assurance_inspection', 'a55de000-0000-4000-8000-000000000401', '{"status":"PLANNED"}', '{"fixture":"assurance-demo","status":"IN_PROGRESS"}', now() - interval '12 days'),
  ('assurance-demo-audit-003', 'assurance-demo-org', 'assurance-demo-inspector', 'assurance_inspection.completed', 'assurance_inspection', 'a55de000-0000-4000-8000-000000000401', '{"status":"IN_PROGRESS"}', '{"fixture":"assurance-demo","status":"COMPLETED"}', now() - interval '12 days' + interval '50 minutes'),
  ('assurance-demo-audit-004', 'assurance-demo-org', 'assurance-demo-inspector', 'assurance_finding.created', 'assurance_finding', 'a55de000-0000-4000-8000-000000000701', NULL, '{"fixture":"assurance-demo","status":"OPEN","inspection_id":"a55de000-0000-4000-8000-000000000401","inspection_item_key":"02-drain-grates-secured"}', now() - interval '12 days' + interval '16 minutes'),
  ('assurance-demo-audit-005', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_action.created', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', NULL, '{"fixture":"assurance-demo","status":"OPEN"}', now() - interval '11 days'),
  ('assurance-demo-audit-006', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_action.task_linked', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', NULL, '{"fixture":"assurance-demo"}', now() - interval '10 days'),
  ('assurance-demo-audit-007', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_action.work_completed', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', '{"status":"IN_PROGRESS"}', '{"fixture":"assurance-demo","status":"AWAITING_VERIFICATION"}', now() - interval '6 days'),
  ('assurance-demo-audit-008', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_action.verification_recorded', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', NULL, '{"fixture":"assurance-demo","result":"REJECTED","attempt_number":1}', now() - interval '5 days'),
  ('assurance-demo-audit-009', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_evidence.unlinked', 'assurance_evidence', 'a55de000-0000-4000-8000-000000000903', NULL, '{"fixture":"assurance-demo","target":"action"}', now() - interval '5 days'),
  ('assurance-demo-audit-010', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_action.verification_recorded', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', NULL, '{"fixture":"assurance-demo","result":"ACCEPTED","attempt_number":2}', now() - interval '4 days' + interval '3 hours'),
  ('assurance-demo-audit-011', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_action.closed', 'assurance_action', 'a55de000-0000-4000-8000-000000000801', '{"status":"AWAITING_VERIFICATION"}', '{"fixture":"assurance-demo","status":"CLOSED"}', now() - interval '3 days'),
  ('assurance-demo-audit-012', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_incident.created', 'assurance_incident', 'a55de000-0000-4000-8000-000000000501', NULL, '{"fixture":"assurance-demo","status":"REPORTED"}', now() - interval '14 days' + interval '10 hours'),
  ('assurance-demo-audit-013', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_incident.status_changed', 'assurance_incident', 'a55de000-0000-4000-8000-000000000501', '{"status":"REPORTED"}', '{"fixture":"assurance-demo","status":"UNDER_REVIEW"}', now() - interval '14 days' + interval '11 hours'),
  ('assurance-demo-audit-014', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_incident.status_changed', 'assurance_incident', 'a55de000-0000-4000-8000-000000000501', '{"status":"UNDER_REVIEW"}', '{"fixture":"assurance-demo","status":"INVESTIGATION_REQUIRED"}', now() - interval '13 days'),
  ('assurance-demo-audit-015', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_incident.status_changed', 'assurance_incident', 'a55de000-0000-4000-8000-000000000501', '{"status":"INVESTIGATION_REQUIRED"}', '{"fixture":"assurance-demo","status":"UNDER_INVESTIGATION"}', now() - interval '13 days'),
  ('assurance-demo-audit-016', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_investigation.created', 'assurance_investigation', 'a55de000-0000-4000-8000-000000000601', NULL, '{"fixture":"assurance-demo","status":"OPEN"}', now() - interval '13 days'),
  ('assurance-demo-audit-017', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_investigation.completed', 'assurance_investigation', 'a55de000-0000-4000-8000-000000000602', '{"status":"AWAITING_REVIEW"}', '{"fixture":"assurance-demo","status":"COMPLETED"}', now() - interval '2 days'),
  ('assurance-demo-audit-018', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_finding.created', 'assurance_finding', 'a55de000-0000-4000-8000-000000000702', NULL, '{"fixture":"assurance-demo","status":"OPEN"}', now() - interval '9 days'),
  ('assurance-demo-audit-019', 'assurance-demo-org', 'assurance-demo-whs', 'assurance_action.created', 'assurance_action', 'a55de000-0000-4000-8000-000000000802', NULL, '{"fixture":"assurance-demo","status":"OPEN"}', now() - interval '8 days'),
  ('assurance-demo-audit-020', 'assurance-demo-org', 'assurance-demo-supervisor', 'assurance_action.work_completed', 'assurance_action', 'a55de000-0000-4000-8000-000000000802', '{"status":"IN_PROGRESS"}', '{"fixture":"assurance-demo","status":"AWAITING_VERIFICATION"}', now() - interval '1 day'),
  ('assurance-demo-audit-021', 'assurance-demo-org', 'assurance-demo-inspector', 'assurance_finding.created', 'assurance_finding', 'a55de000-0000-4000-8000-000000000703', NULL, '{"fixture":"assurance-demo","status":"OPEN","inspection_id":"a55de000-0000-4000-8000-000000000403","inspection_item_key":"adhoc-lamp-4-demo01"}', now() - interval '85 minutes'),
  ('assurance-demo-audit-022', 'assurance-demo-org', 'assurance-demo-coordinator', 'assurance_inspection_template.version_published', 'assurance_inspection_template', 'a55de000-0000-4000-8000-000000000301', NULL, '{"fixture":"assurance-demo","version_number":2}', now() - interval '5 days');

COMMIT;

-- Quick check (optional):
--   SELECT incident_reference, status, restricted FROM assurance_incidents WHERE organisation_id = 'assurance-demo-org' ORDER BY 1;
