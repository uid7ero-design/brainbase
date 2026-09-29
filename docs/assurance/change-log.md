# Assurance — Change log

User-facing changes only: navigation, workflow, statuses, permissions,
terminology, visible fields, and how a task is done. Internal changes that do
not affect users are not listed.

Newest first.

---

## First release foundation (not yet released to Production users)

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
- Existing evidence can be linked onward from its own page only to
  incidents and findings.
- No recurring inspections or audits.
