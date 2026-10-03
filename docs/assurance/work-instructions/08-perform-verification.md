# Perform verification

## Purpose

Independently confirm whether an action's corrective work genuinely resolved
the issue.

## When to use this

When an action is **Awaiting verification**. These appear in **Assurance →
Verification**, and in **Awaiting verification** on the Dashboard.

## Who can do this

Users with **manager** access or higher who are **independent** of the
action. You cannot verify if you:

- own the action; or
- have ever marked its work complete.

## Before you start

- Review the action, the finding it addresses and its linked evidence.
- Where practical, check the work yourself.

## Steps

1. Go to **Assurance → Verification**. In **Awaiting verification**, check
   the **You can verify** column (**Yes** or **Not independent**).
2. Open the action.
3. In **Next step** select **Record verification**.
4. Choose the **Result**:
   - **Accepted** — the work resolved the issue.
   - **Partially accepted** or **Rejected** — more work is needed.
   - **More evidence required** — the proof is insufficient.
   - **N/A** — verification does not apply.
5. Enter **Notes**. These are required for every result except Accepted.
6. Optionally select the **Evidence relied on**.
7. Select **Record verification**.

## What happens next

| Result | Action becomes |
|---|---|
| Accepted / N/A | Still **Awaiting verification**, but ready to close |
| Rejected / Partially accepted | **In progress** — the owner redoes the work and marks it complete again |
| More evidence required | **Awaiting evidence** — evidence must be linked and resubmitted |

The attempt is added to **Verification history** and to **Recent
verification decisions**.

## Important rules

- Verification **never** closes the action. Closure is a separate step
  ([work instruction 09](09-close-actions-and-findings.md)).
- Verification history is permanent. Each check is a new numbered attempt.
- Once an Accepted (or N/A) result exists, no further attempts can be
  recorded.
- Evidence chosen as **Evidence relied on** becomes part of the verification
  record and cannot be removed.

## Common issues

| Message or problem | What to do |
|---|---|
| "You own this action or completed its work, so you cannot verify it." | Ask another manager to verify. |
| "Explain the verification result in the notes." | Add notes. |
| "This action has already been verified…" | Close the action instead. |
| **Record verification** not shown | The action is not awaiting verification, you are not independent, or you have viewer access. |

## Related records / next steps

- [Close actions and findings](09-close-actions-and-findings.md)
- [Verify and replace evidence](15-verify-and-replace-evidence.md) — accepting
  or rejecting an individual piece of evidence is a separate decision.
- [Create and manage an action](06-create-and-manage-an-action.md)
