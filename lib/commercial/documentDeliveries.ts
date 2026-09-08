import sql from '@/lib/db';

// Phase C3-POLISH-R §8 — tenant-scoped data access for
// commercial_document_deliveries (see
// scripts/create-commercial-document-deliveries.sql for the schema and
// its full rationale). Same discipline as every other lib/commercial/*.ts
// module: organisationId is always an explicit caller-supplied
// parameter, every query is scoped by it.
//
// Phase C4.3B — 'invoice' added to DeliveryDocumentType (the schema's
// document_type CHECK is widened to match — see
// scripts/widen-commercial-document-deliveries-for-invoices.sql). That
// migration also DROPS this table's former composite FK onto
// commercial_quotes — a polymorphic association cannot composite-FK
// onto two different parent tables at once, and no replacement
// cross-table FK is added. Tenant/document integrity for WRITES is now
// an explicit APPLICATION invariant enforced here, not a DB constraint:
// the raw insert primitive (below) is intentionally NOT exported —
// nothing outside this file can write a delivery row from a bare
// {organisationId, documentType, documentId} triple. The only two
// exported write paths, recordQuoteDeliveryAttempt() and
// recordInvoiceDeliveryAttempt(), each hardcode their own documentType
// (a caller cannot mismatch quote vs invoice) and require the caller to
// pass the actual resolved document row (not a bare id string) —
// carrying its own organisation_id, which is asserted to match the
// caller's organisationId before anything is written. In real usage
// that assertion can never fire: both send-email API routes already
// resolve the quote/invoice via a tenant-scoped lookup
// (getQuoteWithLines(session.organisationId, id) /
// getInvoiceWithLines(session.organisationId, id)) before ever reaching
// this module, so the object's own organisation_id is always already
// session.organisationId by construction. The assertion exists as a
// structural, testable belt-and-suspenders guard against a FUTURE
// refactor accidentally breaking that invariant, not because today's
// callers can actually trigger it.
export type DeliveryChannel = 'EMAIL' | 'SMS';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
export type DeliveryDocumentType = 'quote' | 'invoice';

export interface CommercialDocumentDelivery {
  id: string;
  organisation_id: string;
  document_type: DeliveryDocumentType;
  document_id: string;
  channel: DeliveryChannel;
  recipient: string;
  status: DeliveryStatus;
  provider: string | null;
  provider_message_id: string | null;
  attempted_at: string;
  delivered_at: string | null;
  failed_at: string | null;
  error_summary: string | null;
  created_by: string | null;
  created_at: string;
}

// The raw insert primitive — deliberately NOT exported. See this
// module's own header comment for why: nothing outside this file may
// write a delivery row from a bare {organisationId, documentType,
// documentId} triple. Every real write goes through
// recordQuoteDeliveryAttempt()/recordInvoiceDeliveryAttempt() below,
// which each hardcode their own documentType and assert tenant
// ownership before ever reaching this function.
//
// One row per delivery ATTEMPT — a resend creates a new row, never
// updates a prior one. That is what makes "history" on the quote/invoice
// detail UI a plain ORDER BY attempted_at DESC, and what the resend
// cooldown check reads from (see the cooldown query in
// app/api/commercial/quotes/[id]/send-email/route.ts and its invoice
// equivalent).
async function recordDeliveryAttempt(params: {
  organisationId: string;
  documentType: DeliveryDocumentType;
  documentId: string;
  channel: DeliveryChannel;
  recipient: string;
  status: DeliveryStatus;
  provider?: string | null;
  providerMessageId?: string | null;
  errorSummary?: string | null;
  createdBy: string | null;
}): Promise<CommercialDocumentDelivery> {
  // delivered_at/failed_at are computed here in JS (not via a nested
  // sql`now()` fragment interpolated as a value — the neon() tagged-
  // template client parameterizes every ${} as a plain bound value, it
  // does not compose nested SQL fragments the way postgres.js does) so
  // that a row's attempted_at/delivered_at/failed_at all agree with each
  // other to the millisecond, rather than attempted_at using this
  // request's JS time and delivered_at/failed_at using a separately
  // evaluated DB now().
  const now = new Date().toISOString();
  const deliveredAt = params.status === 'DELIVERED' ? now : null;
  const failedAt = params.status === 'FAILED' ? now : null;

  const rows = (await sql`
    INSERT INTO commercial_document_deliveries (
      organisation_id, document_type, document_id, channel, recipient, status,
      provider, provider_message_id, delivered_at, failed_at, error_summary, created_by
    ) VALUES (
      ${params.organisationId}, ${params.documentType}, ${params.documentId}, ${params.channel}, ${params.recipient}, ${params.status},
      ${params.provider ?? null}, ${params.providerMessageId ?? null},
      ${deliveredAt}, ${failedAt},
      ${params.errorSummary ?? null}, ${params.createdBy}
    )
    RETURNING *
  `) as CommercialDocumentDelivery[];
  return rows[0];
}

interface DeliveryAttemptCommon {
  organisationId: string;
  channel: DeliveryChannel;
  recipient: string;
  status: DeliveryStatus;
  provider?: string | null;
  providerMessageId?: string | null;
  errorSummary?: string | null;
  createdBy: string | null;
}

function assertSameOrganisation(organisationId: string, documentOrganisationId: string, documentType: DeliveryDocumentType): void {
  if (documentOrganisationId !== organisationId) {
    // Never reachable via any real call site today (see this module's
    // own header comment) — a loud, immediate failure here is strictly
    // preferable to silently writing a cross-tenant delivery row if a
    // future refactor ever breaks the resolve-then-record invariant.
    throw new Error(`Tenant mismatch recording a ${documentType} delivery attempt: document belongs to a different organisation.`);
  }
}

// The ONLY way to write a quote delivery row. `quote` must be the
// already-resolved row from a tenant-scoped lookup (e.g.
// getQuoteWithLines(session.organisationId, quoteId).quote) — its own
// organisation_id is asserted to match `organisationId` before anything
// is written.
export async function recordQuoteDeliveryAttempt(params: DeliveryAttemptCommon & {
  quote: { id: string; organisation_id: string };
}): Promise<CommercialDocumentDelivery> {
  assertSameOrganisation(params.organisationId, params.quote.organisation_id, 'quote');
  const { quote, ...rest } = params;
  return recordDeliveryAttempt({ ...rest, documentType: 'quote', documentId: quote.id });
}

// The ONLY way to write an invoice delivery row. Same discipline as
// recordQuoteDeliveryAttempt() above.
export async function recordInvoiceDeliveryAttempt(params: DeliveryAttemptCommon & {
  invoice: { id: string; organisation_id: string };
}): Promise<CommercialDocumentDelivery> {
  assertSameOrganisation(params.organisationId, params.invoice.organisation_id, 'invoice');
  const { invoice, ...rest } = params;
  return recordDeliveryAttempt({ ...rest, documentType: 'invoice', documentId: invoice.id });
}

export async function listDeliveriesForDocument(params: {
  organisationId: string;
  documentType: DeliveryDocumentType;
  documentId: string;
}): Promise<CommercialDocumentDelivery[]> {
  return (await sql`
    SELECT * FROM commercial_document_deliveries
    WHERE organisation_id = ${params.organisationId} AND document_type = ${params.documentType} AND document_id = ${params.documentId}
    ORDER BY attempted_at DESC
  `) as CommercialDocumentDelivery[];
}

// Seconds since the most recent delivery attempt for this
// document+channel, regardless of outcome (matches the events
// ticket-email-resend precedent's own cooldown semantics — the point is
// stopping double-click/repeat-click spam, not just gating successful
// sends). Returns null if there is no prior attempt at all.
export async function secondsSinceLastAttempt(params: {
  organisationId: string;
  documentType: DeliveryDocumentType;
  documentId: string;
  channel: DeliveryChannel;
}): Promise<number | null> {
  const rows = (await sql`
    SELECT EXTRACT(EPOCH FROM (now() - attempted_at))::int AS seconds_since
    FROM commercial_document_deliveries
    WHERE organisation_id = ${params.organisationId} AND document_type = ${params.documentType}
      AND document_id = ${params.documentId} AND channel = ${params.channel}
    ORDER BY attempted_at DESC
    LIMIT 1
  `) as { seconds_since: number }[];
  return rows[0]?.seconds_since ?? null;
}
