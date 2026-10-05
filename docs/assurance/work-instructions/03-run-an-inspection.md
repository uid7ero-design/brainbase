# Run an inspection

## Purpose

Carry out a structured check of a site, vehicle, facility, contractor
service or operation, and record each item's result.

## When to use this

For a planned, template-based inspection, or an ad hoc check in the field.

## Who can do this

- **Manager** access or higher plans, starts, records, completes and raises
  findings.
- Cancelling also needs manager access.

## Before you start

- For a template-based inspection, an admin must have **published** an
  inspection template.
- Decide the inspector, location and schedule.

## Steps

**Plan**

1. Go to **Assurance → Inspections** and select **Plan inspection**.
2. Enter a **Title**.
3. Choose a **Template**, or leave **Ad hoc (no template)**. For ad hoc,
   choose an **Inspection type**.
4. Optionally set **Scheduled for**, **Inspector**, **Location**, **Asset**
   and **Contractor / external organisation**.
5. Select **Plan inspection**.

**Run**

6. On the inspection page select **Start inspection**.
7. For each checklist item, choose **Pass**, **Fail**, **Observation** or
   **N/A**. Enter a value if the item asks for one, and add notes.
8. Select **Save response**. To change it later, use **Revise**, then
   **Update response**.
9. Ad hoc only: use **Add an item**. Enter what was checked, the **Response
   type** and outcome, then select **Add item**.
10. For a **Fail** or **Observation** that needs formal follow-up, select
    **Raise finding** on that item (see
    [work instruction 05](05-raise-and-manage-a-finding.md)).

**Finish**

11. Select **Complete inspection**. Optionally add a **Summary**, then
    submit.

**Link an existing finding** (repeat issue)

12. In **Findings** select **Link existing finding**, choose the finding and
    select **Link finding**. This links the whole inspection, not an item.

**Cancel** (if the inspection will not go ahead)

13. Select **Cancel inspection**, enter the **Reason**, then confirm with
    **Cancel inspection**. (Select **Cancel** instead to back out.)

## What happens next

- The inspection moves Planned → In progress → Completed.
- Its checklist version stays fixed, even if a newer version is later
  published or the template is retired.
- Findings raised appear under **Findings** on the inspection, and on the
  Findings register with the inspection as their source.

## Important rules

- Responses can only be recorded while the inspection is **In progress**.
- A **Fail** needs a note explaining why.
- A Fail or Observation does **not** create a finding. Raising one is your
  decision.
- Once a finding is raised from an item, that item's response is locked.
- Completion is refused until every **required** item has a response. An
  ad hoc inspection needs at least one item.
- **Cancel inspection** is available only while planned or in progress, and
  needs a **Reason**, which is kept in the inspection's history. A cancelled
  inspection's responses and evidence can no longer be changed.

## Common issues

| Message or problem | What to do |
|---|---|
| "Add a note describing why this item failed." | Add notes, then save. |
| "N required checklist items have no response yet." | Answer the listed items, then complete. |
| "A finding has been raised from this item, so its response can no longer be changed." | Expected; the response is part of the finding's record. |
| "Start the inspection to record responses." | Select **Start inspection** first. |
| No templates offered | No published templates exist (drafts and retired templates are not offered). Ask an admin, or run it ad hoc. |
| "Reason is required." when cancelling | Enter why the inspection is being cancelled. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Add and link evidence](07-add-and-link-evidence.md)
- [Manage inspection and audit templates](10-manage-inspection-and-audit-templates.md)
