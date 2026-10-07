# Reopen a finding and add follow-up work

## Purpose

Bring a closed finding back under review when the issue has come back or
the closure turns out to be premature, and record the further corrective
work, without rewriting what happened before.

## When to use this

- A closed issue has recurred — for example the same defect is found again.
- New information shows the closure reason was wrong or incomplete.

If it is a **different** issue, raise a new finding instead. A **cancelled**
finding cannot be reopened; raise a new finding.

## Who can do this

- **Managers and admins** reopen and close findings.
- **Managers and admins** create the follow-up action
  (see [work instruction 06](06-create-and-manage-an-action.md)).
- **Viewers** can see the reopen history but change nothing.

## Before you start

- The finding must be **Closed**.
- Know why you are reopening it. The reason is kept permanently.

## Steps

**Reopen**

1. Open the finding. Under **Next step** select **Reopen finding**.
2. Enter the **Reopen reason** — what has happened since it was closed.
3. Select **Reopen finding**. The finding returns to **Under review**.

**Add follow-up work**

4. In **Corrective actions** select **Create action** and describe the
   follow-up work. The earlier, closed actions stay listed as they are.
5. Take the new action through work, evidence, verification and closure as
   usual (see [work instruction 06](06-create-and-manage-an-action.md) and
   [work instruction 08](08-perform-verification.md)).

**Check the deadline**

6. Look at the finding's **Deadline** section. Reopening does not change the
   resolve-by date. If it has passed, the finding shows as **overdue**:
   request an extension there if more time is needed
   (see [work instruction 13](13-manage-deadlines.md)).

**Close again**

7. When the **Closure readiness** box says nothing prevents closure, select
   **Close finding** and enter a **new Closure reason**.

## What happens next

- **Reopen history** lists every reopen: when, by whom and why, with the
  previous closure — who closed it, when and the closure reason. It cannot be
  edited or deleted.
- **History** shows the closure, the reopen and the later closure as
  separate events.
- The Findings register shows **Reopened** next to the status.

## Important rules

- Only **Closed** findings can be reopened, and always to **Under review**.
- Reopening never reopens an action, the source incident, investigation,
  inspection or audit, or contractor records, and never changes evidence
  decisions, verifications or risk.
- Reopening never creates, resets or extends a deadline.
- **Actions are never reopened.** Follow-up work is always a new action on
  the same finding, so earlier verification history stays intact.
- A finding closed before closure reasons were captured shows **No reason
  recorded** in its reopen history. No reason is made up.
- If two people reopen the same finding at once, only one succeeds; the
  other is told it has already been reopened.

## Common issues

| Message or problem | What to do |
|---|---|
| **Reopen finding** not shown | The finding is not Closed, or you have viewer access. |
| "Reopen reason is required." | Enter why you are reopening it. |
| "A cancelled finding cannot be reopened. Raise a new finding instead." | Raise a new finding from the source record. |
| "This finding has already been reopened (or changed) by someone else…" | Refresh the page to see its current state. |
| The finding shows as overdue straight after reopening | The original resolve-by date has passed. Request an extension in its **Deadline** section. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Close actions and findings](09-close-actions-and-findings.md)
- [Manage deadlines, extensions and escalations](13-manage-deadlines.md)
