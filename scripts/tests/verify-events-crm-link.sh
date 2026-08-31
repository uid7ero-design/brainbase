#!/usr/bin/env bash
# scripts/add-events-crm-link.sql — repeatable behavioral validation.
#
# WHY THIS EXISTS: this migration's core safety property — "an
# event_orders row can never point at a crm_contacts row in a different
# organisation" — is a composite FOREIGN KEY behavior that only a real
# Postgres instance can prove. The same harness ALSO caught a genuine
# bug during this migration's own development: a composite FK's plain
# `ON DELETE SET NULL` nulls EVERY column in the FK, not just the
# "optional" one — which would have also nulled event_orders'
# NOT NULL organisation_id column and made deleting a linked CRM
# contact fail outright with a constraint violation. The fix
# (`ON DELETE SET NULL (crm_contact_id)`, PostgreSQL 15+'s column-scoped
# form) is proven here, not just asserted from reading the SQL.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with minimal organisations/users/events/event_orders/crm_* stand-ins
# matching this repo's real schema (see scripts/create-events.sql,
# scripts/create-events-phase2.sql, scripts/crm-migrate.mjs), applies
# the ACTUAL, unmodified scripts/add-events-crm-link.sql, then verifies:
#   - crm_contact_id is UUID and nullable
#   - a same-tenant contact can be linked
#   - a cross-tenant contact link is rejected by the composite FK
#   - deleting the linked CRM contact SET NULLs crm_contact_id only
#   - deleting the linked CRM contact does NOT delete/break the order
#   - organisation_id and every other order column survive that delete
#   - the migration is idempotent (safe to apply twice)
#
# WHAT THIS DOES NOT DO: not wired into CI (Docker is not part of the
# standard CI workflow here, matching every other disposable-Postgres
# harness's own precedent). Requires only Docker. Creates and destroys
# its own disposable container; never touches Production, DEV, or any
# already-running database.
#
# USAGE:
#   bash scripts/tests/verify-events-crm-link.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise. Always removes the disposable container (trap on EXIT).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/scripts/add-events-crm-link.sql"
CONTAINER="events-crm-link-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${DIAG_OUT:-}" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: migration file not found: $MIGRATION" >&2
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

DIAG_OUT="/tmp/events_crm_link_harness_out.$$.txt"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}

expect_success() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"
    sed 's/^/    /' "$DIAG_OUT"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

expect_failure() {
  local desc="$1" sql="$2"
  if echo "$sql" | psql_exec; then
    echo "  FAIL (expected an error, got success): $desc"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  else
    echo "  PASS: $desc (correctly rejected)"
    PASS=$((PASS + 1))
  fi
}

expect_eq() {
  local desc="$1" sql="$2" want="$3"
  local got
  got="$(echo "$sql" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc (got $got)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want $want, got $got)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
  fi
}

bootstrap_base() {
  cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id), email TEXT NOT NULL, role TEXT NOT NULL);

CREATE TABLE crm_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL, website TEXT, industry TEXT, company_size TEXT, phone TEXT, address TEXT, notes TEXT,
  created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, phone TEXT, job_title TEXT, notes TEXT,
  created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL, contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL, value NUMERIC, stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualified','proposal','negotiation','closed_won','closed_lost')),
  probability INTEGER DEFAULT 0 CHECK (probability BETWEEN 0 AND 100), expected_close DATE, assigned_to TEXT REFERENCES users(id), notes TEXT,
  created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL, company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL, deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('call','email','note','meeting')), subject TEXT NOT NULL, body TEXT,
  activity_date TIMESTAMPTZ DEFAULT NOW(), created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, timezone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT events_organisation_id_slug_key UNIQUE (organisation_id, slug),
  CONSTRAINT events_time_order_check CHECK (ends_at > starts_at)
);
CREATE TABLE event_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, event_id TEXT NOT NULL,
  purchaser_name TEXT NOT NULL, purchaser_email TEXT NOT NULL, purchaser_phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_orders_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_orders_event_org_fkey FOREIGN KEY (event_id, organisation_id) REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

INSERT INTO organisations (name, slug) VALUES ('Org A', 'org-a'), ('Org B', 'org-b');
SQL
}

echo ""
echo "=== BOOTSTRAP ==="
bootstrap_base
echo "  organisations/users/crm_*/events/event_orders stand-ins created"

echo ""
echo "=== APPLY MIGRATION (first run) ==="
if cat "$MIGRATION" | psql_exec; then
  echo "  PASS: 1. scripts/add-events-crm-link.sql applies cleanly against a fresh database"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 1. migration failed to apply"
  sed 's/^/    /' "$DIAG_OUT"
  FAIL=$((FAIL + 1))
  FAILURES+=("migration failed to apply on first run")
fi

echo ""
echo "=== COLUMN SHAPE ==="
expect_eq "2. crm_contact_id is uuid" \
  "SELECT data_type FROM information_schema.columns WHERE table_name='event_orders' AND column_name='crm_contact_id';" "uuid"
expect_eq "3. crm_contact_id is nullable" \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='event_orders' AND column_name='crm_contact_id';" "YES"
expect_eq "4. crm_contacts_id_organisation_id_key exists (unique)" \
  "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'crm_contacts'::regclass AND conname = 'crm_contacts_id_organisation_id_key' AND contype = 'u';" "1"
expect_eq "5. event_orders_crm_contact_org_fkey exists and is column-scoped SET NULL" \
  "SELECT pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (crm_contact_id)%' FROM pg_constraint WHERE conname = 'event_orders_crm_contact_org_fkey';" "t"
expect_eq "6. idx_event_orders_crm_contact_id index exists" \
  "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'event_orders' AND indexname = 'idx_event_orders_crm_contact_id';" "1"

echo ""
echo "=== SEED TEST DATA (org A + org B, one event/order in org A, one contact per org) ==="
cat <<'SQL' | psql_exec
DO $$
DECLARE v_org_a TEXT; v_org_b TEXT; v_event_a TEXT;
BEGIN
  SELECT id INTO v_org_a FROM organisations WHERE slug='org-a';
  SELECT id INTO v_org_b FROM organisations WHERE slug='org-b';
  INSERT INTO events (organisation_id, name, slug, status, starts_at, ends_at, timezone)
    VALUES (v_org_a, 'E1', 'e1', 'PUBLISHED', now()+interval '1 day', now()+interval '2 day', 'Australia/Adelaide');
  SELECT id INTO v_event_a FROM events WHERE slug='e1';
  INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, total_cents)
    VALUES ('order-a-1', v_org_a, v_event_a, 'Buyer', 'buyer@example.invalid', 'CONFIRMED', 0);
  INSERT INTO crm_contacts (id, organisation_id, first_name, last_name, email)
    VALUES ('11111111-1111-1111-1111-111111111111', v_org_a, 'Same', 'Tenant', 'buyer@example.invalid');
  INSERT INTO crm_contacts (id, organisation_id, first_name, last_name, email)
    VALUES ('22222222-2222-2222-2222-222222222222', v_org_b, 'Other', 'Tenant', 'buyer@example.invalid');
END $$;
SQL
echo "  seed complete"

echo ""
echo "=== TENANT ISOLATION ==="
expect_success "7. linking order-a-1 to the SAME-tenant contact succeeds" \
  "UPDATE event_orders SET crm_contact_id = '11111111-1111-1111-1111-111111111111' WHERE id = 'order-a-1';"
expect_failure "8. linking order-a-1 to the OTHER-tenant contact is rejected by the composite FK" \
  "UPDATE event_orders SET crm_contact_id = '22222222-2222-2222-2222-222222222222' WHERE id = 'order-a-1';"
expect_eq "9. order-a-1 is still linked to the same-tenant contact (the rejected update did not partially apply)" \
  "SELECT crm_contact_id::text FROM event_orders WHERE id = 'order-a-1';" "11111111-1111-1111-1111-111111111111"

echo ""
echo "=== DELETE BEHAVIOR (the bug this harness caught during development) ==="
expect_success "10. deleting the linked CRM contact succeeds (does not error, does not cascade-delete the order)" \
  "DELETE FROM crm_contacts WHERE id = '11111111-1111-1111-1111-111111111111';"
expect_eq "11. the order row still exists after the contact was deleted" \
  "SELECT COUNT(*) FROM event_orders WHERE id = 'order-a-1';" "1"
expect_eq "12. crm_contact_id was set to NULL by the delete" \
  "SELECT crm_contact_id IS NULL FROM event_orders WHERE id = 'order-a-1';" "t"
expect_eq "13. organisation_id survived the delete untouched (the column-scoped SET NULL did not null it too)" \
  "SELECT organisation_id IS NOT NULL FROM event_orders WHERE id = 'order-a-1';" "t"
expect_eq "14. every other order column is unchanged (status/purchaser_name/total_cents)" \
  "SELECT status = 'CONFIRMED' AND purchaser_name = 'Buyer' AND total_cents = 0 FROM event_orders WHERE id = 'order-a-1';" "t"

echo ""
echo "=== IDEMPOTENCY ==="
expect_success "15. re-applying the migration a second time is a no-op (no error)" \
  "$(cat "$MIGRATION")"
expect_eq "16. still exactly one crm_contact_id column after the second apply" \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='event_orders' AND column_name='crm_contact_id';" "1"
expect_eq "17. existing order row remains valid (crm_contact_id still NULL, no data lost)" \
  "SELECT COUNT(*) FROM event_orders WHERE id = 'order-a-1' AND crm_contact_id IS NULL;" "1"

echo ""
echo "=== SUMMARY ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
exit 0
