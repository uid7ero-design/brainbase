import sql from '@/lib/db';
import { logDocumentSequenceConfigured } from './auditLog';

// Phase C2 — reusable, tenant-scoped, concurrency-safe document-number
// allocator for future commercial documents (quotes, invoices, credit
// notes, purchase orders, ...). Schema: commercial_document_sequences
// (see scripts/create-commercial-core.sql), one row per
// (organisation_id, document_type).
//
// Concurrency safety: allocation is TWO statements
// (INSERT ... ON CONFLICT DO NOTHING, then UPDATE ... RETURNING),
// executed as one atomic unit via sql.transaction() — Neon's
// "non-interactive" transaction primitive, which accepts a flat,
// pre-built array of queries with no branching on an earlier query's
// result (see lib/tennisSchedule.ts's own documented use of the same
// primitive for the identical reason). Both statements are unconditional
// (the UPDATE runs regardless of whether the INSERT actually inserted a
// row or hit its ON CONFLICT DO NOTHING no-op), so no branching is
// needed — this is exactly the "flat array" shape sql.transaction()
// supports.
//
// The UPDATE is what actually guarantees no duplicate allocation: it is
// a single statement that both reads and writes the same row inside one
// transaction, so Postgres's normal row-level locking serializes any two
// concurrent transactions targeting the SAME (organisation_id,
// document_type) row — one always waits for the other's transaction to
// commit before its own UPDATE can proceed, and each committed UPDATE
// has already incremented next_number, so the second transaction reads
// the POST-increment value, never a stale one. This is the same
// correctness guarantee any single-row UPDATE-based counter has under
// MVCC, requiring no explicit SELECT ... FOR UPDATE or advisory lock.
//
// next_number is stored as "the next number that will be allocated"
// (starts at 1). RETURNING next_number - 1 computes the PRE-increment
// value from the just-updated (POST-increment) row in the same
// expression — see the SQL comment inline below for the exact algebra.

export type CommercialDocumentType = 'QUOTE' | 'INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_ORDER';

const DEFAULT_PREFIX: Record<CommercialDocumentType, string> = {
  QUOTE: 'QUO-',
  INVOICE: 'INV-',
  CREDIT_NOTE: 'CRN-',
  PURCHASE_ORDER: 'PO-',
};

const DEFAULT_PADDING = 6;

function formatDocumentNumber(prefix: string, allocatedNumber: number, padding: number): string {
  return `${prefix}${String(allocatedNumber).padStart(padding, '0')}`;
}

// Allocates the next document number for (organisationId, documentType).
// Never accepts documentType from unvalidated request input beyond the
// CommercialDocumentType union — callers must resolve/validate it first,
// matching every other organisation-scoped write in this codebase's
// tenant-isolation discipline (organisationId itself must already be a
// trusted, session-resolved value, never taken from client input).
export async function allocateDocumentNumber(
  organisationId: string,
  documentType: CommercialDocumentType,
): Promise<string> {
  const queries = [
    sql`
      INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
      VALUES (${organisationId}, ${documentType}, ${DEFAULT_PREFIX[documentType]}, 1, ${DEFAULT_PADDING})
      ON CONFLICT (organisation_id, document_type) DO NOTHING
    `,
    // next_number in the RETURNING clause reflects the row AFTER this
    // statement's own SET has applied (the new, incremented value) —
    // so `next_number - 1` here algebraically recovers the value that
    // was current immediately BEFORE this allocation, which is exactly
    // the number this specific call is allocating.
    sql`
      UPDATE commercial_document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organisation_id = ${organisationId} AND document_type = ${documentType}
      RETURNING (next_number - 1) AS allocated_number, prefix, padding
    `,
  ];

  const results = await sql.transaction(queries);
  const rows = results[1] as { allocated_number: number; prefix: string; padding: number }[];
  const row = rows[0];
  return formatDocumentNumber(row.prefix, row.allocated_number, row.padding);
}

// Explicit, ADMIN-gated reconfiguration of a document type's prefix/
// padding — a genuine configuration CHANGE, distinct from ordinary
// allocation (which never logs an audit entry — see
// lib/commercial/auditLog.ts's own comment on that boundary). Never
// resets or rewinds next_number — changing how future numbers are
// FORMATTED must never retroactively risk colliding with an
// already-issued number.
export async function configureDocumentSequence(params: {
  organisationId: string;
  userId: string;
  documentType: CommercialDocumentType;
  prefix: string;
  padding: number;
}): Promise<void> {
  const existing = await sql`
    SELECT prefix, padding FROM commercial_document_sequences
    WHERE organisation_id = ${params.organisationId} AND document_type = ${params.documentType}
  `;
  const before = existing[0] as { prefix: string; padding: number } | undefined;

  await sql`
    INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
    VALUES (${params.organisationId}, ${params.documentType}, ${params.prefix}, 1, ${params.padding})
    ON CONFLICT (organisation_id, document_type)
    DO UPDATE SET prefix = ${params.prefix}, padding = ${params.padding}, updated_at = now()
  `;

  await logDocumentSequenceConfigured({
    organisationId: params.organisationId,
    userId: params.userId,
    documentType: params.documentType,
    before: before ? { prefix: before.prefix, padding: before.padding } : null,
    after: { prefix: params.prefix, padding: params.padding },
  });
}
