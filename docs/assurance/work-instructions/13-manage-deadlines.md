# Manage deadlines, extensions and escalations

## Purpose

Keep track of the due dates set on findings and actions, ask for more time
in a controlled way, and flag a deadline that needs elevated attention.

A **deadline** (timeframe) exists only where someone entered a due date on a
finding or an action when it was created:

- a finding's due date is its **closure deadline**;
- an action's due date is its **action deadline**.

There are no organisation-wide deadline rules.

## When to use this

- Seeing what is overdue or due soon across your organisation.
- Asking for a later due date (an **extension**).
- Approving or rejecting someone else's extension request.
- Escalating a deadline, and acknowledging, resolving or cancelling an
  escalation.

## Who can do this

| Task | Who |
|---|---|
| View deadlines | Everyone with Assurance access (restricted records stay hidden as usual) |
| Request or withdraw an extension | Managers and admins (withdraw: the person who asked, or an admin) |
| Approve or reject an extension | **Organisation admins** — never for their own request |
| Escalate, acknowledge, resolve, cancel an escalation | Managers and admins |

## Before you start

- The **original due date** never changes. An approved extension changes the
  **effective due date** only.
- An extension must move the deadline **later**, and into the future.
- Only one extension request can wait for a decision at a time.

## Steps

**See your deadlines**

1. Go to **Assurance → Deadlines**.
2. Use the views: **Open**, **Overdue**, **Due soon**, **Awaiting
   decision**, **Extended**, **Escalated** or **All**. Filter by findings or
   actions, deadline type, or search.
3. Select a record to open its **Deadline** section.

**Request an extension**

4. On the finding or action, in **Deadline**, select **Request extension**.
5. Choose the **New due date** (due at the end of that day) and give a
   **Reason**.
6. Select **Request extension**. The effective due date does not change yet.

**Decide an extension (organisation admins)**

7. In **Deadline**, the request shows the current and requested dates, who
   asked and why.
8. Select **Approve** (optionally choose a different later date, and add
   notes) or **Reject** (a reason is required).

**Withdraw a request**

9. Select **Withdraw request**, then confirm.

**Escalate**

10. In **Deadline**, select **Escalate**. Choose a **level** (Level 1–5),
    give a **Reason**, and optionally assign someone.
11. Later, select **Acknowledge** when someone picks it up, then **Resolve**
    when the attention is no longer needed. **Cancel escalation** (with a
    reason) if it was raised in error.

## What happens next

- **Approved:** the effective due date moves to the approved date. The
  original due date, the request and the decision stay in **Extension
  history**.
- **Rejected or withdrawn:** the due date is unchanged; the request stays in
  the history.
- Escalations stay listed with their status, who raised, acknowledged and
  resolved them, and when.
- Every change is recorded in the audit history.

## Important rules

- **Overdue** and **due soon** are worked out from the effective due date:
  overdue once it has passed, due soon within the next 3 days (the same rule
  as the dashboard). Nothing needs to run in the background.
- Once the finding or action is **closed or cancelled**, its deadline is
  finished: it cannot be extended or escalated.
- **Escalation levels are just numbers.** Your organisation has not given
  them a meaning (such as a job title); Level 1 is simply the first level.
- **An escalation is not blame.** It flags that a deadline needs elevated
  attention.
- **Resolving an escalation does not finish the work.** It does not close the
  finding or action, does not meet the deadline and does not change the due
  date. Closure is still the explicit **Close** step.
- **Approving an extension does not complete work** either.
- A due date can only be set when the finding or action is created; a record
  created without one shows **No due date**.

## Common issues

| Message or problem | What to do |
|---|---|
| "The new due date must be later than the current due date." | Choose a later date. |
| "An extension request is already waiting for a decision on this deadline." | Wait for the decision, or withdraw the existing request. |
| "You cannot decide your own extension request." | Ask another organisation admin. |
| "The deadline has changed since this request was made." | Reject the old request and ask for a new one. |
| "This deadline is no longer open…" | The record was closed or cancelled; nothing more to do. |
| "This escalation was updated by someone else." | Refresh and check its current status. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Create and manage an action](06-create-and-manage-an-action.md)
- [Close actions and findings](09-close-actions-and-findings.md)
