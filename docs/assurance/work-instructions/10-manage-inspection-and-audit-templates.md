# Manage inspection and audit templates

## Purpose

Maintain the standard checklists (inspections) and criteria (audits) that
inspections and audits are planned from.

## When to use this

- Creating a new standard checklist or audit.
- Changing an existing one by publishing a new version.
- Retiring a template (deactivating it) or bringing one back (reactivating
  it).

## Who can do this

Only **organisation admins**. Managers and viewers can view templates and
their versions, but cannot change them.

## Before you start

- Agree the items or criteria, their response types, and which are required.
- For audits, know the **Standard / reference**.

## Steps

**Create a template** (publishes version 1)

1. Go to **Inspections → Templates** or **Audits → Templates**.
2. Under **New template**, open **Open the checklist builder** (inspections)
   or **Open the criteria builder** (audits).
3. Enter the **Template name**, then choose the **Inspection type** or
   **Audit type**. Optionally add a **Description**.
4. Audits: enter the **Standard / reference**.
5. Optionally add **Instructions**.
6. For each item or criterion, enter:
   - what should be checked or required;
   - its response type;
   - **Required** (ticked by default);
   - options, for choice types — at least two, comma-separated;
   - optional guidance.

   Use **↑** and **↓** to reorder, **Remove** to delete and **+ Add item** /
   **+ Add criterion** to add.
7. Select **Create template (version 1)**.

**Publish a new version** (to change a template)

8. Open the template.
9. Under **Publish a new version** (inspections) or **Edit (publishes a new
   version)** (audits), open the builder. It starts from the latest
   version.
10. Change the **Version title**, instructions, standard (audits) and the
    items or criteria.
11. Select **Publish new version**.

**Deactivate or reactivate**

12. On the template page, select **Deactivate** or **Reactivate**.
13. Read the confirmation, then select **Deactivate template** or
    **Reactivate template**. (Select **Cancel** to back out; nothing changes.)

## What happens next

- The template appears in the register with its **Current version** and
  **Status**. Its page lists every version, with its content and the number
  of inspections or audits using it.
- Active templates are offered when planning inspections and audits.

## Important rules

- **Published versions are immutable.** They can never be edited.
- Each inspection or audit keeps the version it was planned with. A new
  version affects only inspections and audits planned afterwards.
- Deactivating stops a template being offered for new plans. Existing
  inspections and audits are unaffected.
- A template needs at least one item or criterion, and at most 200.
- Checklist response types: Boolean, Pass / fail, Text, Number, Date, Choice,
  Multiple choice.
- Criteria response types: Compliance rating, Boolean, Text, Number, Choice.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only organisation admins can manage … templates." | Ask an admin. |
| "Checklist item N needs at least two options." / "Criterion N needs at least two options." | Enter two or more comma-separated options. |
| "Another version was published at the same time." | Refresh, review the latest version, and publish again if needed. |
| Old inspections still show the old checklist | Expected; versions are bound permanently. |

## Related records / next steps

- [Run an inspection](03-run-an-inspection.md)
- [Create and run an audit](04-create-and-run-an-audit.md)
