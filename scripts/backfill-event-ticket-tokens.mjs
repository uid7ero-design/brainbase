#!/usr/bin/env node
// Events & Ticketing Phase 3 — backfills ticket_token for
// event_attendees rows created before Phase 3 (scripts/add-events-
// ticketing.sql added the column nullable, precisely so this backfill
// can be a separate, explicit, reviewable step — see that script's own
// header comment for the full rationale).
//
// DEV-ONLY. Requires DATABASE_URL to already be set in the environment
// (e.g. `node --env-file=.env.local scripts/backfill-event-ticket-
// tokens.mjs`) — this script performs no Production detection of its
// own; running it against the wrong database is the operator's
// responsibility, same as every other manual script in scripts/.
//
// Safety:
//   - Defaults to a DRY RUN: reports the target DB host, how many
//     event_attendees rows currently have ticket_token IS NULL, and
//     exits without writing anything.
//   - Only writes when invoked with --apply.
//   - Never touches event_order_items.quantity, event_ticket_types/
//     event_sessions.capacity, or event_orders — this script does
//     exactly one thing: UPDATE event_attendees SET ticket_token = ...
//     WHERE ticket_token IS NULL, one row at a time, each with its own
//     freshly generated 256-bit token (same generateTicketToken()
//     contract as the live registration route —
//     randomBytes(32).toString('hex')).
//   - Idempotent: rows that already have a token are never touched
//     (the WHERE ticket_token IS NULL guard), so re-running this script
//     after a partial run, or after new Phase-3-era rows have already
//     been created with their own tokens, is always safe.

import { randomBytes } from 'crypto';
import { neon } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run this via: node --env-file=.env.local scripts/backfill-event-ticket-tokens.mjs');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function generateTicketToken() {
  return randomBytes(32).toString('hex');
}

const { hostname, pathname } = new URL(process.env.DATABASE_URL);
console.log(`Target database: ${hostname}${pathname}`);
console.log(APPLY ? 'Mode: APPLY (will write)' : 'Mode: DRY RUN (no writes — pass --apply to actually backfill)');

const rows = await sql`
  SELECT id FROM event_attendees WHERE ticket_token IS NULL ORDER BY created_at
`;
console.log(`Attendees missing a ticket_token: ${rows.length}`);

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
  // index (scripts/add-events-ticketing.sql) catches a collision on
  // exactly the one row that caused it, not the whole batch, and a
  // script interruption partway through leaves already-backfilled rows
  // untouched on the next run (the WHERE ticket_token IS NULL guard).
  const token = generateTicketToken();
  const result = await sql`
    UPDATE event_attendees SET ticket_token = ${token} WHERE id = ${row.id} AND ticket_token IS NULL RETURNING id
  `;
  if (result.length) updated += 1;
}

console.log(`Backfilled ${updated} of ${rows.length} attendee row(s).`);
