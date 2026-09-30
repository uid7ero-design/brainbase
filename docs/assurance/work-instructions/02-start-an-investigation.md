# Start an investigation

## Purpose

Examine one or more incidents to establish what happened and why, and
record a conclusion.

## When to use this

When triage decides an incident (or a group of related incidents) needs a
structured examination.

## Who can do this

- **Manager** access or higher starts an investigation and moves its
  status.
- Completing or cancelling also needs manager access.

## Before you start

- Know which incident is the **primary** incident, if any, and which others
  are related.
- Agree the scope and, ideally, a lead investigator and target date.

## Steps

1. Choose where to start:
   - From an incident: open it, and in **Investigations** select **Start
     investigation**. That incident is pre-selected as the **Primary
     incident**.
   - Or go to **Assurance → Investigations** and select **Start
     investigation**.
2. Enter a **Title** and the **Scope**: what will and will not be examined.
3. Check the **Primary incident**, or leave it as **None**.
4. Select any **Related incidents**. Hold Ctrl/Cmd to select several.
5. Optionally choose the **Lead investigator**, **Risk level** and **Target
   completion**.
6. Tick **Restricted investigation** only if it must be limited to you, the
   lead and organisation admins.
7. Select **Start investigation**.
8. To add another incident later, on the investigation page select **Link
   another incident**. Choose the **Incident** and a **Relationship**
   (Primary, Related, Triggering or Context), then select **Link incident**.
9. Progress the work with **Next step**: **Move to planning**, **Move to in
   progress**, **Move to awaiting information** and **Move to awaiting
   review**.
10. When done, from **Awaiting review** select **Complete with conclusion**.
    Enter the **Conclusion** and submit.

## What happens next

- The investigation starts as **Open**, with an `INV-…` reference.
- Raise findings from it with **Raise finding**
  (see [work instruction 05](05-raise-and-manage-a-finding.md)).
- Completing records the conclusion, who completed it and when.

## Important rules

- An investigation can have only **one primary incident**.
- One incident can be part of several investigations. The **Also in** column
  shows this.
- Links are permanent history. Incidents cannot be linked after completion or
  cancellation.
- Completing does **not** close the linked incidents or any findings. Close
  those separately.
- Starting an investigation does not change the incident's status. Move the
  incident to **Investigation underway** yourself if appropriate.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only one incident can be the primary incident." / "This investigation already has a primary incident…" | Link the extra incident as Related, Triggering or Context. |
| "That incident is already linked." | It is already on the investigation; no action needed. |
| **Complete with conclusion** not shown | The investigation must be in **Awaiting review**. |
| An incident shows as **Restricted incident** | You can't see that restricted incident; this is expected. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Add and link evidence](07-add-and-link-evidence.md)
