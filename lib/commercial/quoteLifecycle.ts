// Phase C3 — central quote status/transition authority. Every quote
// status mutation anywhere in this codebase (lib/commercial/quotes.ts's
// issueQuote/acceptQuote/rejectQuote/expireQuote — there is no other
// write path to commercial_quotes.status) MUST go through
// assertQuoteTransition() first, so the legal-transition rule lives in
// exactly one place rather than being re-derived at each call site.
//
// Five statuses, matching the C3 brief's own recommendation exactly.
// CANCELLED/VOID were assessed and deliberately NOT added: no C3
// workflow requirement produces a "the seller withdrew a SENT quote
// before the customer responded" case, and REJECTED already covers "the
// customer said no" — inventing a sixth status with no driving use case
// would be exactly the over-modelling the brief warns against. Revisit
// only if a future phase has a real, evidenced need for it.
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export const QUOTE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

// DRAFT is the only status a quote can ever be edited in (customer,
// notes, terms, expiry, and every line CRUD operation all gate on
// isQuoteEditable()). SENT/ACCEPTED/REJECTED/EXPIRED are all equally
// immutable — the C3 brief's "SENT: snapshot locked", "ACCEPTED:
// immutable commercial terms", "REJECTED: immutable issued terms",
// "EXPIRED: immutable issued terms" are the same rule stated four times,
// not four different rules.
const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'DRAFT';
}

export function isValidQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Throws a plain Error (never silently no-ops) for any transition not in
// the table above — including the same-status "transition" a naive
// caller might otherwise treat as a harmless no-op (e.g. SENT -> SENT is
// not a legal transition; issuing an already-issued quote a second time
// must be rejected explicitly, not silently accepted).
export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!isValidQuoteTransition(from, to)) {
    throw new Error(`Cannot transition quote from ${from} to ${to}`);
  }
}

export function assertQuoteEditable(status: QuoteStatus): void {
  if (!isQuoteEditable(status)) {
    throw new Error(`Quote is ${status} and can no longer be edited`);
  }
}
