# Raise and manage a finding

## Purpose

Record an identified issue — hazard, defect, non-conformance, observation,
service failure or improvement opportunity — so it can be decided on and
acted upon.

## When to use this

When an incident, investigation, inspection item or audit criterion reveals
something that needs formal follow-up.

## Who can do this

- **Manager** access or higher raises findings and moves their status.
- Closing or cancelling also needs manager access.

## Before you start

- Open the **source record**: the incident, investigation, inspection or
  audit.
- For inspections and audits, the item or criterion must already have a saved
  response.

## Steps

**Raise**

1. On the source record, select **Raise finding**:
   - Incident or investigation: in its **Findings** section.
   - Inspection item or audit criterion: on the item itself. It is shown for
     Fail and Observation items, and for Non-compliant, Partially compliant
     and Observation criteria.
2. Choose the **Finding type**, and check the **Title** and **Description**.
   From an inspection item or audit criterion these are pre-filled:
   - Type: Defect for a failed item, Non-conformance for a non-compliant or
     partial criterion, Observation for an observation.
   - Title: the item or criterion label.
   - Description: your notes.
3. Optionally choose **Risk level**, **Responsible person** and **Resolve
   by**. Inspections and audits also offer **Responsible external
   organisation**.
4. Select **Raise finding**. The new finding opens.

**Link an existing finding to another record** (repeat issue)

5. On the incident, investigation, inspection or audit, in its **Findings**
   section select **Link existing finding**, choose the **Finding**, then
   select **Link finding**.

**Manage**

6. Use **Next step** to record where the finding is:
   - **Move to under review**
   - **Move to action required**
   - **Move to action in progress**
   - **Move to awaiting verification**
7. Add corrective work with **Add corrective action**
   (see [work instruction 06](06-create-and-manage-an-action.md)).
8. Watch the **Assurance chain** strip at the top: Source → Finding → Action
   → Evidence → Verification → Closure.
9. When the finding is resolved, select **Close finding**
   (see [work instruction 09](09-close-actions-and-findings.md)).

## What happens next

- The finding starts as **Open**, with an `FND-…` reference.
- Its **Source** links back to where it came from. For inspection items and
  audit criteria, the exact item is recorded, and that response becomes
  locked.

## Important rules

- One source per finding at the time it is raised; further sources are
  added with **Link existing finding**. Linking changes no statuses.
- Only open findings can be linked, and only to open records.
- A finding visible to everyone cannot be linked to a restricted incident or
  investigation (it would become hidden). Raise a new finding there instead.
- Findings cannot be raised from a closed, completed or cancelled incident or
  investigation, or from a cancelled inspection or audit.
- **Resolve by** cannot be in the past.
- Finding statuses are manual. Creating, verifying or closing actions does
  not move the finding.
- **Risk level** is the finding's severity measure.
- Closing is refused while any linked action is still open.

## Common issues

| Message or problem | What to do |
|---|---|
| "Findings cannot be raised from a closed, completed or cancelled record." | Raise it from an open source, or record the issue on a new incident. |
| "That checklist item has no recorded response on this inspection." | Save the item's response first. |
| **Raise finding** not shown on an item | The outcome is Pass or N/A (or Compliant), or you lack manager access. |
| No "new finding" button on the Findings register | Findings are raised from their source record. |
| "That finding is already linked to this …" | It is already linked; no action needed. |
| "…Linking it to a restricted … would hide it…" | Raise a new finding from the restricted record. |
| **Link existing finding** not shown | No open findings are available to link, the record is finished, or you have viewer access. |

## Related records / next steps

- [Create and manage an action](06-create-and-manage-an-action.md)
- [Add and link evidence](07-add-and-link-evidence.md)
- [Close actions and findings](09-close-actions-and-findings.md)
