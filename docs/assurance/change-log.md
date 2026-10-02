# Assurance — Change log

User-facing changes only: navigation, workflow, statuses, permissions,
terminology, visible fields, and how a task is done. Internal changes that do
not affect users are not listed.

Newest first.

---

## Deadlines, extensions and escalations

- **Deadlines** is added to the Assurance navigation, after **Actions**: a
  register of the due dates set on findings (closure deadlines) and actions
  (action deadlines), with views Open, Overdue, Due soon, Awaiting decision,
  Extended, Escalated and All.
- Findings and actions gain a **Deadline** section showing the effective and
  original due dates, the extension history and escalations. A record created
  without a due date shows **No due date**.
- **Request extension** (managers and admins), **Approve** / **Reject**
  (organisation admins, never their own request) and **Withdraw request**.
  The original due date never changes; every request is kept in the history.
  (Previously extensions could not be requested in the UI.)
- **Escalate** (managers and admins) at Level 1–5, then **Acknowledge**,
  **Resolve** or **Cancel escalation**. Escalation is manual and does not
  close work, meet a deadline or change a due date.
- Overdue and due soon use the same rule as the dashboard. Deadline dates are
  shown in Australia/Adelaide time.
- New [work instruction 13: Manage deadlines, extensions and escalations](work-instructions/13-manage-deadlines.md).

## Settings → Reference data

- **Settings → Reference data** manages your organisation's shared BrainBase
  **Locations**, **Assets** and **External organisations** — the records
  offered on incidents, inspections, audits, findings, actions and evidence.
  They belong to your organisation, not to Assurance; Assurance keeps no
  copies.
- Each list shows name, reference, type (or roles), status and how many
  Assurance records use it, with search and an **Active / Inactive / All**
  filter. It becomes cards on a phone.
- Admins can **create**, **edit**, **deactivate** and **reactivate** records.
  The reference cannot be changed after creation. There is no delete.
- External organisations can carry several **roles** (Contractor, Supplier,
  Customer and more), not only "contractor".
- Deactivated records are no longer offered for new records, and are refused
  if submitted directly. Existing records keep and show them. Register
  filters (for example **Any location**) still list them, marked
  "(inactive)".
- Every change is recorded in the audit history and listed under **Change
  history**.
- New [work instruction 12: Manage reference data](work-instructions/12-manage-reference-data.md).

## Settings → Risk levels

- **Settings** is added to the Assurance navigation, after **Verification**.
  Everyone with Assurance access can view it; only organisation admins can
  change settings.
- **Settings → Risk levels** lists every risk level (active and inactive)
  from the highest rank to the lowest, with its code, rank, status,
  "requires verification" setting and classification (**Serious**,
  **Standard** or **Inactive**).
- Admins can **create** a level, **edit** its name, description, rank and
  "requires verification" setting, and **deactivate** or **reactivate** it.
  The code cannot be changed after creation. There is no delete.
- Deactivated levels are no longer offered for new records; existing
  records keep and show them.
- If a change would alter which levels are serious on the dashboard, the
  screen shows the serious levels before and after and asks for
  confirmation.
- Every change is recorded in the audit history and listed under **Change
  history**. Risk levels no longer need database maintenance.
- New [work instruction 11: Manage risk levels](work-instructions/11-manage-risk-levels.md).

## First release foundation (not yet released to Production users)

### Risk levels — Brainbase scale

- Brainbase's initial risk scale is **Low / Medium / High / Extreme**. It
  appears in the **Risk level** choices once the reviewed bootstrap script has
  been applied.
- **High** and **Extreme** count as **serious** on the dashboard.
- The "requires verification" setting on High and Extreme is descriptive
  only; verification rules are unchanged.
- At this point there was no screen for maintaining risk levels; see
  **Settings → Risk levels** above.

### In-app Help

- **Help & work instructions** is added at the bottom of the Assurance
  navigation. It shows the overview, user guide, admin guide, the ten work
  instructions and this change log inside BrainBase, with search.
- Every Assurance page has a **Help** link to the most relevant guide section
  or work instruction.
- Help is available to everyone with Assurance access. It is read-only and
  shows the same text as the published documentation.

### Reconciliation — shared record workflows

- **Evidence:** an evidence record's page now has **Link to a record**, which
  reuses it on any supported record type — Incident, Investigation,
  Inspection, Audit, Finding or Action — from one selector. This replaces the
  separate **Link to incident** and **Link to finding** buttons.
- **Findings:** **Link existing finding** is now available on incidents,
  investigations and inspections as well as audits, for repeat issues. A
  finding visible to everyone cannot be linked to a restricted incident or
  investigation.
- **Inspections:** **Cancel inspection** now requires a **Reason**, entered in a
  confirmation form, as audits and actions already do.
- **History:** a recorded reason (for example for a cancellation) is shown
  under the history entry.
- **Templates:** **Deactivate** and **Reactivate** now ask for confirmation.
- **Wording:** the Findings register description now includes audits.
- No change to statuses, closure or verification rules.

### Visual update — BrainBase redesign

- Assurance now uses the same look as the rest of BrainBase: shared
  headers, panels, tables, filters, buttons and status badges. It works in
  light and dark themes and on phones, where the section navigation becomes
  a strip across the top.
- The dashboard's "What needs attention?" counts are now one compact strip,
  and each label links to its filtered register.
- Register sub-views (for example Actions → Overdue) are shown as tabs.
- Required form fields show a visible **Required** marker.
- No change to workflow, statuses, permissions or terminology.

### Foundation

**Navigation**

- **Assurance** is added to the BrainBase top navigation for organisations
  with the Assurance capability.
- The module has nine sections: Dashboard, Incidents, Investigations,
  Inspections, Audits, Findings, Actions, Evidence and Verification.
- Inspection and audit **Templates** are reached from their sections.

**Workflow**

- Incidents: report, triage through explicit status steps, and close with a
  closure summary. Optionally mark an incident **Restricted**.
- Investigations: cover one or more incidents (one primary; related,
  triggering or context links), move through status steps, and **Complete
  with conclusion**.
- Inspections: plan from a checklist template or ad hoc, start, record item
  responses (Pass / Fail / Observation / N/A), then complete or cancel.
- Audits: plan from a criteria template or ad hoc against a standard or
  reference, start, rate each criterion, then complete with summary and
  recommendations, or cancel with a reason.
- Findings: raised explicitly from an incident, investigation, inspection
  item or audit criterion. Source provenance is kept. Raising a finding from
  an item or criterion locks that response.
- Actions: created from a finding with owner, priority, due date and
  evidence/verification requirements. The steps are Start work → Mark work
  complete → (Submit for verification) → Record verification → Close action.
- Evidence: record metadata and where the original is held; link to
  records; remove links with a reason, kept as history.
- Verification: an independent verifier records Accepted, Rejected,
  Partially accepted, More evidence required or N/A. Verification never
  closes an action.
- Organiser: tasks can be linked to actions for day-to-day tracking.
  Completing a task never completes, verifies or closes the action.

**Rules visible to users**

- Closure is always explicit. Nothing closes another record automatically.
- An incident cannot close while linked findings or investigations are open.
- A finding cannot close while linked actions are open.
- An action cannot close until work is complete, and any required evidence
  and accepted verification are in place.
- Template versions are immutable. Inspections and audits keep the version
  they were planned with.
- No direct audit-to-action shortcut.

**Permissions**

- Viewer: read only.
- Manager: record, progress, verify, close and cancel.
- Admin: templates, and visibility of all restricted records.

**Known limitations at this release**

- No evidence file upload.
- People on incidents and investigations cannot be edited in the UI.
- Due-date extensions cannot be requested in the UI.
- No recurring inspections or audits.
