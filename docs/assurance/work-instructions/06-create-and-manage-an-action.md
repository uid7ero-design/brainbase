# Create and manage an action

## Purpose

Plan and track the corrective work that responds to a finding, through to
verified closure.

## When to use this

Whenever a finding needs something done: an immediate control, corrective,
preventative or remedial work, an improvement, follow-up or monitoring.

## Who can do this

- **Manager** access or higher creates actions, starts work, marks work
  complete and submits for verification.
- Verification needs an **independent** manager or higher
  (see [work instruction 08](08-perform-verification.md)).
- Closing and cancelling need manager access.

## Before you start

- The finding must be **open**: not closed or cancelled.
- Agree the owner, priority and due date.
- Decide whether evidence and independent verification should be required.
  Both are on by default.

## Steps

**Create**

1. Open the finding. In **Corrective actions** select **Add corrective
   action**.
2. Choose the **Action type**, and enter a **Title** and **What needs to be
   done**.
3. Set the **Priority**, **Owner**, **Contractor / external organisation**
   (optional) and **Due**.
4. Leave **Evidence required before closure** and **Independent
   verification required before closure** ticked unless there is a good
   reason not to.
5. Select **Create action**. The action opens.

**Progress**

6. Select **Start work** when work begins (Open → In progress).
7. Record proof in the action's **Evidence** section with **Add evidence**
   (see [work instruction 07](07-add-and-link-evidence.md)).
8. When the work is done, select **Mark work complete**.
9. If the action went to **Awaiting evidence**, link evidence, then select
   **Submit for verification**.
10. Optionally, if Organiser is enabled, use **Link Organiser task** to
    connect the day-to-day task.

## What happens next

After **Mark work complete** the action moves to:

- **Awaiting evidence**, if evidence is required and none is linked;
- **Awaiting verification**, if verification is required;
- otherwise it stays **In progress**, with the work recorded as complete.

An independent verifier then records a result
([work instruction 08](08-perform-verification.md)). Then the action is
closed ([work instruction 09](09-close-actions-and-findings.md)).

If verification sends the work back (**In progress**), redo it, then select
**Mark work complete again**.

## Important rules

- Every action is linked to at least one finding.
- **Due** cannot be in the past.
- Work complete ≠ verified ≠ closed. Each is a separate step.
- If you mark the work complete, you cannot verify this action, and the
  owner cannot either.
- The **Before this action can be closed** box lists what is still missing.
- Completing a linked Organiser task never completes, verifies or closes the
  action.
- **Cancel action** needs a **Reason**.

## Common issues

| Message or problem | What to do |
|---|---|
| "Actions cannot be added to a closed or cancelled finding." | Use an open finding. |
| "Link at least one piece of evidence first." | Add evidence, then **Submit for verification**. |
| "Work is already marked complete. The action is ready to close." | Proceed to closure. |
| **Link Organiser task** not shown | Organiser is not enabled, there are no tasks to link, or the action is finished. |
| Deadline needs extending | Not yet possible in the UI (an action's due date and description cannot be edited after creation). Agree the new date with the finding's responsible person and raise it with your admin. |

## Related records / next steps

- [Add and link evidence](07-add-and-link-evidence.md)
- [Perform verification](08-perform-verification.md)
- [Close actions and findings](09-close-actions-and-findings.md)
