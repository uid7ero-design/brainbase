#!/usr/bin/env bash
# Phase C5.2 — repeatable behavioral validation for the payments
# foundation's concurrency safety (lib/commercial/payments.ts's
# recordInvoicePayment(), and lib/commercial/invoices.ts's voidInvoice()
# paid-invoice-block rule), against REAL PostgreSQL, not mocks.
#
# WHY THIS EXISTS: the C5.2 brief explicitly requires proof that (a) two
# concurrent payments cannot together overpay an invoice, and (b) a
# payment-recording transaction and a void transaction on the same
# invoice cannot race into an invalid final state (a VOID invoice with
# an active recorded payment). Same category of proof as
# scripts/tests/verify-events-phase4-payment-concurrency.sh, applied to
# this phase's own genuinely new mechanism: the invoice-row FOR UPDATE
# lock shared between recordInvoicePayment() and voidInvoice().
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with a minimal, structurally-accurate stand-in commercial_invoices
# table (id/organisation_id/status/total_cents/void metadata — the only
# columns either atomic statement touches) plus the ACTUAL, unmodified
# scripts/create-commercial-payments.sql, then executes the SAME
# statement sequences recordInvoicePayment() and voidInvoice() issue
# (verbatim, copied from lib/commercial/payments.ts and
# lib/commercial/invoices.ts — see each function below for the
# cross-reference) via `docker exec ... psql`.
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other harness's own
# precedent). Requires only Docker. No Neon/Production/Preview access
# of any kind — this container is disposable, local-only, and destroyed
# on exit.
#
# USAGE:
#   bash scripts/tests/verify-commercial-payments-concurrency.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAYMENTS_MIGRATION="$REPO_ROOT/scripts/create-commercial-payments.sql"
CONTAINER="c5-payments-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$PAYMENTS_MIGRATION" ]; then
  echo "ERROR: migration file not found: $PAYMENTS_MIGRATION" >&2
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

DIAG_OUT="/tmp/c5_payments_harness_out.$$.txt"
OUT_A="/tmp/c5_payments_harness_a.$$.txt"
OUT_B="/tmp/c5_payments_harness_b.$$.txt"

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
-- Minimal, structurally-accurate stand-in for commercial_invoices —
-- only the columns recordInvoicePayment()/voidInvoice() actually read
-- or write. The real table (scripts/create-commercial-invoices.sql)
-- carries many more columns unrelated to payments; this harness is
-- scoped to the payments concurrency mechanism specifically, exactly
-- like scripts/tests/verify-events-phase4-payment-concurrency.sh scopes
-- itself to capacity/payment_status rather than re-bootstrapping every
-- unrelated events column too.
CREATE TABLE commercial_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','VOID')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  voided_by TEXT,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  UNIQUE (id, organisation_id)
);
SQL
    cat "$PAYMENTS_MIGRATION"
    cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
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

# ─── recordInvoicePayment()'s exact atomic statement ──────────────────
# Copied verbatim (parameterization via shell substitution only) from
# lib/commercial/payments.ts's recordInvoicePayment(). If that function's
# SQL ever changes, this string must be updated to match — same
# discipline as the events concurrency harness's own reserve_*_sql
# functions.
record_payment_sql() {
  local invoice_id="$1" org_id="$2" amount_cents="$3" method="${4:-CASH}"
  cat <<SQL
BEGIN;
WITH guard AS (
  SELECT id, total_cents FROM commercial_invoices
  WHERE id = '$invoice_id' AND organisation_id = '$org_id' AND status = 'ISSUED'
  FOR UPDATE
),
active_paid AS (
  SELECT COALESCE(SUM(cpa.allocated_amount_cents), 0)::int AS paid_cents
  FROM commercial_payment_allocations cpa
  JOIN commercial_payments cp ON cp.id = cpa.payment_id AND cp.organisation_id = cpa.organisation_id
  WHERE cpa.organisation_id = '$org_id' AND cpa.invoice_id = '$invoice_id' AND cp.status = 'RECORDED'
),
ins_payment AS (
  INSERT INTO commercial_payments (organisation_id, amount_cents, currency, method, received_at)
  SELECT '$org_id', $amount_cents, 'AUD', '$method', now()
  FROM guard, active_paid
  WHERE $amount_cents <= (guard.total_cents - active_paid.paid_cents)
  RETURNING *
),
ins_allocation AS (
  INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents)
  SELECT '$org_id', ins_payment.id, '$invoice_id', $amount_cents
  FROM ins_payment
  RETURNING id
)
SELECT ins_payment.* FROM ins_payment, ins_allocation;
COMMIT;
SQL
}

# ─── voidInvoice()'s exact atomic statement ────────────────────────────
# Copied verbatim from lib/commercial/invoices.ts's voidInvoice().
void_sql() {
  local invoice_id="$1" org_id="$2"
  cat <<SQL
BEGIN;
WITH guard AS (
  SELECT id FROM commercial_invoices
  WHERE id = '$invoice_id' AND organisation_id = '$org_id' AND status = 'ISSUED'
  FOR UPDATE
),
active_paid AS (
  SELECT COALESCE(SUM(cpa.allocated_amount_cents), 0)::int AS paid_cents
  FROM commercial_payment_allocations cpa
  JOIN commercial_payments cp ON cp.id = cpa.payment_id AND cp.organisation_id = cpa.organisation_id
  WHERE cpa.organisation_id = '$org_id' AND cpa.invoice_id = '$invoice_id' AND cp.status = 'RECORDED'
)
UPDATE commercial_invoices SET status = 'VOID', voided_by = 'tester', voided_at = now(), void_reason = 'concurrency harness'
WHERE id = '$invoice_id' AND organisation_id = '$org_id' AND status = 'ISSUED'
  AND EXISTS (SELECT 1 FROM guard)
  AND (SELECT paid_cents FROM active_paid) = 0
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
echo "  bootstrap applied (stand-in commercial_invoices + real create-commercial-payments.sql)"

echo ""
echo "=== NORMAL PATH ==="
expect_success "1. seed an ISSUED invoice, total \$100.00 (10000 cents)" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('11111111-1111-1111-1111-111111111111', 'org-a', 'ISSUED', 10000);"
expect_success "1b. a single \$40 payment within balance succeeds" \
  "$(record_payment_sql 11111111-1111-1111-1111-111111111111 org-a 4000)"
expect_eq "1c. exactly one payment row exists" "SELECT count(*) FROM commercial_payments;" "1"
expect_eq "1c2. exactly one allocation row exists" "SELECT count(*) FROM commercial_payment_allocations;" "1"
expect_eq "1d. active paid amount is 4000" \
  "SELECT COALESCE(SUM(cpa.allocated_amount_cents),0) FROM commercial_payment_allocations cpa JOIN commercial_payments cp ON cp.id=cpa.payment_id WHERE cp.status='RECORDED';" "4000"

echo ""
echo "=== A: overpayment race — outstanding \$100, two concurrent \$70 payments, only one may succeed ==="
reset_db; bootstrap
expect_success "A setup: ISSUED invoice, total \$100.00" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('22222222-2222-2222-2222-222222222222', 'org-a', 'ISSUED', 10000);"
run_concurrent_pair "$(record_payment_sql 22222222-2222-2222-2222-222222222222 org-a 7000)" "$(record_payment_sql 22222222-2222-2222-2222-222222222222 org-a 7000)"
expect_eq "A. exactly one \$70 payment recorded — total active paid is 7000, never 14000" \
  "SELECT COALESCE(SUM(cpa.allocated_amount_cents),0) FROM commercial_payment_allocations cpa JOIN commercial_payments cp ON cp.id=cpa.payment_id WHERE cp.status='RECORDED' AND cpa.invoice_id='22222222-2222-2222-2222-222222222222';" "7000"
expect_eq "A2. exactly one payment row exists for this invoice (the loser inserted nothing at all)" \
  "SELECT count(*) FROM commercial_payments cp JOIN commercial_payment_allocations cpa ON cpa.payment_id=cp.id WHERE cpa.invoice_id='22222222-2222-2222-2222-222222222222';" "1"

echo ""
echo "=== A2: repeated genuine race (blocking gate) — 10 repetitions, never oversold ==="
TOTAL_PASS=0; TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('33333333-3333-3333-3333-333333333333', 'org-a', 'ISSUED', 10000);" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(record_payment_sql 33333333-3333-3333-3333-333333333333 org-a 7000)" "$(record_payment_sql 33333333-3333-3333-3333-333333333333 org-a 7000)"
  got="$(echo "SELECT COALESCE(SUM(cpa.allocated_amount_cents),0) FROM commercial_payment_allocations cpa JOIN commercial_payments cp ON cp.id=cpa.payment_id WHERE cp.status='RECORDED';" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "7000" ]; then TOTAL_PASS=$((TOTAL_PASS+1)); else TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "    run $i: FAIL — want 7000, got $got"; fi
done
echo "  $TOTAL_PASS/10 repetitions correct, $TOTAL_FAIL oversold"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: overpayment prevention holds under genuine concurrency across 10 repetitions"; PASS=$((PASS+1))
else
  echo "  FAIL: overpayment occurred in $TOTAL_FAIL/10 repetitions"; FAIL=$((FAIL+1)); FAILURES+=("A2 repeated concurrency gate")
fi

echo ""
echo "=== B: payment vs. void race — never ends with VOID + an active recorded payment ==="
TOTAL_PASS=0; TOTAL_FAIL=0
for i in $(seq 1 10); do
  reset_db >/dev/null 2>&1; bootstrap >/dev/null 2>&1
  echo "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('44444444-4444-4444-4444-444444444444', 'org-a', 'ISSUED', 10000);" | psql_exec >/dev/null 2>&1
  run_concurrent_pair "$(record_payment_sql 44444444-4444-4444-4444-444444444444 org-a 5000)" "$(void_sql 44444444-4444-4444-4444-444444444444 org-a)"
  status="$(echo "SELECT status FROM commercial_invoices WHERE id='44444444-4444-4444-4444-444444444444';" | psql_query | tr -d '[:space:]')"
  active_paid="$(echo "SELECT COALESCE(SUM(cpa.allocated_amount_cents),0) FROM commercial_payment_allocations cpa JOIN commercial_payments cp ON cp.id=cpa.payment_id WHERE cp.status='RECORDED' AND cpa.invoice_id='44444444-4444-4444-4444-444444444444';" | psql_query | tr -d '[:space:]')"
  if [ "$status" = "VOID" ] && [ "$active_paid" != "0" ]; then
    TOTAL_FAIL=$((TOTAL_FAIL+1)); echo "    run $i: FAIL — invoice is VOID but active_paid=$active_paid (invalid state)"
  else
    TOTAL_PASS=$((TOTAL_PASS+1))
  fi
done
echo "  $TOTAL_PASS/10 repetitions produced a valid final state, $TOTAL_FAIL invalid"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "  PASS: payment/void race never produces a VOID invoice with an active recorded payment, across 10 repetitions"; PASS=$((PASS+1))
else
  echo "  FAIL: invalid final state occurred in $TOTAL_FAIL/10 repetitions"; FAIL=$((FAIL+1)); FAILURES+=("B repeated payment/void race")
fi

echo ""
echo "=== C: unpaid invoice can still be voided; becomes voidable again after reversal ==="
reset_db; bootstrap
expect_success "C setup: ISSUED invoice, unpaid" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('55555555-5555-5555-5555-555555555555', 'org-a', 'ISSUED', 10000);"
expect_success "C1. voiding an unpaid ISSUED invoice succeeds" \
  "$(void_sql 55555555-5555-5555-5555-555555555555 org-a)"
expect_eq "C2. invoice is now VOID" \
  "SELECT status FROM commercial_invoices WHERE id='55555555-5555-5555-5555-555555555555';" "VOID"

reset_db; bootstrap
expect_success "C3 setup: ISSUED invoice" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('66666666-6666-6666-6666-666666666666', 'org-a', 'ISSUED', 10000);"
expect_success "C4. record a \$50 payment" \
  "$(record_payment_sql 66666666-6666-6666-6666-666666666666 org-a 5000)"
expect_success "C5. voiding while a payment is active is CLEANLY rejected (zero rows changed, no error)" \
  "$(void_sql 66666666-6666-6666-6666-666666666666 org-a)"
expect_eq "C6. invoice is still ISSUED (not voided)" \
  "SELECT status FROM commercial_invoices WHERE id='66666666-6666-6666-6666-666666666666';" "ISSUED"
PAY_ID="$(echo "SELECT cp.id FROM commercial_payments cp JOIN commercial_payment_allocations cpa ON cpa.payment_id=cp.id WHERE cpa.invoice_id='66666666-6666-6666-6666-666666666666';" | psql_query | tr -d '[:space:]')"
expect_success "C7. reverse the payment" \
  "UPDATE commercial_payments SET status='REVERSED', reversed_at=now(), reversal_reason='test' WHERE id='$PAY_ID' AND status='RECORDED';"
expect_success "C8. voiding now succeeds — active_paid has returned to zero" \
  "$(void_sql 66666666-6666-6666-6666-666666666666 org-a)"
expect_eq "C9. invoice is now VOID" \
  "SELECT status FROM commercial_invoices WHERE id='66666666-6666-6666-6666-666666666666';" "VOID"

echo ""
echo "=== D: DRAFT/VOID invoices reject payment at the atomic-statement level too ==="
reset_db; bootstrap
expect_success "D setup: DRAFT invoice" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('77777777-7777-7777-7777-777777777777', 'org-a', 'DRAFT', 10000);"
expect_success "D1. attempting a payment against a DRAFT invoice cleanly inserts nothing (guard requires status=ISSUED)" \
  "$(record_payment_sql 77777777-7777-7777-7777-777777777777 org-a 1000)"
expect_eq "D2. zero payment rows were created" \
  "SELECT count(*) FROM commercial_payments;" "0"

echo ""
echo "=== E: schema-level constraint proofs ==="
reset_db; bootstrap
expect_success "E setup: ISSUED invoices for org-a and org-b" \
  "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('88888888-8888-8888-8888-888888888888', 'org-a', 'ISSUED', 10000), ('99999999-9999-9999-9999-999999999999', 'org-b', 'ISSUED', 10000);"
expect_success "E1. record a real payment for org-a" \
  "$(record_payment_sql 88888888-8888-8888-8888-888888888888 org-a 1000)"
ORG_A_PAY_ID="$(echo "SELECT id FROM commercial_payments LIMIT 1;" | psql_query | tr -d '[:space:]')"
expect_fail "E2. cannot allocate org-a's payment against org-b's invoice — composite FK (invoice_id, organisation_id) rejects the tenant mismatch" \
  "INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents) VALUES ('org-b', '$ORG_A_PAY_ID', '99999999-9999-9999-9999-999999999999', 500);"
expect_fail "E3. cannot reference org-a's payment_id while claiming organisation_id='org-b' — composite FK (payment_id, organisation_id) requires an exact match" \
  "INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents) VALUES ('org-b', '$ORG_A_PAY_ID', '88888888-8888-8888-8888-888888888888', 500);"
expect_fail "E4. a second allocation for the SAME payment_id is rejected — UNIQUE (organisation_id, payment_id), the C5.2 one-allocation-per-payment rule" \
  "INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents) VALUES ('org-a', '$ORG_A_PAY_ID', '88888888-8888-8888-8888-888888888888', 500);"
expect_fail "E5. amount_cents must be > 0" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method) VALUES ('org-a', 0, 'CASH');"
expect_fail "E6. method must be one of the approved vocabulary" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method) VALUES ('org-a', 100, 'STRIPE');"
expect_fail "E7. provider_reference without provider is rejected by the explicit CHECK" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method, provider_reference) VALUES ('org-a', 100, 'CASH', 'evt_123');"
expect_success "E8. seed one payment with a real provider_reference" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method, provider, provider_reference) VALUES ('org-a', 100, 'CARD', 'stripe', 'evt_dup_1');"
expect_fail "E9. a second payment with the SAME (organisation_id, provider, provider_reference) is rejected — the external-idempotency partial unique index" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method, provider, provider_reference) VALUES ('org-a', 200, 'CARD', 'stripe', 'evt_dup_1');"
expect_success "E10. the SAME provider_reference under a DIFFERENT organisation is allowed — the index is tenant-scoped, not global" \
  "INSERT INTO commercial_payments (organisation_id, amount_cents, method, provider, provider_reference) VALUES ('org-b', 200, 'CARD', 'stripe', 'evt_dup_1');"

echo ""
echo "=== MUTATION PROOF — weaken the overpayment guard, confirm the harness catches it ==="
reset_db; bootstrap
echo "INSERT INTO commercial_invoices (id, organisation_id, status, total_cents) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a', 'ISSUED', 10000);" | psql_exec >/dev/null 2>&1
# Weakened statement: drops the ins_payment WHERE clause entirely, so an
# overpayment is wrongly accepted — proves this harness is sensitive to
# the exact regression the real guard exists to prevent.
MUT_SQL=$(cat <<'SQL'
BEGIN;
WITH guard AS (
  SELECT id, total_cents FROM commercial_invoices WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND organisation_id = 'org-a' AND status = 'ISSUED' FOR UPDATE
),
ins_payment AS (
  INSERT INTO commercial_payments (organisation_id, amount_cents, currency, method, received_at)
  SELECT 'org-a', 99999999, 'AUD', 'CASH', now() FROM guard
  RETURNING *
),
ins_allocation AS (
  INSERT INTO commercial_payment_allocations (organisation_id, payment_id, invoice_id, allocated_amount_cents)
  SELECT 'org-a', ins_payment.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 99999999 FROM ins_payment RETURNING id
)
SELECT ins_payment.* FROM ins_payment, ins_allocation;
COMMIT;
SQL
)
echo "$MUT_SQL" | psql_exec >/dev/null 2>&1
got_mut="$(echo "SELECT COALESCE(SUM(allocated_amount_cents),0) FROM commercial_payment_allocations;" | psql_query | tr -d '[:space:]')"
if [ "$got_mut" = "99999999" ]; then
  echo "  PASS (mutation correctly reproduces an overpayment-accepted regression when the guard is removed): a \$999,999.99 payment was wrongly accepted against a \$100 invoice"
  PASS=$((PASS+1))
else
  echo "  FAIL: removing the overpayment guard did NOT reproduce the expected regression — harness may not be sensitive to it (got $got_mut)"
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
