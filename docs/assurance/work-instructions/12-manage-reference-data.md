# Manage reference data

## Purpose

Maintain your organisation's shared **locations**, **assets** and **external
organisations**: the records offered when recording incidents, inspections,
audits, findings, actions and evidence.

These are shared BrainBase records. They belong to your organisation, not to
Assurance, and Assurance never keeps its own copies.

## When to use this

- Adding a new location, asset or external organisation.
- Correcting a name or other details.
- Retiring a record (deactivating it) or bringing one back (reactivating it).

## Who can do this

Only **organisation admins**. Everyone else with Assurance access can view
**Settings → Reference data**, but sees no change controls, and the system
refuses changes from anyone who is not an admin.

## Before you start

- Agree the record's **Reference**: a short, unique identifier such as
  `DEPOT-01`, `TRUCK-001` or `ACME`. It cannot be changed later.
- Do not enter personal details. For external organisations, use a general
  business email address and phone number, not a person's.

## Steps

**Create a record**

1. Go to **Assurance → Settings → Reference data**.
2. Select **Locations**, **Assets** or **External organisations**.
3. Select **Create location** (or **Create asset**, **Create external
   organisation**).
4. Enter the **Reference** and **Name**, then the other details:
   - Locations: **Location type** (required), description and address.
   - Assets: **Asset type** (required), description and an external
     identifier such as a fleet number.
   - External organisations: **Roles** (for example Contractor, Supplier or
     Customer — choose any that apply), legal name, business identifier,
     general email, general phone and website.
5. Select **Create**.

**Edit a record**

6. Select **Edit** on the record.
7. Change the details. The **Reference** is shown but cannot be changed.
8. Select **Save changes**.

**Deactivate or reactivate**

9. Select **Deactivate** (or **Reactivate**) on the record.
10. Read the confirmation, then select **Deactivate** or **Reactivate**.
    (Select **Cancel** to back out; nothing changes.)

**Find a record**

11. Use **Search by name or reference**, and the status filter (**Active**,
    **Inactive** or **All**).

## What happens next

- Active records are offered in the **Location**, **Asset** and
  **Contractor / external organisation** choices when recording new
  incidents, inspections and audits, and for the responsible external
  organisation on findings and actions.
- **Used by** shows how many Assurance records reference each record.
- The change appears under **Change history** on the same page.

## Important rules

- **Nothing is ever deleted.** Deactivate a record instead.
- **Existing records keep their reference.** A deactivated location, asset or
  external organisation still shows on every record that uses it; it is only
  removed from the choices for new records. Nothing is reassigned or cleared.
- A deactivated record **cannot be chosen for a new record**, even by a
  direct request: the system refuses it.
- List filters (for example **Any location** on the incident list) still
  include deactivated records, marked "(inactive)", so you can find older
  records.
- **The reference is permanent** and unique within your organisation,
  including inactive records.
- Records are **organisation-scoped**: you only ever see and change your own
  organisation's records.
- Records with a status of **Archived** or **Retired** are shown, but cannot
  be reactivated here.
- Every change is recorded in the audit history.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only organisation admins can manage …" | Ask an admin. |
| "A … with reference … already exists." | Choose a different reference (inactive records keep theirs). |
| "A reference cannot be changed after the record is created." | Create a new record with the reference you need and deactivate the old one. |
| "This … was changed by someone else." | Refresh the page, check the latest values and try again. |
| "… is inactive and cannot be used on new records." | Choose an active record, or ask an admin to reactivate it. |
| The record is missing from a choice on a new record | It is inactive. Reactivate it if it should be offered again. |

## Related records / next steps

- [Report an incident](01-report-an-incident.md)
- [Run an inspection](03-run-an-inspection.md)
- [Create and run an audit](04-create-and-run-an-audit.md)
- [Manage risk levels](11-manage-risk-levels.md)
