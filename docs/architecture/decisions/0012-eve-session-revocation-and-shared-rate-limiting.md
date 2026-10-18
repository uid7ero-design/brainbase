# 0012 — Eve session revocation and shared rate limiting

Status: Accepted for Preview (Eve Phase 3.5). Schema: two additive tables
(`scripts/create-ticketing-sessions-and-rate-limits.sql`). Applied to an
isolated Preview Neon branch only; the Production migration is a separate,
explicitly approved gate and is applied BEFORE the code is deployed.

## 1. Session revocation

**Before:** an Eve token was a stateless 8-hour JWT; logout only dropped Eve's
cookie, a password change revoked nothing, and an organisation switch left the
old token usable. User status, organisation, role and the Events capability were
already reloaded from the database on every request.

**Now:** every token carries a `jti` that is the id of a `ticketing_sessions`
row.

- **Issue:** the row is written first; the token is signed only after the write
  (or, for an organisation switch, after one transaction that inserts the new
  row and revokes the old one). No row, no token.
- **Verify:** the existing user read also checks
  `EXISTS (session with this jti, this user, this organisation, not revoked, not
  expired)`. It adds no round trip, and it does not replace any existing check:
  active user, active organisation, current database role and the Events
  capability still decide.
- **Revoke:** logout (`LOGOUT`, idempotent, reported 503 if unconfirmed),
  organisation switch (`ORG_SWITCH`), and every password change
  (`PASSWORD_CHANGE`). `ADMIN` is reserved.
- **Password change:** all four existing paths (profile, admin reset action,
  reset-link route, admin user PATCH) run the revocation in the SAME transaction
  as the password write — both happen or neither does, and a failure is reported
  rather than shown as success. BrainBase's own session semantics are unchanged.
- **Compatibility:** tokens without a `jti` fail closed after deploy (sign in
  again). Missing table = deny, so the migration precedes the code.
- **Retention:** each sign-in deletes up to 100 rows expired more than a day ago.

## 2. Shared rate limiting

`ticketing_rate_limits` holds fixed-window counters keyed by
`SHA-256(class + length-prefixed dimensions)`; one `INSERT … ON CONFLICT DO
UPDATE … RETURNING count` increments atomically across all serverless instances.
No email, address, id, token or secret is stored in the clear. Cleanup is bounded
(≈1% of calls delete ≤ 200 expired rows). Measured on a local container:
~2.3 ms per increment sequentially, 300 parallel in ~0.23 s.

It is abuse protection only — never authorisation, payment idempotency or a
capacity guard. A 429 is returned before the event is resolved, a reservation is
made or Stripe is called.

| Class | Dimensions | Limit | If the limiter is unavailable |
|---|---|---|---|
| Eve login (address) | address | 30 / 15 min | **closed** (503) |
| Eve login (user) | username (hashed) | 10 / 15 min | **closed** (503) |
| Public quote | org, event, address | 120 / h | in-memory fallback, logged |
| Free registration | org, event, address | 10 / h | in-memory fallback, logged |
| Paid checkout | org, event, address | 10 / h | in-memory fallback, logged |
| Ticket / booking lookup | address | 60 / h | in-memory fallback, logged |
| Organiser reads | verified org, user | 600 / 5 min | in-memory fallback, logged |
| Organiser mutations (none yet) | verified org, user | 60 / 5 min | **closed** |
| Check-in resolve / search | verified org, user, event | 600 / min | in-memory fallback, logged |
| Check-in confirm / undo | verified org, user, event | 300 / min | in-memory fallback, logged |

Fixed windows allow a brief burst of up to twice the limit across a boundary.
The addresses come only from the existing trusted extraction path; organiser
identity comes only from the verified session, after authorisation.

## 3. Observability

One JSON line per event: `ticketing_rate_limited`, `ticketing_rate_limit_degraded`,
`ticketing_rate_limit_unavailable`, with the class and an 8-character prefix of
the already-hashed key. Never a password, token, cookie, address, email or id.

## 4. Out of scope

Settings or refund mutations, a general session-management UI, revoking
BrainBase's own sessions, limiting BrainBase's own (non-Eve) public routes.
