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
| **Admin** | Everything a manager can, plus: create, version, deactivate and reactivate inspection and audit templates; see **all** restricted records in the organisation. |
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

Risk levels (used as the severity measure and by the dashboard's "serious
incidents"), locations, assets and external organisations are drawn from the
organisation's shared BrainBase records.

> Current limitation: Assurance has no screens for maintaining risk levels,
> locations, assets or external organisations. They must already exist for
> the organisation.

The dashboard treats an incident as **serious** when its risk level is one of
the organisation's **two highest-ranked active** risk levels.

### Risk levels

Risk levels are **organisation-scoped**: each organisation has its own scale,
and a record can only use an **active** risk level of its own organisation.
Choosing a risk level is optional, but it can only be set when an incident,
investigation or finding is **created** — it cannot be added or changed
afterwards.

Brainbase currently uses a **four-level** scale:

| Risk level | Rank | Meaning |
|---|---|---|
| **Extreme** | 40 | Severe risk requiring immediate attention and action. |
| **High** | 30 | Significant risk requiring prompt management attention. |
| **Medium** | 20 | Moderate risk requiring a planned and monitored response. |
| **Low** | 10 | Minor risk that can be managed through routine controls. |

- Choices are listed from the highest rank to the lowest.
- **High** and **Extreme** are currently treated as **serious**, because the
  dashboard defines serious as the two highest active ranks.
- Each level also carries a "requires verification" setting (on for High and
  Extreme). It is **descriptive only** today: it records intended policy and
  is **not an enforced workflow rule**. Verification works the same way at
  every risk level.

> Current limitation: risk levels are set up through a controlled bootstrap
> (a reviewed database script, `scripts/seed-assurance-risk-levels-brainbase.sql`)
> and maintained by controlled database changes. There is no screen for them
> yet. The planned future location is **Assurance → Settings → Risk levels**;
> that screen does not exist yet.
>
> Once a risk level is used by a record it is never deleted. A level that is
> no longer wanted is deactivated (no longer offered) and, if needed,
> replaced by a new level.

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
| Due dates | Extensions are displayed on actions, but cannot be requested or approved in the UI. |
| Findings | Findings are raised from a source record, and can be linked to further incidents, investigations, inspections and audits. There is no standalone "new finding" button. |
| Reference data | No Assurance screens for risk levels, locations, assets or external organisations. Risk levels are maintained by controlled database changes (see [Risk levels](#risk-levels)). |
| Scheduling | No recurring or automatically scheduled inspections or audits. |
| Evidence after closure | Evidence can still be added to a **closed incident** or a **completed investigation** (it is frozen only on closed or cancelled findings and actions, and cancelled inspections and audits). This is current behaviour pending a policy decision. |
| Record editing | Records cannot be edited after creation (for example an action's due date or description). |
| Access | The Analyst role has no Assurance access. |
