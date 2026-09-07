import sql from '@/lib/db';

// Phase C3-POLISH-R §8 — tenant-scoped data access for
// commercial_document_deliveries (see
// scripts/create-commercial-document-deliveries.sql for the schema and
// its full rationale). Same discipline as every other lib/commercial/*.ts
// module: organisationId is always an explicit caller-supplied
// parameter, every query is scoped by it, and the composite FK backs up
// every application-level check.

export type DeliveryChannel = 'EMAIL' | 'SMS';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
export type DeliveryDocumentType = 'quote';

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

// One row per delivery ATTEMPT — a resend creates a new row, never
// updates a prior one. That is what makes "history" on the quote detail
// UI a plain ORDER BY attempted_at DESC, and what the resend cooldown
// check reads from (see the cooldown query in
// app/api/commercial/quotes/[id]/send-email/route.ts).
export async function recordDeliveryAttempt(params: {
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
