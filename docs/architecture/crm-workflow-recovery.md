# CRM workflow recovery bundle

## Problem and resulting behaviour

CRM lists previously treated failed reads like empty results or retained old data, and writes could leave a drawer stuck or report a deletion as complete despite rejection. The pipeline sent a full-record update for stage changes, risking replacement of unrelated fields. Subscription checks alone did not impose a writer-role ceiling or verify that linked records belonged to the current organisation.

This bundle adds explicit read failure/retry states to companies, contacts, deals and activities, including company/contact detail. Old rows and history are hidden while a new scope or refresh is unconfirmed. Saves and deletes report completion only after an acknowledged response. Network failures, server failures and malformed success responses hold a session-local recovery lock across drawer dismissal and reload. Recovery reads saved records; it never automatically repeats the write. A stage move uses a stage-only PATCH. Writers must be manager, admin or super admin, retain the CRM entitlement, and reference same-organisation records and active assignees. Related display names are also organisation-scoped.

## Reconciliation with PR #472

PR #472 (`fix/crm-contact-duplicate-prevention`) remains separate. Its identity locks span CRM and Events; its contact routes also reject duplicate email. A shared family mailbox policy remains unresolved, so this bundle does not import that rejection or claim duplicate identity prevention. Both branches touch contact route preflight and legacy schema/classification tests. Preserve both the access/link checks here and the chosen identity-lock semantics when combining them. No Events synchronisation or duplicate-email policy is changed here.

## Operator walkthrough

1. Open CRM and choose Contacts, Companies, Deals or Activities. Use the existing search and contact classification filters.
2. If a read fails, use **Refresh saved records** (or **Refresh saved record** on a detail page). A failed read is not evidence that the organisation has no records.
3. Create or edit through the existing drawer. A confirmed save closes it and reloads saved data.
4. If a result cannot be confirmed, do not repeat the change. Choose **Review saved records**, inspect the refreshed list/history, and only then decide whether a new change is needed. A failed review keeps the action locked. Dismissing the drawer does not discard the lock.
5. Move a deal through the pipeline using its stage control. This changes stage only. Deletion is shown as complete only after an acknowledged response.
6. Read-only users may browse with current CRM access; the server refuses writes even if a stale screen still offers a control. Revoked module access refuses fresh reads as well.

## Verification receipts

- CRM regression and component suite: 348 passed, 15 skipped (environment-dependent integration checks); 9 component checks included.
- Owned disposable Postgres: 12 actual-route checks covering same-tenant links, foreign roots/links, active assignees, writer roles, anonymous/entitlement denial, stage preservation and legacy display-name containment.
- Production-mode browser proof: real local login, real Next HTTP routes and repository schema in owned disposable Postgres. External fetch/SDK egress is blocked. Contact create and deal delete deliberately commit then lose their HTTP response; recovery must not repeat writes. Includes filter read failure, deal save, viewer denial, access revocation and narrow-screen rendering.
- Changed-file lint, TypeScript and optimized build are required before review readiness.

## Limits and release boundary

All records/accounts are synthetic. This is not production/provider acceptance or a certification of all concurrent edit/deletion/revocation races. Link validation and mutation are separate SQL statements; no new database constraints or migrations are introduced. Session storage holds only a per-collection pending/unknown marker, never drafts or personal data. It is a conservative browser-session guard, not server idempotency or exactly-once delivery. A fresh list can be incomplete (for example, paged activities); review is a deliberate reconciliation step, not proof that an unknown request never committed. Gmail import acknowledgement is guarded, but no live Gmail provider was exercised.

Production merge/deployment is outside this bundle's authority. Existing HR evidence and unrelated work are preserved.

