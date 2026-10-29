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
| **Admin** | Everything a manager can, plus: create, draft, publish and retire inspection and audit templates (**Templates**); create, edit, deactivate and reactivate risk levels (**Settings → Risk levels**); see **all** restricted records in the organisation. |
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
by **admins** under **Assurance → Templates**. (The old Inspections →
Templates and Audits → Templates links now open the same page.)

Managers and viewers can view templates, including drafts, but cannot change
them. Managers use published templates when they plan an inspection or
audit. See
[work instruction 10](work-instructions/10-manage-inspection-and-audit-templates.md)
for the steps.

### Draft, published and retired versions

- A template is a stable identity (reference, name and type). Its content
  lives in **numbered versions**.
- A new template starts with **version 1 as a draft**. Drafts can be saved and
  edited as often as needed and are **not** offered when planning.
- **Publish** checks the draft (a title; at least one item or criterion; at
  least two options for choice items; no repeated wording; each section's
  items kept together), then makes it the **current version**. Publishing a
  new version **retires the previous one** at the same moment.
- **Published and retired versions can never be edited.** To change a
  template, use **Create new version**: it copies the current version into a
  new draft. A template has at most one draft at a time.
- **Retire** stops the template being offered for new inspections or audits
  (after a confirmation step). A retired version cannot be republished; to
  bring the template back, create and publish a new version.
- The template's **name and type** can be changed only until version 1 is
  published.
- Each inspection or audit is bound to the version that was published when it
  was planned, and keeps it permanently. This is enforced by the database: an
  inspection or audit cannot be created against a draft or retired version,
  or against another organisation's template.
- If two admins edit the same draft, the second save is refused with "Someone
  else saved this draft since you opened it" — reload to see their changes.
- Every create, save, new version, publish and retire is recorded in the
  template's **History** (version numbers and statuses only, not the
  wording).

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
- **Time zone.** Deadline dates are shown in Australia/Adelaide time (BrainBase's
  display convention), whatever the server's own time zone. A per-organisation
  time zone is a planned platform capability and is not used yet.
- **Audited.** `assurance_timeframe.extension_requested`, `…extension_approved`,
  `…extension_rejected`, `…extension_cancelled`, and
  `assurance_escalation.created`, `…acknowledged`, `…resolved`, `…cancelled`
  are written in the same transaction as the change, with the record
  reference, original, previous and resulting due dates, extension or
  escalation id and level. Free-text reasons and notes stay on the extension
  and escalation history, not in the audit payload.

## Contractor assurance

Contractor assurance (**Assurance → Contractor assurance**) records what your
organisation requires of its external organisations, and the evidence that
shows each requirement is met. See
[work instruction 14](work-instructions/14-manage-contractor-assurance.md).

### Contractor assurance requirement library

- **Assurance → Contractor assurance → Requirement library**. Only
  organisation admins can create, edit, deactivate or reactivate
  requirements.
- A requirement has:
  - a code (unique, and fixed once created);
  - a name, a category and an optional description;
  - evidence guidance;
  - whether evidence must carry an expiry date;
  - an optional **renewal notice** in days (1–365).
- BrainBase does not assume any legal requirement, threshold or policy
  amount. Your organisation defines its own.
- **Renewal notice** controls "Expiring soon": evidence expiring within that
  many days is flagged. Leave it blank for no expiring-soon state; there is
  no hidden default.
- Requirements are never deleted. **Deactivate** stops new assignments only:
  - an inactive requirement cannot be newly assigned to any organisation;
  - existing active assignments continue, labelled "Requirement inactive";
  - evidence can still be recorded, accepted and rejected for those existing
    assignments, and newly accepted evidence still replaces the old;
  - deactivating does **not** end an organisation's existing obligation. To
    end it, **cancel the assignment** (with a reason) on the organisation's
    page. Its evidence and history are kept.
- Editing a requirement does not change how earlier evidence is understood:
  each piece of evidence keeps a copy of the requirement as it stood when it
  was recorded.

### Scope, assignments and decisions

- **Scope**: managers bring an active shared external organisation into
  Assurance scope, and can set a responsible person.
  - Moving an organisation **out of scope** hides it from the register but
    keeps every assignment, piece of evidence and history entry. It can be
    brought back into scope.
  - New requirements can only be assigned while it is in scope.
- **Assignments**: managers assign active requirements. Each assignment can
  have an optional required-from date, evidence-due date, reviewer and notes.
  - A requirement can only be actively assigned once per organisation.
  - Cancelling an assignment (with a reason) keeps its history and allows a
    fresh assignment later.
- **Decisions**: accepting or rejecting evidence uses the same manager-level
  permission as other verification.
  - The database refuses a decision by the person who recorded the evidence.
    This is the independence the system can prove; it does not establish any
    wider independence.
  - Evidence for a requirement that needs an expiry date cannot be accepted
    without one.
- Everything is recorded in the audit history:
  - requirement created / updated / deactivated / reactivated;
  - scope created / brought into scope / removed from scope / updated;
  - assignment created / updated / cancelled;
  - evidence recorded / accepted / rejected / superseded / withdrawn.

## Evidence and verification

Evidence (**Assurance → Evidence**) is the register of proof; Verification
(**Assurance → Verification**) is the queue of decisions. See
[work instruction 15](work-instructions/15-verify-and-replace-evidence.md).

- **Permissions.** Managers and admins record, link, submit, withdraw,
  correct and replace evidence. Accepting or rejecting uses the same
  manager-level **verify** permission as action verification. Viewers read
  only. Every check is made on the server.
- **Independence.**
  - The database refuses a decision by the person who recorded or captured
    the evidence.
  - The service also refuses the owner of any action the evidence supports,
    and anyone who completed (or ever completed) that action's work.
  - This is the independence BrainBase can prove from its own records. It
    does not establish independence from an external supplier.
- **Lifecycle.** Unverified → Awaiting verification → Accepted or Rejected;
  Accepted → Superseded only when a replacement is accepted. Each piece of
  evidence gets at most one decision.
- **Correction.** Allowed only before a decision, with the previous details
  kept in the audit history. After a decision, content is fixed and a
  replacement is recorded instead.
- **Replacement.** Only the current evidence in a chain (accepted, or rejected
  with nothing newer current or pending) can be replaced, one replacement at
  a time. Concurrent attempts are serialised: exactly one succeeds.
- **Contractor evidence.** Evidence recorded for a contractor requirement is
  decided only in Contractor assurance. The Evidence and Verification pages
  show that decision and link to it; the general lifecycle never changes it.
- **Inspection and audit context.** Evidence added on an inspection or audit
  can name the checklist item or criterion it relates to (a structured link
  to the recorded response). It is fixed once linked.
- **No knock-on effects.** An evidence decision never verifies or closes an
  action, closes a finding, incident or investigation, completes an inspection
  or audit, changes a deadline or escalation, approves a contractor or creates
  a finding.
- **Audit history.** Every change writes an audit entry in the same
  transaction: evidence created, linked, unlinked, corrected (before and
  after), verification requested, verification withdrawn, accepted, rejected,
  superseded and replacement recorded.

## Incidents and investigations

See [work instruction 01](work-instructions/01-report-an-incident.md) and
[02](work-instructions/02-start-an-investigation.md).

- **Model.** An incident is the event; an investigation is the structured
  process to understand it; findings are the issues; actions are the
  corrective work. Actions always address findings — there is no action
  directly on an incident or investigation.
- **Cases.** Incidents and investigations each have their own restricted
  flag and people. The underlying Case record is not used by the Assurance
  screens today and is not shown to users.
- **Permissions.** Managers and admins report incidents, start
  investigations, change status, assign owners and lead investigators, and
  raise findings. Closing or cancelling an incident, and completing or
  cancelling an investigation, use the manager-level **close** permission.
  Viewers read only. Every check is made on the server.
- **Restriction.** A restricted incident is visible to its owner, reporter,
  creator and admins; a restricted investigation to its lead, creator and
  admins. An investigation of a restricted incident must be restricted:
  starting one from a restricted incident always creates a restricted
  investigation, and linking a restricted incident to an unrestricted
  investigation is refused. Assigning a lead to a restricted investigation
  lets that person see it.
- **Starting an investigation** from an incident links it as the primary
  incident, inside a lock on the incident. A second start is refused while
  an active investigation already has that primary incident. The incident's
  status is not changed.
- **Closure.** An incident closes only from Under review or Awaiting
  verification, with a closure summary, and only when every linked finding
  is closed or cancelled and every linked investigation is completed or
  cancelled (counting records the user cannot see). An investigation
  completes only from Awaiting review, with a conclusion; open findings do
  not block it. Neither ever closes the other, or any finding or action.
- **Reopen.** Closed or cancelled incidents and completed or cancelled
  investigations cannot be reopened.
- **Deadlines.** Incidents and investigations have no deadlines in the
  Deadlines workflow. An investigation's **target completion** date is a
  planning date only.
- **Audit history.** Incident created, status changed, closed, owner
  changed and investigation started; investigation created, status changed,
  completed, lead changed and incident linked. Each is one entry written in
  the same transaction as the change.

## Findings and corrective actions

Findings are the issues; actions are the corrective work. See
[work instruction 05](work-instructions/05-raise-and-manage-a-finding.md),
[09](work-instructions/09-close-actions-and-findings.md) and
[16](work-instructions/16-reopen-a-finding.md).

- **Permissions.** Managers and admins raise findings, change their status,
  create actions and record work. Closing, cancelling and reopening a finding
  use the manager-level **close** permission. Viewers read only.
- **Closure reason.** Every new close or cancel of a finding records a
  reason; the database refuses one without it. Findings closed before
  reasons were captured keep no reason — none is invented, and one cannot be
  added afterwards. A recorded closure (reason, who, when) is never
  rewritten while the finding stays closed.
- **Reopen.** Only a **Closed** finding can be reopened, always to **Under
  review**, with a reason. The previous closure is copied into a permanent
  **Reopen history** in the same transaction; the history cannot be edited
  or deleted. Concurrent reopens are serialised: exactly one succeeds.
  Cancelled findings cannot be reopened.
- **No knock-on effects.** Closing or reopening a finding never changes its
  actions, source records, contractor records, evidence decisions,
  verifications, deadlines, extensions, escalations or risk level. Nothing
  closes a finding automatically.
- **Actions are not reopened.** Follow-up work is a new action linked to the
  same finding, so earlier verification attempts stay exactly as recorded.
- **Source provenance.** Source links (incident, investigation, inspection,
  audit) cannot be changed once made. A link to an inspection or audit can
  record the exact checklist item or criterion (a structured link to the
  recorded response of that same inspection or audit). Links made before
  this was recorded have no item.
- **Derived progress.** Needs action, Actions underway and Ready for closure
  are worked out from the linked actions each time a page loads. They are
  not stored and never change a status. They take every linked action into
  account, including ones a viewer cannot see, but only visible actions are
  ever named.
- **Audit history.** Finding created, status changed, closed (with reason),
  cancelled (with reason) and reopened (with reason and the previous
  closure) are each one audit entry, written in the same transaction as the
  change.

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
| Evidence | **No file upload.** Evidence records describe the proof and where the original is held. Checklist-item or criterion context can be set when adding evidence on the inspection or audit, not when linking existing evidence from the evidence page. Evidence has no expiry date of its own (contractor evidence keeps its dates in Contractor assurance). |
| People | People on incidents and investigations are displayed, but cannot be added or edited from Assurance screens. |
| Incidents & investigations | Risk level, location, asset, external organisation and description cannot be edited after an incident is reported (owner and lead can be changed). No reopen. No deadlines in the Deadlines workflow (investigation target dates are for planning only). |
| Due dates | A due date can only be set when a finding or action is created; it cannot be added later. Extensions and escalations are manual (no automatic escalation, no organisation-wide deadline rules). Who cancelled an escalation is recorded in the audit history, not on the escalation itself. |
| Findings | Findings are raised from a source record, and can be linked to further incidents, investigations, inspections and audits. There is no standalone "new finding" button. Linking an existing finding to an inspection or audit does not record a checklist item or criterion. Who cancelled a finding, and when, is recorded in its audit history rather than on the finding. |
| Reference data | Locations, assets and external organisations are managed under **Settings → Reference data** and are never deleted. Archived or retired records cannot be reactivated there, and there is no map or address look-up. |
| Scheduling | No recurring or automatically scheduled inspections or audits. |
| Contractor assurance | No file upload: evidence records where the original document is held. No automatic reminders or expiry notifications. Contractor portal / self-service submission is not available. |
| Templates | A draft cannot be deleted from the screens: edit it, publish it, or leave it as a draft. A retired version cannot be republished. A template's name and type are fixed once it has been published. There is no template import or copying between templates. |
| Evidence after closure | Evidence can still be added to a **closed incident** or a **completed investigation** (it is frozen only on closed or cancelled findings and actions, and cancelled inspections and audits). This is current behaviour pending a policy decision. |
| Record editing | Records cannot be edited after creation (for example an action's due date or description). |
| Access | The Analyst role has no Assurance access. |
