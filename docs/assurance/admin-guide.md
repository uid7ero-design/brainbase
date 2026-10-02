# Assurance — Admin guide

For organisation admins and BrainBase super admins. It explains how access
to Assurance is controlled and how the shared set-up works.

This is not a developer or deployment guide.

---

## Enabling Assurance for an organisation

Assurance is a **capability** (module key `assurance`). It is off for every
organisation until a BrainBase **super admin** enables it for that
organisation on the organisation's capability settings in BrainBase admin.

- The Assurance capability must first be registered on the platform. This
  is a one-off platform step carried out by the BrainBase team, not by
  organisations.
- Registering the capability grants nothing to any organisation. Each
  organisation's entitlement stays off until it is enabled.
- While Assurance is not enabled, users see "Assurance isn't enabled for
  your organisation" and every Assurance request is refused. It fails closed.
- Once enabled, **Assurance** appears in the BrainBase top navigation for
  that organisation's users.

The navigation link only makes the module visible. Every Assurance page and
every Assurance request separately checks the capability, and checks the
user's role.

## Roles and access

Assurance uses the user's BrainBase role:

| Role | Can do in Assurance |
|---|---|
| **Viewer** | View the dashboard, registers and records they are allowed to see. No recording. |
| **Manager** | Everything a viewer can, plus: report incidents; start investigations; plan and run inspections and audits; raise findings; create and progress actions; record and link evidence; record verifications (independence rules apply); move statuses; close and cancel records. |
| **Admin** | Everything a manager can, plus: create, version, deactivate and reactivate inspection and audit templates; create, edit, deactivate and reactivate risk levels (**Settings → Risk levels**); see **all** restricted records in the organisation. |
| **Super admin** | As admin, and enables the capability for organisations. |

The **Analyst** role has no Assurance access.

Pages show only the buttons a user's role allows. The same rules are also
enforced when an action is submitted, so hiding a button is never the only
protection.

## Restricted records

Incidents and investigations can be marked **Restricted** when they are
created.

| Restricted record | Visible to |
|---|---|
| Incident | Organisation admins; its owner; its reporter; the person who created it |
| Investigation | Organisation admins; its lead investigator; the person who created it |

Restriction is inherited **downwards**:

- a **finding** linked to a restricted incident or investigation the user
  cannot see is hidden;
- an **action** linked to a hidden finding is hidden;
- **evidence** linked, now or previously, to any hidden record is hidden.

A hidden record behaves exactly like a record that does not exist. It is
absent from registers, dashboard counts and link lists, and opening its
address shows "Record not found".

Restriction does **not** flow upwards. An unrestricted incident linked to a
restricted investigation stays visible, and shows the investigation only as a
**Restricted** placeholder.

To protect restricted material, evidence already used on other records
cannot be linked to a restricted record. The user is asked to record new
evidence instead. In the same way, a finding that everyone can see cannot be linked
to a restricted incident or investigation with **Link existing finding** — a
new finding must be raised from the restricted record.

## Same-organisation users

Anywhere a person is chosen — owner, lead investigator, inspector, auditor,
responsible person, action owner — the choice is limited to **active users of
the same organisation**. The same rule is checked when the record is saved, so
a user from another organisation, or an inactive user, is refused.

Likewise, risk levels, locations, assets and external organisations must
belong to the same organisation.

## Template management

Inspection templates (checklists) and audit templates (criteria) are managed
by **admins**:

- Inspections → **Templates**
- Audits → **Templates**

Managers and viewers can view templates, but cannot change them. See
[work instruction 10](work-instructions/10-manage-inspection-and-audit-templates.md)
for the steps.

### Immutable template versions

- A template is a stable identity. Its content lives in **numbered
  versions**: version 1 is published when the template is created.
- A published version **can never be edited**. Changing a checklist or
  criteria always publishes a **new version**.
- Each inspection or audit is bound to the version current when it was
  planned, and keeps it permanently — even after new versions are published,
  or after the template is deactivated.
- **Deactivate** removes a template from the choices offered when planning
  (after a confirmation step). Existing inspections and audits are unaffected.
  **Reactivate** (also confirmed) offers it
  again.

## Reference data

Locations, assets and external organisations are drawn from the
organisation's shared BrainBase records. They are managed under
**Settings → Reference data** (see [below](#reference-data-locations-assets-and-external-organisations)).

## Assurance settings

**Assurance → Settings** holds Assurance configuration for your
organisation. Everyone with Assurance access can open it and view the
settings; only **organisation admins** can change them, and the system
refuses changes from anyone else. Every change is recorded in the audit
history. See [work instruction 11](work-instructions/11-manage-risk-levels.md)
for the steps.

### Risk levels

Risk levels are the organisation's severity scale, managed under
**Settings → Risk levels**.

- **Organisation-scoped.** Each organisation has its own levels. A record can
  only use an **active** level of its own organisation.
- **Optional on records, fixed at creation.** Choosing a risk level on an
  incident, investigation or finding is optional, but it can only be set
  when the record is **created**.
- **Code** is a stable identifier (upper-case letters, numbers and
  underscores). It **cannot be changed** after the level is created.
- **Rank** orders the scale: higher is more severe, and choices are listed
  from the highest rank to the lowest. Each rank is **unique** in the
  organisation, **including inactive levels** (an inactive level keeps its
  rank).
- **Active / inactive.** Deactivating a level removes it from the choices for
  **new** records only. Existing incidents, investigations and findings keep
  the level and continue to show it; nothing is reassigned or rewritten.
  A level can be reactivated.
- **Never deleted.** There is no delete; deactivate a level instead.
- **Serious.** The dashboard treats an incident as serious when its risk
  level is one of the organisation's **two highest-ranked active** levels.
  The Risk levels screen shows each level's classification (**Serious**,
  **Standard** or **Inactive**). Creating a high-ranked level, changing a
  rank, deactivating or reactivating can change which levels are serious;
  the screen shows the serious levels before and after, and asks for
  confirmation.
- **Requires verification** is recorded for policy/configuration purposes. It
  does **not** currently enforce verification automatically: verification
  works the same way at every level.
- **Audited.** Creating, editing, deactivating and reactivating a level each
  write an audit record with the values before and after (and the serious
  levels when they change). The screen lists recent changes under **Change
  history**.

Brainbase's initial scale is:

| Risk level | Rank | Meaning |
|---|---|---|
| **Extreme** | 40 | Severe risk requiring immediate attention and action. |
| **High** | 30 | Significant risk requiring prompt management attention. |
| **Medium** | 20 | Moderate risk requiring a planned and monitored response. |
| **Low** | 10 | Minor risk that can be managed through routine controls. |

With this scale, **High** and **Extreme** are serious.

> Bootstrap history: Brainbase's initial four levels were created by a
> reviewed, one-off database script
> (`scripts/seed-assurance-risk-levels-brainbase.sql`). That script remains
> as bootstrap tooling only; risk levels are now administered in
> **Settings → Risk levels**.

### Reference data: locations, assets and external organisations

**Settings → Reference data** manages the organisation's shared BrainBase
**Locations**, **Assets** and **External organisations**. See
[work instruction 12](work-instructions/12-manage-reference-data.md) for the
steps.

- **Shared BrainBase records, not Assurance copies.** These records belong to
  the organisation. Assurance records only *reference* them; Assurance never
  keeps its own location, asset or contractor lists. No other BrainBase
  screen manages them today, so this is where they are maintained.
- **External organisations** are broader than contractors: each can carry
  one or more **roles** (Contractor, Subcontractor, Supplier, Service
  provider, Consultant, Customer, Partner, Insurer, Other).
- **Assets** are generic reference records (vehicle, plant, equipment,
  building and so on) that Assurance records can point at. Assurance does not
  manage an asset's lifecycle (servicing, fleet operations and the like).
- **Organisation-scoped.** Every list and change is limited to your own
  organisation. Another organisation's record is never shown, and changing
  one by guessing its identifier is refused as "not found".
- **Reference** is a stable, unique identifier (upper-case letters, numbers,
  dots, dashes, underscores and slashes). It **cannot be changed** after the
  record is created and is unique including inactive records.
- **Active / inactive.** Deactivating removes a record from the choices for
  **new** records only, and the system refuses an inactive record on a new
  record even if it is submitted directly. Existing records keep it and
  continue to show it; nothing is reassigned or cleared. List-page filters
  still include inactive records, marked "(inactive)". A deactivated record
  can be reactivated. Records with the shared statuses **Archived** or
  **Retired** are shown but cannot be reactivated here.
- **Never deleted.** There is no delete.
- **Who can change them.** Only **organisation admins**. Everyone with
  Assurance access can view the lists (usage counts are shown to those who
  can see every record).
- **Audited.** Creating, editing, deactivating and reactivating each write
  an audit record (`location.*`, `asset.*` or `external_organisation.*`)
  with the reference, name, type or roles and status before and after, and
  which fields changed. Descriptions, addresses and contact details are not
  copied into the audit log. Recent changes are listed under **Change
  history** on each screen.
- **Concurrent edits** are protected: if someone else changed a record after
  you opened it, your save is refused with "changed by someone else" instead
  of overwriting their change.

## Deadlines, extensions and escalations

**Assurance → Deadlines** is an operational register, not configuration.
See [work instruction 13](work-instructions/13-manage-deadlines.md).

- **What a deadline is.** A timeframe attached to one record: a finding's
  due date is its **closure deadline**, an action's due date its **action
  deadline**. They are created only when a due date is entered at creation.
  There are no organisation-wide SLA rules.
- **Original vs effective.** The **original due date** is fixed by the
  database and never changes. The **effective due date** changes only when an
  extension is approved.
- **Overdue / due soon** are derived from the effective due date (overdue once
  passed; due soon within 3 days — one shared rule with the dashboard). No
  background job sets them; the stored deadline status is not changed by
  Deadlines.
- **Extensions** keep a full history: requested → approved, rejected or
  withdrawn. Managers and admins request (later, future dates only; one
  waiting request per deadline). **Only organisation admins decide**, and
  never their own request. Approval is refused if the deadline changed since
  the request. An approver may approve a different later date.
- **Escalations are manual.** Managers and admins raise them at a numeric
  level (Level 1–5; no tier meaning is defined), optionally assigned to an
  active user of your organisation. Transitions: Open → Acknowledged →
  Resolved, or Open/Acknowledged → Cancelled (with a reason). A change is
  refused if someone else changed the escalation first.
- **No propagation.** Approving an extension does not complete work.
  Resolving or cancelling an escalation does not close the finding or action,
  meet the deadline, change the due date or affect other escalations. Closing
  a finding or action still follows its own closure rules, and finishes its
  deadline (it can no longer be extended or escalated).
- **Visibility** follows the finding or action: restricted records' deadlines
  are hidden from anyone who cannot see the record, and another
  organisation's deadline, extension or escalation is "not found".
- **Time zone.** Dates are shown in the organisation's time zone
  (organisations.timezone), or Australia/Adelaide when none is set.
- **Audited.** `assurance_timeframe.extension_requested`, `…extension_approved`,
  `…extension_rejected`, `…extension_cancelled`, and
  `assurance_escalation.created`, `…acknowledged`, `…resolved`, `…cancelled`
  are written in the same transaction as the change, with the record
  reference, original, previous and resulting due dates, extension or
  escalation id and level. Free-text reasons and notes stay on the extension
  and escalation history, not in the audit payload.

## In-app Help

Everyone with Assurance access can open **Help & work instructions** and each
page's **Help** link. Help is read-only and shows these documents, including
this admin guide; it contains no organisation data. Nothing needs to be
enabled separately.

## Audit trail

Every create, status change, response, link, unlink, verification and closure
is written to the organisation's audit history, with who did it and when. It
appears in each record's **History** section. Verification history and
removed evidence links are kept permanently.

## Demo fixture and disposable testing

A synthetic demonstration scenario exists for training and testing: a fictional
council ("[DEMO] Riverside Shire Council (synthetic)"). It includes:

- five demo users;
- connected incident, investigation, inspection, audit, finding, action,
  evidence and verification records;
- a restricted incident;
- template versions.

Rules:

- **Demo data is for disposable environments only** — a local database, a
  disposable Neon branch, or the automated test harness.
- It is **never loaded into Production**. The seed refuses to run unless the
  person running it has explicitly declared the environment disposable.
- It enables Assurance **only** for the demo organisation.
- Demo users have no passwords. To look around, sign in as a super admin and
  impersonate the demo organisation.
- A matching clean-up script removes only the demo organisation's records.

## Current known limitations

| Area | Limitation |
|---|---|
| Evidence | **No file upload.** Evidence records describe the proof and where the original is held. |
| People | People on incidents and investigations are displayed, but cannot be added or edited from Assurance screens. |
| Due dates | A due date can only be set when a finding or action is created; it cannot be added later. Extensions and escalations are manual (no automatic escalation, no organisation-wide deadline rules). Who cancelled an escalation is recorded in the audit history, not on the escalation itself. |
| Findings | Findings are raised from a source record, and can be linked to further incidents, investigations, inspections and audits. There is no standalone "new finding" button. |
| Reference data | Locations, assets and external organisations are managed under **Settings → Reference data** and are never deleted. Archived or retired records cannot be reactivated there, and there is no map or address look-up. |
| Scheduling | No recurring or automatically scheduled inspections or audits. |
| Evidence after closure | Evidence can still be added to a **closed incident** or a **completed investigation** (it is frozen only on closed or cancelled findings and actions, and cancelled inspections and audits). This is current behaviour pending a policy decision. |
| Record editing | Records cannot be edited after creation (for example an action's due date or description). |
| Access | The Analyst role has no Assurance access. |
