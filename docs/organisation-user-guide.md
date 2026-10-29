# Managing your organisation's users

This guide describes the new organisation-user administration bundle. It becomes available after its schema and application release have been approved and deployed.

## Start here

Open **Manage → Organisation users**, or `/settings/users`. You need an organisation administrator account. The BrainBase platform administrator establishes the first administrator for your organisation; you cannot turn an ordinary account into an administrator yourself.

This screen manages your own organisation only. Platform super administrators, other organisations and subscription settings are not available to client administrators.

## Invite a colleague

1. Choose **Invite user**.
2. Enter their name and email address. Their email becomes their username.
3. Choose a role: **Viewer**, **Manager** or **Organisation administrator**.
4. Choose access for each enabled supported module:
   - **No access** — cannot open or call that module's staff APIs.
   - **View only** — can make permitted reads, but module writes are blocked.
   - **Use module (within role)** — can perform the actions that their role and existing record permissions allow.
5. Select **Create and send invitation**.

New users start with no module access. The email invitation lets them choose their own password, with at least 12 characters. Links expire after 48 hours and work once. Administrators do not see or set the invited person's password.

An organisation administrator can manage organisation users even when no business module has been selected. Assign that role only to someone trusted to administer colleagues' accounts.

## Roles and module permissions work together

The role is a ceiling, not a way around module controls. A Viewer with “Use module” does not acquire Manager or administrator actions. “View only” can prevent a task completion or document acknowledgement because these save records. Select “Use module” if the employee needs those actions, while keeping the appropriate role.

Existing rules still apply: HR administrator grants, restricted-case reader grants, linked employee accounts, manager relationships, lifecycle task visibility, and approvals remain separate. Giving People access does not make somebody an HR administrator or give them restricted-case access.

Only modules enabled for your organisation and supported by this permission editor appear. You cannot use this screen to buy, enable or expand subscriptions. Managed accounts cannot use unclassified legacy areas; their home page is **My workspace**, which links to their permitted modules. Ask the platform administrator if your organisation needs an area that is not offered.

## Change or remove access

Choose **Edit access for [name]**, adjust the role, module choices or account status, then **Save access**. Choose **Inactive** to block the account's authenticated access without deleting its history. Existing sessions are checked against current account status and current module access on subsequent protected requests.

For existing accounts, the screen identifies previously inherited module access. Saving switches that account to the explicit module choices displayed. Untouched existing accounts retain their old permissions. An administrator cannot edit their own access in this screen, and the last active organisation administrator cannot be removed by a concurrent demotion/deactivation. Ask another administrator to change your own account.

Email/username changes and platform-level account transfers are deliberately not included in this screen. Ask platform support when those are required.

## Invitation problems

- **Invitation sent:** the configured email provider accepted it. Check the recipient's inbox and spam folder if needed.
- **Email delivery is unconfirmed:** the account was saved, but delivery was not confirmed. Refresh the list first. Use **Send new invitation** only when you intend to send another email; this replaces the old link.
- **Expired/used link:** ask your administrator for a new invitation. An inactive invited account must be intentionally reactivated before it can accept an invitation.
- **Unknown save result:** do not submit again. Choose **Refresh users**, inspect the saved account, and decide whether another change is necessary. The original request may have committed.

Invitations and deliberate resends are limited to 20 per organisation per hour. Contact support if a legitimate bulk onboarding needs a different arrangement.

## Linking someone to HR

An invitation creates a BrainBase login account, not an HR employee record. After creating the employee record in **People**, an authorized HR administrator can select this account under **Linked BrainBase Account**. The explicit link connects the login to the person's permitted HR information and tasks.
