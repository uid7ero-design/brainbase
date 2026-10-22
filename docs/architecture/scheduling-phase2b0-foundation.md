# Scheduling Phase 2B.0: capability, CRM link and test-organisation definition (2026-10-22)

Read with `scheduling-phase2b-plan.md` (section 2B.0), `scheduling-phase2a-migration-package.md` and
`scheduling-release-checklist.md`. Status: **built and proven on disposable Postgres; applied nowhere.** Nothing here
enables Scheduling for any organisation, creates a customer record, touches LD Tennis or adds a route.

## 1. What 2B.0 delivers

| Item | Where | State |
| --- | --- | --- |
| Capability registration (`scheduling`, active, no entitlement for anyone) | `scripts/scheduling/120_brainbase_capability.sql`, rollback `191_...` | Staged, not applied |
| CRM find-or-create host function | `scripts/scheduling/130_brainbase_crm_link.sql`, rollback `192_...` | Staged, not applied |
| Internal test organisation: create, enable, remove | `scripts/scheduling/manual/internal-test-org-{1-create,2-enable-capability,9-remove}.sql` | Defined and proven on a disposable database; **never run** |
| Fail-closed access gate (session, capability, role) | `lib/scheduling/access.ts` | Nothing imports it |
| Typed wrapper over the CRM function | `lib/scheduling/crmLink.ts` | Nothing imports it |
| Proofs | `tests/containment/scheduling{Access,CrmLink,Phase2b0Containment}.test.ts`, `scripts/tests/schedulingHost2b0.integration.test.ts`, `scripts/tests/verify-scheduling-phase2b0.sh` | Green |

Out of scope and not started: routes, pages, navigation, `lib/scheduling/runtime.ts`, the reduced `viewer` read shape
(2B.1); configuration screens (2B.2); everything after. The access gate is the only slice of 2B.1 pulled forward,
because 2B.0 asks for fail-closed capability and role checks; it returns no scheduling data and has no caller.

## 2. Reconciliation: what the code and database actually say

| Finding | Consequence |
| --- | --- |
| `crm_contacts` has no normalised-email column and no unique email index (it has `(id, organisation_id)` unique, `idx_crm_contacts_org`, a classification check that allows `LEAD`) | Match is `lower(btrim(email))` within the organisation, the same rule as `lib/crm/eventSync.ts`. No CRM schema change. Existing duplicates are possible: the function returns the oldest and merges nothing |
| The Events sync takes `pg_advisory_xact_lock(hashtext(org), hashtext('email:' \|\| normalised email))` | 130 takes the **identical key**, so a scheduling booking and an Events purchase for the same person serialise against each other. Proved with a lock held by a simulated Events transaction |
| The Phase 1 adapter documented customers as the LD Tennis `contacts` table | Corrected to `crm_contacts` (approved decision 3). `contactToCustomerRef` for `contacts` is untouched |
| `OrgSession` carries no timezone | The gate's tenant uses the platform fallback (Australia/Adelaide); reading `organisations.timezone` stays a 2B.2 job |
| The capability toggle UI lists every `modules` row | After 120 is applied a "Scheduling & Bookings" switch appears for super_admins, off for every organisation. That is the intended enabling path later |
| `users.id`, `organisations.id` and `organisation_modules.*` are TEXT | The function takes `p_created_by text` and `p_organisation_id text` |
| Production already holds test-like organisations ("School Test Organisation", "BrainBase C7 Production Smoke ...") | Neither is reused; the plan's dedicated organisation is a new, clearly named row |
| `btrim()` strips only spaces; the CRM API uses JavaScript `trim()` | 130 trims all whitespace (including tabs, newlines, no-break space) so a name of only tabs is blank, as in the API |

Existing pins changed deliberately (each says so in its comment): the exact file list of `scripts/scheduling`
(`schedulingPhase2aContainment`), the one exempt reference to the host function name in `lib/scheduling/crmLink.ts`
(same file), and the exemption of the disposable-Postgres suite from the "no `scheduling_*` outside" scan
(`schedulingPhase1Containment`).

## 3. Design decisions (flagged for review)

1. **`modules.active = true` at registration**, as the approved plan states. "Disabled by default" is delivered by
   the absence of any `organisation_modules` row. Registering with `active = false` instead would add a second lock
   (flipping it on becomes a separate step); it is a one-word change if you prefer it.
2. **An email is required to find or create a contact.** Without one there is no stable identity to match on, so every
   call would mint another duplicate. A customer with no email is saved unlinked ("No CRM contact"), as are walk-ins.
3. **Creation needs structured first and last names, and the function raises (SQLSTATE `SCCNM`) rather than default.**
   The TypeScript wrapper turns that into `{ kind: 'unlinked', reason: 'names_required' }`, so a booking is never
   blocked by a missing surname. The wrapper has no display-name parameter at all: a display name cannot be split,
   derived or substituted because it never reaches this code.
4. **An email match never needs names and never edits the contact** (names, phone, classification, notes untouched).
5. **A new contact is `LEAD`**, `created_by` is the acting user (or NULL), `notes` and every other column are left empty.
6. **The host function is named `brainbase_scheduling_find_or_create_contact`**, deliberately outside the `scheduling_`
   prefix, so the 2A inventory checks (`020_verify.sql`) and the per-kind fingerprints are unchanged. Proved: the four
   definition hashes are identical with and without 120/130.
7. **Markers** `2b.0-capability` and `2b.0-crm-link` are written to `scheduling_schema_migrations` (as 110 does) and
   removed by the rollbacks.

## 4. Manual handoff (nothing below has been run)

Same discipline as 2A: Neon SQL Editor, **owner-run**, Preview branch first, a fresh backup branch of Production before
any Production step, and a separate approval for Production. Each file is a single `BEGIN ... COMMIT` with
`lock_timeout = 5s`. Apply in this order, after 2A (`010` and `110`) is present.

| Stage | File | Expected result | Stop if |
| --- | --- | --- | --- |
| P0 | read-only | `SELECT count(*) FROM modules WHERE key='scheduling'` = 0; `SELECT proname FROM pg_proc WHERE proname='brainbase_scheduling_find_or_create_contact'` = 0 rows; `scheduling_schema_migrations` holds `2a.1-brainbase`, `2a.2` | any row already exists |
| P1 | `120_brainbase_capability.sql` | no error, ends in `COMMIT` | any error |
| V1 | read-only | `modules` has `scheduling`, `active = true`; `SELECT count(*) FROM organisation_modules WHERE module_key='scheduling'` = 0; marker `2b.0-capability` | any entitlement row, `active` false |
| P2 | `130_brainbase_crm_link.sql` | no error, ends in `COMMIT` | any error |
| V2 | read-only | exactly one function `brainbase_scheduling_find_or_create_contact`, 6 arguments; marker `2b.0-crm-link`; public functions +1 versus before; tables and triggers unchanged; the four per-kind hashes from `scheduling-phase2a-evidence/preview-schema-record.txt` unchanged | any difference |

**Do not call the function on Production** to verify it: it would create a customer record. On Preview, verify with a
transaction that you roll back:

```sql
BEGIN;
SELECT * FROM brainbase_scheduling_find_or_create_contact('<a Preview organisation id>', 'rehearsal@example.test', 'Re', 'Hearsal');
-- expect one row, outcome 'created'; a second identical call in the same transaction returns 'matched'
ROLLBACK;
```

**Rollback**: `192_brainbase_crm_link_rollback.sql`, then `191_brainbase_capability_rollback.sql` (refuses while any
entitlement row exists). Contacts the function created are ordinary CRM rows and stay; delete any test ones through
the CRM. No existing table is altered by any step, so no data restore is ever required.

**Not part of this handoff**: creating the internal test organisation and enabling the capability for it. They are the
three files in `scripts/scheduling/manual/`, each a separate approval after 120 and 130 are in place:
`internal-test-org-1-create.sql` (one `organisations` row), `...-2-enable-capability.sql` (one `organisation_modules`
row, with a guard that exactly one organisation is entitled), `...-9-remove.sql` (refuses while anything belongs to it).
Which internal users belong to the organisation, and with which roles, remains an open decision.

## 5. Customer-name policy as implemented

- The reservation's display name is never an input here, and is never split, rewritten or placeholder-filled.
- A contact is created only from separately supplied first and last names, both non-blank after trimming; otherwise
  nothing is created and the booking is saved unlinked.
- An existing contact is found by organisation and normalised email, never by name, and is returned unchanged.
- No placeholder exists in code: a containment test forbids `COALESCE`, `split_part`, `string_to_array`, `substring`,
  `concat`, `initcap` and a list of placeholder literals in 130, and `.split(`/`.slice(` and display-name handling in
  the TypeScript.

## 6. Risks and limits

| Risk | Status |
| --- | --- |
| Writers that bypass the function (the CRM API, imports) can still create a duplicate of a contact the function just made | Accepted: `crm_contacts` is not altered. The Events sync shares the lock; the CRM API does not |
| `lower(btrim(email))` cannot use an index, so a match scans the organisation's contacts | Fine at current sizes (Production holds 13 contacts); measured again in 2B.7 before any large organisation is enabled |
| Super_admins will see a Scheduling toggle once 120 is applied | Intended; off for everyone; no code path acts on it |
| The test organisation is a Production data change | Defined, not created; separate approval, backup first, deletion plan included |
| Windows host: four unrelated containment files fail locally on CRLF line endings and one Docker port conflict; they fail identically on untouched `main` | CI (Linux) is the reference |

## 7. Evidence (2026-10-22, disposable Docker Postgres 16 and 17; nothing here touched Neon)

`bash scripts/tests/verify-scheduling-phase2b0.sh 17` (and `16`): PASS on both. Steps: BrainBase-shaped host with the real
`create-modules.sql`, `create-organisation-modules.sql` and `crm_contacts` as the production catalogue defines it; `010`,
`110`, `120`, `130` each applied twice; both rollbacks and a clean re-apply; the 36-test suite
(`scripts/tests/schedulingHost2b0.integration.test.ts`); the 2A schema suite (32 tests) again with 120 and 130 present;
the LD Tennis `contacts` sentinel unchanged.

**Concurrent contact creation** (real function, real Postgres 17):

| Scenario | Result |
| --- | --- |
| 10 rounds x 40 simultaneous bookings by one new customer (email in four case and spacing variants, different names per call) | every round: 1 contact created, 39 matched, one contact id |
| 40 distinct customers at once | 40 contacts created, no serialisation between different emails |
| Same email in two organisations at once (40 calls) | one contact in each organisation, never a shared one |
| The TypeScript wrapper under a 30-way race | 1 `created`, 29 `matched`, 1 contact |
| A scheduling call while a simulated Events transaction holds the Events lock, then commits its own contact | the scheduling call waited, then returned that contact as `matched`; 1 contact, classification left `EVENT_CONTACT` |
| A waiter whose lock is held past the bound | gave up after 5011 ms with a retryable error and wrote nothing |
| Negative control: the same race with a lock-free find-then-insert | 12 duplicates from 12 calls, so the suite can detect a missing lock |

**CRM isolation and name policy**: a contact with the same email in another organisation is never matched or altered, in
both directions; names are never used to match (same names with another email creates a separate contact; no email is
refused); blank, tab-only, newline-only and no-break-space names are refused at creation and create nothing; a match
needs no names and returns the contact byte-for-byte unchanged; with duplicates present the oldest is returned and
nothing is merged; `REPEATABLE READ` and `SERIALIZABLE` are refused; an unknown organisation or user leaves nothing behind.

**Capability isolation** (the real `requireCapability` and the real gate against the database): no row means every
organisation and role is denied (403, no session 401); with only `org-a` entitled, `org-b`, a disabled `org-c` and an
unknown organisation are all 403, `viewer` may view but not reserve or manage, `analyst` is denied everything, a
super_admin impersonating a non-entitled organisation is denied even when their home organisation is entitled; an
inactive or deleted capability denies an enabled organisation; an unreadable entitlement or malformed config is 503.

**Shared inventory unaffected**: constraints 106 `e02124d4...`, indexes 37 `a52b9844...`, triggers 16 `286f585e...` equal the
hashes recorded from Production (`preview-schema-record.txt`). The functions hash on the Windows checkout is
`ebf404c8...`, not the recorded `ead0e197...`; it is identical with and without 120/130, and the likely cause is CRLF
line endings in the function bodies from the Windows working copy (not verified). Re-check on Preview, which applies
LF text.

**CI-equivalent checks**: `tsc --noEmit` clean; ESLint clean on every changed file; 150 scheduling containment and unit
tests pass. The full default run (18,601 passed) shows 12 failing files: 4 fail identically on untouched `main`
(19 tests: Windows CRLF line endings and a Docker port conflict), and 8 are 5-second timeouts under load that pass in
isolation.
