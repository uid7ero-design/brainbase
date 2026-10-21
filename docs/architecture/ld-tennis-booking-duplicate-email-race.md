# LD Tennis booking: the same-email duplicate race (documented, not fixed)

Status: **open, deliberately separate from the capacity guard.** Nothing here is implemented.

## What it is

The duplicate rule "one person cannot hold two live places in the same session instance" is enforced by
a read followed by an insert, so two simultaneous requests carrying the same email can both pass the
check and both be booked. The capacity guard (`ld-tennis-booking-capacity-guard.md`) bounds the *number*
of places but is blind to *who* holds them, so one person can still end up with two of the places.

| Path | Duplicate rule today |
| --- | --- |
| `POST /api/tennis/book` (public) | refuses a live booking on the instance with the same `LOWER(client_email)`: read, then insert |
| Staff enrol by name (`…/instances/[instanceId]`) | `findDuplicateEnrolment` on normalised email within the session, when an email is supplied: read, then insert |
| Staff enrol from a contact (`/api/dashboard/enrolments`) | **no duplicate check at all** |
| Recurring propagation | unique index `uniq_bookings_instance_recurring_group` on (instance, lineage) already makes lineage duplicates impossible |
| Bookings with no email | cannot be checked; allowed by design (no matching on names) |

Impact is small (a person double-booked into a class, fixable by cancelling one) and it needs near
simultaneous requests with the same email. It is a correctness and fairness issue, not a capacity or
data-integrity one.

## Why it is not folded into the capacity guard

- The staff "enrol from a contact" route has never enforced it, and the routes disagree about scope
  (instance versus whole session), so a single trigger rule would change one path's behaviour.
- A duplicate refusal would need its own error and response mapping on every path.
- Enforcing a business rule at the database level is a separate product decision from stopping
  overbooking.

## Options (for a separate approval)

1. **Partial unique index** on `(session_instance_id, lower(btrim(client_email))) WHERE status != 'cancelled'
   AND client_email IS NOT NULL AND btrim(client_email) <> ''`. Strongest and simplest; a schema change
   needing its own migration. Pre-check on a copy of Production: 86 live instance bookings, **0**
   duplicate groups, so it would apply cleanly today. Behaviour change: the contact-based staff route
   would start refusing a duplicate; the response mapping for that route would need to be decided.
2. **Extend the trigger** to check duplicates under the same advisory lock. No new index, but it hides a
   business rule in a trigger and has the same contact-route behaviour change.
3. **Leave it** and rely on the existing pre-checks, accepting the rare near-simultaneous duplicate.

Recommendation: option 1, after deciding what the contact-based route should say, shipped as its own
change once the capacity guard is live.

## Not to be confused with

Merging customers: nothing here ever merges or matches customers by name; matching is on organisation
plus normalised email only.
