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
- The left navigation lists the twelve work sections, then **Settings**. On a
  phone it becomes a scrollable strip across the top of the page.
- **Settings** shows your organisation's Assurance configuration: its **Risk
  levels**, and its **Reference data** (the shared locations, assets and
  external organisations offered on Assurance records). Anyone can view it;
  only organisation admins can change it.
- **Locations**, **assets** and **external organisations** are shared
  BrainBase records, not Assurance copies. Only **active** ones are offered
  when you record something new. If one is later deactivated, records that
  already use it keep it and still show it; register filters list it marked
  "(inactive)".
- **Help & work instructions**, at the bottom of the navigation, opens this
  guide, the admin guide and the step-by-step work instructions, with
  search. Every page also has a **Help** link (top right) that opens the most
  relevant section or work instruction for that screen.
- Every record has a reference, such as `INC-…` (incident), `INV-…`
  (investigation), `INS-…` (inspection), `AUD-…` (audit), `FND-…` (finding),
  `ACT-…` (action) and `EVD-…` (evidence). Template references start `TPL-…`
  (inspection) or `ATP-…` (audit).
- Detail pages start with breadcrumbs and a header showing the reference,
  status and (if relevant) a **Restricted** tag.
- The **Next step** section appears only when there is something you are
  allowed to do next.
- Every detail page ends with **History**: who did what, and when. Where a
  reason was recorded (for example when an action, audit or inspection was
  cancelled), it is shown under the entry.
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

An incident is the **event** — what happened. Working out why is an
**investigation**; issues found are **findings**; corrective work is
**actions**. Each is its own record.

### The Incidents register

The register has views for **All**, **Open**, **Needs triage** (Reported or
Under review), **Investigation required**, **Under investigation**, **Findings
open** (at least one linked finding still open), **Ready for closure**
(Awaiting verification, with no open finding and no running investigation)
and **Closed** (closed or cancelled). It can also be filtered by status,
category, risk, owner, location, external organisation, restriction and
date.

Each row shows the risk, owner, where it happened (location, asset,
external organisation), whether an investigation is active or finished, how
many findings are open, and how many corrective actions are still open on
those findings.

### Owner

The **owner** is responsible for the incident response. Use **Assign owner**
(or **Change owner**) under **Next step**. If someone else changed the owner
since you opened the page, your change is refused — refresh and try again.
Changing the owner changes nothing else. A closed or cancelled incident
keeps its owner.

### What still needs attention

An open incident shows two boxes:

- **What still prevents this incident from being closed?** — only the
  things that will actually stop closure: the status path, open findings
  (named), and investigations that are not completed (named). Findings or
  investigations hidden from you are reported only as "one or more".
- **Triage facts** — whether a risk level is set, an owner is assigned, an
  immediate response is recorded, an investigation is linked or marked
  required, and whether findings have been raised. These are facts only;
  BrainBase never decides the risk or whether to investigate.

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

An investigation of a restricted incident must itself be restricted.
**Start investigation** on a restricted incident always creates a restricted
investigation, and a restricted incident cannot be linked to an unrestricted
investigation.

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
finding is still open, or any linked investigation is still active. The
**What still prevents this incident from being closed?** box shows what is
blocking closure. Nothing is closed on the incident's behalf, and closing an
incident never closes its investigations, findings or actions.

A closed or cancelled incident **cannot be reopened**. If the issue recurs,
report a new incident.

### People

The **People** section lists people recorded against the incident (for
example injured person, witness, responder) with their role and notes.

> Current limitation: people cannot yet be added or edited from the
> Assurance screens.

### Findings and investigations

- **Raise finding** in the **Findings** section creates a finding linked to
  this incident. It is available until the incident is closed or cancelled.
- **Link existing finding** (next to **Raise finding**) attaches a finding
  that already exists — for a repeat issue already being managed. It offers
  open findings you can see that are not already linked.
- **Start investigation** in the **Investigation** section starts a new
  investigation with this incident as its **primary** incident. Enter the
  **Title** and **What will the investigation establish?**, and optionally
  the **Lead investigator**, **Risk level** (pre-filled from the incident;
  change it if needed) and **Target completion**. The incident's own status
  does **not** change — move it to **Investigation underway** yourself.
- While an active investigation already has this incident as its primary
  incident, a second **Start investigation** is refused; open the existing
  one instead. To investigate several incidents together, use **Start one
  that covers several incidents**.
- The **Investigation** table shows each linked investigation, its
  relationship (Primary, Related, Triggering or Context) and its status.
- **Corrective actions** lists the actions on this incident's findings.
  Actions always address a finding — there is no action directly on an
  incident — and closing them never closes the incident.
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

An investigation is the **structured process** to understand an incident:
its scope, the evidence gathered, the findings it identifies and its
conclusion. It is not a narrative copy of the incident — nothing is copied
from the incident's description.

### The Investigations register

Views: **All**, **Active**, **Open / planning**, **In progress**, **Awaiting
information**, **Ready for completion** (Awaiting review — the only status
that can be completed), **Findings recorded** and **Completed / cancelled**.
Each row shows the lead, start and target dates, source incidents, how much
evidence is linked, open findings and open corrective actions.

### Lead investigator

Use **Assign lead investigator** (or **Change lead investigator**) under
**Next step**. As with incident owners, a change made by someone else since
you opened the page makes yours refused. The lead of a restricted
investigation can see it and everything linked beneath it.

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

**Complete with conclusion** requires a **Conclusion**: the factual outcome,
written by the investigator. BrainBase never writes, suggests or infers a
cause, blame or liability. Completing records the conclusion only. It does
**not** close the linked incidents, findings or actions.

The **What still prevents this investigation from being completed?** box
shows the status path still needed. Open findings do **not** block
completion — they are closed on their own — and the **Target completion**
date is a planning date, not a deadline: it shows as overdue but never
blocks anything.

A completed or cancelled investigation **cannot be reopened**. Start a new
investigation if more work is needed.

### Evidence

**Evidence gathered** works as everywhere in Assurance (see
[Evidence](#evidence)): who recorded it, its verification state and any
replacement history. Accepting evidence never completes the investigation
or closes the incident.

### Findings

**Raise finding** creates a finding linked to the investigation. It is
available until the investigation is completed or cancelled.
**Link existing finding** attaches a finding that already exists (for
example one first raised from an incident).

---

## Inspections

### Template-based and ad hoc

Select **Plan inspection**:

- **Title** is required.
- **Template** — choose a published inspection template to use its current
  checklist version, or leave **Ad hoc (no template)**. Draft and retired
  templates are not offered.
- **Inspection type** — required for an ad hoc inspection; otherwise the
  template's type is used.
- Optional: **Scheduled for**, **Inspector**, **Location**, **Asset**,
  **Contractor / external organisation**.

The Inspections register has views: **All**, **Due (7 days)**, **Planned**,
**In progress** and **Completed**. **Templates** opens **Assurance →
Templates**, showing inspection templates.

### Historical template versions

A template-based inspection keeps the **exact checklist version** it was
planned with. Its **Checklist** section says which version it uses. If a
newer version has since been published, it says so, and confirms the newer
version does not change this inspection. If the version groups its items into
sections, the checklist shows the same section headings in the same order.

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
- **Cancel inspection** (manager access) opens a confirmation form. A
  **Reason** is required and is kept in the inspection's history. It works
  only on a planned or in-progress inspection. Once cancelled, responses and
  evidence can no longer be changed.

### Linking an existing finding

In the inspection's **Findings** section, **Link existing finding** attaches
a finding that already exists (for example a repeat defect found again). This
links the finding to the inspection as a whole, not to a checklist item, so
it does not lock any response. It is not available on a cancelled inspection.

---

## Audits

### Template and ad hoc audits

Select **Plan audit**:

- **Title** and **Scope** are required.
- **Template** — choose a published audit template to use its current
  criteria version, or leave **Ad hoc (no template)**. Draft and retired
  templates are not offered.
- **Standard / reference** — what the audit is measured against. It is
  **required for an ad hoc audit**.
- **Audit type** — required for an ad hoc audit (Internal, Contractor, Site,
  Process, Facility, Policy, Compliance or Other).
- Optional: **Scheduled for**, **Auditor**, **Location**, **Asset**,
  **Contractor / external organisation**.

The Audits register has views: **All**, **Due (14 days)**, **Planned**,
**In progress** and **Completed**. **Templates** opens **Assurance →
Templates**, showing audit templates.

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

## Templates

**Templates** holds the standard checklists that inspections are planned from
and the criteria that audits are planned from. Everyone with Assurance access
can view them; only organisation admins can create, change, publish or retire
them (see the admin guide).

- The register lists both kinds. Filter by **Inspections and audits** or by
  status. If none exist yet, it says "No Assurance templates have been
  created."
- **Status**: **Draft** (never published, so not yet offered when planning),
  **Published** (its current version is offered), or **Retired** (no longer
  offered).
- A template's content lives in numbered **versions**. Each version is a
  **draft** while it is being prepared, **published** when it becomes the
  current version, and **retired** when a newer version replaces it or the
  template is retired.
- A template page shows the **Current version**, any **Draft**, and
  **Earlier versions**, each with who published or retired it, when, and how
  many inspections or audits use it. Items can be grouped under **section**
  headings.
- **Published and retired versions never change.** An inspection or audit
  always shows the exact wording of the version it was created from, even
  after newer versions are published or the template is retired.

---

## Contractor assurance

**Contractor assurance** answers: which external organisations need assurance,
what they must demonstrate, what evidence they have supplied, whether it is
current, and what still needs attention.

- It works on your organisation's **shared external organisations** (managed
  under **Settings → Reference data**). Contractor assurance never copies them
  or changes their relationship roles.
- An organisation is only included once someone **brings it into Assurance
  scope**. Being a contractor or supplier does not put it in scope by itself.
- The register has views: **Needs attention**, **Expired**, **Expiring soon**,
  **Awaiting review**, **Missing evidence**, **Current**, **All in scope** and
  **Out of scope**.
- Each organisation shows a status and the counts behind it:
  - **Expired evidence** — the current accepted evidence has passed its expiry
    date;
  - **Missing evidence** — a requirement has no accepted evidence;
  - **Evidence awaiting review** — evidence has been recorded but not yet
    accepted or rejected;
  - **Evidence expiring soon** — the current evidence expires within the
    requirement's renewal notice period (only if one is set);
  - **All requirements current**; or **No requirements assigned**.

  The status shown is the first of these that applies, in that order. It is
  a plain statement of facts, not a risk or compliance score. Dates use
  Australia/Adelaide time.
- On an organisation's page each requirement shows its current evidence,
  anything awaiting review, the evidence history and any findings.
- **Record evidence** (managers): what was supplied, its supplied, effective
  and expiry dates, and where the document is held. There is no file upload
  yet; the original stays where it is held.
- **Accept or reject** (managers and admins): someone other than the person
  who recorded the evidence must decide. Accepting new evidence keeps the old
  evidence as **superseded** history. Rejecting a replacement leaves the
  current evidence in place.
- Each piece of evidence is assessed against the requirement **as it stood
  when the evidence was recorded**. If the requirement has changed since, the
  page says so and shows both.
- If a requirement is **inactive** in the library, it cannot be newly
  assigned, but existing assignments continue: evidence can still be recorded
  and reviewed for them. Deactivating a requirement does not end an
  organisation's obligation; cancel the assignment to do that.
- Missing, expired or rejected evidence never creates a finding by itself.
  Use **Raise finding** when there is a genuine assurance issue; actions
  are then created from the finding in the usual way.

---

## Findings

A finding is raised from a source record: an incident, an investigation, an
inspection item, or an audit criterion. Use the **Raise finding** button on
that record. Each finding is raised from one source at a time.

A finding can afterwards be linked to **further** incidents, investigations,
inspections or audits with **Link existing finding** on that record (for a
repeat issue). Only open findings can be linked, and only to a record that
is still open (not a closed or cancelled incident, a completed or cancelled
investigation, or a cancelled inspection or audit). Linking changes no
statuses. A finding that everyone in your organisation can see cannot be
linked to a **restricted** incident or investigation — that would hide it,
its actions and its evidence from everyone else; raise a new finding from the
restricted record instead.

There is no "new finding" button on the Findings register.

### Source provenance

The finding's **Source** section shows where it came from, with a link back.
For inspection items and audit criteria, the exact **checklist item** or
**criterion** is recorded with the link and shown beside it. A finding raised
from a contractor requirement shows the **contractor** and the
**requirement**. Source links are permanent: they cannot be changed or moved
to another record, and closing or reopening the finding never changes the
source record.

Findings raised before this was recorded show **Whole inspection** or
**Whole audit** instead of an item.

The Findings register can filter by source: **From incidents**,
**From investigations**, **From inspections**, **From audits**, **From
contractor requirements** or **No source**.

"No source" findings cannot be created from the Assurance screens, but they
can exist — for example from data loaded through other supported paths — so
the filter is kept.

A finding cannot be raised from a closed, completed or cancelled incident or
investigation, or from a cancelled inspection or audit.

### What a finding records

- **Finding type**: Observation, Hazard, Defect, Non-conformance, Audit
  finding, Service failure, Improvement opportunity or Other.
- **Title** and **Description**.
- **Risk level** — this is the severity measure, set from your
  organisation's risk levels. Only **active** levels are offered. A level
  that an admin later deactivates stays on the records that already use it.
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
| Closed | **Reopen finding** (see Reopening below) |
| Cancelled | No further steps |

Finding statuses are **manual**. Adding, verifying or closing an action does
not move the finding, and nothing ever closes a finding automatically — not
even when its last action closes.

### Progress and register views

Next to its status, an open finding shows its **progress**, worked out from
its linked actions:

| Progress | Meaning |
|---|---|
| **No corrective action yet** | No action is linked, or every linked action was cancelled |
| **Actions underway** | At least one linked action is still open |
| **Ready for closure decision** | Every linked action is closed or cancelled, and at least one was closed |

Progress is never saved and never changes the status. The Findings register
has views for **All**, **Open**, **Needs action**, **Actions underway**,
**Overdue** (past the finding's resolve-by date), **Ready for closure** and
**Closed** (closed or cancelled).

A finding with no actions can still be closed directly — for example an
observation that needs no corrective work. It is simply never shown as
"ready".

### Linked actions

**Create action** in the **Corrective actions** section creates an action
already linked to the finding (see Actions). The table shows each action's
status and, separately, whether its **work** is complete, whether it is
**verified**, and whether it is **closed**, plus how much of its evidence is
accepted.

### Closure readiness

An open finding has a **Closure readiness** box: **What still prevents this
finding from being closed?** It lists only things that will actually stop
closure:

- the finding's status cannot move straight to Closed (it names the status
  to move to first);
- linked actions that are still open, by reference;
- "one or more linked actions you cannot see are still open", if an action
  is hidden from you because it is restricted.

A missed deadline is shown as a note, not a blocker.

### Closure

**Close finding** needs a **Closure reason** and is refused while any linked
action is still open (not closed or cancelled). **Cancel finding** needs a
**Cancellation reason**; a cancelled finding cannot be reopened. Closing a
finding does not close its actions or change its source records.

A closed or cancelled finding shows a **Closure record**: who closed it, when
and why. Findings closed before reasons were captured show **No reason
recorded**; no reason is made up for them.

### Reopening

If a closed issue comes back, select **Reopen finding** and give a **Reopen
reason**. The finding returns to **Under review**.

- The previous closure — who closed it, when and why — is kept in **Reopen
  history**, which cannot be edited.
- Reopening does **not** reopen any action, the source record, evidence
  decisions or verifications, and does **not** change risk.
- Reopening does **not** reset or extend the deadline. If the resolve-by
  date has passed, the finding shows as overdue; request an extension in its
  **Deadline** section.
- Closed actions are never reopened. Record the follow-up work as a **new**
  action on the finding. Both the earlier and the new actions stay listed.
- To close the finding again, give a new closure reason.

---

## Actions

### Assigned work

Actions are created from a finding with **Create action**. The
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

The action's **Corrective work status** box keeps the three facts apart:

- **Work complete** — Not complete, Work complete, or Rework required (a
  later verification did not accept the work).
- **Action verified** — Not required, Not yet verified, Action verified, Not
  accepted, or More evidence required.
- **Action closed** — Not closed, Action closed, or Cancelled.

Completing a linked Organiser task, accepting evidence or recording a
verification never closes the action. Closed actions are never reopened: if
more work is needed later, create a new action on the finding.

### Due dates

The **Due** date and **Overdue** marker come from the action's deadline. The
action's **Deadline** section shows the **effective due date**, the
**original due date**, any extension request and its history, and any
escalations. Extensions and escalations are described under
[Deadlines](#deadlines).

---

## Deadlines

**Assurance → Deadlines** lists the due dates set on findings (their
**closure deadline**) and actions (their **action deadline**). A deadline
exists only where a due date was entered when the finding or action was
created; there are no organisation-wide deadline rules.

- **Views:** Open, Overdue, Due soon, Awaiting decision, Extended,
  Escalated and All. Filter by findings or actions, deadline type, or search.
- **Overdue** means the effective due date has passed; **due soon** means it
  falls within the next 3 days — the same rule as the dashboard.
- Deadline dates are shown in Australia/Adelaide time.
- The **original due date** never changes. An approved extension changes only
  the **effective due date**, and the whole request history is kept.
- **Request extension** (managers and admins) asks for a later date with a
  reason. Nothing changes until an **organisation admin** approves it. The
  person who asked cannot approve their own request. A rejected or withdrawn
  request stays in the history.
- **Escalate** (managers and admins) flags a deadline for elevated
  attention, at a numbered level (Level 1–5 — the numbers have no set
  meaning). An escalation is then **acknowledged**, **resolved** or
  **cancelled**. Resolving an escalation does not close the finding or
  action, meet the deadline or change the due date.
- Once a finding or action is closed or cancelled, its deadline is finished
  and cannot be extended or escalated.

See [work instruction 13](work-instructions/13-manage-deadlines.md) for the
steps.

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
- **Supplied by** (optional) — the external organisation that supplied it.
  Otherwise it was recorded internally.
- Who **recorded** and **captured** it, and when.

> **Current limitation: there is no file upload.** Evidence records describe
> the proof and where it is kept; the file itself stays in your records
> system.

### Evidence and Verification

- The **Evidence** page answers *what do we have and what does it support?*
  It lists every piece of evidence with what it supports, who recorded it,
  who supplied it and its verification status. Views: **All**, **Awaiting
  verification**, **Accepted**, **Rejected**, **Superseded** and
  **Unverified**, plus a **Supports** filter.
- The **Verification** page answers *what needs an assurance decision?* (see
  Verification).

### Recording and linking

- On any incident, investigation, inspection, audit, finding or action,
  **Add evidence** records new evidence and links it to that record in one
  step. **Why it is linked here** records the purpose.
- On the **Evidence** register, **Record evidence** creates evidence that is
  not linked yet.
- On an evidence record's own page, **Link to a record** reuses it on another
  record: choose the **Record type** (Incident, Investigation, Inspection,
  Audit, Finding or Action), then the record, and optionally **Why it is
  linked**. The list offers records you can see that are still open and not
  already linked to this evidence. (Evidence for a verification is chosen when
  the verification is recorded, not linked here.)
- Evidence already used on other records cannot be linked to a restricted
  record. Record new evidence for the restricted record instead.
- On an **inspection** or **audit**, **Add evidence** can also name the
  **Checklist item** or **Criterion** it relates to. That context is fixed
  once linked; to change it, remove the link and add the evidence again.
- Superseded evidence cannot be linked to new records. Link the current
  evidence instead.

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

Evidence can currently still be added to a **closed incident** or a
**completed investigation** with **Add evidence** on that record. This is the
implemented behaviour pending a later policy decision.

### Verification status

Each piece of evidence shows one status:

- **Unverified** — recorded, not submitted for a decision.
- **Awaiting verification** — submitted; someone independent must accept or
  reject it.
- **Accepted** — an independent person accepted it.
- **Rejected** — an independent person rejected it, with a reason. It stays in
  the history.
- **Superseded** — it was accepted, and a replacement has since been accepted.
  It stays readable and unchanged.

Evidence recorded for a **contractor requirement** shows the decision made in
**Contractor assurance** (marked "Decided in Contractor assurance"). It is
never accepted or rejected from the Evidence page.

### Submitting and deciding

- **Submit for verification** on the evidence page (or tick **Submit for
  verification now** when adding evidence). **Withdraw from verification**
  takes it back, for example to correct it.
- **Accept or reject** is only offered to someone independent. You cannot
  decide evidence that you recorded or captured, or that supports an action
  you own or whose work you completed. BrainBase cannot prove independence
  from an external supplier, and does not claim to.
- Rejecting needs a **reason**.

### Correcting and replacing

- **Correct details** is available until the evidence is accepted or rejected.
  The previous details are kept in the history.
- After a decision, use **Record replacement** on accepted or rejected
  evidence. The replacement is linked to the same open records and starts as
  unverified.
  - When the replacement is **accepted**, accepted earlier evidence becomes
    **Superseded**; rejected earlier evidence stays **Rejected**.
  - When the replacement is **rejected**, the earlier evidence is unchanged.
- **Replacement history** on the evidence page shows the whole chain. Only the
  current evidence can be replaced, and only one replacement can be in
  progress at a time.

### What an evidence decision never does

Accepting, rejecting or replacing evidence never:

- verifies, closes or changes an action — action verification is a separate
  decision (see Verification);
- closes a finding, incident or investigation, or completes an inspection or
  audit;
- changes a deadline or escalation, or a contractor requirement;
- creates a finding or action.

Any of those remain explicit steps.

See [work instruction 15](work-instructions/15-verify-and-replace-evidence.md).

---

## Verification

### Independent verifier

The **Verification** page lists what needs an assurance decision:

- **Evidence awaiting verification** — decided on the evidence page.
- **Contractor evidence awaiting review** — decided in Contractor assurance.
- **Actions awaiting verification** — decided on the action (below).

It then shows **Recent evidence decisions** and **Recent action
verifications**. The **You can decide** / **You can verify** column shows
**Yes** or **Not independent**. When nothing is waiting, the page says
"Nothing is waiting for verification."

The rest of this section is about **action verification**: whether an
action's corrective work resolved the issue. Evidence decisions are described
under Evidence.

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
