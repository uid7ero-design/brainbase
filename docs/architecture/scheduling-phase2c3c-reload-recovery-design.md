# Scheduling Phase 2C.3c: reload-recovery for staff booking (design only)

Status: **design and test specification. Not implemented.** A separate safety PR, stacked on #549, **required before booking activation (2C.3d)**. Owner decision 2026-11-08: minimal mechanism; do not add to #549 unless a critical defect forces it (none does, see section 1).

## 1. The gap this closes

Slice 2 keeps the idempotency key in the dialog's memory (`createBookingKeyHolder()` in a `useState`). Anything that destroys that memory while an outcome is uncertain forgets the attempt:

| Event while the outcome is unknown | What happens today |
| --- | --- |
| Reload / tab crash / navigate away | The attempt is forgotten. |
| **Close the dialog from "could not confirm" and open it again (same page)** | The dialog unmounts; the holder is lost. Re-booking the same content mints a **different** key. Verified with a scratch jsdom test on ce3c4cf5: first POST key `bk_b69b…`, second POST key `bk_0e2f…`. |

Consequence, bounded by the database: a second booking of the **same court and time is impossible** (the exclusive hold refuses it; proven on PG 16/17 and the Neon driver). What the staff member would see, if the first write had in fact committed, is "That time was just taken. Nothing was booked.", which is false: their own booking exists and is not shown as theirs. No duplicate, no overwrite, but a misleading result and no recovery. Not a critical defect (no data harm, mitigated by the on-screen "look in the calendar first" warning), so it is **not** fixed in #549. The follow-up must cover both rows above, because they are the same problem (the attempt must outlive the component).

## 2. What is stored (and only this)

One record per unresolved attempt:

```
{ v: 1, key: "bk_<32 hex>", fp: "<base64url HMAC-SHA-256, 22 chars>", savedAt: <epoch ms> }
```

Never stored: name, email, phone, notes, party size, date, time, resource, offering, reservation id, the request body, the user id, the organisation id, the role.

Storage: `sessionStorage` (per tab, gone when the tab closes), under the key `bb.sched.pending.<scope>`.

### 2.1 The fingerprint is not a plain hash
Customer names and phone numbers are low-entropy; `SHA-256(body)` can be brute-forced by anyone who can read the record. So `fp = HMAC-SHA-256(k, canonicalContent)` where `k` is a **non-extractable** Web Crypto key generated per browser profile and persisted as a `CryptoKey` object in IndexedDB (the bytes are never readable, only usable by this origin's script). `canonicalContent` is the exact string `key.ts` already builds for the holder (resource, offering, date, time, party, trimmed customer fields), so the holder and the fingerprint can never disagree.
* If `crypto.subtle` or IndexedDB is unavailable, **fail closed** (section 6).
* The fingerprint exists for one purpose: on re-entry, decide whether the staff member typed the same booking again (reuse the original key: a true replay) or a different one (new key, only after reconciliation, section 4).

### 2.2 Scope: organisation and user, without storing either
The server component that already computes `canBook` also computes an opaque **scope token** and passes it as a prop:

```
scope = base64url( HMAC-SHA-256( SESSION_SECRET, "sched-pending|" + userId + "|" + organisationId ) ).slice(0, 22)
```

* It is a function of the server's validated session, so a tampered client cannot choose it.
* Non-reversible and not a stored identifier: the browser holds only the token (in the storage key name), never the ids.
* A different user or a different organisation gets a different token and therefore never sees the record; a record from a previous sign-in by someone else is simply not found.
* `SessionPayload` has `userId` and `organisationId` (lib/session.ts), so the token can be derived without a new column or any server state. The secret is the existing session signing secret (no new environment variable). To confirm in review: the secret is available to server components, and the derivation lives in one server-only helper with a unit test.
* If the token is missing (prop absent, secret unavailable), the client **does not write a record and does not enable booking** (fail closed, section 6).

## 3. Write-ahead, and when a record is removed

* **Written before the first byte is sent**: in the same synchronous step that freezes `attempt` (SUBMIT), before `fetch`. A crash between "sent" and "answered" therefore always leaves a record. The write must succeed or the send does not happen.
* **Removed** only on a **definitive** outcome (created, or one of the stable refusal codes), after the UI state has moved on. Never removed on `uncertain`, `unsure`, `retry` or `conflict`.
* **Expires** at `savedAt + 15 min` (checked on read; an expired record is deleted and ignored). The window is far longer than any request can live (section 4.2), so an expired record can no longer hide a late commit.
* At most one record per scope. A second attempt cannot start while one exists (section 4), so there is nothing to overwrite.

## 4. On load and on every dialog open: reconcile before any new attempt

1. Read `bb.sched.pending.<scope>`. Absent, malformed, wrong `v` or expired → delete, proceed normally.
2. Present → the dialog opens in a **"Checking a booking you started earlier"** state (polite status, no form, no Book button). Nothing else is offered until it resolves.
3. Look up by the **original key** (`GET /api/scheduling/reservations?idempotencyKey=`, read-only, the existing endpoint):
   * **found** → show the normal **Booked** confirmation (marked "saved earlier"), refresh the calendar, delete the record.
   * **missing** → not yet proof (a request in flight when the page died can still commit). Keep checking until `savedAt + QUIET_MS` (section 4.2); then delete the record and allow a new attempt.
   * lookup failed (network, 5xx) → remain in the checking state; offer **Try again later** and Close. Never offer a new booking.
4. While the record exists the only way forward for new content is waiting it out; the only way forward for **identical** content is the replay below.

### 4.1 Re-entering the same booking before the record clears
The staff member may type the booking again during the quiet period. `REVIEW` computes `fp` of the new content:
* `fp` equals the record's → `holder.adopt(record.key)` (new holder operation, the only one, called only from REVIEW): the send is a **same-key replay**; the server returns the original reservation (`replayed: true`) or books it once. No second key exists.
* `fp` differs → refuse with "Finish or clear the earlier booking check first". No key is minted.

### 4.2 The quiet period
`QUIET_MS` must exceed the longest time a request already sent can still commit: client timeout (20 s) plus the route's maximum execution time. `app/api/scheduling/**` sets no `maxDuration`, so it inherits the platform default; **to confirm in the implementation PR and set `QUIET_MS = default maxDuration + 30 s`** (expected 60 to 90 s). After that, a missing key proves no booking was made, because the write is one atomic batch (migration-independent, proven by the lost-reply tests).

## 5. State machine changes (pure, extends machine.ts)

* New step `recovering` (entered by an action `RECOVER { record }` dispatched once at mount when a record exists). Same rules as `checking`: `FIELD`, `REVIEW`, `BACK`, `START`, `NEW_ATTEMPT` return the same state object.
* `SUBMIT` gains a precondition: a write-ahead callback result `persisted: true` (the effect writes the record; the reducer only requests it with a `persist` flag on the state).
* The holder gains exactly one new operation, `adopt(key, fp)`, reachable only from `REVIEW` while `recovering` has ended with a matching `fp`. The static gate test is extended: `keyFor`, `adopt` and `discard` appear in `machine.ts` and nowhere else.
* The attempt must survive unmount: the dialog hydrates its holder from the record on mount (this is what fixes the close/reopen row in section 1).
* Server: **no change**. No migration, no new endpoint, no environment variable.

## 6. Fail closed

Booking is not offered (the Book button is absent, same as the gate being off) when any of these holds, and the dialog never writes anything:
* no scope token from the server;
* `sessionStorage` unreadable or unwritable (private mode, blocked storage);
* `crypto.subtle` or IndexedDB (for the non-extractable key) unavailable.

The staff member sees nothing new in the calendar (a read-only view as before). This is deliberately stricter than "book without recovery": a mode with no recovery must not exist in a booking build.
**Alternative** if fail-closed proves too strict in the field: a server-side "my recent attempts" read (reservations created by this user in the last N minutes, shown as "Possibly yours"). That needs a new endpoint and an actor column read, so it is a larger change and is not proposed for the first follow-up.

## 7. Residual risks (accepted, to be listed in the PR)

* Another tab for the same user does not see the record (sessionStorage is per tab). Duplicates remain impossible (exclusive hold); the other tab can show "just taken". localStorage would share across tabs but outlives the session and widens exposure; not chosen.
* Same user, same organisation, signing out and in on the same tab keeps the record (same scope). That is the same person, and the record holds no personal data.
* Script injection on the origin could read the record or use the key; the same script could already read the page. The record adds no personal data to what such an attacker could read.

## 8. Test specification (written first, as `it.todo` in `tests/containment/schedulingStaffBookingReloadRecovery.test.ts`; implemented with the PR)

Machine and storage (vitest, pure):
1. Record content: `JSON.stringify(record)` has exactly the keys `v, key, fp, savedAt`; it contains none of the typed name, email, phone, notes, resource id, org id or user id (property test over random inputs).
2. `fp` is a keyed MAC: the same content under two different keys differs; a plain SHA-256 of the content does not equal `fp`.
3. Scope: two (user, org) pairs give different tokens; same pair gives the same; changing either changes it; the token contains neither id; a record under another scope is invisible.
4. Write-ahead: SUBMIT with a failing storage write sends nothing; with a working write, the record exists before `fetch` is called (ordering assertion).
5. Removal: removed on created and on every stable refusal code; **kept** on uncertain, unsure, retry, conflict.
6. Expiry: a record older than 15 min is deleted and ignored; a malformed or wrong-version record is deleted.
7. `recovering` is inert: for every action in the vocabulary except `POLL`/`RECOVER_RESULT`, the reducer returns the identical state object (extends the existing property test; a counting holder proves `keyFor`, `adopt`, `discard` are never called in `recovering`).
8. `adopt` only with a matching `fp`; a differing `fp` refuses and mints nothing; the whole random-sequence test still shows one key per episode.

Dialog (jsdom + axe):
9. Close from "could not confirm", reopen: the dialog shows "Checking a booking you started earlier", not the form; a lookup for the original key is sent; no POST.
10. Reload simulated by remount with the record present and the lookup returning the reservation: Booked ("saved earlier"), record deleted, calendar refreshed.
11. Missing before the quiet period: stays checking, no form, no new key; after it: record cleared, form available.
12. Same content re-entered during the quiet period: the POST carries the **original** key and the same body shape; different content: refused, no POST.
13. Fail-closed matrix: no scope prop, storage throwing, no `crypto.subtle`, no IndexedDB: no Book button, no writes (network and storage spies).

Database (PG 16/17 and the Neon driver, real routes):
14. Commit then lost reply then remount: the original key resolves to the original reservation; exactly one reservation and one hold.
15. Close/reopen/rebook with the original key after a lost reply: `replayed: true`, one hold.
16. The scenario in section 1 end to end: with recovery, the misleading "just taken. Nothing was booked." can no longer occur for the staff member's own booking.

Browser (Playwright, 390/768/1440, light/dark):
17. Real reload during a delayed (held) POST: after reload the checking state shows, then Booked; one reservation. Default-OFF network spy unchanged (no storage written, no requests when the gate is off).
18. Sign out and in as another user in the same tab: the record is not found; the booking form is available.
19. a11y: the recovering state announces politely and has a focusable heading; no axe violations.

## 9. Out of scope
Cancellation (slice 3), public booking, payments, recurrence, a short human reference, any server or schema change.
