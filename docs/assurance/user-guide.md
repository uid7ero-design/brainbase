# Assurance — User guide

This guide explains the whole Assurance module in plain language. For
step-by-step procedures, use the [work instructions](work-instructions/).

> **Who can do what.** Anyone with Assurance access can view records they
> are allowed to see. Recording, verifying, closing and cancelling need
> **manager** access or higher. Managing templates and seeing every restricted
> record need **admin** access. If a button described here is missing, you
> probably do not have the access it needs (see the [admin guide](admin-guide.md)).

---

## Finding your way around

- Open **Assurance** from the BrainBase top navigation.
- The left navigation lists the nine sections. On a phone it becomes a
  scrollable strip across the top of the page.
- Every record has a reference, such as `INC-…` (incident), `INV-…`
  (investigation), `INS-…` (inspection), `AUD-…` (audit), `FND-…` (finding),
  `ACT-…` (action) and `EVD-…` (evidence). Template references start `TPL-…`
  (inspection) or `ATP-…` (audit).
- Detail pages start with breadcrumbs and a header showing the reference,
  status and (if relevant) a **Restricted** tag.
- The **Next step** section appears only when there is something you are
  allowed to do next.
- Every detail page ends with **History**: who did what, and when.
- Registers have filters above the table. Choose values, then select
  **Apply**. **Reset** clears them.

If a record "can't be found", it either does not exist or you are not allowed
to see it. Assurance deliberately does not say which.

---

## Dashboard — "What needs attention?"

The dashboard shows only records you are allowed to see.

### The counts

Each count's label is a link to the filtered register behind it. A count is
coloured only when it is not zero and the colour carries a meaning.

| Count | Means |
|---|---|
| **Overdue actions** | Open actions whose due date has passed. The line underneath shows how many actions are open in total. |
| **Awaiting verification** | Actions waiting for an independent verifier. The line underneath shows actions still awaiting evidence, if any. |
| **Serious open incidents** | Open incidents at your organisation's two highest active risk levels. The line underneath shows all open incidents. |
| **Active investigations** | Investigations that are not completed or cancelled. The line underneath shows how many are past their target date. |
| **Inspections due (7 days)** | Planned inspections scheduled within the next 7 days, including any whose scheduled time has already passed. The line underneath shows inspections in progress. |
| **Audits due (14 days)** | Planned audits scheduled within the next 14 days, including any already past. The line underneath shows audits in progress and audits completed in the last 30 days. |
| **Open findings** | Findings that are not closed or cancelled. The line underneath shows how many are overdue. |
| **Open audit findings** | Open findings raised from, or linked to, an audit. |

### The work lists

| Panel | Shows |
|---|---|
| **Needs attention** | Open actions and findings that are overdue or due in the next three days. |
| **Awaiting verification** | Actions in the verification queue, with when the work was completed. **Open queue →** goes to Verification. |
| **Serious incidents still open** | Open incidents at the two highest risk levels, with the risk level shown. |
| **Active investigations** | In-progress investigations and their target dates. |
| **Inspections & audits due or in progress** | Inspections due in 7 days, audits due in 14 days, and anything in progress. An in-progress inspection or audit whose scheduled time has passed is **not** marked overdue. |
| **Recent incidents** | The latest reported incidents. **All incidents →** opens the register. |

Two charts follow: **Open findings by type**, and **Incidents reported — last
8 weeks**.

**How to use it:** start with **Overdue actions** and **Needs attention**,
then clear the **Awaiting verification** queue, then check serious incidents
and upcoming inspections and audits. Managers also see **Report incident** and
**Plan inspection** buttons at the top.

---

## Incidents

### Reporting

Select **Report incident**, either on the Incidents register or the
Dashboard. Required fields:

- **Short title**
- **Category**: Injury / safety, Environmental, Property / equipment,
  Operational / service, Security, Near miss or Other.
- **When did it happen?** Defaults to now; it cannot be in the future.
- **What happened?**

Optional fields: **Immediate response taken**, **Risk level**, **Owner**,
**Location**, **Asset**, **External organisation involved** and
**Restricted incident**.

A new incident starts as **Reported**. You are recorded as the reporter.

### Restricted incidents

Tick **Restricted incident** when the matter is sensitive. A restricted
incident is visible only to its owner, its reporter, the person who created
it, and organisation admins.

Restriction flows **downwards**. Findings linked to a restricted incident, and
their actions and evidence, are hidden from everyone else as well. To other
people, a hidden record behaves as if it does not exist: it is missing from
lists, counts and search.

If an unrestricted record is linked to a restricted one, the restricted
record appears as a **Restricted** placeholder with no details.

### Status and lifecycle

Move an incident on with the buttons in **Next step**:

| From | Buttons available |
|---|---|
| Reported | **Start triage** (→ Under review), **Cancel incident** |
| Under review | **Needs investigation**, **Action required**, **Awaiting verification**, **Close incident**, **Cancel incident** |
| Investigation required | **Investigation underway**, **Start triage** (back to Under review), **Cancel incident** |
| Under investigation | **Action required**, **Awaiting verification**, **Start triage** (back to Under review) |
| Action required | **Awaiting verification**, **Start triage** (back to Under review) |
| Awaiting verification | **Close incident**, **Action required** |
| Closed / Cancelled | No further steps |

These statuses are **manual**. Starting an investigation, raising findings or
closing actions does **not** change an incident's status. Keep it current
yourself.

**Closing** needs a **Closure summary**. It is refused while any linked
finding is still open, or any linked investigation is still active. If that
applies, a warning shows what is blocking closure. Nothing is closed on the
incident's behalf.

### People

The **People** section lists people recorded against the incident (for
example injured person, witness, responder) with their role and notes.

> Current limitation: people cannot yet be added or edited from the
> Assurance screens.

### Findings and investigations

- **Raise finding** in the **Findings** section creates a finding linked to
  this incident. It is available until the incident is closed or cancelled.
- **Start investigation** in the **Investigations** section opens a new
  investigation with this incident already chosen as the primary incident.
- The **Investigations** table shows each linked investigation, its
  relationship (Primary, Related, Triggering or Context) and its status.
- A note appears if some linked findings are hidden from you because they
  belong to restricted records.

---

## Investigations

### Starting

Select **Start investigation**, either on the register or from an incident.
Fill in:

- **Title** and **Scope** (required).
- **Primary incident** — optional; at most one.
- **Related incidents** — optional. Hold Ctrl/Cmd to select several.
- **Lead investigator**, **Risk level** and **Target completion**.
- **Restricted investigation** — if ticked, only you, the lead and
  organisation admins will see it and the findings raised from it.

A new investigation starts as **Open**.

### Linked incidents

- The **Linked incidents** table shows each incident's relationship, status,
  whether it is also part of other investigations ("Also in"), and when it
  was linked.
- **Link another incident** adds an incident with a relationship of Primary,
  Related, Triggering or Context. An investigation can have only one primary
  incident. Links are permanent history.
- Incidents cannot be linked once the investigation is completed or
  cancelled.

### People

The **People** section lists people involved (investigator, lead
investigator, witness, subject, technical adviser, reviewer and so on).

> Current limitation: people cannot yet be added or edited from the
> Assurance screens.

### Status

| From | Buttons available |
|---|---|
| Open | **Move to planning**, **Move to in progress**, **Cancel investigation** |
| Planning | **Move to in progress**, **Cancel investigation** |
| In progress | **Move to awaiting information**, **Move to awaiting review**, **Cancel investigation** |
| Awaiting information | **Move to in progress**, **Cancel investigation** |
| Awaiting review | **Move to in progress**, **Complete with conclusion** |
| Completed / Cancelled | No further steps |

**Complete with conclusion** requires a **Conclusion**. Completing records
the conclusion only. It does **not** close the linked incidents or any
findings.

### Findings

**Raise finding** creates a finding linked to the investigation. It is
available until the investigation is completed or cancelled.

---

## Inspections

### Template-based and ad hoc

Select **Plan inspection**:

- **Title** is required.
- **Template** — choose an active inspection template to use its current
  checklist version, or leave **Ad hoc (no template)**.
- **Inspection type** — required for an ad hoc inspection; otherwise the
  template's type is used.
- Optional: **Scheduled for**, **Inspector**, **Location**, **Asset**,
  **Contractor / external organisation**.

The Inspections register has views: **All**, **Due (7 days)**, **Planned**,
**In progress** and **Completed**. **Templates** opens the template list.

### Historical template versions

A template-based inspection keeps the **exact checklist version** it was
planned with. Its **Checklist** section says which version it uses. If a
newer version has since been published, it says so, and confirms the newer
version does not change this inspection.

### Running the checklist

1. **Start inspection** (status → In progress). Responses can only be
   recorded while an inspection is in progress.
2. For each item, choose an outcome — **Pass**, **Fail**, **Observation** or
   **N/A**. Enter a value if the item asks for one (yes/no, number, date,
   text or a choice). Add notes, then **Save response**.
3. **A Fail needs a note** describing why the item failed.
4. To change a saved response, select **Revise**, then **Update response**.
5. For an ad hoc inspection, use **Add an item** to add each item as you
   check it (Pass / fail, Text or Number). Up to 200 items.

The summary line shows how many items are answered and how many failed.

### Fail and Observation → explicit **Raise finding**

A failed or observed item is **not** a finding by itself. For Fail and
Observation items, a **Raise finding** button appears. It pre-fills:

- a finding type (Defect for a fail, Observation for an observation);
- the item's label as the title;
- your notes as the description.

The finding records exactly which inspection item it came from. Once a
finding has been raised from an item, **that item's response is locked** and
cannot be revised. You can raise further findings from the same item with
**Raise another finding**.

Findings can still be raised from a completed inspection, but not from a
cancelled one.

### Completing and cancelling

- **Complete inspection** (optional **Summary**) is refused until every
  required checklist item has a response. An ad hoc inspection needs at least
  one item. Completing locks the responses. It never creates or closes
  findings.
- **Cancel inspection** (manager access) is a single button with no reason
  field. It works only on a planned or in-progress inspection.

---

## Audits

### Template and ad hoc audits

Select **Plan audit**:

- **Title** and **Scope** are required.
- **Template** — choose an active audit template to use its current criteria
  version, or leave **Ad hoc (no template)**.
- **Standard / reference** — what the audit is measured against. It is
  **required for an ad hoc audit**.
- **Audit type** — required for an ad hoc audit (Internal, Contractor, Site,
  Process, Facility, Policy, Compliance or Other).
- Optional: **Scheduled for**, **Auditor**, **Location**, **Asset**,
  **Contractor / external organisation**.

The Audits register has views: **All**, **Due (14 days)**, **Planned**,
**In progress** and **Completed**. **Templates** opens the template list.

### Version binding

Like inspections, a template-based audit keeps the exact **criteria version**
it was planned with. The **Criteria** section names the version and its
standard.

### Criteria and compliance outcomes

1. **Start audit**.
2. Rate each criterion: **Compliant**, **Partially compliant**,
   **Non-compliant**, **Not applicable** or **Observation**. Hover over a
   rating to see what it means.
3. **Non-compliant** and **Partially compliant** need a note explaining the
   gap against the requirement. Then **Save response**. Use **Revise** to
   change it.
4. For an ad hoc audit, use **Assess another criterion** → **Add criterion**
   (Compliance rating, Text or Number). Up to 200 criteria.

The summary line tallies the ratings.

### Raise finding

For **Non-compliant**, **Partially compliant** and **Observation** ratings,
the auditor is **offered** **Raise finding**. A rating never creates a finding
by itself. The finding form is pre-filled:

- type: Non-conformance, or Observation for an observation;
- title: the criterion label;
- description: your notes.

A warning lists any non-compliant or partial criteria with no finding yet, so
you can decide. Raising a finding locks that criterion's rating.

**Link existing finding** attaches an already-open finding, for a repeat
issue already being managed. Corrective actions stay on that finding.

There is **no direct audit-to-action shortcut**. Corrective work always goes
Finding → Action → Evidence → Verification → Closure.

### Recommendations and completion

**Complete audit** takes an optional **Summary** and **Recommendations**
(advice for improvement). It is refused until every required criterion has a
rating. It does not create or close findings or actions.

**Cancel audit** requires a **Reason**. Evidence on a cancelled audit can no
longer be changed.

---

## Findings

A finding is raised from a source record: an incident, an investigation, an
inspection item, or an audit criterion. Use the **Raise finding** button on
that record. Each finding is raised from one source at a time.

### Source provenance

The finding's **Source** shows where it came from, with a link back. For
inspection items and audit criteria, the exact item or criterion is
recorded. The Findings register can filter by source: **From incidents**,
**From investigations**, **From inspections**, **From audits** or
**No source**.

A finding cannot be raised from a closed, completed or cancelled incident or
investigation, or from a cancelled inspection or audit.

### What a finding records

- **Finding type**: Observation, Hazard, Defect, Non-conformance, Audit
  finding, Service failure, Improvement opportunity or Other.
- **Title** and **Description**.
- **Risk level** — this is the severity measure, set from your
  organisation's risk levels.
- **Responsible person** and **Resolve by**. The resolve-by date cannot be
  in the past.

### Status

| From | Buttons available |
|---|---|
| Open | **Move to under review**, **Move to action required**, **Cancel finding** |
| Under review | **Move to action required**, **Close finding**, **Cancel finding** |
| Action required | **Move to action in progress**, **Move to under review**, **Cancel finding** |
| Action in progress | **Move to awaiting verification**, **Move to action required** |
| Awaiting verification | **Close finding**, **Move to action in progress** |
| Closed / Cancelled | No further steps |

Finding statuses are **manual**. Adding, verifying or closing an action does
not move the finding.

### Linked actions

**Add corrective action** in the **Corrective actions** section creates an
action linked to the finding (see Actions). The table shows each action's
status, evidence and verification.

### Closure

**Close finding** is refused while any linked action is still open (not
closed or cancelled). Closing a finding does not change its source records.

---

## Actions

### Assigned work

Actions are created from a finding with **Add corrective action**. The
**Corrective actions** register has no "new" button. Fields:

- **Action type**: Immediate control, Corrective, Preventative, Remedial,
  Improvement, Follow up, Monitoring or Other.
- **Title**, **What needs to be done**, and **Priority** (Low, Medium, High
  or Critical).
- **Owner** and **Contractor / external organisation**.
- **Due** — cannot be in the past.
- **Evidence required before closure** — ticked by default.
- **Independent verification required before closure** — ticked by default.

The register views are **All**, **Open**, **Overdue**, **Mine** (actions you
own), **Awaiting verification** and **Closed**.

### Work complete ≠ verified ≠ closed

| Step | Button | Result |
|---|---|---|
| Start | **Start work** | Open → In progress |
| Work done | **Mark work complete** | Awaiting evidence, if evidence is required and none is linked; otherwise Awaiting verification, if verification is required; otherwise it stays In progress with the work recorded as complete |
| Evidence linked | **Submit for verification** | Awaiting evidence → Awaiting verification (or In progress, if no verification is required) |
| Verified | **Record verification** (independent person) | See Verification below |
| Closed | **Close action** | Closed. Appears only when every closure condition is met |

The **Before this action can be closed** box lists exactly what is still
missing:

- work not marked complete;
- no evidence linked when evidence is required;
- no accepted verification when verification is required.

**Cancel action** needs a **Reason**. If a verification sends the work back,
use **Mark work complete again** once it has been redone.

### Due dates

The **Due** date and **Overdue** marker come from the action's timeframe. If
a deadline was extended, the overview shows the original and extended dates.

> Current limitation: extensions cannot be requested or approved from the
> Assurance screens.

### Evidence

Add evidence in the action's **Evidence** section (see Evidence). Evidence on
a closed or cancelled action is frozen.

### Organiser tasks

If your organisation also has Organiser, **Link Organiser task** connects a
task (Implementation, Follow up, Evidence collection or Other) to the action.
The **Organiser tasks** section shows each task's current status.

Completing a task **never** completes, verifies or closes the action.

---

## Evidence

### What an evidence record holds

- **Type**: Photo, Video, Document, Email, Statement, Measurement, System
  record or Other.
- **Title**, **Description** and **Captured** date/time.
- **Where the original is held** — for example a records-system reference
  or a shared-drive path.

> **Current limitation: there is no file upload.** Evidence records describe
> the proof and where it is kept; the file itself stays in your records
> system.

### Recording and linking

- On any incident, investigation, inspection, audit, finding or action,
  **Add evidence** records new evidence and links it to that record in one
  step. **Why it is linked here** records the purpose.
- On the **Evidence** register, **Record evidence** creates evidence that is
  not linked yet.
- On an evidence record's own page, **Link to incident** and **Link to
  finding** reuse it on other records.
- Evidence already used on other records cannot be linked to a restricted
  record. Record new evidence for the restricted record instead.

### Unlinking and history

**Remove link** needs a **Reason for removal**. The evidence record itself is
never deleted. The link is kept as history, showing who removed it, when and
why:

- on the record, under "removed links (history)";
- on the evidence page, marked **Removed**.

Evidence can no longer be added or removed once its record is finished:

- a closed or cancelled finding or action;
- a cancelled inspection or audit.

Evidence recorded with a verification is part of that verification and
cannot be removed.

---

## Verification

### Independent verifier

The **Verification** page lists every action **awaiting verification** and
**Recent verification decisions**. The **You can verify** column shows
**Yes** or **Not independent**.

You **cannot** verify an action if you own it, or if you have ever marked its
work complete. The action page says so if this applies to you.

### Recording a result

On the action, select **Record verification**:

- **Result**: Accepted, Rejected, Partially accepted, More evidence required
  or N/A.
- **Notes** — required unless the result is Accepted.
- **Evidence relied on** — optional; choose from the action's linked
  evidence.

### Effect on the action

| Result | Action status afterwards |
|---|---|
| Accepted / N/A | Stays **Awaiting verification**, and the verification requirement is now met, so the action can be closed |
| Rejected / Partially accepted | Back to **In progress** — the work needs redoing |
| More evidence required | Back to **Awaiting evidence** |

Verification history is permanent. Each check is a numbered attempt. Once an
accepted (or N/A) verification exists, no further attempts can be recorded.

**Verification never closes an action.** Someone with close rights must then
select **Close action**.
