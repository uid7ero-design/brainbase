# Manage risk levels

## Purpose

Maintain your organisation's risk scale: the severity levels offered when
recording incidents, investigations and findings, and used by the
dashboard's serious-incident view.

## When to use this

- Adding a new risk level.
- Renaming a level, changing its description, its rank or its
  "requires verification" setting.
- Retiring a level (deactivating it) or bringing one back (reactivating it).

## Who can do this

Only **organisation admins**. Everyone else with Assurance access can view
**Settings → Risk levels**, but sees no change controls, and the system
refuses changes from anyone who is not an admin.

## Before you start

- Agree the level's **code**, **name** and **rank**. The code cannot be
  changed later.
- Check which levels are currently **Serious**. A new rank, or a level being
  deactivated or reactivated, can change which levels count as serious.

## Steps

**Create a risk level**

1. Go to **Assurance → Settings → Risk levels**.
2. Select **Create risk level**.
3. Enter the **Code** (for example `CRITICAL`), the **Name**, an optional
   **Description** and the **Rank**.
4. Tick **Requires verification** only if you want to record that policy
   (see Important rules). Leave **Active** ticked to offer the level
   straight away.
5. Select **Create risk level**.

**Edit a risk level**

6. Select **Edit** on the level.
7. Change the **Name**, **Description**, **Rank** or **Requires
   verification**. The **Code** is shown but cannot be changed.
8. Select **Save changes**.

**Deactivate or reactivate**

9. Select **Deactivate** (or **Reactivate**) on the level.
10. Read the confirmation, then select **Deactivate** or **Reactivate**.
    (Select **Cancel** to back out; nothing changes.)

**Confirm a change to the serious levels**

11. If your change would change which levels are serious, a warning shows
    the serious levels **Before** and **After** the change. Select **Confirm
    change** to save it, or **Go back**.

## What happens next

- The list shows every level, active and inactive, from the highest rank to
  the lowest, with its **Status** and **Classification** (**Serious**,
  **Standard** or **Inactive**).
- Active levels are offered in the **Risk level** choice when recording new
  incidents, investigations and findings.
- The change appears under **Change history** on the same page.

## Important rules

- **Nothing is ever deleted.** Deactivate a level instead.
- **Existing records keep their level.** A deactivated level still shows on
  every incident, investigation and finding that uses it; it is only removed
  from the choices for new records. Nothing is reassigned.
- **The code is permanent.** It is a stable identifier and cannot be edited.
- **Ranks are unique**, including inactive levels: an inactive level still
  holds its rank. Higher ranks are more severe.
- **Serious** means one of the **two highest-ranked active** levels. Changing
  a rank, deactivating or reactivating (or creating a high-ranked level) can
  change which levels are serious, which is why the system asks you to
  confirm.
- **Requires verification** is recorded for policy/configuration purposes. It
  does not currently enforce verification automatically; verification works
  the same way at every level.
- Every change is recorded in the audit history.

## Common issues

| Message or problem | What to do |
|---|---|
| "Only organisation admins can manage risk levels." | Ask an admin. |
| "A risk level with code … already exists." | Choose a different code. |
| "Rank … is already used by …" | Choose an unused rank, or change the other level's rank first (inactive levels keep their rank). |
| "A risk level code cannot be changed after it is created." | Create a new level with the code you need and deactivate the old one. |
| "This risk level was changed by someone else." | Refresh the page, check the latest values and try again. |
| The level is missing from the Risk level choice | It is inactive. Reactivate it if it should be offered again. |

## Related records / next steps

- [Report an incident](01-report-an-incident.md)
- [Raise and manage a finding](05-raise-and-manage-a-finding.md)
