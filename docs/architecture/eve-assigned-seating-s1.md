# Eve assigned seating — S1 database foundation and pure domain

Status: **S1 implemented on a branch, not applied to Production.** There is no buyer route, no hold
API and no UI. Every existing event stays general admission.

Locked owner decisions (2026-11-17):
- D1: admin reassignment is in v1.
- D2: paid seated tickets are refused explicitly; paid GA is unchanged.
- D3: holds last 10 minutes, with one renewal and a 20-minute absolute maximum.
- D4: wheelchair spaces can be selected by any buyer, are labelled, and need no declaration;
  seats can be blocked from sale.
- D5: buyers choose their seats in v1.

## Files

| File | Purpose |
|---|---|
| `scripts/create-events-assigned-seating.sql` | Additive, idempotent migration with version marker `events_schema_migrations('seating-s1')` |
| `scripts/rollback-events-assigned-seating.sql` | Rollback. Refuses while any seating data exists and restores the exact pre-migration schema |
| `packages/ticketing/src/seating.ts` | Pure domain: formatter, snapshot, generator, CSV, validator, eligibility, paid guard, hold windows |
| `packages/ticketing/tests/seating.test.ts` | Unit tests for the domain module |
| `scripts/tests/verify-events-assigned-seating.sh` | Disposable PostgreSQL 16 + 17 behavioural proof |
| `tests/containment/eveAssignedSeatingS1.test.ts` | Static scope pins: additive migration, rollback refusal, no live path |

## Schema

There are 9 tables plus a version marker, and 2 existing tables are altered. The approved design is kept,
with one deliberate change to how holds are stored (see "Hold uniqueness" below).

**Reusable, per organisation**
- `seating_venues`
- `seating_layouts`: versioned DRAFT → PUBLISHED → RETIRED; `venue_id` may be NULL for an
  event-specific layout.
- `seating_layout_sections`
- `seating_layout_groups`: `kind` is `ROW` or `TABLE`, a real column rather than a naming convention.
- `seating_layout_seats`: factual booleans `wheelchair_space`, `companion_seat`, `step_free` and
  `restricted_view`, plus an optional `companion_of_seat_id` in the same layout.

**Per event**
- `event_seating`: one PUBLISHED layout version per event. `layout_version` is filled from the
  layout by trigger.
- `event_ticket_type_sections`: which sections a seated ticket type may use.
- `event_seats`: inventory copied per event and session. Every label, sort key and seat fact is
  copied from the layout by a BEFORE INSERT trigger (whatever the caller supplies is ignored) and is
  immutable afterwards. The only mutable state is `sale_status` (AVAILABLE or BLOCKED) and
  `block_note`. *Held* and *assigned* are not stored here; they are derived from
  `event_seat_holds` and `event_attendees`.
- `event_seat_holds`: one row per held seat (see below).

**Existing tables**
- `event_ticket_types.seating_mode`: `GENERAL_ADMISSION` by default, or `ASSIGNED`. Adding it is a
  constant default, so no table rewrite.
- `event_attendees.event_seat_id`, `seat_snapshot` and `seat_released_at`: all nullable. A CHECK
  makes the seat and its snapshot travel together.

### Tenant safety (database, not application)

Every reference is a composite FK that includes `organisation_id`, and where relevant `layout_id`
and `event_id`:

- section → layout
- group → section
- seat → group
- companion → seat in the same layout
- event_seating → event, and → layout of the same organisation
- event seat → event_seating, the session of the same event, a layout seat of the attached layout,
  and a section of that layout
- ticket-type mapping → ticket type of the same event, the event's attached layout, and a section of
  that layout
- hold → event seat of the same event and organisation (event and session are filled from the seat)
- attendee → event seat of the attendee's own event and organisation

Trigger checks add the rules an FK cannot express:

- the seat must be in the attendee's own session;
- the ticket type must be ASSIGNED and mapped to the seat's section;
- the seat must be AVAILABLE;
- the snapshot must describe exactly that seat;
- ASSIGNED ticket types are allowed only on an event with seating attached.

### Hold uniqueness (the one design change)

`now()` cannot appear in an index, so "one *active* hold per seat" cannot be a partial unique index.
The gate proposed `hold_id` / `hold_expires_at` on `event_seats`. That stores a redundant mutable
pointer, and it relies on every writer remembering the expiry predicate before it overwrites the
pointer.

S1 instead stores one row per held seat and lets PostgreSQL enforce non-overlap in time:

```sql
CONSTRAINT event_seat_holds_one_active_per_seat EXCLUDE USING gist
  (event_seat_id WITH =, tstzrange(created_at, expires_at, '[)') WITH &&) WHERE (state = 'ACTIVE')
```

- Two ACTIVE holds on one seat can never have overlapping windows. A new hold's window starts at
  its `now()`, so it collides with any hold that has not yet expired, and passes any hold that has.
  Expired holds need no cleanup to stop blocking; an hourly sweep may mark them EXPIRED for
  tidiness only.
- Concurrent inserts serialise on the GiST index, like a unique index. The PG16/17 harness runs two
  sessions inserting the same seat (H24): the first wins, and the second waits, then fails.
- Renewal is an UPDATE of `expires_at`. If someone else took the seat after this hold lapsed, the
  renewal overlaps their window and is refused, so a lapsed hold can never take its seat back.
- The window rules are CHECK constraints:
  - `expires_at <= hold_started_at + 20 min` (absolute cap);
  - `renewal_count = 1 OR expires_at <= hold_started_at + 10 min` (initial window);
  - `renewal_count BETWEEN 0 AND 1`.

  A trigger allows only one renewal, forward, before expiry. CONSUMED is refused once the hold has
  expired; EXPIRED is refused while it is still live; terminal rows are immutable.
- `hold_started_at` anchors the 20-minute cap for the buyer's whole hold group (rows share a
  `secret_hash`). The browser generates the secret and the database stores only its SHA-256, so a
  retried request after a lost response finds the same hold.
- `btree_gist` provides the GiST `=` operator for text. It is already installed in Production (by
  Scheduling 2A, in `scheduling_ext`), so the migration is a no-op there.

### Assignment uniqueness

```sql
CREATE UNIQUE INDEX event_attendees_active_seat_key
  ON event_attendees (event_seat_id) WHERE event_seat_id IS NOT NULL AND seat_released_at IS NULL;
```

At most one unreleased attendee per event seat, and one seat per attendee (a single column).

Release sets `seat_released_at`, which frees the seat and keeps the issued seat and its snapshot as
immutable history. Clearing a seat and editing released history are both refused.

A seat cannot be BLOCKED while an unreleased attendee holds it.

### Layout freeze

- A layout is created DRAFT. Its sections, groups and seats change only while it is DRAFT; the child
  trigger takes `FOR SHARE` on the parent, so it serialises against a concurrent publish.
- Allowed transitions are DRAFT → PUBLISHED (which needs at least one active seat) and
  PUBLISHED → RETIRED. Nothing goes back to DRAFT.
- Only DRAFT layouts can be deleted. A frozen layout is removed only when its organisation is
  deleted (organisation cascade behaviour is unchanged).
- Only a PUBLISHED layout can be attached. `event_seating` cannot be repointed in place.
- A new version is a new DRAFT row with `version + 1`. Events that use v1 keep their copied
  inventory, so retiring v1 or publishing v2 changes no event (F12–F15).
- General-admission editing is unaffected: no trigger fires on existing tables unless a seating
  column is involved.

### Snapshot (`event_attendees.seat_snapshot`, v1)

```json
{"v":1,"layout_id":"…","layout_version":3,"section":"Section A","group_kind":"ROW","group":"C","seat":"12",
 "display":"Section A · Row C · Seat 12"}
```

- Written by `buildSeatSnapshot()`. The database verifies every structural field against the seat
  row and refuses any other key.
- Contains no venue name or other mutable organiser field, no buyer data, and no seat features: a
  ticket must not announce that its holder uses a wheelchair space.
- Every ticket surface (S4) renders `display` as stored.

### Indexes (sized for 2,000+ seats per session)

| Read | Index |
|---|---|
| Seat map / door list in order | `event_seats_map_idx (event_id, event_session_id, section_sort, group_sort, seat_sort)` |
| Occupancy by section | `event_seats_section_idx (event_id, layout_section_id)` |
| Active holds for an event (sweep, map) | `event_seat_holds_active_event_idx (event_id, expires_at) WHERE state='ACTIVE'` |
| Seat → active hold | the GiST exclusion index |
| Hold by secret | `event_seat_holds_secret_idx (secret_hash)` |
| Attendee by seat | `event_attendees_active_seat_key` (partial unique) |

Plus an `organisation_id` index on every new table and indexes on the FK columns.

## Admin reassignment (D1), designed for S5

Reassignment is one transaction:

1. Lock both seats in ascending id order.
2. `UPDATE event_attendees SET event_seat_id = :new, seat_snapshot = :newSnapshot` (allowed by the
   trigger; the old seat is freed implicitly).
3. Insert one `audit_logs` row: `action = 'event_attendee.seat_reassigned'`, with `before_state`
   holding the old seat id and snapshot, `after_state` the new ones, plus the actor.

`audit_logs` already has `before_state` / `after_state` jsonb, so no new table is needed. The QR /
`ticket_token` does not change. Buyer self-service changes stay out of v1.

## Paid seated refusal (D2)

`guardPaidAssignedSeating()` returns `PAID_ASSIGNED_SEATING_NOT_AVAILABLE` for any ASSIGNED ticket
type with `price_cents > 0`. S3 calls it at the top of `startPaidCheckout` and `registerFreeOrder`,
before any reservation work. Paid GA is untouched. There is no database CHECK, so a later paid-seating
phase can lift the rule without a migration.

## Feature flag

S1 adds **no** environment variable and no Production env. It needs none: no route reads or writes a
seating table, and the containment test pins that.

`EVE_ASSIGNED_SEATING_ENABLED` (absent means OFF) must be enforced, from S3, in:

- the seat-map read, hold, renew and release buyer actions (new `getTicketingGateway().buyerAction`
  actions);
- `registerFreeOrder` and `startPaidCheckout` whenever a cart contains an ASSIGNED line (refuse with
  a stable code);
- the BrainBase admin seating screens (S2) for attach and publish, with read-only views allowed;
- the BrainBase `/e` page, which must refuse ASSIGNED lines regardless of the flag (Eve only).

## Rollback

The rollback is safe **only before any seated data exists in Production**.

- It first refuses (raises, changing nothing) if any seating table has a row, any attendee carries
  seat data, or any ticket type is ASSIGNED.
- It then drops everything S1 added, without CASCADE.
- It removes `btree_gist` only if the marker says this migration installed it and nothing depends
  on it.

Once seated tickets exist, use the kill switch, not a schema rollback.

## Known limits (deliberate in S1)

- "An ASSIGNED attendee of a confirmed order must have a seat" is not a database constraint: paid
  orders create attendees before payment, and a later organiser-assigned mode needs NULL. S3 enforces
  it in the booking statement, and a consistency query is part of the S3 proof.
- The hold-insert trigger's "seat not assigned" check is advisory under concurrency. The partial
  unique index on attendees remains the authority, so a racing hold can at worst fail at booking; it
  can never cause a double assignment.
- Renewal and selection changes keep one `hold_started_at` per group by application contract. The
  per-row CHECKs cap every row at 20 minutes regardless.
