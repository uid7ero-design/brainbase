# Close actions and findings

## Purpose

Formally close the corrective work, then the finding, then the source
incident. Each is a separate, explicit decision.

## When to use this

- An **action**, once its work is complete and its evidence and verification
  requirements are met.
- A **finding**, once every linked action is closed or cancelled.
- An **incident**, once its findings and investigations are resolved.

## Who can do this

Users with **manager** access or higher.

## Before you start

Nothing closes automatically. Check the **Assurance chain** strip on the
finding or action, which shows what is done and what is blocked.

## Steps

**Close the action**

1. Open the action.
2. If the **Before this action can be closed** box is shown, resolve each
   item:
   - work marked complete;
   - evidence linked;
   - an accepted verification recorded.
3. Select **Close action**.

**Close the finding**

4. Open the finding, from the action's **Findings addressed** section.
5. Check that every linked action in **Corrective actions** is Closed or
   Cancelled.
6. Optionally move the finding to **Awaiting verification** first. It can
   be closed from **Under review** or **Awaiting verification**.
7. Check the **Closure readiness** box says nothing prevents closure.
8. Select **Close finding**, enter the **Closure reason** — why the issue is
   resolved — and submit.

**Close the incident** (if the finding came from one)

9. Open the incident. Check that its findings are closed or cancelled and its
   investigations are completed or cancelled.
10. Move it to **Awaiting verification**, if it is not already there, or
   close it directly from **Under review**.
11. Select **Close incident**, enter the **Closure summary**, and submit.

**Cancel instead of closing** (work no longer needed)

- Actions: **Cancel action**, with a **Reason**.
- Findings: **Cancel finding**, with a **Cancellation reason**. A cancelled
  finding cannot be reopened.
- Incidents: **Cancel incident**, from Reported, Under review or
  Investigation required.

## What happens next

- Each record shows **Closed**, with who closed it and when, in **History**.
- Evidence on a closed action or finding is frozen.
- Closing an action does **not** close its finding. Closing a finding does
  **not** close its actions or change its source records.
- The finding shows a **Closure record** with the reason. Findings closed
  before reasons were captured show **No reason recorded**.
- If the issue comes back, reopen the finding
  (see [work instruction 16](16-reopen-a-finding.md)). Closed actions are
  never reopened.

## Important rules

| Record | Closure is refused while… |
|---|---|
| Action | work not marked complete; required evidence missing; required verification not accepted |
| Finding | any linked action is still open; a closure reason is required |
| Incident | any linked finding is open, or any linked investigation is active; a closure summary is required |

- Investigations are finished with **Complete with conclusion**, not closed.
  Completing them does not close incidents.
- Inspections and audits are completed, not closed. They never close
  findings.

## Common issues

| Message or problem | What to do |
|---|---|
| "This action cannot be closed yet…" | Resolve the listed blockers. |
| "This finding cannot be closed yet: one or more linked actions are still open." | Close or cancel the actions first. Some may be hidden from you if restricted; ask an admin. |
| "This incident cannot be closed yet: linked findings or investigations are still open." | Close the findings and complete the investigations first. |
| **Close finding** not shown | The finding is not in Under review or Awaiting verification. Move it there first. |
| "Closure reason is required." | Enter why the finding is resolved. |

## Related records / next steps

- [Perform verification](08-perform-verification.md)
- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
