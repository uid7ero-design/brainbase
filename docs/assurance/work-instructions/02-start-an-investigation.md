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

**From one incident** (most common)

1. Open the incident. In the **Investigation** section select **Start
   investigation**.
2. Enter a **Title** and **What will the investigation establish?** — the
   question you are trying to answer and what is in and out of scope.
3. Optionally choose the **Lead investigator**, **Risk level** (pre-filled
   from the incident) and **Target completion**.
4. If the incident is not restricted, tick **Restricted investigation** only
   if it must be limited to you, the lead and organisation admins. (An
   investigation of a restricted incident is always restricted.)
5. Select **Start investigation**. The investigation opens, with the
   incident as its **primary** incident.

**Covering several incidents**

1. Go to **Assurance → Investigations** and select **Start investigation**
   (or use **Start one that covers several incidents** on an incident).
2. Enter a **Title** and the **Scope**.
3. Choose the **Primary incident**, or leave it as **None**, and any
   **Related incidents**. Hold Ctrl/Cmd to select several.
4. Optionally choose the **Lead investigator**, **Risk level** and **Target
   completion**, and tick **Restricted investigation** if needed (required
   when any chosen incident is restricted).
5. Select **Start investigation**.

**Then**
6. To add another incident later, on the investigation page select **Link
   another incident**. Choose the **Incident** and a **Relationship**
   (Primary, Related, Triggering or Context), then select **Link incident**.
7. Assign or change the **Lead investigator** under **Next step** if needed.
8. Progress the work with **Next step**: **Move to planning**, **Move to in
   progress**, **Move to awaiting information** and **Move to awaiting
   review**.
9. Record evidence in **Evidence gathered** and raise findings for the issues
   you identify (**Raise finding**).
10. When done, from **Awaiting review** select **Complete with conclusion**.
    Enter the **Conclusion** — the factual outcome — and submit.

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
- Completing does **not** close the linked incidents, findings or actions.
  Close those separately. Open findings do not block completion.
- While an active investigation has an incident as its primary incident,
  **Start investigation** on that incident is refused.
- A restricted incident can only be investigated by a restricted
  investigation.
- The **Target completion** date is for planning only; it never blocks
  anything.
- A completed or cancelled investigation cannot be reopened.
- The conclusion is written by people. BrainBase never infers a cause,
  blame or liability.
- Starting an investigation does not change the incident's status. Move the
  incident to **Investigation underway** yourself if appropriate.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only one incident can be the primary incident." / "This investigation already has a primary incident…" | Link the extra incident as Related, Triggering or Context. |
| "That incident is already linked." | It is already on the investigation; no action needed. |
| **Complete with conclusion** not shown | The investigation must be in **Awaiting review**. |
| An incident shows as **Restricted incident** | You can't see that restricted incident; this is expected. |
| "This incident already has an active investigation as its primary incident…" | Open the existing investigation, or link this incident to it as Related. |
| "A restricted incident can only be investigated by a restricted investigation…" | Tick **Restricted investigation**, or link a different incident. |
| "The lead was not changed: someone else changed it…" | Refresh the page and try again. |

## Related records / next steps

- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
- [Add and link evidence](07-add-and-link-evidence.md)
