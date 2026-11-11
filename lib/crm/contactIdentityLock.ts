import sql from '@/lib/db';

// One shared lock for every code path that decides "does this contact already exist?" before writing to
// crm_contacts (Events sync, Events backfill, the CRM API create/edit, and
// the Scheduling module's find-or-create-contact SQL function, which takes the identical key).
//
// The lock alone is not enough. Under READ COMMITTED a statement takes its snapshot when it STARTS. A
// statement that takes the lock and reads in the SAME statement (a CTE, as these paths used to do) keeps the
// snapshot from before it waited, so a waiter that began before the winner committed cannot see the winner's row
// and inserts a duplicate. The lock therefore has to be its own statement, with the read-and-write in a LATER
// statement of the same transaction: that statement starts after the lock is held and sees everything committed
// before the previous holder released it.
//
//   const [, rows] = await sql.transaction([
//     contactIdentityLock(organisationId, 'email', normalisedEmail),
//     sql`...read, then insert/update if still absent...`,
//   ]);
//
// The key is (hashtext(organisation_id), hashtext('<kind>:<normalised identity>')). Callers MUST pass the value
// produced by normalizeEmail / normalizePhone in lib/crm/eventSync.ts so every path derives the same key.
// Keys are per organisation: the same email in two organisations never contends.
//
// Known limits (documented, not hidden): an email-keyed writer and a phone-only writer use different keys and can
// still both create the same real person; with no email and no phone there is nothing to lock on. A unique index
// is the only complete backstop and is deliberately not part of this change.

export type ContactIdentityKind = 'email' | 'phone';

export function contactIdentityLockKey(kind: ContactIdentityKind, normalisedIdentity: string): string {
  return `${kind}:${normalisedIdentity}`;
}

export function contactIdentityLock(organisationId: string, kind: ContactIdentityKind, normalisedIdentity: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId}), hashtext(${contactIdentityLockKey(kind, normalisedIdentity)})) AS locked`;
}
