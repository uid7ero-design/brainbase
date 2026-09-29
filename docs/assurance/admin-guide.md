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
evidence instead.

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
- **Deactivate** removes a template from the choices offered when planning.
  Existing inspections and audits are unaffected. **Reactivate** offers it
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
| Evidence reuse | An existing evidence record can be linked to more records from its own page only for **incidents and findings**. On other records, **Add evidence** records new evidence. |
| People | People on incidents and investigations are displayed, but cannot be added or edited from Assurance screens. |
| Due dates | Extensions are displayed on actions, but cannot be requested or approved in the UI. |
| Findings | Findings are raised from a source record. There is no "new finding" button on the Findings register, and extra sources can be linked afterwards only for audits (**Link existing finding**). |
| Reference data | No Assurance screens for risk levels, locations, assets or external organisations. |
| Inspections | **Cancel inspection** does not ask for a reason (audits and actions do). |
| Scheduling | No recurring or automatically scheduled inspections or audits. |
