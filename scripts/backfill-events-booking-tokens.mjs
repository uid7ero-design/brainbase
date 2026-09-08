#!/usr/bin/env node
// Events & Ticketing — booking wallet. Backfills event_orders.booking_token
// for CONFIRMED, ticket-eligible orders created before this feature
// existed (scripts/add-events-booking-wallet.sql added the column
// nullable, precisely so this backfill can be a separate, explicit,
// reviewable step — see that script's own header comment for the full
// rationale). Modeled directly on scripts/backfill-event-ticket-
// tokens.mjs's own pattern.
//
// DEV-ONLY. Requires DATABASE_URL to already be set in the environment
// (e.g. `node --env-file=.env.local scripts/backfill-events-booking-
// tokens.mjs`) — this script performs no Production detection of its
// own; running it against the wrong database is the operator's
// responsibility, same as every other manual script in scripts/. This
// implementation phase does NOT run this script against Production —
// that is a separate, later, explicit gate.
//
// Eligible rows only — an order qualifies when ALL of:
//   - event_orders.status = 'CONFIRMED'
//   - event_orders.payment_status IN ('NOT_REQUIRED', 'PAID')
//   - event_orders.booking_token IS NULL
//   - at least one event_attendees row for that order already has a
//     non-null ticket_token
// (the same eligibility shape as lib/events/ticketEmailEligibility.ts's
// isOrderEligibleForTicketEmail(), applied here at the DB-query level
// rather than imported directly — this script runs standalone via
// node, outside the Next.js module graph the 'server-only' guard on
// that file would otherwise poison for it).
//
// Safety:
//   - Defaults to a DRY RUN: reports the target DB host and how many
//     eligible orders currently have booking_token IS NULL, and exits
//     without writing anything.
//   - Only writes when invoked with --apply.
//   - Never touches event_attendees.ticket_token, event_orders.status,
//     event_orders.payment_status, or any other column — this script
//     performs exactly one kind of write: UPDATE event_orders SET
//     booking_token = ... WHERE booking_token IS NULL AND <eligible>,
//     one row at a time, each with its own freshly generated 256-bit
//     token (same generateBookingToken()/generateTicketToken() contract
//     as the live registration route and Stripe webhook path —
//     randomBytes(32).toString('hex')).
//   - Idempotent: rows that already have a booking_token are never
//     touched (the WHERE booking_token IS NULL guard), so re-running
//     this script after a partial run, or after new eligible orders
//     have already minted their own token via the live paths, is
//     always safe.

import { randomBytes } from 'crypto';
import { neon } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run this via: node --env-file=.env.local scripts/backfill-events-booking-tokens.mjs');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function generateBookingToken() {
  return randomBytes(32).toString('hex');
}

const { hostname, pathname } = new URL(process.env.DATABASE_URL);
console.log(`Target database: ${hostname}${pathname}`);
console.log(APPLY ? 'Mode: APPLY (will write)' : 'Mode: DRY RUN (no writes — pass --apply to actually backfill)');

const rows = await sql`
  SELECT DISTINCT eo.id
  FROM event_orders eo
  JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
  JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
  WHERE eo.booking_token IS NULL
    AND eo.status = 'CONFIRMED'
    AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
    AND ea.ticket_token IS NOT NULL
  ORDER BY eo.id
`;
console.log(`Eligible orders missing a booking_token: ${rows.length}`);

if (rows.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

if (!APPLY) {
  console.log('Dry run complete. Re-run with --apply to write tokens.');
  process.exit(0);
}

let updated = 0;
for (const row of rows) {
  // One UPDATE per row, each with its own freshly generated token —
  // deliberately not a single bulk statement, so the partial unique
  // index (scripts/add-events-booking-wallet.sql) catches a collision
  // on exactly the one row that caused it, not the whole batch, and a
  // script interruption partway through leaves already-backfilled rows
  // untouched on the next run (the WHERE booking_token IS NULL guard).
  // The eligibility conditions are repeated in this UPDATE's own WHERE
  // clause (not just the earlier SELECT) so a row that changed state
  // between the SELECT and this UPDATE (e.g. cancelled in the
  // meantime) is safely skipped rather than blindly written to.
  const token = generateBookingToken();
  const result = await sql`
    UPDATE event_orders
    SET booking_token = ${token}
    WHERE id = ${row.id} AND booking_token IS NULL AND status = 'CONFIRMED' AND payment_status IN ('NOT_REQUIRED', 'PAID')
    RETURNING id
  `;
  if (result.length) updated += 1;
}

console.log(`Backfilled ${updated} of ${rows.length} order(s). No attendee ticket tokens, order status, or payment status were changed.`);
