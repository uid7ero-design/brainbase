#!/usr/bin/env bash
# Eve Phase 3.1 (order product identity) — repeatable behavioural validation,
# against REAL PostgreSQL 16, of
#   scripts/add-events-order-product-surface.sql   (the migration)
# and of the order INSERT / webhook / Retry statements that touch
# event_orders (mirrored statement-for-statement from
# lib/events/services/paidCheckout.ts, freeRegistration.ts, retryCheckout.ts
# and lib/events/stripe.ts).
#
# WHY THIS EXISTS: mocked SQL has no constraints, defaults or catalogs, so it
# cannot prove any of:
#   M. the migration applies to the CURRENT schema chain, is idempotent, adds
#      exactly one column and one constraint and nothing else, is
#      metadata-only for existing rows (pre-migration orders read BRAINBASE),
#      and rolls back to a schema identical to the pre-migration one
#   C. the CHECK accepts BRAINBASE and EVE and refuses NULL, lower case,
#      unknown values and empty string
#   H. historical orders (inserted BEFORE the migration) are BRAINBASE
#   B. an INSERT that does not name the column (old application code) lands
#      as BRAINBASE
#   E. the paid and free INSERT shapes the services now run stamp EVE /
#      BRAINBASE exactly as given, in the same statement as the order
#   I. the webhook PAID / EXPIRED updates, a webhook REPLAY, the Retry
#      reacquisition + write-back and the refund UPDATE never change it
#
# Usage: bash scripts/tests/verify-events-order-product-surface.sh
# Exit 0 = all checks passed; 1 = at least one failed; 2 = harness error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATIONS=(
  "$REPO_ROOT/scripts/create-events.sql"
  "$REPO_ROOT/scripts/create-events-phase2.sql"
  "$REPO_ROOT/scripts/add-events-ticketing.sql"
  "$REPO_ROOT/scripts/add-events-payments.sql"
  "$REPO_ROOT/scripts/add-events-payment-connect.sql"
  "$REPO_ROOT/scripts/add-events-registration-questions.sql"
  "$REPO_ROOT/scripts/add-eve-registration-questions.sql"
  "$REPO_ROOT/scripts/add-events-booking-wallet.sql"
  "$REPO_ROOT/scripts/add-events-ticket-email-delivery.sql"
  "$REPO_ROOT/scripts/create-events-ticket-type-session-inventory.sql"
  "$REPO_ROOT/scripts/create-events-promotions-presales-sale-windows.sql"
  "$REPO_ROOT/scripts/create-events-ticketing-fees-foundation.sql"
)
NEW_MIGRATION="$REPO_ROOT/scripts/add-events-order-product-surface.sql"
CONTAINER="events-product-surface-harness-$$"
PASS=0
FAIL=0
FAILURES=()

DIAG_OUT=""
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

for f in "${BASE_MIGRATIONS[@]}" "$NEW_MIGRATION"; do
  if [ ! -f "$f" ]; then echo "ERROR: migration file not found: $f" >&2; exit 2; fi
done
if ! command -v docker >/dev/null 2>&1; then echo "ERROR: docker is required to run this harness." >&2; exit 2; fi

echo "Starting disposable postgres:16-alpine ($CONTAINER)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null
READY=0
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then echo "ERROR: postgres in $CONTAINER did not become ready within 30s." >&2; exit 2; fi

DIAG_OUT="$(mktemp)"

psql_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1; }

run_file() { # file...
  { for f in "$@"; do cat "$f"; echo; done; } | psql_exec || { echo "ERROR: applying migration failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL (expected success, got error): $desc"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_error() { # desc sql expected_error_regex
  local desc="$1" sql="$2" want="$3"
  if echo "$sql" | psql_exec; then echo "  FAIL (expected an error, statement succeeded): $desc"; FAIL=$((FAIL + 1)); FAILURES+=("$desc")
  elif grep -qiE "$want" "$DIAG_OUT"; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL (error, but not the expected one /$want/): $desc"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}
expect_eq() {
  local desc="$1" sql="$2" want="$3" got
  got="$( (echo "$sql" | psql_query 2>&1 || true) | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then echo "  PASS: $desc (got $got)"; PASS=$((PASS + 1))
  else echo "  FAIL: $desc (want $want, got $got)"; FAIL=$((FAIL + 1)); FAILURES+=("$desc"); fi
}

# A deterministic fingerprint of event_orders' structure: every column's
# name/type/nullability/default and every constraint and index definition.
schema_fingerprint() {
  psql_query <<'SQL' | md5sum | cut -d' ' -f1
SELECT 'col:' || column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '')
FROM information_schema.columns WHERE table_name = 'event_orders'
UNION ALL
SELECT 'con:' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'event_orders'::regclass
UNION ALL
SELECT 'idx:' || indexname || ':' || indexdef FROM pg_indexes WHERE tablename = 'event_orders'
ORDER BY 1;
SQL
}

echo ""
echo "=== M: migration against the current schema chain ==="
{
  cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, stripe_account_id TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
  for f in "${BASE_MIGRATIONS[@]}"; do cat "$f"; echo; done
  cat <<'SQL'
INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
  ('event-1', 'org-a', 'Gala', 'gala', 'PUBLISHED', now(), now() + interval '2 hours', 'Australia/Adelaide');
-- Historical orders written by PRE-3.1 code (no product column exists yet):
-- one free, one paid-and-confirmed, one pending.
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents)
  VALUES ('hist-free', 'org-a', 'event-1', 'Hist Free', 'h1@example.test', 'CONFIRMED', 0);
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, payment_provider, currency, stripe_account_id, stripe_checkout_session_id)
  VALUES ('hist-paid', 'org-a', 'event-1', 'Hist Paid', 'h2@example.test', 'CONFIRMED', 5000, 'PAID', 'stripe', 'AUD', 'acct_hist', 'cs_hist_paid');
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id, stripe_checkout_session_id)
  VALUES ('hist-pend', 'org-a', 'event-1', 'Hist Pend', 'h3@example.test', 'PENDING', 5000, 'PENDING', 'stripe', 'AUD', now() + interval '30 minutes', 'acct_hist', 'cs_hist_pend');
SQL
} | psql_exec || { echo "ERROR: bootstrap failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }

BEFORE_FP="$(schema_fingerprint)"
XMIN_SQL="SELECT string_agg(id || ':' || xmin::text, ',' ORDER BY id) FROM event_orders;"
BEFORE_XMIN="$(echo "$XMIN_SQL" | psql_query)"
COLS_BEFORE="$(echo "SELECT count(*) FROM information_schema.columns WHERE table_name='event_orders';" | psql_query)"

run_file "$NEW_MIGRATION"
AFTER_FP="$(schema_fingerprint)"
AFTER_XMIN="$(echo "$XMIN_SQL" | psql_query)"

expect_eq "M1. exactly one column added (product_surface)" "SELECT count(*) FROM information_schema.columns WHERE table_name='event_orders' AND column_name='product_surface';" "1"
expect_eq "M2. column is TEXT NOT NULL DEFAULT 'BRAINBASE'" "SELECT data_type || '/' || is_nullable || '/' || column_default FROM information_schema.columns WHERE table_name='event_orders' AND column_name='product_surface';" "text/NO/'BRAINBASE'::text"
expect_eq "M3. the constraint exists and is validated" "SELECT count(*) FROM pg_constraint WHERE conrelid='event_orders'::regclass AND conname='event_orders_product_surface_check' AND convalidated;" "1"
expect_eq "M4. column count grew by exactly one" "SELECT count(*) - $COLS_BEFORE FROM information_schema.columns WHERE table_name='event_orders';" "1"
expect_eq "M5. no index was added for it" "SELECT count(*) FROM pg_indexes WHERE tablename='event_orders' AND indexdef ILIKE '%product_surface%';" "0"
if [ "$BEFORE_XMIN" = "$AFTER_XMIN" ]; then echo "  PASS: M6. no existing row was rewritten (xmin unchanged: metadata-only, no backfill)"; PASS=$((PASS + 1))
else echo "  FAIL: M6. existing rows were rewritten"; FAIL=$((FAIL + 1)); FAILURES+=("M6"); fi
expect_success "M7. re-running the migration is a no-op (idempotent)" "$(cat "$NEW_MIGRATION")"
expect_eq "M8. no other table gained a product_surface column" "SELECT count(*) FROM information_schema.columns WHERE column_name='product_surface';" "1"

echo ""
echo "=== N: a same-named constraint elsewhere must not skip the event_orders constraint ==="
# Fresh database, base chain only (no product_surface yet). Decoys carry the
# exact constraint name on a different table AND on a table in another schema.
docker exec "$CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE collide;" >"$DIAG_OUT" 2>&1 || { echo "ERROR: create collide db failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }
collide_exec() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d collide -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
collide_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d collide -v ON_ERROR_STOP=1; }
{
  cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, stripe_account_id TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
SQL
  for f in "${BASE_MIGRATIONS[@]}"; do cat "$f"; echo; done
  cat <<'SQL'
CREATE TABLE decoy_other_table (product_surface TEXT, CONSTRAINT event_orders_product_surface_check CHECK (product_surface IN ('X')));
CREATE SCHEMA decoy_schema;
CREATE TABLE decoy_schema.event_orders (product_surface TEXT, CONSTRAINT event_orders_product_surface_check CHECK (product_surface IN ('Y')));
SQL
} | collide_exec || { echo "ERROR: collide bootstrap failed:" >&2; cat "$DIAG_OUT" >&2; exit 2; }
if cat "$NEW_MIGRATION" | collide_exec; then echo "  PASS: N1. migration runs despite same-named constraints elsewhere"; PASS=$((PASS + 1))
else echo "  FAIL: N1. migration failed"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("N1"); fi
N2="$(echo "SELECT count(*) FROM pg_constraint WHERE conrelid='public.event_orders'::regclass AND conname='event_orders_product_surface_check' AND convalidated;" | collide_query | tr -d '[:space:]')"
if [ "$N2" = "1" ]; then echo "  PASS: N2. event_orders still received its own validated constraint (got $N2)"; PASS=$((PASS + 1))
else echo "  FAIL: N2. event_orders constraint skipped (want 1, got $N2)"; FAIL=$((FAIL + 1)); FAILURES+=("N2"); fi
N3="$(echo "SELECT count(*) FROM pg_constraint WHERE conname='event_orders_product_surface_check';" | collide_query | tr -d '[:space:]')"
if [ "$N3" = "3" ]; then echo "  PASS: N3. decoys untouched; one constraint per table (got $N3)"; PASS=$((PASS + 1))
else echo "  FAIL: N3. (want 3, got $N3)"; FAIL=$((FAIL + 1)); FAILURES+=("N3"); fi
if echo "INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, product_surface) VALUES ('o','e','n','e@x.test','CONFIRMED',0,'BOGUS');" | collide_exec; then
  echo "  FAIL: N4. event_orders accepted an invalid value"; FAIL=$((FAIL + 1)); FAILURES+=("N4")
elif grep -qi "event_orders_product_surface_check" "$DIAG_OUT"; then echo "  PASS: N4. the CHECK is enforced on event_orders"; PASS=$((PASS + 1))
else echo "  FAIL: N4. refused for another reason"; sed 's/^/    /' "$DIAG_OUT"; FAIL=$((FAIL + 1)); FAILURES+=("N4"); fi

echo ""
echo "=== H: historical orders are BrainBase ==="
expect_eq "H1. all three pre-migration orders read BRAINBASE" "SELECT count(*) FROM event_orders WHERE id LIKE 'hist-%' AND product_surface='BRAINBASE';" "3"

echo ""
echo "=== C: the CHECK vocabulary ==="
INS="INSERT INTO event_orders (organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents, product_surface)"
expect_success "C1. BRAINBASE accepted" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,'BRAINBASE');"
expect_success "C2. EVE accepted" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,'EVE');"
expect_error "C3. NULL refused" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,NULL);" "null value|not-null"
expect_error "C4. lower-case eve refused" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,'eve');" "event_orders_product_surface_check"
expect_error "C5. unknown value refused" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,'OTHER');" "event_orders_product_surface_check"
expect_error "C6. empty string refused" "$INS VALUES ('org-a','event-1','C','c@example.test','CONFIRMED',0,'');" "event_orders_product_surface_check"
expect_error "C7. an UPDATE to an invalid value is refused" "UPDATE event_orders SET product_surface='ADMIN' WHERE id='hist-free';" "event_orders_product_surface_check"

echo ""
echo "=== B: old application code (column not named) ==="
expect_success "B1. an INSERT that omits the column succeeds" "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents) VALUES ('old-code','org-a','event-1','Old','o@example.test','CONFIRMED',0);"
expect_eq "B2. and it lands as BRAINBASE" "SELECT product_surface FROM event_orders WHERE id='old-code';" "BRAINBASE"

echo ""
echo "=== E: the service INSERT shapes stamp the supplied product ==="
# freeRegistration.ts shape.
free_insert() { # id surface
  echo "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone, status, total_cents, booking_token, ticket_email_status, access_code_id, access_code_snapshot, product_surface)
        VALUES ('$1','org-a','event-1','Free','f@example.test',NULL,'CONFIRMED',0,'bk-$1','pending',NULL,NULL,'$2');"
}
# paidCheckout.ts shape (zero-fee BrainBase default: fee columns as the
# service writes them when no policy applies).
paid_insert() { # id surface
  echo "INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, purchaser_phone,
          status, total_cents, payment_status, payment_provider, currency, expires_at, stripe_account_id,
          platform_fee_cents, fee_mode, payment_total_cents, fee_policy_id, fee_policy_version,
          fee_percent_bps, fee_fixed_per_order_cents, fee_fixed_per_ticket_cents, fee_min_cents, fee_max_cents, fee_tax_treatment, fee_label,
          discount_cents, promotion_code_id, promotion_code_snapshot, access_code_id, access_code_snapshot,
          product_surface)
        VALUES ('$1','org-a','event-1','Paid','p@example.test',NULL,
          'PENDING',10000,'PENDING','stripe','AUD', now() + interval '31 minutes','acct_test',
          0,NULL,10000,NULL,NULL, NULL,NULL,NULL,NULL,NULL,NULL,NULL,
          0,NULL,NULL,NULL,NULL,
          '$2');"
}
expect_success "E1. free BRAINBASE" "$(free_insert free-bb BRAINBASE)"
expect_success "E2. free EVE" "$(free_insert free-eve EVE)"
expect_success "E3. paid BRAINBASE" "$(paid_insert paid-bb BRAINBASE)"
expect_success "E4. paid EVE" "$(paid_insert paid-eve EVE)"
expect_eq "E5. stamps read back exactly" "SELECT string_agg(id || '=' || product_surface, ',' ORDER BY id) FROM event_orders WHERE id IN ('free-bb','free-eve','paid-bb','paid-eve');" "free-bb=BRAINBASE,free-eve=EVE,paid-bb=BRAINBASE,paid-eve=EVE"
expect_error "E6. an invalid surface in the service INSERT shape is refused by the database" "$(paid_insert paid-bad ADMIN)" "event_orders_product_surface_check"

echo ""
echo "=== I: nothing later changes the stamp ==="
echo "UPDATE event_orders SET stripe_checkout_session_id='cs_eve' WHERE id='paid-eve';" | psql_exec
WEBHOOK_PAID="UPDATE event_orders SET status='CONFIRMED', payment_status='PAID', paid_at=now(), ticket_email_status='pending', stripe_payment_intent_id=COALESCE('pi_1', stripe_payment_intent_id)
              WHERE id='paid-eve' AND stripe_checkout_session_id='cs_eve' AND payment_status='PENDING' AND stripe_account_id='acct_test';"
expect_success "I1. webhook checkout.session.completed UPDATE" "$WEBHOOK_PAID"
expect_eq "I2. EVE after the webhook" "SELECT product_surface FROM event_orders WHERE id='paid-eve';" "EVE"
expect_success "I3. webhook REPLAY (matches zero rows, idempotent)" "$WEBHOOK_PAID"
expect_eq "I4. EVE after the replay" "SELECT product_surface || '/' || payment_status FROM event_orders WHERE id='paid-eve';" "EVE/PAID"
echo "UPDATE event_orders SET stripe_checkout_session_id='cs_bb' WHERE id='paid-bb';" | psql_exec
expect_success "I5. webhook checkout.session.expired UPDATE (BrainBase order)" "UPDATE event_orders SET status='CANCELLED', payment_status='EXPIRED' WHERE id='paid-bb' AND stripe_checkout_session_id='cs_bb' AND payment_status='PENDING' AND stripe_account_id='acct_test';"
expect_eq "I6. BRAINBASE after expiry" "SELECT product_surface FROM event_orders WHERE id='paid-bb';" "BRAINBASE"
# Retry on a pending EVE order: reacquisition then write-back.
paid_insert retry-eve EVE | psql_exec
echo "UPDATE event_orders SET stripe_checkout_session_id='cs_r1' WHERE id='retry-eve';" | psql_exec
expect_success "I7. Retry reacquisition (clears the session, extends the hold)" "UPDATE event_orders eo SET expires_at = NOW() + make_interval(secs => 1860), stripe_checkout_session_id = NULL WHERE eo.id='retry-eve' AND eo.organisation_id='org-a' AND eo.payment_status='PENDING';"
expect_success "I8. Retry write-back of the new session" "UPDATE event_orders SET stripe_checkout_session_id='cs_r2' WHERE id='retry-eve' AND stripe_checkout_session_id IS NULL;"
expect_eq "I9. Retry preserved EVE (the stored value is what Retry reads)" "SELECT product_surface FROM event_orders WHERE id='retry-eve';" "EVE"
expect_success "I10. refund UPDATE on the paid EVE order" "UPDATE event_orders SET status='CANCELLED', payment_status='REFUNDED', refunded_at=now(), refunded_cents=10000, platform_fee_refunded_cents=0 WHERE id='paid-eve';"
expect_eq "I11. EVE after the refund" "SELECT product_surface FROM event_orders WHERE id='paid-eve';" "EVE"

echo ""
echo "=== R: rollback restores the pre-migration schema exactly ==="
expect_success "R1. documented rollback runs" "ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_product_surface_check; ALTER TABLE event_orders DROP COLUMN IF EXISTS product_surface;"
ROLLED_FP="$(schema_fingerprint)"
if [ "$ROLLED_FP" = "$BEFORE_FP" ]; then echo "  PASS: R2. event_orders structure after rollback is identical to before the migration"; PASS=$((PASS + 1))
else echo "  FAIL: R2. structure differs after rollback"; FAIL=$((FAIL + 1)); FAILURES+=("R2"); fi
if [ "$AFTER_FP" != "$BEFORE_FP" ]; then echo "  PASS: R3. (control) the migration did change the structure"; PASS=$((PASS + 1))
else echo "  FAIL: R3. migration changed nothing"; FAIL=$((FAIL + 1)); FAILURES+=("R3"); fi
expect_eq "R4. historical rows survive the rollback" "SELECT count(*) FROM event_orders WHERE id LIKE 'hist-%';" "3"

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0
