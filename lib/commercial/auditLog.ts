import sql from '@/lib/db';

// Phase C2 — Commercial Core audit wiring, applying ADR-0003
// (docs/architecture/decisions/0003-commercial-audit-wiring-standard.md).
// Reuses the existing, already-live, generic audit_logs table — no new
// schema. Modeled directly on lib/events/auditLog.ts's shape (per
// ADR-0003 §6: "the two existing, now-proven shapes are the pattern to
// copy per-vertical... not a shared generic utility").
//
// Every mutation this file logs is HUMAN-INITIATED and already gated by
// authorizeCommercialRequest() (session + capability + role) before the
// business-state write runs — per ADR-0003 §3, this makes a separate,
// best-effort (non-transactional) write the correct choice: a person who
// just successfully created/edited/deactivated a row already proved who
// they are, and a dropped audit write afterward does not retroactively
// make that action ambiguous the way a dropped webhook-audit write would
// (there is no retry/redelivery here to create a duplicate-vs-missing
// ambiguity). Call these functions AFTER the real mutation has already
// committed successfully — never before, never inside the same
// transaction.
//
// action namespace: '<resource_type>.<verb>', matching ADR-0003 §12
// exactly (snake_case verb, past tense, resource_type always the literal
// noun a future `WHERE resource_type = '...'` query would filter on).

async function insertAuditLog(entry: {
  organisationId: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      VALUES (
        ${crypto.randomUUID()}, ${entry.organisationId}, ${entry.userId}, ${entry.action}, ${entry.resourceType}, ${entry.resourceId},
        ${entry.beforeState ? JSON.stringify(entry.beforeState) : null}::jsonb,
        ${entry.afterState ? JSON.stringify(entry.afterState) : null}::jsonb
      )
    `;
  } catch (err) {
    console.error('[commercial audit] audit_logs write failed (ignored — the underlying mutation remains valid)', err, { action: entry.action, resourceId: entry.resourceId });
  }
}

// ── Product / service catalogue ──────────────────────────────────────────

export async function logProductCreated(params: {
  organisationId: string; userId: string; productId: string;
  after: { name: string; type: string; default_unit_price_cents: number; currency: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_product.created',
    resourceType: 'commercial_product', resourceId: params.productId, beforeState: null, afterState: params.after,
  });
}

export async function logProductUpdated(params: {
  organisationId: string; userId: string; productId: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_product.updated',
    resourceType: 'commercial_product', resourceId: params.productId, beforeState: params.before, afterState: params.after,
  });
}

export async function logProductDeactivated(params: { organisationId: string; userId: string; productId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_product.deactivated',
    resourceType: 'commercial_product', resourceId: params.productId, beforeState: { active: true }, afterState: { active: false },
  });
}

// Phase C3
export async function logProductReactivated(params: { organisationId: string; userId: string; productId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_product.reactivated',
    resourceType: 'commercial_product', resourceId: params.productId, beforeState: { active: false }, afterState: { active: true },
  });
}

// ── Cost centres ──────────────────────────────────────────────────────────

export async function logCostCentreCreated(params: {
  organisationId: string; userId: string; costCentreId: string; after: { code: string; name: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_cost_centre.created',
    resourceType: 'commercial_cost_centre', resourceId: params.costCentreId, beforeState: null, afterState: params.after,
  });
}

export async function logCostCentreUpdated(params: {
  organisationId: string; userId: string; costCentreId: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_cost_centre.updated',
    resourceType: 'commercial_cost_centre', resourceId: params.costCentreId, beforeState: params.before, afterState: params.after,
  });
}

export async function logCostCentreDeactivated(params: { organisationId: string; userId: string; costCentreId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_cost_centre.deactivated',
    resourceType: 'commercial_cost_centre', resourceId: params.costCentreId, beforeState: { active: true }, afterState: { active: false },
  });
}

// ── Financial periods ────────────────────────────────────────────────────
//
// A period/year status change (OPEN -> CLOSED) is exactly the kind of
// state transition ADR-0003 §2 requires an audit entry for ("changes a
// commercial document's status") — closing a period is effectively a
// finance-control action a future auditor may need to attribute to a
// specific person and time.

export async function logFinancialYearStatusChanged(params: {
  organisationId: string; userId: string; financialYearId: string; before: string; after: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_financial_year.status_changed',
    resourceType: 'commercial_financial_year', resourceId: params.financialYearId,
    beforeState: { status: params.before }, afterState: { status: params.after },
  });
}

export async function logFinancialPeriodStatusChanged(params: {
  organisationId: string; userId: string; financialPeriodId: string; before: string; after: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_financial_period.status_changed',
    resourceType: 'commercial_financial_period', resourceId: params.financialPeriodId,
    beforeState: { status: params.before }, afterState: { status: params.after },
  });
}

// ── Document numbering configuration ─────────────────────────────────────
//
// Never logs the currently-allocated next_number as part of an ordinary
// allocation (that is a routine, high-frequency operation, not an
// auditable configuration change — matching ADR-0003 §2's "routine reads
// ... do NOT require their own audit entry" boundary). Only an explicit
// ADMIN reconfiguration (prefix/padding change) is audited.
export async function logDocumentSequenceConfigured(params: {
  organisationId: string; userId: string; documentType: string;
  before: { prefix: string; padding: number } | null;
  after: { prefix: string; padding: number };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_document_sequence.configured',
    resourceType: 'commercial_document_sequence', resourceId: `${params.organisationId}:${params.documentType}`,
    beforeState: params.before, afterState: params.after,
  });
}

// ── Customers ─────────────────────────────────────────────────────────────

export async function logCustomerCreated(params: {
  organisationId: string; userId: string; customerId: string; after: { name: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_customer.created',
    resourceType: 'commercial_customer', resourceId: params.customerId, beforeState: null, afterState: params.after,
  });
}

export async function logCustomerUpdated(params: {
  organisationId: string; userId: string; customerId: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_customer.updated',
    resourceType: 'commercial_customer', resourceId: params.customerId, beforeState: params.before, afterState: params.after,
  });
}

export async function logCustomerDeactivated(params: { organisationId: string; userId: string; customerId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_customer.deactivated',
    resourceType: 'commercial_customer', resourceId: params.customerId, beforeState: { active: true }, afterState: { active: false },
  });
}

// Phase C3
export async function logCustomerReactivated(params: { organisationId: string; userId: string; customerId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_customer.reactivated',
    resourceType: 'commercial_customer', resourceId: params.customerId, beforeState: { active: false }, afterState: { active: true },
  });
}

// ── Quotes (Phase C3) ─────────────────────────────────────────────────────
//
// issued/accepted/rejected/expired are all genuine status-change events
// on a commercial document per ADR-0003 §2 ("changes a commercial
// document's status" is explicitly listed as requiring an audit entry).
// Still a best-effort, non-transactional write like every other function
// in this file — issueQuote()/acceptQuote()/rejectQuote()/expireQuote()
// (lib/commercial/quotes.ts) each already gate on
// authorizeCommercialRequest() before the state-changing UPDATE runs, so
// the same ADR-0003 §3 reasoning applies: the actor is already proven,
// and a dropped audit write afterward cannot retroactively make the
// action ambiguous.

export async function logQuoteCreated(params: {
  organisationId: string; userId: string; quoteId: string; after: { customer_id: string; currency: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.created',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: null, afterState: params.after,
  });
}

export async function logQuoteUpdated(params: {
  organisationId: string; userId: string; quoteId: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.updated',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: params.before, afterState: params.after,
  });
}

export async function logQuoteIssued(params: {
  organisationId: string; userId: string; quoteId: string; quoteNumber: string; totalCents: number;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.issued',
    resourceType: 'commercial_quote', resourceId: params.quoteId,
    beforeState: { status: 'DRAFT' }, afterState: { status: 'SENT', quote_number: params.quoteNumber, total_cents: params.totalCents },
  });
}

export async function logQuoteAccepted(params: { organisationId: string; userId: string; quoteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.accepted',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: { status: 'SENT' }, afterState: { status: 'ACCEPTED' },
  });
}

export async function logQuoteRejected(params: { organisationId: string; userId: string; quoteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.rejected',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: { status: 'SENT' }, afterState: { status: 'REJECTED' },
  });
}

export async function logQuoteExpired(params: { organisationId: string; userId: string | null; quoteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.expired',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: { status: 'SENT' }, afterState: { status: 'EXPIRED' },
  });
}

// Phase C3-POLISH-R §9 — "send/resend quote email" audit entry.
// Deliberately does NOT go through this file's own insertAuditLog()
// helper above, for the exact same reason
// lib/events/auditLog.ts's logTicketEmailResent() doesn't: the
// send-email route (app/api/commercial/quotes/[id]/send-email/route.ts)
// has its own Case D failure mode (the email provider already accepted
// the send, and only this audit write afterwards fails) that the route
// must detect and react to distinctly from an ordinary successful send —
// silently swallowing the error the way insertAuditLog() does would make
// that case indistinguishable from success. Callers must catch this
// function's thrown errors themselves.
//
// after_state is operational metadata only — result/recipient
// (masked)/provider message id — never the customer's full email
// address, the PDF content, or any snapshot field already living on the
// quote row itself.
export async function logQuoteEmailSent(params: {
  organisationId: string; userId: string | null; quoteId: string;
  result: 'sent' | 'failed' | 'unknown' | 'not_configured';
  recipientMasked: string;
  providerMessageId: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
    VALUES (
      ${crypto.randomUUID()}, ${params.organisationId}, ${params.userId}, 'commercial_quote.sent', 'commercial_quote', ${params.quoteId},
      NULL,
      ${JSON.stringify({
        result: params.result,
        recipient_masked: params.recipientMasked,
        provider_message_id: params.providerMessageId,
      })}::jsonb
    )
  `;
}

// Draft-only deletion (lib/commercial/quotes.ts's deleteDraftQuote()
// refuses anything but a DRAFT row) — narrow scope per the C3 brief's
// explicit "if draft deletion is supported: audit it and keep scope
// narrow" instruction.
export async function logQuoteDeleted(params: { organisationId: string; userId: string; quoteId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_quote.deleted',
    resourceType: 'commercial_quote', resourceId: params.quoteId, beforeState: { status: 'DRAFT' }, afterState: null,
  });
}

// ── Invoices (Phase C4.1) ─────────────────────────────────────────────
//
// Same discipline as the Quotes block above: issued/voided are genuine
// status-change events on a commercial document per ADR-0003 §2, and
// every one of these is still a best-effort, non-transactional write —
// createDraftInvoice()/createInvoiceFromQuote()/issueInvoice()/
// voidInvoice() (lib/commercial/invoices.ts) each already gate on
// authorization before the state-changing write runs (once a route layer
// exists in C4.2 — this phase's invoices.ts functions are called directly
// by tests, with no route wired up yet), so a dropped audit write
// afterward cannot retroactively make the action ambiguous.
//
// Never logs a full customer record, full email/phone, secrets, or
// provider data — only operational metadata (ids, amounts, statuses),
// matching every existing logQuote*() function's own payload boundary.

export async function logInvoiceCreated(params: {
  organisationId: string; userId: string; invoiceId: string; after: { customer_id: string; currency: string };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.created',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId, beforeState: null, afterState: params.after,
  });
}

// Distinct action name from logInvoiceCreated() — "created from a quote"
// is a materially different event (carries lineage) from an ordinary
// standalone creation, and a future audit-log query filtering on
// resource_type = 'commercial_invoice' should be able to tell the two
// apart without parsing after_state.
export async function logInvoiceCreatedFromQuote(params: {
  organisationId: string; userId: string; invoiceId: string; sourceQuoteId: string;
  after: { customer_id: string; currency: string; total_cents: number };
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.created_from_quote',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId,
    beforeState: { source_quote_id: params.sourceQuoteId }, afterState: params.after,
  });
}

export async function logInvoiceUpdated(params: {
  organisationId: string; userId: string; invoiceId: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.updated',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId, beforeState: params.before, afterState: params.after,
  });
}

export async function logInvoiceIssued(params: {
  organisationId: string; userId: string; invoiceId: string; invoiceNumber: string; totalCents: number;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.issued',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId,
    beforeState: { status: 'DRAFT' }, afterState: { status: 'ISSUED', invoice_number: params.invoiceNumber, total_cents: params.totalCents },
  });
}

// after_state carries the trimmed void_reason — operational context for
// why the document was voided, never customer PII, matching this file's
// existing payload-boundary discipline throughout.
export async function logInvoiceVoided(params: {
  organisationId: string; userId: string; invoiceId: string; voidReason: string;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.voided',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId,
    beforeState: { status: 'ISSUED' }, afterState: { status: 'VOID', void_reason: params.voidReason },
  });
}

// Draft-only deletion (lib/commercial/invoices.ts's deleteDraftInvoice()
// refuses anything but a DRAFT row) — narrow scope, mirrors
// logQuoteDeleted() exactly.
export async function logInvoiceDeleted(params: { organisationId: string; userId: string; invoiceId: string }): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId, userId: params.userId, action: 'commercial_invoice.deleted',
    resourceType: 'commercial_invoice', resourceId: params.invoiceId, beforeState: { status: 'DRAFT' }, afterState: null,
  });
}
