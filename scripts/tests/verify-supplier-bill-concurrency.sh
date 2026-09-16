#!/usr/bin/env bash
# Phase C7.4 — real disposable-Postgres proof that the strict, VALUE-based
# over-billing guard (postSupplierBillAtomically(),
# lib/commercial/supplierBills.ts), the PO-cancel-vs-bill-post mutual
# exclusion (cancelPurchaseOrder(), lib/commercial/purchaseOrders.ts), and
# the canonicalised duplicate-supplier-invoice-number constraint are
# genuinely safe against a real Postgres engine.
#
# WHY THIS EXISTS: the over-billing guard is enforced by real Postgres
# row-level locking (FOR UPDATE on the bill row, the parent PO row, and
# every affected PO line row, acquired in deterministic id order) inside
# one atomic writable-CTE statement. A mocked sql client can simulate the
# RESULT of a race but cannot prove the race itself is actually
# race-safe — only real MVCC/locking semantics can. Likewise, the STORED
# GENERATED ALWAYS AS column backing supplier_invoice_number_canonical
# only exists as real behaviour inside an actual Postgres engine — no
# mock can fake generated-column evaluation. This harness follows the
# exact same disposable-container methodology as
# scripts/tests/verify-purchase-receipt-concurrency.sh: a fresh
# postgres:16-alpine container, created and destroyed by this script
# only, never touching Production/Neon or any already-running database.
#
# WHAT THIS DOES:
#   1. starts the disposable container and applies a minimal but REAL
#      schema covering organisations/users plus the Commercial Core/
#      Purchasing/Supplier-Bills tables actually touched by the code
#      under test — extracted verbatim from scripts/create-commercial-
#      core.sql, scripts/create-commercial-purchasing.sql, and
#      scripts/create-commercial-supplier-bills.sql (including its own
#      Section 0 UNIQUE(id, supplier_id) retrofit onto
#      commercial_purchase_orders) — plus minimal stub tables
#      (crm_companies, crm_contacts, commercial_cost_centres,
#      commercial_products, commercial_tax_codes) satisfying the
#      composite/plain FKs those real tables declare;
#   2. proves migration idempotency by applying the exact same DDL a
#      second time;
#   3. runs scripts/tests/supplierBillConcurrency.integration.test.ts via
#      `vitest --config vitest.integration.config.ts`, which imports the
#      REAL, completely unmodified createPurchaseOrder/issuePurchaseOrder/
#      cancelPurchaseOrder/createSupplierBill/addSupplierBillLine/
#      postSupplierBill/cancelSupplierBill and exercises sequential
#      over-billing rejection, genuine concurrent over-billing prevention,
#      concurrent non-conflicting posts, cancel-reopens-value,
#      PO-cancel-blocked-by-posted-bill, the PO-cancel-vs-bill-post race
#      invariant, and the real (trim + lower) canonicalised duplicate-
#      invoice-number constraint, against this real container.
#
# WHAT THIS DOES NOT DO: it is not wired into CI. It never touches
# Production or any already-running database — it creates and destroys
# its own disposable container, and cleans up on exit even on failure
# (trap on EXIT). audit_logs writes are best-effort and this harness
# deliberately does NOT create an audit_logs table.
#
# USAGE:
#   bash scripts/tests/verify-supplier-bill-concurrency.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="supplier-bill-concurrency-harness-$$"
HOST_PORT=$((20000 + RANDOM % 20000))
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER) on host port $HOST_PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
  -p "127.0.0.1:${HOST_PORT}:5432" \
  postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1
}

# ─── Minimal but real schema — Commercial Core/Purchasing/Supplier-Bills
# tables extracted verbatim from scripts/create-commercial-core.sql,
# scripts/create-commercial-purchasing.sql, and scripts/create-commercial-
# supplier-bills.sql. Unrelated verticals are minimal stubs. ───────────
SCHEMA_SQL='
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS crm_companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS crm_contacts (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS commercial_cost_centres (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  code            TEXT NOT NULL,
  UNIQUE (organisation_id, code),
  UNIQUE (id, organisation_id)
);
CREATE TABLE IF NOT EXISTS commercial_tax_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  code            TEXT NOT NULL,
  rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE (organisation_id, code),
  UNIQUE (id, organisation_id)
);
CREATE TABLE IF NOT EXISTS commercial_products (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT NOT NULL REFERENCES organisations(id),
  type                      TEXT NOT NULL DEFAULT '"'"'PRODUCT'"'"',
  name                      TEXT NOT NULL,
  sku                       TEXT,
  unit_label                TEXT,
  default_unit_price_cents  INTEGER NOT NULL DEFAULT 0,
  default_tax_code_id       UUID,
  UNIQUE (id, organisation_id)
);

CREATE TABLE IF NOT EXISTS commercial_document_sequences (
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  document_type    TEXT NOT NULL,
  prefix           TEXT NOT NULL DEFAULT '"'"''"'"',
  next_number      INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding          INTEGER NOT NULL DEFAULT 6 CHECK (padding >= 1),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, document_type)
);

CREATE TABLE IF NOT EXISTS commercial_suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       TEXT NOT NULL REFERENCES organisations(id),
  name                  TEXT NOT NULL,
  legal_name            TEXT,
  contact_name          TEXT,
  email                 TEXT,
  phone                 TEXT,
  billing_address       TEXT,
  tax_business_number   TEXT,
  supplier_reference    TEXT,
  payment_terms_days    INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  crm_company_id        UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  crm_contact_id        UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id)
);

CREATE TABLE IF NOT EXISTS commercial_purchase_orders (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                       TEXT NOT NULL REFERENCES organisations(id),
  supplier_id                           UUID NOT NULL,
  purchase_order_number                 TEXT,
  status                                TEXT NOT NULL DEFAULT '"'"'DRAFT'"'"'
                                         CHECK (status IN ('"'"'DRAFT'"'"', '"'"'PENDING_APPROVAL'"'"', '"'"'APPROVED'"'"', '"'"'ISSUED'"'"', '"'"'CANCELLED'"'"')),
  currency                              TEXT NOT NULL DEFAULT '"'"'AUD'"'"',
  cost_centre_id                        UUID,
  supplier_reference                    TEXT,
  delivery_date                         DATE,
  delivery_address_line1                TEXT,
  delivery_address_line2                TEXT,
  delivery_suburb                       TEXT,
  delivery_state                        TEXT,
  delivery_postcode                     TEXT,
  delivery_country                      TEXT,
  payment_terms_days                    INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  internal_notes                        TEXT,
  supplier_notes                        TEXT,
  subtotal_cents                        INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents                             INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents                           INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  CHECK (total_cents = subtotal_cents + tax_cents),
  supplier_name_snapshot                TEXT,
  supplier_legal_name_snapshot          TEXT,
  supplier_contact_name_snapshot        TEXT,
  supplier_email_snapshot               TEXT,
  supplier_phone_snapshot               TEXT,
  supplier_address_snapshot             TEXT,
  supplier_tax_business_number_snapshot TEXT,
  supplier_reference_snapshot           TEXT,
  payment_terms_days_snapshot           INTEGER,
  return_reason                         TEXT,
  cancel_reason                         TEXT,
  created_by                            TEXT REFERENCES users(id),
  submitted_by                          TEXT REFERENCES users(id),
  approved_by                           TEXT REFERENCES users(id),
  issued_by                             TEXT REFERENCES users(id),
  cancelled_by                          TEXT REFERENCES users(id),
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                          TIMESTAMPTZ,
  approved_at                           TIMESTAMPTZ,
  issued_at                             TIMESTAMPTZ,
  cancelled_at                          TIMESTAMPTZ,
  UNIQUE (organisation_id, purchase_order_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_purchase_orders_supplier_org_fkey
    FOREIGN KEY (supplier_id, organisation_id)
    REFERENCES commercial_suppliers (id, organisation_id),
  CONSTRAINT commercial_purchase_orders_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id)
);

-- Real, verbatim: scripts/create-commercial-supplier-bills.sql Section 0.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '"'"'commercial_purchase_orders_id_supplier_id_key'"'"'
  ) THEN
    ALTER TABLE commercial_purchase_orders
      ADD CONSTRAINT commercial_purchase_orders_id_supplier_id_key UNIQUE (id, supplier_id);
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS commercial_purchase_order_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        TEXT NOT NULL REFERENCES organisations(id),
  purchase_order_id      UUID NOT NULL,
  product_id             UUID,
  cost_centre_id         UUID,
  position               INTEGER NOT NULL DEFAULT 0,
  description_snapshot   TEXT NOT NULL,
  sku_snapshot           TEXT,
  unit_snapshot          TEXT,
  quantity               INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents       INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  tax_code_snapshot      TEXT,
  tax_rate_snapshot      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100),
  line_subtotal_cents    INTEGER NOT NULL DEFAULT 0 CHECK (line_subtotal_cents >= 0),
  line_tax_cents         INTEGER NOT NULL DEFAULT 0 CHECK (line_tax_cents >= 0),
  line_total_cents       INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_po_lines_po_org_fkey
    FOREIGN KEY (purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_po_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id),
  CONSTRAINT commercial_po_lines_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id)
);

-- Minimal stub of commercial_purchase_receipts (real shape: scripts/
-- create-commercial-purchase-receipts.sql Section 1) — cancelPurchaseOrder()
-- queries this table directly in its own C7.3 guard clause regardless of
-- which document type is under test here, so it must exist even though
-- this suite never posts a receipt.
CREATE TABLE IF NOT EXISTS commercial_purchase_receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT NOT NULL REFERENCES organisations(id),
  purchase_order_id   UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT '"'"'DRAFT'"'"' CHECK (status IN ('"'"'DRAFT'"'"', '"'"'POSTED'"'"', '"'"'CANCELLED'"'"')),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_purchase_receipts_po_org_fkey
    FOREIGN KEY (purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id)
);

-- Real, verbatim: scripts/create-commercial-supplier-bills.sql Section 1.
CREATE TABLE IF NOT EXISTS commercial_supplier_bills (
  id                                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                        TEXT NOT NULL REFERENCES organisations(id),
  supplier_id                            UUID NOT NULL,
  source_purchase_order_id               UUID NOT NULL,
  supplier_invoice_number                TEXT NOT NULL,
  supplier_invoice_number_canonical      TEXT GENERATED ALWAYS AS (lower(btrim(supplier_invoice_number))) STORED,
  bill_number                            TEXT,
  status                                 TEXT NOT NULL DEFAULT '"'"'DRAFT'"'"' CHECK (status IN ('"'"'DRAFT'"'"', '"'"'POSTED'"'"', '"'"'CANCELLED'"'"')),
  currency                               TEXT NOT NULL DEFAULT '"'"'AUD'"'"',
  bill_date                              DATE,
  due_date                               DATE,
  subtotal_cents                         INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents                              INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents                            INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  CHECK (total_cents = subtotal_cents + tax_cents),
  supplier_name_snapshot                 TEXT,
  supplier_legal_name_snapshot           TEXT,
  supplier_contact_name_snapshot         TEXT,
  supplier_email_snapshot                TEXT,
  supplier_phone_snapshot                TEXT,
  supplier_address_snapshot              TEXT,
  supplier_tax_business_number_snapshot  TEXT,
  supplier_reference_snapshot            TEXT,
  cancel_reason                          TEXT,
  created_by                             TEXT REFERENCES users(id),
  posted_by                              TEXT REFERENCES users(id),
  cancelled_by                           TEXT REFERENCES users(id),
  created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at                              TIMESTAMPTZ,
  cancelled_at                           TIMESTAMPTZ,
  UNIQUE (organisation_id, bill_number),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_supplier_bills_supplier_invoice_unique
    UNIQUE (organisation_id, supplier_id, supplier_invoice_number_canonical),
  CONSTRAINT commercial_supplier_bills_po_org_fkey
    FOREIGN KEY (source_purchase_order_id, organisation_id)
    REFERENCES commercial_purchase_orders (id, organisation_id),
  CONSTRAINT commercial_supplier_bills_po_supplier_fkey
    FOREIGN KEY (source_purchase_order_id, supplier_id)
    REFERENCES commercial_purchase_orders (id, supplier_id),
  CONSTRAINT commercial_supplier_bills_supplier_org_fkey
    FOREIGN KEY (supplier_id, organisation_id)
    REFERENCES commercial_suppliers (id, organisation_id)
);

-- Real, verbatim: scripts/create-commercial-supplier-bills.sql Section 2.
CREATE TABLE IF NOT EXISTS commercial_supplier_bill_lines (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                TEXT NOT NULL REFERENCES organisations(id),
  supplier_bill_id               UUID NOT NULL,
  source_purchase_order_line_id  UUID NOT NULL,
  product_id                     UUID,
  position                       INTEGER NOT NULL DEFAULT 0,
  description_snapshot           TEXT NOT NULL,
  sku_snapshot                   TEXT,
  unit_snapshot                  TEXT,
  quantity                       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents               INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  tax_code_snapshot              TEXT,
  tax_rate_snapshot              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_snapshot >= 0 AND tax_rate_snapshot <= 100),
  line_subtotal_cents            INTEGER NOT NULL DEFAULT 0 CHECK (line_subtotal_cents >= 0),
  line_tax_cents                 INTEGER NOT NULL DEFAULT 0 CHECK (line_tax_cents >= 0),
  line_total_cents               INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_supplier_bill_lines_bill_org_fkey
    FOREIGN KEY (supplier_bill_id, organisation_id)
    REFERENCES commercial_supplier_bills (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT commercial_supplier_bill_lines_po_line_org_fkey
    FOREIGN KEY (source_purchase_order_line_id, organisation_id)
    REFERENCES commercial_purchase_order_lines (id, organisation_id),
  CONSTRAINT commercial_supplier_bill_lines_product_org_fkey
    FOREIGN KEY (product_id, organisation_id)
    REFERENCES commercial_products (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_supplier_bill_lines_org_po_line ON commercial_supplier_bill_lines(organisation_id, source_purchase_order_line_id);
'

echo ""
echo "=== 1. SCHEMA APPLIES FRESH ==="
if echo "$SCHEMA_SQL" | psql_exec >/dev/null 2>&1; then
  echo "  PASS: schema applied cleanly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: schema failed to apply"
  echo "$SCHEMA_SQL" | psql_exec
  FAIL=$((FAIL + 1))
  FAILURES+=("schema apply")
fi

echo ""
echo "=== 2. SCHEMA IDEMPOTENCY — re-applying the exact same DDL must not error ==="
if echo "$SCHEMA_SQL" | psql_exec >/dev/null 2>&1; then
  echo "  PASS: re-applying schema is a no-op, no error"
  PASS=$((PASS + 1))
else
  echo "  FAIL: re-applying schema errored — not idempotent"
  FAIL=$((FAIL + 1))
  FAILURES+=("schema idempotency")
fi

echo ""
echo "=== 3. REAL OVER-BILLING CONCURRENCY + PO-CANCEL-RACE + DUPLICATE-INVOICE SUITE (vitest against this same container) ==="
export DATABASE_URL="postgresql://postgres:test@localhost:${HOST_PORT}/testdb"
echo "DATABASE_URL=$DATABASE_URL (disposable container only)"
cd "$REPO_ROOT"
npx vitest run --config vitest.integration.config.ts scripts/tests/supplierBillConcurrency.integration.test.ts
VITEST_RESULT=$?
if [ "$VITEST_RESULT" -eq 0 ]; then
  echo "  PASS: supplierBillConcurrency.integration.test.ts (all cases)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: supplierBillConcurrency.integration.test.ts (exit $VITEST_RESULT)"
  FAIL=$((FAIL + 1))
  FAILURES+=("vitest integration suite")
fi

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
echo "All checks passed."
exit 0
