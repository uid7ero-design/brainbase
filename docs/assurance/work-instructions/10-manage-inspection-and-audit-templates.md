# Manage inspection and audit templates

## Purpose

Maintain the standard checklists (inspections) and criteria (audits) that
inspections and audits are planned from: draft them, publish them, change
them through new versions, and retire them.

## When to use this

- Creating a new standard checklist or audit.
- Changing an existing one (by drafting and publishing a new version).
- Retiring a template that should no longer be used.

## Who can do this

Only **organisation admins**. Managers and viewers can view templates, their
drafts and their versions, but cannot change them.

## Before you start

- Agree the items or criteria, their response types, which are required and
  how they are grouped into sections.
- For audits, know the **Standard / reference**.

## Steps

**Create a template** (version 1 starts as a draft)

1. Go to **Assurance → Templates**.
2. Under **New template**, open **Open the template builder**.
3. Choose **Template for**: **Inspections** or **Audits**.
4. Enter the **Template name**, then choose the **Inspection type** or
   **Audit type**. Optionally add a **Description**.
5. Audits: enter the **Standard / reference**.
6. Optionally add **Instructions**.
7. Optionally enter a **Section heading**. Select **+ Add section** to start
   another section; **↑** / **↓** next to a heading move the whole section.
8. For each item or criterion, enter:
   - what should be checked or required;
   - its response type;
   - **Required** (ticked by default);
   - options, for choice types — at least two, comma-separated;
   - optional guidance.

   Use **↑** and **↓** to reorder within a section, **Remove** to delete and
   **+ Add item** / **+ Add criterion** to add.
9. Select **Create draft template**. The template page opens with
   **Draft — version 1**. It is not offered when planning yet.

**Edit and publish a draft**

10. On the template page, change the draft (name, type and description can
    be changed only until version 1 is published).
11. Select **Save draft**. Save before publishing; **Publish version N** is
    unavailable while there are unsaved changes.
12. Select **Publish version N**, read the confirmation, then select
    **Confirm — publish version N**. If the draft is incomplete, the message
    says what to fix; nothing is published.

**Change a published template** (create a new version)

13. On the template page, select **Create new version**. A new draft opens,
    copied from the current version.
14. Make the changes, select **Save draft**, then publish it as above.
    Publishing retires the previous version at the same moment.

**Retire a template**

15. On the template page, select **Retire**.
16. Read the confirmation, then select **Retire template**. (Select
    **Cancel** to back out; nothing changes.)

## What happens next

- The register shows the template's **Status** (Draft, Published or
  Retired), **Current version**, any **Draft** and how many inspections or
  audits use it.
- Only the **published** version of each template is offered when planning
  inspections and audits.
- The template page lists the current version, any draft and the earlier
  versions, with who published or retired each one and when. **History**
  records every create, save, new version, publish and retire.

## Important rules

- **Published and retired versions never change.** Changes always go through
  a new draft version.
- Each inspection or audit keeps the version it was planned with. A new
  version affects only inspections and audits planned afterwards.
- A template has at most **one draft** at a time.
- Retiring stops a template being offered for new plans. Existing
  inspections and audits are unaffected. A retired version cannot be
  republished; to bring the template back, create and publish a new version.
- To publish, a version needs a title and at least one item or criterion (at
  most 200), each choice item needs two or more options, no two items may
  have the same wording, and each section's items must be kept together.
- Checklist response types: Boolean, Pass / fail, Text, Number, Date, Choice,
  Multiple choice.
- Criteria response types: Compliance rating, Boolean, Text, Number, Choice.
- Findings are never created by a template. Raise them from an inspection
  item or audit criterion with **Raise finding**.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only organisation admins can manage Assurance templates." | Ask an admin. |
| "Version N cannot be published yet: …" | Fix what the message lists, select **Save draft**, then publish again. |
| "Someone else saved this draft since you opened it." | Reload the page to see their changes, then make yours again. |
| "Version N is already a draft." | Edit or publish the existing draft instead of creating another. |
| "The name and type are fixed once a template has been published." | Create a new template if the name or type must change. |
| A template is not offered when planning | It is still a draft, or it has been retired. Publish a version. |
| Old inspections still show the old checklist | Expected; versions are bound permanently. |

## Related records / next steps

- [Run an inspection](03-run-an-inspection.md)
- [Create and run an audit](04-create-and-run-an-audit.md)
