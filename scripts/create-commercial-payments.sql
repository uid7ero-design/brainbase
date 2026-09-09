-- Phase C5.2 — Payments Foundation. Adds the smallest schema extension
-- required to record customer payments against Commercial invoices,
-- per the C5.1 architecture review's own recommended minimum model.
-- This migration is prepared and rehearsed only; it is NOT run against
-- production during this phase (see the C5.2 brief's explicit
-- "no production migration" boundary — that remains a separate,
-- later C5.3 gate).
--
-- Two tables, not one, deliberately — see the C5.1 report's own
-- explicit reasoning:
--   - commercial_payments is the receipt/remittance itself.
--   - commercial_payment_allocations is the join to the invoice(s) it
--     pays. For C5.2 this table carries exactly ONE allocation row per
--     payment (enforced below by UNIQUE (organisation_id, payment_id)),
--     because a payment can only apply to one invoice in this phase —
--     but the allocation concept exists as its own table now
--     specifically so that a future "one remittance across multiple
--     invoices" feature is purely additive (drop the one-allocation
--     constraint, add UI to split a payment across invoices) with
--     ZERO migration of existing rows, rather than requiring every
--     existing payment to be retrofitted into a join table it didn't
--     have before.
--
-- Deliberately does NOT touch commercial_invoices at all — no
-- payment_status, no amount_paid, no PAID status value. Payment state
-- (amount_paid_cents / outstanding_balance_cents / payment_state) is
-- derived at read time from active (non-REVERSED) allocations, exactly
-- mirroring the existing `overdue` field's own SQL-computed, read-only,
-- separate-extended-type pattern (see lib/commercial/invoices.ts) —
-- never a stored/cached column that could drift from the true sum of
-- payments. InvoiceStatus remains exactly DRAFT | ISSUED | VOID.
--
-- Money: INTEGER cents throughout, per ADR-0002
-- (docs/architecture/decisions/0002-money-and-currency-standard.md) —
-- no exception, matching every other Commercial table.
--
-- Tenant scoping: both tables carry organisation_id TEXT NOT NULL
-- REFERENCES organisations(id), and every cross-table reference is a
-- composite (id, organisation_id) FK — never a plain id FK — matching
-- this codebase's established tenant-integrity-anchor convention
-- (see scripts/create-commercial-quotes.sql's own Section 0 for the
-- precedent this follows). commercial_invoices already carries
-- UNIQUE (id, organisation_id) from its own original creation (Phase
-- C4.1) — no retrofit is required before commercial_payment_allocations
-- can composite-FK onto it.
--
-- Immutability / correction: a commercial_payments row is never
-- UPDATEd except for the single, guarded RECORDED -> REVERSED
-- transition (reversed_at/reversed_by/reversal_reason populated,
-- nothing else ever changes) and never DELETEd — mirroring
-- commercial_invoices' own voidInvoice() shape exactly (append-only
-- correction, never a mutation of the original financial fact).
--
-- Provider/reference idempotency: provider + provider_reference are
-- reserved, nullable columns for a FUTURE payment-provider/accounting
-- import integration (not built in C5.2 — no Stripe/card collection,
-- no accounting sync). The partial unique index below
-- (organisation_id, provider, provider_reference) WHERE
-- provider_reference IS NOT NULL is the same idempotency idiom already
-- proven in this codebase for
-- event_orders.stripe_checkout_session_id (scripts/add-events-payments.sql)
-- — a retried webhook or a re-run import can never create a duplicate
-- payment row for the same external event. The ordinary manual
-- "Record Payment" UI/API path in C5.2 never sets provider/
-- provider_reference at all; these columns exist as a forward-
-- compatible slot only.
--
-- Idempotency of this file itself: every statement uses IF NOT EXISTS
-- (or an existence-checked DO block for the two constraint types that
-- don't support the keyword directly), matching every other Commercial
-- migration in this repository. No DROP, no DELETE, no TRUNCATE, no
-- ALTER ... DROP anywhere in this file. Safe to re-run.
--
-- NOT run automatically — a prepared migration artifact, to be
-- rehearsed against an isolated Neon Preview branch (or a disposable
-- local Postgres) before any production execution, following this
-- repository's existing hand-written-SQL migration convention (see
-- CLAUDE.md — no prisma/migrations directory).

-- ── 1. Payments (the receipt/remittance itself) ──────────────────────
CREATE TABLE IF NOT EXISTS commercial_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT NOT NULL REFERENCES organisations(id),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  currency            TEXT NOT NULL DEFAULT 'AUD',
  method              TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  reference           TEXT,
  provider            TEXT,
  provider_reference  TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED', 'REVERSED')),
  recorded_by         TEXT REFERENCES users(id),
  reversed_at         TIMESTAMPTZ,
  reversed_by         TEXT REFERENCES users(id),
  reversal_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A provider-attributed reference can never exist without knowing
  -- which provider it came from — prevents a malformed/partial future
  -- integration write from ever landing an orphan provider_reference.
  CONSTRAINT commercial_payments_provider_reference_requires_provider
    CHECK (provider_reference IS NULL OR (provider IS NOT NULL AND provider <> '')),
  -- Tenant-integrity anchor — lets commercial_payment_allocations
  -- composite-FK onto this table immediately, matching this codebase's
  -- established (id, organisation_id) convention.
  UNIQUE (id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_payments_org ON commercial_payments(organisation_id);
-- "Recent payments" — organisation-scoped, newest first.
CREATE INDEX IF NOT EXISTS idx_commercial_payments_org_received ON commercial_payments(organisation_id, received_at DESC);
-- External-event idempotency lookup. Partial (only when
-- provider_reference is actually set) and UNIQUE — this is the
-- constraint itself, not merely a lookup accelerator: a second insert
-- for the same (organisation_id, provider, provider_reference) tuple
-- is rejected by Postgres, not just found slowly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_payments_provider_reference
  ON commercial_payments(organisation_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

-- ── 2. Payment allocations (the join to the invoice it pays) ─────────
--
-- Exactly one allocation per payment in C5.2 (UNIQUE (organisation_id,
-- payment_id) below) — a payment cannot yet be split across multiple
-- invoices. See this file's own header for why this is still a
-- separate table rather than a bare invoice_id column on
-- commercial_payments directly.
CREATE TABLE IF NOT EXISTS commercial_payment_allocations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         TEXT NOT NULL REFERENCES organisations(id),
  payment_id              UUID NOT NULL,
  invoice_id              UUID NOT NULL,
  allocated_amount_cents  INTEGER NOT NULL CHECK (allocated_amount_cents > 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commercial_payment_allocations_payment_org_fkey
    FOREIGN KEY (payment_id, organisation_id)
    REFERENCES commercial_payments (id, organisation_id),
  CONSTRAINT commercial_payment_allocations_invoice_org_fkey
    FOREIGN KEY (invoice_id, organisation_id)
    REFERENCES commercial_invoices (id, organisation_id),
  -- Tenant-integrity anchor, matching every other Commercial table —
  -- no known future child needs it yet, but every sibling table in
  -- this schema carries it unconditionally rather than adding it only
  -- once a consumer exists.
  UNIQUE (id, organisation_id),
  -- C5.2's own explicit one-payment-to-one-invoice rule, enforced
  -- structurally rather than only in application code. Dropping this
  -- constraint (and this constraint ALONE) is the entire schema change
  -- a future multi-invoice-remittance feature would need — no other
  -- column, table, or existing row requires any change.
  UNIQUE (organisation_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_payment_allocations_org_invoice ON commercial_payment_allocations(organisation_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_commercial_payment_allocations_org_payment ON commercial_payment_allocations(organisation_id, payment_id);
