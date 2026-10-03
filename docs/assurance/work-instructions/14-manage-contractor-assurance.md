# Manage contractor assurance

## Purpose

Record what your organisation requires of an external organisation (for
example insurance, a licence or an accreditation), the evidence it has
supplied, and whether that evidence is current.

## When to use this

- A contractor, supplier or other external organisation needs to be
  assured before or while it works for your organisation.
- Evidence (a certificate, licence or policy document) has been supplied or
  renewed.
- Evidence is awaiting review, expiring or expired.

## Who can do this

- **Organisation admins** maintain the requirement library.
- **Managers and admins** bring organisations into scope, assign
  requirements, record evidence, accept or reject evidence, and raise
  findings.
- **Viewers** can see everything but change nothing.

## Before you start

- The external organisation must exist as an active shared record under
  **Settings → Reference data → External organisations**.
- The requirement must exist in the **Requirement library** (ask an admin).

## Steps

**Add a requirement to the library** (admins)

1. Go to **Assurance → Contractor assurance**, then **Requirement library**.
2. Select **New requirement**.
3. Enter a **Code**, **Name** and **Category**, and optionally a description
   and evidence guidance.
4. Tick **Evidence must have an expiry date** if it must.
5. Optionally enter a **Renewal notice** in days. Evidence expiring within
   that period is shown as **Expiring soon**; leave it blank for none.
6. Select **Create requirement**.

**Bring an organisation into scope**

7. On **Contractor assurance**, select **Add organisation to Assurance
   scope**, choose the organisation, optionally a responsible person, then
   **Add to scope**.

**Assign a requirement**

8. Open the organisation, select **Assign a requirement**, choose the
   requirement, optionally an evidence due date and reviewer, then
   **Assign requirement**.

**Record evidence**

9. Under the requirement, select **Record evidence**.
10. Enter a **Title**, where the document is held, **Supplied on**, and the
    effective and expiry dates. Then select **Record evidence**. It now
    shows under **Awaiting review**.

**Accept or reject evidence** (someone other than the recorder)

11. Under **Awaiting review**, select **Accept or reject**.
12. Choose **Accept**, or **Reject** with a reason, then **Record decision**.

**When evidence is replaced**

13. Record the new evidence and have it accepted. The previous evidence
    becomes **superseded** and stays in **Evidence history**.

**Raise a finding** (only for a genuine issue)

14. Select **Raise finding** under the requirement, enter the details and
    select **Raise finding**. Create any actions from the finding as usual.

## What happens next

- The organisation's status updates from the facts: expired, missing,
  awaiting review, expiring soon or current.
- Every step is recorded in the organisation's **History**.

## Important rules

- Scope is separate from relationship roles. A contractor is not in scope
  until someone brings it into scope.
- The person who recorded evidence cannot accept or reject it.
- Evidence for a requirement that needs an expiry date cannot be accepted
  without one.
- Evidence is assessed against the requirement as it stood when the evidence
  was recorded. If the requirement changes later, the page shows both.
- Nothing is deleted:
  - Rejected, withdrawn and superseded evidence stays in the history.
  - Cancelling an assignment keeps its history.
  - Deactivating a requirement only stops new assignments.
- Missing, expired or rejected evidence never creates a finding, action or
  any consequence by itself.
- There is no file upload: record where the original document is held.

## Common issues

| Message or problem | What to do |
|---|---|
| "You recorded this evidence, so someone else must accept or reject it." | Ask another manager or admin to decide. |
| "This requirement needs an expiry date before evidence can be accepted" | Reject it with that reason, and record the evidence again with its expiry date. |
| "External organisation is not in Assurance scope." | Bring the organisation back into scope first. |
| "Requirement is not active." | Ask an admin to reactivate the requirement, or choose another. |
| "This requirement is already assigned to this organisation." | Use the existing assignment, or cancel it first. |
| "Someone else changed this since you opened it." | Reload the page and try again. |
| The organisation is not in the list to add | It must be an active external organisation under Settings → Reference data. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Create and manage an action](06-create-and-manage-an-action.md)
