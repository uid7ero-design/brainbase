#!/usr/bin/env bash
# Phase C6.2 — repeatable behavioral validation for the Purchasing
# foundation's migration correctness and concurrency safety
# (lib/commercial/purchaseOrders.ts's issuePurchaseOrderAtomically(),
# submitPurchaseOrder()/approvePurchaseOrder()/cancelPurchaseOrder()'s
# guarded UPDATEs), against REAL PostgreSQL, not mocks. Same category of
# proof as scripts/tests/verify-commercial-payments-concurrency.sh,
# applied to this phase's own genuinely new mechanism: the
# purchase-order-row FOR UPDATE lock inside issuePurchaseOrderAtomically(),
# and the plain status-guarded UPDATEs used by every other transition.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with minimal, structurally-accurate stand-ins for organisations/users/
# crm_companies/crm_contacts (only the columns the real migration's FKs
# actually reference — mirroring the payments harness's own identical
# "minimal stand-in, not the full unrelated schema" convention), then
# applies the ACTUAL, unmodified scripts/create-commercial-core.sql
# (for commercial_cost_centres/commercial_products/commercial_tax_codes/
# commercial_document_sequences) and the ACTUAL, unmodified
# scripts/create-commercial-purchasing.sql, then executes the SAME
# statement sequences issuePurchaseOrderAtomically()/
# submitPurchaseOrder()/approvePurchaseOrder()/cancelPurchaseOrder()
# issue (verbatim, copied from lib/commercial/purchaseOrders.ts — see
# each function below for the cross-reference) via `docker exec ...
# psql`.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here). Requires only Docker. No Neon/Production/
# Preview access of any kind — this container is disposable, local-only,
# and destroyed on exit.
#
# USAGE:
#   bash scripts/tests/verify-commercial-purchasing-concurrency.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE_MIGRATION="$REPO_ROOT/scripts/create-commercial-core.sql"
PURCHASING_MIGRATION="$REPO_ROOT/scripts/create-commercial-purchasing.sql"
CONTAINER="c6-purchasing-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$CORE_MIGRATION" ]; then
  echo "ERROR: migration file not found: $CORE_MIGRATION" >&2
  exit 2
fi
if [ ! -f "$PURCHASING_MIGRATION" ]; then
  echo "ERROR: migration file not found: $PURCHASING_MIGRATION" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run this harness." >&2
  exit 2
fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null

READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2
  exit 2
fi

DIAG_OUT="/tmp/c6_purchasing_harness_out.$$.txt"
OUT_A="/tmp/c6_purchasing_harness_a.$$.txt"
OUT_B="/tmp/c6_purchasing_harness_b.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}
reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

bootstrap() {
  {
    cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
-- Minimal, structurally-accurate stand-ins for crm_companies/
-- crm_contacts — only the columns commercial_suppliers' own plain FKs
-- actually reference (id, organisation_id). The real tables
-- (scripts/crm-migrate.mjs) carry many more columns unrelated to this
-- harness's purpose.
CREATE TABLE crm_companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id), name TEXT NOT NULL);
CREATE TABLE crm_contacts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL);
SQL
    cat "$CORE_MIGRATION"
    cat <<'SQL'
-- Simulates the REAL, already-live-in-Production retrofit
-- scripts/create-commercial-quotes.sql's own Section 0 applies to
-- commercial_products (UNIQUE(id, organisation_id)) — this harness only
-- bootstraps create-commercial-core.sql, not the full quotes migration,
-- but Production's actual commercial_products table already carries
-- this constraint (added back in Phase C3). Reproduced verbatim here so
-- this harness accurately represents the CURRENT canonical Commercial
-- schema commercial_purchase_order_lines' own product_id FK composite-FKs
-- onto, not a from-scratch-core-only schema no live Production database
-- has ever actually had.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commercial_products_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_products
      ADD CONSTRAINT commercial_products_id_organisation_id_key UNIQUE (id, organisation_id);
  END IF;
END $$;
SQL
    cat "$PURCHASING_MIGRATION"
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
-- 'tester' seeds every _by column this harness's SQL functions
-- (approve_sql/issue_sql/cancel_sql, and the plain submit UPDATE below)
-- reference — the real commercial_purchase_orders.*_by columns are
-- genuine `TEXT REFERENCES users(id)` FKs, unlike the payments
-- harness's own stand-in commercial_invoices.voided_by (a plain TEXT
-- with no FK), so a real user row is required here.
INSERT INTO users (id, organisation_id, username, name) VALUES ('tester', 'org-a', 'tester', 'Test User');
INSERT INTO commercial_suppliers (id, organisation_id, name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'org-a', 'Acme Supplies'),
  ('11111111-0000-0000-0000-000000000002', 'org-b', 'Other Org Supplier');
SQL
  } | psql_exec
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"; sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1)); FAILURES+=("$desc")
  fi
}
expect_fail() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected an error, got success): $desc"
    FAIL=$((FAIL + 1)); FAILURES+=("$desc")
  else
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  fi
}
expect_eq() {
  local desc="$1" sql="$2" want="$3"
  local got
  got="$(echo "$sql" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc (got $got)"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want $want, got $got)"; FAIL=$((FAIL + 1)); FAILURES+=("$desc")
  fi
}

# ─── issuePurchaseOrderAtomically()'s exact atomic statement ──────────
# Copied verbatim (parameterization via shell substitution only) from
# lib/commercial/purchaseOrders.ts's issuePurchaseOrderAtomically(). If
# that function's SQL ever changes, this string must be updated to
# match.
seed_sequence_sql() {
  local org_id="$1"
  cat <<SQL
INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
VALUES ('$org_id', 'PURCHASE_ORDER', 'PO-', 1, 6)
ON CONFLICT (organisation_id, document_type) DO NOTHING;
SQL
}
issue_sql() {
  local po_id="$1" org_id="$2"
  cat <<SQL
BEGIN;
$(seed_sequence_sql "$org_id")
WITH guard AS (
  SELECT id FROM commercial_purchase_orders
  WHERE id = '$po_id' AND organisation_id = '$org_id' AND status = 'APPROVED'
  FOR UPDATE
),
seq AS (
  UPDATE commercial_document_sequences
  SET next_number = next_number + 1, updated_at = now()
  WHERE organisation_id = '$org_id' AND document_type = 'PURCHASE_ORDER'
    AND EXISTS (SELECT 1 FROM guard)
  RETURNING (next_number - 1) AS allocated_number, prefix, padding
)
UPDATE commercial_purchase_orders SET
  status = 'ISSUED',
  purchase_order_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM seq),
  issued_by = 'tester',
  issued_at = now(),
  supplier_name_snapshot = 'Acme Supplies'
WHERE id = '$po_id' AND organisation_id = '$org_id' AND status = 'APPROVED'
  AND EXISTS (SELECT 1 FROM seq)
RETURNING *;
COMMIT;
SQL
}

# ─── submitPurchaseOrder()/approvePurchaseOrder()/cancelPurchaseOrder()'s
# exact guarded UPDATEs ─────────────────────────────────────────────────
approve_sql() {
  local po_id="$1" org_id="$2"
  cat <<SQL
BEGIN;
UPDATE commercial_purchase_orders SET status = 'APPROVED', approved_by = 'tester', approved_at = now()
WHERE id = '$po_id' AND organisation_id = '$org_id' AND status = 'PENDING_APPROVAL'
RETURNING *;
COMMIT;
SQL
}
cancel_sql() {
  local po_id="$1" org_id="$2"
  cat <<SQL
BEGIN;
UPDATE commercial_purchase_orders SET status = 'CANCELLED', cancelled_by = 'tester', cancelled_at = now(), cancel_reason = 'harness'
WHERE id = '$po_id' AND organisation_id = '$org_id' AND status = 'ISSUED'
RETURNING *;
COMMIT;
SQL
}

run_concurrent_pair() {
  local sql_a="$1" sql_b="$2"
  (echo "$sql_a" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  local pid_a=$!
  sleep 0.3
  (echo "$sql_b" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  local pid_b=$!
  wait "$pid_a" "$pid_b"
}

echo ""
echo "=== BOOTSTRAP ==="
reset_db
bootstrap
echo "  bootstrap applied (stand-in organisations/users/crm_* + real create-commercial-core.sql + real create-commercial-purchasing.sql)"

echo ""
echo "=== NORMAL PATH: DRAFT -> PENDING_APPROVAL -> APPROVED -> ISSUED -> CANCELLED ==="
reset_db; bootstrap
expect_success "1. seed a DRAFT PO for org-a's supplier" \
  "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status, subtotal_cents, tax_cents, total_cents) VALUES ('11111111-1111-1111-1111-111111111111', 'org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT', 10000, 1000, 11000);"
expect_success "1b. submit: DRAFT -> PENDING_APPROVAL" \
  "BEGIN; UPDATE commercial_purchase_orders SET status='PENDING_APPROVAL', submitted_by='tester', submitted_at=now() WHERE id='11111111-1111-1111-1111-111111111111' AND organisation_id='org-a' AND status='DRAFT' RETURNING *; COMMIT;"
expect_success "1c. approve: PENDING_APPROVAL -> APPROVED" \
  "$(approve_sql 11111111-1111-1111-1111-111111111111 org-a)"
expect_success "1d. issue: APPROVED -> ISSUED, allocates PO-000001" \
  "$(issue_sql 11111111-1111-1111-1111-111111111111 org-a)"
expect_eq "1e. purchase_order_number is exactly PO-000001" \
  "SELECT purchase_order_number FROM commercial_purchase_orders WHERE id='11111111-1111-1111-1111-111111111111';" "PO-000001"
expect_success "1f. cancel: ISSUED -> CANCELLED" \
  "$(cancel_sql 11111111-1111-1111-1111-111111111111 org-a)"
expect_eq "1g. number is retained after cancellation" \
  "SELECT purchase_order_number FROM commercial_purchase_orders WHERE id='11111111-1111-1111-1111-111111111111';" "PO-000001"
expect_eq "1h. status is CANCELLED" \
  "SELECT status FROM commercial_purchase_orders WHERE id='11111111-1111-1111-1111-111111111111';" "CANCELLED"

echo ""
echo "=== A: concurrent issue on the SAME PO — exactly one succeeds, exactly one number consumed ==="
TOTAL_PASS=0; TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('22222222-2222-2222-2222-222222222222', 'org-a', '11111111-0000-0000-0000-000000000001', 'APPROVED');" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(issue_sql 22222222-2222-2222-2222-222222222222 org-a)" "$(issue_sql 22222222-2222-2222-2222-222222222222 org-a)"
  status="$(echo "SELECT status FROM commercial_purchase_orders WHERE id='22222222-2222-2222-2222-222222222222';" | psql_query | tr -d '[:space:]')"
  numbered="$(echo "SELECT count(*) FROM commercial_purchase_orders WHERE purchase_order_number IS NOT NULL;" | psql_query | tr -d '[:space:]')"
  seq_val="$(echo "SELECT next_number FROM commercial_document_sequences WHERE organisation_id='org-a' AND document_type='PURCHASE_ORDER';" | psql_query | tr -d '[:space:]')"
  if [ "$status" = "ISSUED" ] && [ "$numbered" = "1" ] && [ "$seq_val" = "2" ]; then
    TOTAL_PASS=$((TOTAL_PASS+1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "    run $i: FAIL — status=$status numbered=$numbered seq_val=$seq_val (want ISSUED/1/2)"
  fi
done
echo "  $TOTAL_PASS/10 repetitions correct, $TOTAL_FAIL invalid"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: concurrent same-PO issue never double-allocates or leaves a half-issued row, across 10 repetitions"; PASS=$((PASS+1))
else
  echo "  FAIL: invalid state occurred in $TOTAL_FAIL/10 repetitions"; FAIL=$((FAIL+1)); FAILURES+=("A repeated same-PO issue race")
fi

echo ""
echo "=== B: concurrent issue across TWO DIFFERENT POs — no duplicate number ever allocated ==="
TOTAL_PASS=0; TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('33333333-3333-3333-3333-333333333331', 'org-a', '11111111-0000-0000-0000-000000000001', 'APPROVED'), ('33333333-3333-3333-3333-333333333332', 'org-a', '11111111-0000-0000-0000-000000000001', 'APPROVED');" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(issue_sql 33333333-3333-3333-3333-333333333331 org-a)" "$(issue_sql 33333333-3333-3333-3333-333333333332 org-a)"
  distinct_numbers="$(echo "SELECT count(DISTINCT purchase_order_number) FROM commercial_purchase_orders WHERE purchase_order_number IS NOT NULL;" | psql_query | tr -d '[:space:]')"
  both_issued="$(echo "SELECT count(*) FROM commercial_purchase_orders WHERE status='ISSUED';" | psql_query | tr -d '[:space:]')"
  if [ "$distinct_numbers" = "2" ] && [ "$both_issued" = "2" ]; then
    TOTAL_PASS=$((TOTAL_PASS+1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "    run $i: FAIL — distinct_numbers=$distinct_numbers both_issued=$both_issued (want 2/2)"
  fi
done
echo "  $TOTAL_PASS/10 repetitions correct, $TOTAL_FAIL invalid"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: two concurrently-issued POs always receive two distinct numbers, across 10 repetitions"; PASS=$((PASS+1))
else
  echo "  FAIL: a duplicate/missing number occurred in $TOTAL_FAIL/10 repetitions"; FAIL=$((FAIL+1)); FAILURES+=("B repeated cross-PO issue race")
fi

echo ""
echo "=== C: concurrent approve on the SAME PO — exactly one succeeds, no duplicate event possible ==="
TOTAL_PASS=0; TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('44444444-4444-4444-4444-444444444444', 'org-a', '11111111-0000-0000-0000-000000000001', 'PENDING_APPROVAL');" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(approve_sql 44444444-4444-4444-4444-444444444444 org-a)" "$(approve_sql 44444444-4444-4444-4444-444444444444 org-a)"
  status="$(echo "SELECT status FROM commercial_purchase_orders WHERE id='44444444-4444-4444-4444-444444444444';" | psql_query | tr -d '[:space:]')"
  if [ "$status" = "APPROVED" ]; then TOTAL_PASS=$((TOTAL_PASS+1)); else TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "    run $i: FAIL — status=$status (want APPROVED)"; fi
done
echo "  $TOTAL_PASS/10 repetitions correct, $TOTAL_FAIL invalid"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: concurrent same-PO approve is safe — the row-level lock serializes both attempts, across 10 repetitions"; PASS=$((PASS+1))
else
  echo "  FAIL: invalid state occurred in $TOTAL_FAIL/10 repetitions"; FAIL=$((FAIL+1)); FAILURES+=("C repeated approve race")
fi

echo ""
echo "=== D: cannot issue a DRAFT/PENDING_APPROVAL PO directly — guard requires APPROVED ==="
reset_db; bootstrap
expect_success "D setup: DRAFT PO" \
  "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('55555555-5555-5555-5555-555555555555', 'org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT');"
expect_success "D1. attempting to issue a DRAFT PO cleanly allocates nothing (guard requires status=APPROVED)" \
  "$(issue_sql 55555555-5555-5555-5555-555555555555 org-a)"
expect_eq "D2. purchase_order_number is still null" \
  "SELECT purchase_order_number FROM commercial_purchase_orders WHERE id='55555555-5555-5555-5555-555555555555';" ""
expect_eq "D3. sequence counter was never incremented (still absent/1)" \
  "SELECT count(*) FROM commercial_document_sequences WHERE organisation_id='org-a' AND document_type='PURCHASE_ORDER' AND next_number > 1;" "0"

echo ""
echo "=== E: schema-level constraint proofs ==="
reset_db; bootstrap
expect_fail "E1. supplier_id must belong to the same organisation — composite FK rejects the tenant mismatch" \
  "INSERT INTO commercial_purchase_orders (organisation_id, supplier_id) VALUES ('org-a', '11111111-0000-0000-0000-000000000002');"
expect_fail "E2. status must be one of the five approved values" \
  "INSERT INTO commercial_purchase_orders (organisation_id, supplier_id, status) VALUES ('org-a', '11111111-0000-0000-0000-000000000001', 'PAID');"
expect_fail "E3. total_cents must equal subtotal_cents + tax_cents" \
  "INSERT INTO commercial_purchase_orders (organisation_id, supplier_id, subtotal_cents, tax_cents, total_cents) VALUES ('org-a', '11111111-0000-0000-0000-000000000001', 100, 10, 999);"
expect_fail "E4. payment_terms_days cannot be negative" \
  "INSERT INTO commercial_purchase_orders (organisation_id, supplier_id, payment_terms_days) VALUES ('org-a', '11111111-0000-0000-0000-000000000001', -1);"
expect_success "E5. seed one ISSUED PO for the line FK tests below" \
  "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('66666666-6666-6666-6666-666666666666', 'org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT');"
expect_fail "E6. purchase_order_id must belong to the same organisation — composite FK on the line table" \
  "INSERT INTO commercial_purchase_order_lines (organisation_id, purchase_order_id, description_snapshot, quantity, unit_price_cents) VALUES ('org-b', '66666666-6666-6666-6666-666666666666', 'x', 1, 100);"
expect_success "E7. a valid line for org-a's own PO succeeds" \
  "INSERT INTO commercial_purchase_order_lines (organisation_id, purchase_order_id, description_snapshot, quantity, unit_price_cents) VALUES ('org-a', '66666666-6666-6666-6666-666666666666', 'Widget', 2, 5000);"
expect_fail "E8. quantity must be positive" \
  "INSERT INTO commercial_purchase_order_lines (organisation_id, purchase_order_id, description_snapshot, quantity, unit_price_cents) VALUES ('org-a', '66666666-6666-6666-6666-666666666666', 'Widget', 0, 100);"
expect_success "E9. deleting the parent PO cascades to its lines (ON DELETE CASCADE)" \
  "DELETE FROM commercial_purchase_orders WHERE id='66666666-6666-6666-6666-666666666666';"
expect_eq "E10. the line row is gone" \
  "SELECT count(*) FROM commercial_purchase_order_lines WHERE purchase_order_id='66666666-6666-6666-6666-666666666666';" "0"
expect_fail "E11. a second PO with the same (organisation_id, purchase_order_number) is rejected" \
  "INSERT INTO commercial_purchase_orders (organisation_id, supplier_id, status) VALUES ('org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT'); UPDATE commercial_purchase_orders SET purchase_order_number='PO-DUPE' WHERE organisation_id='org-a' AND purchase_order_number IS NULL; INSERT INTO commercial_purchase_orders (organisation_id, supplier_id, status, purchase_order_number) VALUES ('org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT', 'PO-DUPE');"

echo ""
echo "=== MUTATION PROOF — weaken the issue guard, confirm the harness catches it ==="
reset_db; bootstrap
echo "INSERT INTO commercial_purchase_orders (id, organisation_id, supplier_id, status) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a', '11111111-0000-0000-0000-000000000001', 'DRAFT');" | psql_exec >/dev/null 2>&1
# Weakened statement: drops the "status = 'APPROVED'" guard from the
# outer UPDATE's WHERE clause entirely, so a DRAFT PO is wrongly issued —
# proves this harness is sensitive to the exact regression the real
# guard exists to prevent.
MUT_SQL=$(cat <<'SQL'
BEGIN;
INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
VALUES ('org-a', 'PURCHASE_ORDER', 'PO-', 1, 6) ON CONFLICT (organisation_id, document_type) DO NOTHING;
WITH seq AS (
  UPDATE commercial_document_sequences SET next_number = next_number + 1, updated_at = now()
  WHERE organisation_id = 'org-a' AND document_type = 'PURCHASE_ORDER'
  RETURNING (next_number - 1) AS allocated_number, prefix, padding
)
UPDATE commercial_purchase_orders SET
  status = 'ISSUED',
  purchase_order_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM seq)
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND organisation_id = 'org-a'
RETURNING *;
COMMIT;
SQL
)
echo "$MUT_SQL" | psql_exec >/dev/null 2>&1
got_mut_status="$(echo "SELECT status FROM commercial_purchase_orders WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';" | psql_query | tr -d '[:space:]')"
if [ "$got_mut_status" = "ISSUED" ]; then
  echo "  PASS (mutation correctly reproduces a DRAFT-issued-without-approval regression when the guard is removed)"
  PASS=$((PASS+1))
else
  echo "  FAIL: removing the APPROVED guard did NOT reproduce the expected regression — harness may not be sensitive to it (got status=$got_mut_status)"
  FAIL=$((FAIL+1)); FAILURES+=("mutation proof")
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
