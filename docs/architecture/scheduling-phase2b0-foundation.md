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
| V2 | read-only | exactly one function `brainbase_scheduling_find_or_create_contact`, 6 arguments; marker `2b.0-crm-link`; public functions +1 versus before; tables and triggers unchanged; the four per-kind hashes from `scheduling-phase2a-evidence/preview-schema-record.txt` unchanged; **and the stored body must be byte-identical to the file**: `SELECT md5(prosrc), length(prosrc) FROM pg_proc WHERE proname = 'brainbase_scheduling_find_or_create_contact'` returns `d77810bfc5896ddfaf50b445336be75f` and `1966` | any difference |

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
| Other writers can still create a duplicate of a contact the function just made: the CRM API (no check), and the Events sync/backfill, whose lock-and-read-in-one-statement design leaks under a real overlap (measured: section 10) | Accepted for 2B.0: `crm_contacts` and the Events/CRM code are not changed. A single-strategy recommendation is in section 10 |
| `lower(btrim(email))` cannot use an index, so a match scans the organisation's contacts | Fine at current sizes (Production holds 13 contacts); measured again in 2B.7 before any large organisation is enabled |
| Super_admins will see a Scheduling toggle once 120 is applied | Intended; off for everyone; no code path acts on it |
| The test organisation is a Production data change | Defined, not created; separate approval, backup first, deletion plan included |
| Windows host: four unrelated containment files fail locally on CRLF line endings and one Docker port conflict; they fail identically on untouched `main` | CI (Linux) is the reference |

## 7. Evidence (2026-10-22, disposable Docker Postgres 16 and 17; nothing here touched Neon)

`bash scripts/tests/verify-scheduling-phase2b0.sh 17` (and `16`): PASS on both (re-run after every change below). Steps: BrainBase-shaped host with the real
`create-modules.sql`, `create-organisation-modules.sql` and `crm_contacts` as the production catalogue defines it; `010`,
`110`, `120`, `130` each applied twice; both rollbacks and a clean re-apply; the 43-test suite
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
hashes recorded from Production (`preview-schema-record.txt`). The functions hash is the same too when the committed LF bytes are applied (see section 9, where the earlier difference is explained and proven to be line endings).

**CI-equivalent checks**: `tsc --noEmit` clean; ESLint clean on every changed file; 150 scheduling containment and unit
tests pass. The full default run (18,601 passed) shows 12 failing files: 4 fail identically on untouched `main`
(19 tests: Windows CRLF line endings and a Docker port conflict), and 8 are 5-second timeouts under load that pass in
isolation.

## 8. Preview rehearsal of 120 and 130 (2026-10-22, Neon; Production untouched)

| Item | Value |
| --- | --- |
| Project / database / role | `brainbase-db` (`empty-fire-62164682`), `neondb`, `neondb_owner`, PostgreSQL 17.11 |
| Branch | `preview/feat/scheduling-phase2b0-foundation`, `br-proud-waterfall-a7yttxw7`: created by the Vercel integration for this PR, **not** the primary or default branch, forked from Production at 11:05:06Z (LSN `0/2E459610`), after the 2A migration |
| Before any SQL | markers `2a.1-brainbase`, `2a.2`; inventory 225 tables / 69 functions / 80 triggers; per-kind hashes equal the Production record (con `e02124d4`, fn `ead0e197`, idx `a52b9844`, trg `286f585e`); no `scheduling` module; no host function; 13 CRM contacts (hash `7d603ac3`); 14 modules; 21 entitlement rows; 0 reservations; no other sessions |
| Rollback readiness | `191` and `192` committed (same branch); a disposable child copy created after applying (below) |
| Applied | `120` (4 statements) then `130`, in one transaction each, committed contents |

After applying: markers `2a.1-brainbase, 2a.2, 2b.0-capability, 2b.0-crm-link`; 225 / **70** / 80 (one function added); `modules` has `scheduling` (`active = true`), 15 rows, the other 14 unchanged (hash `befb980c`); **0** `scheduling` entitlement rows and the 21 existing rows unchanged (`fae91a95`); CRM contacts unchanged (13, `7d603ac3`); organisations unchanged (`687c357f`); per-kind hashes unchanged (fn still `ead0e197`).

**The function** is `brainbase_scheduling_find_or_create_contact(p_organisation_id text, p_email text, p_first_name text, p_last_name text, p_phone text, p_created_by text)` returning `TABLE(contact_id uuid, outcome text)`, plpgsql, security invoker, `proconfig = {lock_timeout=5s}`, owner `neondb_owner`. Its stored body is byte-identical to the committed file: md5 `d77810bfc5896ddfaf50b445336be75f`, 1966 bytes.

**Capability isolation on Preview** (the two canonical `requireCapability` queries, run for every organisation): HLNA Labs, LD Tennis, Brainbase, City of Onkaparinga, School Test Organisation and the C7 smoke organisation all resolve to `NO_ENTITLEMENT`.

**Function behaviour on Preview**, run inside a `DO` block that always ends in an exception so nothing persists (CRM hash unchanged afterwards): a new email created a `LEAD` with names trimmed (`Re`, `Hearsal`), email kept as typed, phone trimmed, `created_by` NULL and `notes` NULL; the same email in different case with different names returned `matched`, the same id, the contact untouched; the same email in another organisation created a separate contact; a blank last name, a tab-only and a no-break-space first and last name each raised `SCCNM`; a missing email raised `SCCEM`; an unknown organisation raised `23503`.

**Idempotency**: both files were applied a second time in full; markers stayed at four rows, the module at one row, the function body hash and every data hash were unchanged.

**Rollback on a disposable copy** (`temp/scheduling-2b0-rollback-rehearsal-20261022`, `br-morning-thunder-a7177ouv`, child of the Preview branch, created from the applied state): with a test entitlement present `191` **refused** ("organisation_modules still holds 1 row(s)") and left the module and marker in place; after removing that row `192` then `191` succeeded. Result equals the pre-120 baseline: markers `2a.1-brainbase, 2a.2`; no host function; no `scheduling` module; 14 modules (hash `befb980c`, identical to before 120); entitlements, CRM contacts, organisations and column fingerprints identical to the baseline hashes; 225 / 69 / 80. Re-applying `120` and `130` restored the 2B.0 state with the same body hash. **This child branch is still present: it blocks the automatic Preview cleanup when PR #470 merges and needs its own deletion approval.**

**A transport pitfall found and fixed during the rehearsal (not a defect in the files).** The tool used to run the Preview SQL converts the six-character text backslash-u00a0 into a real no-break-space character before it reaches the database. The first application of `130` therefore stored four literal no-break spaces where the file has the escape: the function behaved identically but its body was 1946 bytes (md5 `213e8775`) instead of 1966 (`d77810bf`). The byte-level comparison caught it; the function was re-applied from the exact committed text (the backslash restored inside the database with `replace(..., chr(92))`) and the hash then matched. The Neon SQL Editor paste path is not affected, but **the Production handoff must include this check after `130`**: `SELECT md5(prosrc), length(prosrc) FROM pg_proc WHERE proname = 'brainbase_scheduling_find_or_create_contact'` must return `d77810bfc5896ddfaf50b445336be75f` and `1966`.

## 9. Function-definition hash investigation

Question: why did a Docker run report the functions hash `ebf404c8...` while the Production record is `ead0e197...`?

Method: apply `010_shared_schema.sql` to two databases on PostgreSQL 17.11 (Docker), one from the committed bytes (LF, zero CR bytes) and one from the same text with a CR added to every line (CRLF, 740 CR bytes), then compare each function's `md5(pg_get_functiondef())` and `md5(prosrc)` with the Preview branch, which holds the Production-applied schema.

| Function | LF = Preview (definition and body) | CRLF = Preview | Body bytes Preview / CRLF |
| --- | --- | --- | --- |
| `scheduling_cancel_occurrence` | yes | no | 692 / 711 (+19) |
| `scheduling_hold_guard` | yes | no | 713 / 728 (+15) |
| `scheduling_hold_serialise` | yes | no | 199 / 206 (+7) |
| `scheduling_is_timezone` | yes | no | 86 / 88 (+2) |
| `scheduling_occurrence_guard` | yes | no | 1325 / 1353 (+28) |
| `scheduling_occurrence_release_holds` | yes | no | 186 / 192 (+6) |
| `scheduling_require_hold` | yes | no | 1143 / 1164 (+21) |
| `scheduling_reservation_guard` | yes | no | 2334 / 2385 (+51) |
| `scheduling_reservation_lifecycle` | yes | no | 1977 / 2009 (+32) |
| `scheduling_reservation_release_holds` | yes | no | 187 / 193 (+6) |
| `scheduling_touch_updated_at` | yes | no | 53 / 58 (+5) |

Aggregate functions hash: LF `ead0e19768405bc1357638b627192c54` (equals the Production record), CRLF `ebf404c8cddbd69d382ea5618d1ef91e`. All 11 functions of the CRLF build contain carriage returns; none of the LF build does. Each CRLF body is longer by exactly one byte per source line.

Conclusion: the discrepancy is **proven** to be line endings, not a schema difference, and it affects all 11 functions identically. Behaviour is unchanged (PL/pgSQL treats a CR as whitespace; the whole suite passed against the CRLF build in the earlier run), but it **is meaningful for the fingerprint**: the record is byte-exact, so a schema applied from CRLF text (a Windows checkout with `core.autocrlf`, or an editor that rewrites line endings) will not match it. Production's own functions hash matched the record after the real migration because the text applied was LF. The proof script now applies the committed bytes with CRs stripped and, on PostgreSQL 17, asserts all four Production hashes; the handoff should tell the owner to copy from `git show` or GitHub's raw view, and to run the fingerprint query afterwards. On PostgreSQL 16 the same query is reported but not asserted, because definition text can differ between major versions.

## 10. Every writer of `crm_contacts`, measured against the real code

Measured on disposable Postgres 17 with the real `syncEventOrderContact` (the app client pointed at the disposable database). Nothing in the CRM or Events code was changed.

| Writer | Where | Duplicate protection | Measured |
| --- | --- | --- | --- |
| CRM API create | `app/api/crm/contacts/route.ts` POST | none (plain insert, explicit create) | 20 simultaneous posts of one email: 20 contacts |
| CRM API edit | `app/api/crm/contacts/[id]/route.ts` PUT | none | changing an email to one that exists creates a duplicate pair |
| Events sync | `lib/crm/eventSync.ts` `syncEventOrderContact` | advisory lock `(hashtext(org), hashtext('email:' + email))` **taken inside the same statement that reads and inserts** | natural 30-way race: 1 contact. **Forced overlap (6 statements already running when another writer commits): 7 contacts, one duplicate per waiter.** With no email and no phone it always inserts (by design) |
| Events backfill | `lib/crm/eventBackfill.ts` | the same single-statement shape | not executed; same weakness by construction |
| Events classification backfill | `lib/crm/eventContactClassificationBackfill.ts` | updates only | no insert |
| Scheduling | `130_brainbase_crm_link.sql` | the same lock key, taken in one statement and the read done in the NEXT statement | forced overlap: 1 contact; natural races: 1 contact (see section 7) |

**Why the Events path leaks.** Under READ COMMITTED a statement takes its snapshot when it starts. A statement that takes the lock and then reads in the same statement reads with the snapshot from before it waited, so a waiter that started before the winner committed cannot see the winner's row and inserts a duplicate. The natural race looked safe only because each Events call first awaits capability lookups, which staggers the calls; the forced test removes the stagger. Scheduling avoids it by locking in one statement and re-reading in a later one (and refuses `REPEATABLE READ`).

**Which paths share the protocol**: three use the same lock key (Events sync, Events backfill, Scheduling), so they queue behind each other; only Scheduling re-reads after the wait. The CRM API does not use the lock at all.

**What the Scheduling function does and does not guarantee.** It never creates a duplicate itself, and it reuses a contact another writer committed. It cannot stop an Events statement that was already waiting from inserting a duplicate of a contact Scheduling has just created.

**Recommended single strategy (a later change, not in this PR):**
1. One CRM-owned SQL function (lock, then re-read in a separate statement) that every contact creator calls; `130` is a working prototype and its tests carry over. Migrate the callers one reviewed PR at a time, Events sync and Events backfill first because they are the leaky ones.
2. Give the CRM API create and edit paths an explicit policy (return the existing contact or a 409 on an email match) rather than silently duplicating.
3. Run a read-only duplicate audit before any constraint: `SELECT organisation_id, lower(btrim(email)), count(*) FROM crm_contacts WHERE email IS NOT NULL AND btrim(email) <> '' GROUP BY 1, 2 HAVING count(*) > 1`. On the Preview copy of Production it returns 0 groups (13 contacts); it has not been run on Production.
4. Only then add a partial unique index on `(organisation_id, lower(btrim(email)))` for non-blank emails as the backstop, with callers handling `23505`. Until it exists, no application-level protocol is complete.

**Remaining risks, stated plainly**: Events can duplicate under a real overlap (existing behaviour, now measured); the CRM API and its edit path can always duplicate; contacts without an email can never be matched; matching scans an organisation's contacts (no index on the normalised email) and is fine at today's sizes. Scheduling will not make any of these worse: a duplicate it meets is resolved deterministically to the oldest contact.
