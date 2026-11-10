# Scheduling Phase 2C.3c: reload-recovery for staff booking (design v2, implemented)

Status: **IMPLEMENTED on this branch (owner decisions O1-O4 approved; see section 14).** The design below is unchanged except where section 14 records a deliberate difference. Stops at the implementation review gate: nothing is merged, enabled, registered or activated.

## 0. What this PR contains

| Part | State |
| --- | --- |
| This document | design v2 (replaces the v1 of commit 895bdf06, see section 4 for what changed and why) |
| Failing-first tests | 11 component tests, 9 unit contract tests, 2 x 2 browser tests; all proven red (section 9) |
| Wording fix | implemented: "Nothing was booked." only when provable (section 7) |
| Neon test isolation | implemented: independent synthetic identifiers and a prefix-based fingerprint (section 10) |
| Recovery mechanism | **not implemented** |

## 1. The defect (D1) and its relatives

The idempotency key lives in the dialog's memory (`createBookingKeyHolder()` in a `useState`). Anything that destroys that memory while an outcome is unknown forgets the attempt:

* closing the dialog from "could not confirm" and opening it again (D1; verified: first POST key `bk_b69b...`, second `bk_0e2f...`);
* a reload, a crash, a navigation.

The database prevents a duplicate booking of the same court and time (exclusive hold; PG 16/17 and the Neon driver). What it cannot prevent is the **wrong message and the lost trail**: the second attempt is refused with "That time was just taken. Nothing was booked." while the staff member's own booking exists.

## 2. Mandatory principles and the rule each one becomes

| Principle | Design rule |
| --- | --- |
| An uncertain booking never silently gets a new key | The key of an unresolved attempt is held outside the dialog (page memory, then a browser record). `holder.keyFor` is not reachable while a record for the scope exists. |
| Close and reopen preserve or recover the original key | Tier 1: the attempt lives in a page-level store that survives the dialog (section 3.1). |
| A refresh must not permit a duplicate attempt because local state vanished | Tier 2: a write-ahead record survives the reload (3.2); the dialog starts in a recovering state and offers no booking form. |
| An unsuccessful lookup does not prove no booking committed | A lookup that finds nothing never changes the state to "free". Only an authoritative answer ends an attempt: found, or a definitive reply to a replay under the original key. |
| 15-minute expiry must not mean failure | **No expiry.** The record is removed only by an authoritative outcome (3.4). |
| A 60-90 s quiet period must not authorise a new key | **No quiet period.** Nothing in the design measures elapsed time to decide anything. |
| Never persist names, contact details, notes or the body | The record is `{v, key, fp, savedAt}` (3.2). A test scans storage for every typed value. |
| Never expose a record across users or organisations | A server-derived secret per (user, organisation) names and keys the record (3.3). |

## 3. Recommended architecture

### 3.1 Tier 1: the attempt outlives the dialog (same page)
An `attemptStore` (module-level, keyed by scope, no storage) holds the live attempt: the holder, the machine state after SUBMIT (key, frozen body, content, `unconfirmedKeys`). The dialog reads and writes it instead of owning it. Closing and reopening re-mounts the dialog on the **same** attempt: it opens in `unsure`/`checking`, not on the time picker. The full body exists only in page memory, exactly as it does today while the dialog is open; nothing new is persisted by this tier. This fixes D1 completely and needs no fingerprint.

### 3.2 Tier 2: a write-ahead record survives a reload
`sessionStorage`, key `bb.sched.pending.<scope>`, value `{ "v": 1, "key": "bk_<32 hex>", "fp": "<base64url HMAC-SHA-256>", "savedAt": <epoch ms> }`. Never stored: name, email, phone, notes, party, date, time, resource, offering, reservation id, the body, user id, organisation id, the secret.

* **Written before the first byte is sent**, synchronously with SUBMIT. If the write fails, **nothing is sent** (fail closed, 3.6).
* On load, if a record for this scope exists, the dialog opens **recovering**: it looks up the original key (`GET /api/scheduling/reservations?idempotencyKey=`). It offers no booking form.
  * **found** -> the normal Booked confirmation ("saved earlier"); record removed.
  * **not found, or the lookup failed** -> stays "We could not confirm an earlier booking". One action: **Enter the booking again**.
* **Enter the booking again** runs the ordinary flow in *resume mode*. At Review the content's fingerprint must equal the record's. Equal -> the holder is given the original key (`adopt`, the only new holder operation, reachable only here) and Confirm sends the same key. The server answers authoritatively: `replayed:true` with the existing reservation, or books it once, or a definitive refusal. Different -> refused with "This is not the booking being checked", nothing sent, no key minted.
* Why a replay is the right resolution: the server answers a repeated key **before** it reads the basis, and compares offering, resource, start, duration, party, customer and notes (`hireRequestMatches`), not the basis. So a post-reload replay with a fresh basis is answered correctly, and the server remains the authority on "same content"; the fingerprint is only an early, local guard so the UI never mints a key or sends a mismatching body by mistake.

### 3.3 Scope and secret (one value, two jobs)
The server component that already computes `canBook` also computes, and passes as a prop:

```
recoverySecret = base64url( HMAC-SHA-256( SESSION_SECRET, "sched-recovery-v1" || len(userId) || userId || len(organisationId) || organisationId ) )
```

(length-prefixed, so `("a|b","c")` and `("a","b|c")` can never collide). On the client, `scope = base64url(HMAC(recoverySecret, "scope")).slice(0, 22)` names the record, and `fp = HMAC(recoverySecret, canonicalContent)`. It is not stored; it is in the page props for that signed-in user only.

* `SessionPayload` has `userId` and `organisationId` (lib/session.ts), so no new column, endpoint or session state is needed. The secret is the existing session signing secret (no new variable).
* A different user, a different organisation or a rotated server secret yields a different scope: the record is simply not found. A rotated server secret therefore orphans an unresolved record (the D1 hazard returns for that one booking); rotation is rare, and this is listed as a residual risk.

### 3.4 When a record is removed (and never otherwise)
Removed on: Booked (created, replayed, found); a **definitive refusal** under that key (`RESOURCE_CONFLICT`, `AVAILABILITY_CHANGED`, the other stable codes, `VALIDATION`); `IDEMPOTENCY_CONFLICT`. **Kept** on: uncertain, `checking`, `unsure`, `retry` (CONTENTION_TIMEOUT), any lookup result of "not found" or "error", any amount of elapsed time. No timer, no age check, no sweep. The record dies with the tab (`sessionStorage`) or with an authoritative answer.

### 3.5 State machine
New step `recovering` (entered by `RECOVER`, dispatched once at mount when a record exists). It is inert like `checking`: `FIELD`, `REVIEW` (except in resume mode), `BACK`, `START`, `NEW_ATTEMPT` return the same state object. A counting-holder property test proves `keyFor`, `adopt` and `discard` are never called there, and that `adopt` is reachable only from `REVIEW` in resume mode with a matching fingerprint.

### 3.6 Fail closed
The Book button is absent (as when the gate is off), and a dialog that is somehow mounted shows "This booking can't be started safely in this browser" and sends nothing, when any of these holds: no `recoverySecret` prop; `sessionStorage` cannot be read or written (private mode, blocked, quota); `crypto.subtle` unavailable. A booking build must not have a mode without recovery.

## 4. Necessity review: what changed from v1 and why

| v1 element | Verdict |
| --- | --- |
| Non-extractable HMAC key in IndexedDB | **Not necessary. Removed.** Its two jobs (unguessable fingerprint; separation of users) are done by the server-derived secret, which also removes a second storage mechanism and its failure modes. |
| Session-scoped token | **Necessary. Kept, merged** into the same server-derived secret. The only isolation that does not depend on the browser being honest. |
| Payload fingerprint | **Necessary only for the reload resume.** Kept, as a keyed MAC (a plain hash of a name and phone is guessable). Tier 1 needs none. |
| 15-minute expiry | **Removed** (principle 5). |
| 60-90 s quiet period | **Removed** (principle 6). |
| "Release" after the quiet period | **Removed.** See owner decision O1. |
| Deterministic key (derive the key from the content so it can be recomputed) | **Considered and rejected.** It would need no storage, but rebooking the same content after a cancellation would replay the cancelled booking (observed in the browser tests: a fixed key replayed a cancelled reservation). A salt that fixes it must itself be remembered. |
| `localStorage` | **Rejected.** Outlives the session and the tab and would make an unresolved record last forever. |

## 5. Is client-only storage sufficient?

For the mandatory principles in the cases that matter (the same tab and browser session): **yes**. It never asks the browser to prove non-commit; it asks the server an authoritative question (lookup, then a same-key replay) and does nothing else until it answers.

| Scenario | Outcome |
| --- | --- |
| Close and reopen (D1) | Tier 1: same attempt, resumes in `unsure`. |
| Reload / crash with tab restore | Tier 2: recovering, lookup, resume by replay. |
| Timeout, 5xx, network error | Existing `checking` -> `unsure`; the record exists from before the send. |
| Interrupted request (page dies mid-flight) | Record written before sending; recovering on load; the late commit is found by the lookup or answered by the replay. |
| Sign out / sign in as someone else (same tab) | Different secret -> record not found, not looked up, not deleted. |
| Same user signs back in | Same secret -> the record is found and resolved. |
| Switch organisation | Different secret. |
| Second tab (same user) | Does not see the record (per-tab). No duplicate is possible (exclusive hold). **Residual:** that tab's conflict message cannot know about the other tab's attempt. |
| Storage unavailable or full | Fail closed: no booking is offered, nothing sent. |
| Tab closed, storage cleared, new device | **Not covered.** The key is gone. No duplicate is possible; the hold refuses the same slot. **Residual:** a correct but narrow "this request booked nothing" with no pointer to the earlier booking. |

The residual rows cannot be fixed in the browser because nothing in the browser survives them. They are the case for the optional server mechanisms in section 8, none of which is required for the principles above.

## 6. Account and session isolation (summary)
One server-derived secret per (user, organisation), never stored, never in a URL. It names the record (so another scope cannot find it), keys the fingerprint (so storage alone reveals nothing about the content), and is absent from storage. The tests assert: same inputs same output; different user, organisation or server secret differ; unambiguous encoding; no id or secret inside the value; another scope cannot read, overwrite or clear the record; the first scope still can.

## 7. "Nothing was booked." (implemented in this PR)

The sentence is a **claim about the database**. It is made only when the system can prove it: the response is a definitive refusal for this attempt's key **and that key has never had an uncertain outcome** (`provableNotBooked`; the machine tracks `unconfirmedKeys`, which only grows). Otherwise the text states what is known: this request did not save a booking, and the earlier attempt could not be confirmed, so look in the calendar before booking again.

| Path | Wording |
| --- | --- |
| Definitive refusal, first or clean attempt (AVAILABILITY_CHANGED, RESOURCE_CONFLICT, OFF_GRID, OUTSIDE_AVAILABILITY, IN_THE_PAST, RESOURCE_INACTIVE, OFFERING_UNAVAILABLE, RESOURCE_NOT_ELIGIBLE, NONEXISTENT_LOCAL_TIME, DURATION_NOT_ALLOWED, OFFERING_NOT_BOOKABLE, NOT_FOUND, VALIDATION, fallback) | unchanged, "... Nothing was booked." |
| The same codes after an uncertain outcome under that key | the claim is **removed** and replaced by: "Your earlier attempt could not be confirmed, so look in the calendar before booking again." A conflict still says the time was taken. |
| CONTENTION_TIMEOUT (retry) | clean: "Nothing was booked."; after an uncertain outcome: "This try was not saved." plus the note |
| Gate off / BOOKING_NOT_READY (unavailable), 401/403 (denied) | same two forms |
| checking, unsure | never claim anything (asserted) |
| IDEMPOTENCY_CONFLICT | "Nothing new was booked." is kept (the key belongs to another booking and nothing was saved over it) |
| Pre-submission text (basis load failure, "Start time chosen. Nothing has been booked.") | unchanged: no attempt exists. After recovery lands, the recovering state replaces these while a record exists. |

After the recovery fix the key survives, so the false case cannot arise from D1; the rule stays as the safety net for every path that cannot be proven.

## 8. Server-side options (only if the owner wants more than section 5 gives)

Facts: a reservation row stores `idempotency_key` and `created_by`; a refused or never-arrived attempt leaves **no** server record. So a server can answer "did this key commit?" but can never answer "will it never commit?" without new storage.

* **B1: conflict explainer (read-only, no migration).** On `RESOURCE_CONFLICT`, one tenant-scoped read: "bookings created by me on this resource at this start in the last hour". If one exists, show "This time is already booked in your name (reference ...)" instead of "just taken". Closes the residual rows of section 5 for the **committed** case. Needs a small read endpoint over existing columns. Recommended as a later, separate decision.
* **B2: fence (needs a migration).** A tombstone table so a key can be declared abandoned and a later create with it is refused. Only needed if staff must be able to **release** an unresolved attempt. Not recommended for v1 (O1).

## 9. Failing-first evidence and tests

All registered with `recovery(...)`: `it.fails` by default (suite green, failure proven), a plain `it` with `RECOVERY_IMPLEMENTED=1` (the red run the implementation PR must turn green).

* `tests/components/scheduling/StaffBookDialogRecovery.test.tsx` (jsdom, a fake server that commits then loses the reply): D1 steps 1-7 (close, reopen, original booking recovered, one key, one reservation, no second POST); reopen with nothing found (no form; resume keeps the original key); a different booking is blocked; refresh (module reset, storage kept) found / not found, and ten minutes passing changes nothing; write-ahead record shape and no PII and no plain hash; a timeout is uncertain; definitive outcomes clear the record; storage unwritable, unreadable, secret missing (fail closed, nothing sent); user switching and tenant isolation.
* `tests/containment/schedulingStaffBookingReloadRecovery.test.ts`: secret derivation (determinism, separation, unambiguous encoding, opaque), store (record shape, keyed MAC, isolation, **no expiry**, write failure, malformed records).
* `tests/browser/scheduling/staffBooking.spec.ts` (`test.fail`): D1 and a REAL page reload, in both themes, against the real server and database.
* Still to write with the implementation: PG 16/17 and Neon driver recover-by-original-key; sign-in as another user in the same tab; axe on the recovering state.
* Wording: `tests/containment/schedulingStaffBookingUiMachine.test.ts` and `StaffBookDialogBooking.test.tsx` (implemented and green).

## 10. Neon test isolation (implemented)
The 2C.3b and UI slice 2 Neon suites both wrote `neon-route-a/b`, and each fingerprinted "everything outside my two orgs", so run in parallel each saw the other's rows as foreign data (3 spurious failures). Now: the UI suite uses `neon-ui2-*` organisations and users; **both** fingerprints define "other organisations" as `NOT LIKE 'neon-%'` (the Production-data copy uses uuid ids). Suites no longer depend on order or on being serial, and the check on real data is unchanged.

## 11. Owner decisions
* **O1 Release.** v1 has no way to abandon an unresolved attempt; the only ends are found, a replay, or closing the tab. Recommended for v1. Alternatives: an acknowledged "release" (a human choice, not a timer; accepts that a very late commit may appear unannounced) or B2.
* **O2 Scope of the block.** While a record exists, no *other* booking can be started in that tab for that user and organisation (simplest, strictly safe). Alternative: block only the same resource.
* **O3 B1** (conflict explainer): now, later, or never.
* **O4** `sessionStorage` (per tab) accepted over a cross-tab store.

## 12. Implementation outline (after approval)
`recoverySecret.ts` (server), `pendingStore.ts` + `attemptStore.ts` (client), `machine.ts` (`recovering`, `RECOVER`, `adopt`), the dialog (hydrate, resume mode, recovering panel), `CalendarScreen` and the server component (prop, fail-closed button), static pins (`adopt` only in `machine.ts`; no other storage use), then turn the red run green. About 400 lines plus tests. No server, migration or env change.

## 13. Out of scope
Cancellation (slice 3), public booking, payments, recurrence, a short human reference, any server or schema change.

## 14. Implementation (as built) and owner decisions

### 14.1 Owner decisions (approved)

| | Decision | Effect in the code |
| --- | --- | --- |
| O1 | No automatic abandonment of an unresolved attempt. Authoritative resolution or same-key replay only. | No expiry, quiet period, timer, sweep or "release" anywhere. `savedAt` is written and never read. A static pin forbids a clock in the machine, the attempt store and the boot module. |
| O2 | While an attempt is unresolved, block ALL new booking attempts in the tab for that user and organisation. | The dialog opens `recovering` (or `unsafe`); the only way forward is the original attempt. |
| O3 | Conflict explainer (B1) is deferred to a separate enhancement. | Not built. |
| O4 | Per-tab `sessionStorage` for v1, limitations documented. | See 14.5. |

### 14.2 Modules

| File | Role |
| --- | --- |
| `lib/scheduling/recoverySecret.ts` (server only) | `deriveRecoverySecret(sessionSecret, userId, organisationId)`: HMAC-SHA-256 with a domain label and length-prefixed ids. |
| `lib/scheduling/staffBookingVisibility.ts` | `getStaffBookingContext()` returns `{canBook, recoverySecret}`. The secret is derived only when every visibility gate holds, and not at all if `SESSION_SECRET` is missing (fail closed). `getStaffBookingVisibility()` is unchanged in behaviour. |
| `lib/scheduling/staffBooking/hmac.ts` | A synchronous HMAC-SHA-256 for the browser (pinned byte-for-byte against `node:crypto`). Synchronous because the record must be written in the same tick that decides to send, and its storage name must be known synchronously; `crypto.subtle` is asynchronous and secure-context only. |
| `lib/scheduling/staffBooking/pendingStore.ts` | The write-ahead record `{v, key, fp, savedAt}` under `bb.sched.pending.<scope>`; `status()` distinguishes none / record / corrupt / unavailable; `ensure()` never replaces a record of a different key. |
| `lib/scheduling/staffBooking/attemptStore.ts` | Tier 1: unresolved machine state kept in page memory, keyed by scope; no storage. |
| `lib/scheduling/staffBooking/recoveryBoot.ts` | Decides what the dialog opens on, once, before any request. |
| `lib/scheduling/staffBooking/machine.ts` | Steps `recovering` and `unsafe`; actions `CHECK_AGAIN`, `RETRY_FROZEN`, `ENTER_AGAIN`, `STORE_FAILED`; `pending` / `resume` state; `settlesAttempt()`. |
| `lib/scheduling/staffBooking/key.ts` | `adopt(key, content)`: the only way a holder is given an existing key; called from `machine.ts` REVIEW in resume mode only. |
| `StaffBookDialog.tsx`, `CalendarScreen.tsx`, the calendar page | Boot, write-ahead before send, lookup, recovering/unsafe panels; no Book button without a secret. |

### 14.3 Differences from the design text above (deliberate)

1. **No `crypto.subtle`.** Scope and fingerprint use the synchronous HMAC in `hmac.ts`, so "crypto.subtle unavailable" is no longer a failure mode. A missing secret, unusable storage or a corrupt record still fails closed.
2. **One lookup on opening, then "Check again".** The design polled 0.5/1.5/3/6 s on opening. A reload does not need that spacing (the original request is no longer attached to this page), and a user who wants another look presses **Check again**, which only reads. In-session `checking` keeps the original 0.5/1.5/3/6 s schedule.
3. **Three actions when settled:** *Check again* (read only), *Try again* (only when the in-page copy of the frozen attempt exists: same key, same body), *Enter the booking again* (resume by replay).
4. **A corrupt record withholds booking** and is never deleted automatically (deleting it would abandon an unresolved attempt). Closing the tab clears it. There is deliberately no "clear it" button (O1).
5. **A found booking, a definitive refusal under the key and `IDEMPOTENCY_CONFLICT` remove the record; `CONTENTION_TIMEOUT`, uncertain outcomes and (after an uncertain send) 401/403/404 do not** (`settlesAttempt`, proved equal to the reducer for every outcome).

### 14.4 Security of exposing a server-derived value to the browser

* The value is an HMAC over a **domain label** and the length-prefixed user and organisation ids, keyed by the session secret. HMAC is one-way; it does not reveal the key, and the label means it cannot equal any other use of that key.
* It is **not** a session token, a cookie or a JWT, and **no route, middleware or request helper reads it** (static pin). It is never sent in a request, a header, a URL, a log or the DOM. Holding it authorises nothing; the API still authorises every request from the session.
* The browser derives from it a storage name and a fingerprint key, and never stores it.
* An attacker who could read the page props could already act as the signed-in user; the secret adds no capability. What it prevents is one user's or organisation's record being found, read, resumed or cleared by another in the same browser.
* It is stable per (user, organisation), so the same user signing back in finds their record; a rotated session secret orphans one unresolved record (residual risk, section 12).

### 14.5 Limitations (not global guarantees)

* **New tab, cleared site data, a new device, another browser:** the record is not there. No duplicate is possible (the exclusive hold refuses the same slot); the loss is that the earlier booking is not pointed out. The staff member must look in the calendar. The optional server enhancement B1 would address this and is deferred (O3).
* **`sessionStorage` is per tab:** a record is not visible to a second tab, and a duplicated tab starts with a copy of storage. A second tab for the same user can therefore start a booking that the first tab has unresolved; the database still prevents an overlapping hold.
* **Tier 1 lives in page memory** and holds the frozen request (including customer details) until the attempt is resolved or the page unloads. This is what the dialog's state already held while open; nothing is persisted by it.
* **"Enter the booking again" only works when the earlier request did NOT commit.** If it did commit, the engine no longer offers that hour, so the same booking cannot even be entered (proved on PostgreSQL and Neon); the staff member uses **Check again**, which finds the original by its key once a lookup succeeds. Replay is therefore the path for a request that never arrived; lookup is the path for one that committed. Both keep the original key, and neither can create a second booking.
* **Private browsing / blocked storage:** the dialog offers no booking (fail closed).
* **An unresolved attempt blocks new bookings in that tab** until it is found, replayed to an authoritative answer, or the tab is closed (O1/O2). That is the intended cost.

### 14.6 Tests (all permanent; the failing-first markers are removed)

* `tests/components/scheduling/StaffBookDialogRecovery.test.tsx` (D1 steps 1-7, refresh, timeout, storage failure, corrupt record, user/organisation isolation, no customer data in storage at any point, axe).
* `tests/containment/schedulingStaffBookingReloadRecovery.test.ts` (secret and store contract) and `schedulingStaffBookingRecoveryDesign.test.ts` (HMAC vs node, machine inertness and property tests, `settlesAttempt` vs reducer, source pins).
* `scripts/tests/schedulingStaffBookingUi2c3cBooking.integration.test.ts` (recovery through the real routes on PostgreSQL 16/17, and the Neon-driver variant).
* `tests/browser/scheduling/staffBooking.spec.ts` (D1 and a real page reload, three viewports, both themes).
