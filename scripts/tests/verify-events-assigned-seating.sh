#!/usr/bin/env bash
# Eve assigned seating S1 — disposable PostgreSQL behavioural proof of
#   scripts/create-events-assigned-seating.sql    (the migration)
#   scripts/rollback-events-assigned-seating.sql  (the rollback)
# applied on top of the REAL, unmodified Events migration chain.
#
# Proves (per PostgreSQL major in PG_VERSIONS, default "16 17"):
#   M  apply, reapply (idempotent), existing rows byte-identical, existing ticket types GA,
#      rollback restores the exact pre-migration schema dump, rollback refuses while seating
#      data exists, re-apply after rollback works
#   T  tenant isolation: every cross-organisation / cross-layout / cross-event reference refused
#   U  uniqueness: labels, groups, sections, duplicate inventory (incl. NULL session)
#   F  layout freeze: draft editable, published/retired immutable, new version allowed, event
#      inventory independent of later versions, snapshot columns trigger-filled + immutable
#   H  holds: one ACTIVE hold per seat (concurrent proof), expired hold non-blocking,
#      10-minute initial window, one renewal, 20-minute absolute cap, terminal states
#   A  assignment: one unreleased attendee per seat (concurrent proof), snapshot must match,
#      GA type cannot carry a seat, section eligibility, session match, blocked seats,
#      release / history immutability, in-place reassignment, mixed GA + seated order
#   I  the indexes the seat map / door list / occupancy reads need
#
# Usage: bash scripts/tests/verify-events-assigned-seating.sh
#        PG_VERSIONS=17 bash scripts/tests/verify-events-assigned-seating.sh
# Exit 0 = all checks passed; 1 = at least one failed; 2 = harness error.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_MIGRATIONS=(
  create-events create-events-phase2 add-events-ticketing add-events-payments add-events-payment-connect
  add-events-registration-questions add-events-booking-wallet add-events-ticket-email-delivery
  add-events-order-notes add-events-artwork create-events-ticket-email-deliveries
  create-events-ticket-type-session-inventory create-events-promotions-presales-sale-windows
  create-events-ticketing-fees-foundation create-events-notifications add-events-order-product-surface
  add-events-notification-event-updated add-events-order-legal-acceptance add-eve-registration-questions
  add-events-order-legal-notice
)
MIGRATION="$REPO_ROOT/scripts/create-events-assigned-seating.sql"
ROLLBACK="$REPO_ROOT/scripts/rollback-events-assigned-seating.sql"
PG_VERSIONS="${PG_VERSIONS:-16 17}"
PASS=0
FAIL=0
FAILURES=()
CONTAINER=""
DIAG_OUT="$(mktemp)"

cleanup() { [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1; rm -f "$DIAG_OUT" /tmp/seat-race-*-$$ 2>/dev/null; true; }
trap cleanup EXIT

for f in "${BASE_MIGRATIONS[@]}"; do [ -f "$REPO_ROOT/scripts/$f.sql" ] || { echo "ERROR: scripts/$f.sql missing" >&2; exit 2; }; done
[ -f "$MIGRATION" ] && [ -f "$ROLLBACK" ] || { echo "ERROR: seating migration/rollback missing" >&2; exit 2; }
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { echo "ERROR: docker is required" >&2; exit 2; }

psql_exec()  { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 >"$DIAG_OUT" 2>&1; }
psql_query() { docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1 2>&1; }
apply_file() { docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1 <"$1" >"$DIAG_OUT" 2>&1; }

ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); FAILURES+=("[$PGV] $1"); }
expect_success() { if echo "$2" | psql_exec; then ok "$1"; else bad "$1 (unexpected error)"; sed 's/^/    /' "$DIAG_OUT"; fi; }
expect_error() {
  if echo "$2" | psql_exec; then bad "$1 (statement succeeded)"
  elif grep -qiE "$3" "$DIAG_OUT"; then ok "$1"
  else bad "$1 (wrong error, wanted /$3/)"; sed 's/^/    /' "$DIAG_OUT"; fi
}
expect_eq() {
  local got; got="$(echo "$2" | psql_query | tr -d '[:space:]')"
  if [ "$got" = "$3" ]; then ok "$1 ($got)"; else bad "$1 (want '$3', got '$got')"; fi
}

# Legacy data that exists BEFORE the migration (the "existing Production" stand-in).
LEGACY_SQL=$(cat <<'SQL'
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id), username TEXT, name TEXT);
SQL
)
LEGACY_ROWS=$(cat <<'SQL'
INSERT INTO organisations VALUES ('org-a','Org A','org-a'),('org-b','Org B','org-b');
INSERT INTO users VALUES ('user-a','org-a','ua','User A');
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
  ('legacy-ev','org-a','Legacy GA','legacy','PUBLISHED','2026-12-01 09:00Z','2026-12-01 12:00Z','Australia/Adelaide');
INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES
  ('legacy-ses','legacy-ev','org-a','Main','2026-12-01 09:00Z','2026-12-01 12:00Z',100);
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity) VALUES
  ('legacy-free','legacy-ev','org-a','Free',0,50),('legacy-paid','legacy-ev','org-a','Paid',2500,50);
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, booking_token, product_surface) VALUES
  ('legacy-ord','org-a','legacy-ev','Pat','pat@example.test','CONFIRMED','bt-legacy','EVE');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, event_session_id, ticket_type_id, quantity) VALUES
  ('legacy-item','org-a','legacy-ord','legacy-ev','legacy-ses','legacy-free',2);
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token) VALUES
  ('legacy-att-1','org-a','legacy-ev','legacy-ord','legacy-item','Pat','tok-legacy-1'),
  ('legacy-att-2','org-a','legacy-ev','legacy-ord','legacy-item','Sam','tok-legacy-2');
SQL
)
# md5 over the ORIGINAL columns of the legacy rows (columns listed explicitly so new columns do
# not change the fingerprint; they are checked separately).
FINGERPRINT_SQL=$(cat <<'SQL'
SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'e:'||row(id,organisation_id,name,slug,status,starts_at,ends_at,timezone)::text x FROM events WHERE id LIKE 'legacy%'
  UNION ALL SELECT 's:'||row(id,event_id,name,capacity)::text FROM event_sessions WHERE id LIKE 'legacy%'
  UNION ALL SELECT 't:'||row(id,event_id,name,price_cents,capacity,active,sort_order,currency)::text FROM event_ticket_types WHERE id LIKE 'legacy%'
  UNION ALL SELECT 'o:'||row(id,event_id,status,payment_status,total_cents,booking_token,product_surface)::text FROM event_orders WHERE id LIKE 'legacy%'
  UNION ALL SELECT 'i:'||row(id,order_id,ticket_type_id,event_session_id,quantity)::text FROM event_order_items WHERE id LIKE 'legacy%'
  UNION ALL SELECT 'a:'||row(id,order_id,order_item_id,attendee_name,ticket_token,checked_in_at)::text FROM event_attendees WHERE id LIKE 'legacy%'
) q;
SQL
)
schema_dump() { docker exec "$CONTAINER" pg_dump -U postgres -d testdb --schema-only --no-owner --no-privileges | grep -vE '^(--|SET |SELECT pg_catalog|\\restrict |\\unrestrict )' | sed '/^$/d'; }

# Seating fixture (after migration). Layout L1 v1: "Stalls" rows A,B × seats 1..3 (A1 wheelchair,
# A2 companion of A1) and "Ballroom" tables 1,2 × seats 1..2. Event ev-1 has sessions s1, s2.
FIXTURE_SQL=$(cat <<'SQL'
INSERT INTO events (id, organisation_id, name, slug, status, starts_at, ends_at, timezone) VALUES
  ('ev-1','org-a','Gala','gala','DRAFT','2026-12-05 09:00Z','2026-12-05 23:00Z','Australia/Adelaide'),
  ('ev-2','org-a','Other','other','DRAFT','2026-12-06 09:00Z','2026-12-06 23:00Z','Australia/Adelaide'),
  ('ev-b','org-b','Foreign','foreign','DRAFT','2026-12-07 09:00Z','2026-12-07 23:00Z','Australia/Adelaide');
INSERT INTO event_sessions (id, event_id, organisation_id, name, starts_at, ends_at, capacity) VALUES
  ('s1','ev-1','org-a','Matinee','2026-12-05 09:00Z','2026-12-05 12:00Z',100),
  ('s2','ev-1','org-a','Evening','2026-12-05 19:00Z','2026-12-05 23:00Z',100),
  ('s-other','ev-2','org-a','Only','2026-12-06 09:00Z','2026-12-06 12:00Z',100);
INSERT INTO seating_venues (id, organisation_id, name, address) VALUES
  ('ven-a','org-a','Town Hall','1 Main St'), ('ven-b','org-b','Foreign Hall',NULL);
INSERT INTO seating_layouts (id, organisation_id, venue_id, name, version) VALUES ('L1','org-a','ven-a','Main floor',1);
INSERT INTO seating_layout_sections (id, organisation_id, layout_id, name, sort_order) VALUES
  ('sec-st','org-a','L1','Stalls',1), ('sec-ball','org-a','L1','Ballroom',2);
INSERT INTO seating_layout_groups (id, organisation_id, layout_id, section_id, kind, label, sort_order) VALUES
  ('g-A','org-a','L1','sec-st','ROW','A',1), ('g-B','org-a','L1','sec-st','ROW','B',2),
  ('g-T1','org-a','L1','sec-ball','TABLE','1',1), ('g-T2','org-a','L1','sec-ball','TABLE','2',2);
INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order, wheelchair_space) VALUES
  ('ls-A1','org-a','L1','sec-st','g-A','1',1,true);
INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order, companion_seat, companion_of_seat_id) VALUES
  ('ls-A2','org-a','L1','sec-st','g-A','2',2,true,'ls-A1');
INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES
  ('ls-A3','org-a','L1','sec-st','g-A','3',3),
  ('ls-B1','org-a','L1','sec-st','g-B','1',1), ('ls-B2','org-a','L1','sec-st','g-B','2',2), ('ls-B3','org-a','L1','sec-st','g-B','3',3),
  ('ls-T1-1','org-a','L1','sec-ball','g-T1','1',1), ('ls-T1-2','org-a','L1','sec-ball','g-T1','2',2),
  ('ls-T2-1','org-a','L1','sec-ball','g-T2','1',1), ('ls-T2-2','org-a','L1','sec-ball','g-T2','2',2);
UPDATE seating_layouts SET status = 'PUBLISHED', published_at = now() WHERE id = 'L1';
INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-1','org-a','L1',0);
INSERT INTO event_seats (id, organisation_id, event_id, event_session_id, layout_seat_id)
  SELECT 'es-'||ses||'-'||substr(ls.id,4), 'org-a','ev-1', ses, ls.id
    FROM seating_layout_seats ls CROSS JOIN (VALUES ('s1'),('s2')) v(ses) WHERE ls.layout_id = 'L1';
INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity, seating_mode) VALUES
  ('tt-ga','ev-1','org-a','Floor GA',0,100,'GENERAL_ADMISSION'),
  ('tt-res','ev-1','org-a','Reserved Stalls',0,12,'ASSIGNED'),
  ('tt-gala','ev-1','org-a','Gala table',0,8,'ASSIGNED');
INSERT INTO event_ticket_type_sections (organisation_id, event_id, ticket_type_id, layout_id, layout_section_id) VALUES
  ('org-a','ev-1','tt-res','L1','sec-st'), ('org-a','ev-1','tt-gala','L1','sec-ball');
INSERT INTO event_orders (id, organisation_id, event_id, purchaser_name, purchaser_email, status, product_surface) VALUES
  ('ord-1','org-a','ev-1','Jane','jane@example.test','CONFIRMED','EVE'),
  ('ord-2','org-a','ev-1','Ken','ken@example.test','CONFIRMED','EVE'),
  ('ord-x','org-a','ev-2','Xi','xi@example.test','CONFIRMED','EVE');
INSERT INTO event_order_items (id, organisation_id, order_id, event_id, event_session_id, ticket_type_id, quantity) VALUES
  ('it-ga','org-a','ord-1','ev-1','s1','tt-ga',1),
  ('it-res','org-a','ord-1','ev-1','s1','tt-res',3),
  ('it-gala','org-a','ord-1','ev-1','s1','tt-gala',1),
  ('it-res2','org-a','ord-2','ev-1','s2','tt-res',1);
SQL
)
snap() { # layout_id version section kind group seat display
  printf '{"v":1,"layout_id":"%s","layout_version":%s,"section":"%s","group_kind":"%s","group":"%s","seat":"%s","display":"%s"}' "$@"
}
SNAP_A1="$(snap L1 1 Stalls ROW A 1 'Stalls · Row A · Seat 1')"
SNAP_A2="$(snap L1 1 Stalls ROW A 2 'Stalls · Row A · Seat 2')"
SNAP_A3="$(snap L1 1 Stalls ROW A 3 'Stalls · Row A · Seat 3')"
SNAP_B1="$(snap L1 1 Stalls ROW B 1 'Stalls · Row B · Seat 1')"
SNAP_T1="$(snap L1 1 Ballroom TABLE 1 1 'Table 1 · Seat 1')"
HASH_A="$(printf 'a%.0s' $(seq 1 64))"
HASH_B="$(printf 'b%.0s' $(seq 1 64))"
HASH_C="$(printf 'c%.0s' $(seq 1 64))"

run_version() {
  PGV="$1"
  CONTAINER="seating-s1-pg$PGV-$$"
  echo "=== PostgreSQL $PGV ==="
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb "postgres:$PGV-alpine" >/dev/null || { echo "ERROR: start postgres:$PGV" >&2; exit 2; }
  for i in $(seq 1 40); do docker exec "$CONTAINER" pg_isready -U postgres -d testdb >/dev/null 2>&1 && break; sleep 1; done
  sleep 1
  echo "$LEGACY_SQL" | psql_exec || { echo "ERROR: bootstrap" >&2; cat "$DIAG_OUT" >&2; exit 2; }
  for f in "${BASE_MIGRATIONS[@]}"; do apply_file "$REPO_ROOT/scripts/$f.sql" || { echo "ERROR: base migration $f" >&2; cat "$DIAG_OUT" >&2; exit 2; }; done
  echo "$LEGACY_ROWS" | psql_exec || { echo "ERROR: legacy rows" >&2; cat "$DIAG_OUT" >&2; exit 2; }
  expect_eq "server is PostgreSQL $PGV" "SELECT split_part(current_setting('server_version'),'.',1);" "$PGV"

  echo "-- M: migration"
  local fp_before schema_before schema_after
  fp_before="$(echo "$FINGERPRINT_SQL" | psql_query | tr -d '[:space:]')"
  schema_before="$(schema_dump)"
  if apply_file "$MIGRATION"; then ok "M1 migration applies"; else bad "M1 migration applies"; sed 's/^/    /' "$DIAG_OUT"; return; fi
  if apply_file "$MIGRATION"; then ok "M2 migration re-applies (idempotent)"; else bad "M2 re-apply"; sed 's/^/    /' "$DIAG_OUT"; fi
  schema_after="$(schema_dump)"
  if apply_file "$MIGRATION" && [ "$(schema_dump)" = "$schema_after" ]; then ok "M3 third apply leaves the schema dump identical"; else bad "M3 schema changed on re-apply"; fi
  expect_eq "M4 legacy rows byte-identical" "$FINGERPRINT_SQL" "$fp_before"
  expect_eq "M5 legacy ticket types default GENERAL_ADMISSION" "SELECT string_agg(seating_mode, ',' ORDER BY id) FROM event_ticket_types;" "GENERAL_ADMISSION,GENERAL_ADMISSION"
  expect_eq "M6 legacy attendees have no seat data" "SELECT count(*) FROM event_attendees WHERE event_seat_id IS NOT NULL OR seat_snapshot IS NOT NULL OR seat_released_at IS NOT NULL;" "0"
  expect_eq "M7 version marker recorded once" "SELECT count(*) FROM events_schema_migrations WHERE version='seating-s1';" "1"
  expect_eq "M8 btree_gist recorded as installed by this migration (fresh database)" "SELECT details->>'installed_btree_gist' FROM events_schema_migrations;" "true"
  expect_success "M9 GA ticket type insert unchanged after migration" "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, price_cents, capacity) VALUES ('legacy-new','legacy-ev','org-a','Late',0,5);"
  expect_success "M10 GA attendee insert/check-in/cancel unchanged" "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token) VALUES ('legacy-att-3','org-a','legacy-ev','legacy-ord','legacy-item','Lee','tok-legacy-3'); UPDATE event_attendees SET checked_in_at = now() WHERE id = 'legacy-att-3'; UPDATE event_orders SET status='CANCELLED' WHERE id='legacy-ord'; UPDATE event_orders SET status='CONFIRMED' WHERE id='legacy-ord'; DELETE FROM event_attendees WHERE id='legacy-att-3'; DELETE FROM event_ticket_types WHERE id='legacy-new';"
  expect_eq "M11 legacy rows still identical after GA round-trip" "$FINGERPRINT_SQL" "$fp_before"

  echo "-- M: rollback (before seating data) restores the exact schema"
  if apply_file "$ROLLBACK"; then ok "M12 rollback applies"; else bad "M12 rollback"; sed 's/^/    /' "$DIAG_OUT"; fi
  if [ "$(schema_dump)" = "$schema_before" ]; then ok "M13 schema dump after rollback == before migration"
  else bad "M13 schema differs after rollback"; diff <(echo "$schema_before") <(schema_dump) | head -20 | sed 's/^/    /'; fi
  expect_eq "M14 legacy rows identical after rollback" "$FINGERPRINT_SQL" "$fp_before"
  expect_eq "M15 btree_gist removed (it was installed by seating-s1)" "SELECT count(*) FROM pg_extension WHERE extname='btree_gist';" "0"
  if apply_file "$ROLLBACK"; then ok "M16 rollback re-run is a no-op"; else bad "M16 rollback re-run"; fi
  if apply_file "$MIGRATION"; then ok "M17 re-apply after rollback"; else bad "M17 re-apply after rollback"; sed 's/^/    /' "$DIAG_OUT"; fi
  if [ "$(schema_dump)" = "$schema_after" ]; then ok "M18 re-applied schema == first application"; else bad "M18 re-applied schema differs"; fi

  echo "-- fixture"
  if echo "$FIXTURE_SQL" | psql_exec; then ok "fixture: venue, layout v1, event seating, 20 event seats, mixed ticket types"; else bad "fixture"; sed 's/^/    /' "$DIAG_OUT"; return; fi
  expect_eq "fixture: event_seating recorded layout version from the layout" "SELECT layout_version FROM event_seating WHERE event_id='ev-1';" "1"
  expect_eq "fixture: inventory per session (2 × 10)" "SELECT count(*) FROM event_seats WHERE event_id='ev-1';" "20"

  echo "-- M: rollback refuses while seating data exists"
  expect_error "M19 rollback refused with seating rows present" "$(cat "$ROLLBACK")" "ROLLBACK_REFUSED"
  expect_eq "M20 refused rollback changed nothing" "SELECT count(*) FROM event_seats;" "20"

  echo "-- T: tenant isolation"
  expect_error "T1 layout cannot use another organisation's venue" "INSERT INTO seating_layouts (organisation_id, venue_id, name, version) VALUES ('org-b','ven-a','X',1);" "seating_layouts_venue_fkey"
  expect_success "T1b draft layout L2 in org-b" "INSERT INTO seating_layouts (id, organisation_id, venue_id, name, version) VALUES ('LB','org-b','ven-b','B',1);"
  expect_error "T2 section cannot point at another organisation's layout" "INSERT INTO seating_layout_sections (organisation_id, layout_id, name, sort_order) VALUES ('org-b','L1','X',9);" "seating_layout_sections_layout_fkey"
  expect_success "T2b sections in LB" "INSERT INTO seating_layout_sections (id, organisation_id, layout_id, name, sort_order) VALUES ('sec-b','org-b','LB','B',1);"
  expect_error "T3 group cannot use a section of another layout" "INSERT INTO seating_layout_groups (organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('org-b','LB','sec-st','ROW','Z',9);" "seating_layout_groups_section_fkey"
  expect_success "T3b group in LB" "INSERT INTO seating_layout_groups (id, organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('g-b','org-b','LB','sec-b','ROW','A',1);"
  expect_error "T4 seat cannot use a group of another layout/section" "INSERT INTO seating_layout_seats (organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('org-b','LB','sec-b','g-A','9',9);" "seating_layout_seats_group_fkey"
  expect_error "T5 companion reference must stay in the same layout" "INSERT INTO seating_layout_seats (organisation_id, layout_id, section_id, group_id, label, sort_order, companion_seat, companion_of_seat_id) VALUES ('org-b','LB','sec-b','g-b','1',1,true,'ls-A1');" "seating_layout_seats_companion_fkey"
  expect_error "T6 org-b event cannot attach org-a layout" "INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-b','org-b','L1',1);" "event_seating_layout_fkey|SEATING_LAYOUT_NOT_PUBLISHED"
  expect_error "T7 event_seating organisation must match the event" "INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-b','org-a','L1',1);" "event_seating_event_fkey"
  expect_error "T8 event seat cannot use another layout's seat" "INSERT INTO event_seats (organisation_id, event_id, event_session_id, layout_seat_id) VALUES ('org-b','ev-b',NULL,'ls-A1');" "SEAT_NOT_FOUND|event_seats_seating_fkey"
  expect_error "T9 event seat session must belong to the same event" "INSERT INTO event_seats (organisation_id, event_id, event_session_id, layout_seat_id) VALUES ('org-a','ev-1','s-other','ls-A1');" "event_seats_session_fkey"
  expect_error "T10 event seat cannot be added to an event without seating" "INSERT INTO event_seats (organisation_id, event_id, event_session_id, layout_seat_id) VALUES ('org-a','ev-2','s-other','ls-A1');" "event_seats_seating_fkey"
  expect_error "T11 ticket-type/section mapping cannot cross events" "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, capacity) VALUES ('tt-ev2','ev-2','org-a','Other',5); INSERT INTO event_ticket_type_sections (organisation_id, event_id, ticket_type_id, layout_id, layout_section_id) VALUES ('org-a','ev-1','tt-ev2','L1','sec-st');" "event_tt_sections_ticket_type_fkey"
  expect_error "T12 mapping cannot use a section of a different layout" "INSERT INTO event_ticket_type_sections (organisation_id, event_id, ticket_type_id, layout_id, layout_section_id) VALUES ('org-a','ev-1','tt-res','L1','sec-b');" "event_tt_sections_section_fkey"
  expect_error "T13 mapping cannot claim another layout for the event" "INSERT INTO event_ticket_type_sections (organisation_id, event_id, ticket_type_id, layout_id, layout_section_id) VALUES ('org-a','ev-1','tt-res','LB','sec-b');" "event_tt_sections_seating_fkey|event_tt_sections_section_fkey"
  expect_error "T14 hold with the wrong organisation refused" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-b','ev-1','es-s1-A3','$HASH_A', now(), now() + interval '10 minutes');" "SEAT_NOT_FOUND"
  expect_error "T15 hold cannot claim another event (event filled from the seat)" "INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('h-t15','org-a','ev-2','es-s2-A2','$HASH_A', now(), now() + interval '10 minutes'); SELECT CASE WHEN (SELECT event_id FROM event_seat_holds WHERE id='h-t15') = 'ev-1' THEN 1/0 END; " "division by zero"
  expect_error "T16 attendee cannot take a seat of another event" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-2','ord-x','it-res','X','es-s1-A3','$SNAP_A3');" "SEAT_NOT_FOUND|event_attendees_event_seat_fkey|event_attendees_order_item"
  expect_error "T17 attendee cannot take another organisation's seat" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-b','ev-1','ord-1','it-res','X','es-s1-A3','$SNAP_A3');" "SEAT_NOT_FOUND|fkey"
  expect_error "T18 ASSIGNED ticket type refused on an event without seating" "INSERT INTO event_ticket_types (event_id, organisation_id, name, capacity, seating_mode) VALUES ('ev-2','org-a','Seated',5,'ASSIGNED');" "SEATING_NOT_CONFIGURED"
  expect_error "T19 GA ticket type cannot be switched to ASSIGNED without seating" "UPDATE event_ticket_types SET seating_mode='ASSIGNED' WHERE id='legacy-free';" "SEATING_NOT_CONFIGURED"
  expect_error "T20 seating_mode must be a known value" "UPDATE event_ticket_types SET seating_mode='VIP' WHERE id='legacy-free';" "seating_mode_check"

  echo "-- U: uniqueness"
  expect_error "U1 duplicate seat label in a row" "INSERT INTO seating_layout_seats (organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('org-b','LB','sec-b','g-b','1',1),('org-b','LB','sec-b','g-b','1',2);" "seating_layout_seats_label_key"
  expect_error "U2 duplicate sort position in a row" "INSERT INTO seating_layout_seats (organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('org-b','LB','sec-b','g-b','1',1),('org-b','LB','sec-b','g-b','2',1);" "seating_layout_seats_sort_key"
  expect_error "U3 duplicate row label in a section" "INSERT INTO seating_layout_groups (organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('org-b','LB','sec-b','ROW','A',2);" "seating_layout_groups_label_key"
  expect_error "U4 duplicate section name (case-insensitive)" "INSERT INTO seating_layout_sections (organisation_id, layout_id, name, sort_order) VALUES ('org-b','LB',' b ',2);" "seating_layout_sections_name_key"
  expect_error "U5 group kind must be ROW or TABLE" "INSERT INTO seating_layout_groups (organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('org-b','LB','sec-b','BOOTH','Q',3);" "kind_check"
  expect_error "U6 duplicate event inventory (same session + layout seat)" "INSERT INTO event_seats (organisation_id, event_id, event_session_id, layout_seat_id) VALUES ('org-a','ev-1','s1','ls-A1');" "event_seats_inventory_key"
  expect_error "U7 duplicate venue name in an organisation" "INSERT INTO seating_venues (organisation_id, name) VALUES ('org-a','town hall');" "seating_venues_org_name_active_key"
  expect_error "U8 duplicate layout version" "INSERT INTO seating_layouts (organisation_id, venue_id, name, version) VALUES ('org-a','ven-a','Main floor',1);" "seating_layouts_version_key"

  echo "-- F: layout freeze and snapshot inventory"
  expect_success "F1 draft layout is editable (rename, add/edit/delete seat)" "UPDATE seating_layouts SET name='B2' WHERE id='LB'; INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('lsb-1','org-b','LB','sec-b','g-b','1',1),('lsb-2','org-b','LB','sec-b','g-b','2',2); UPDATE seating_layout_seats SET label='3' WHERE id='lsb-2'; DELETE FROM seating_layout_seats WHERE id='lsb-2';"
  expect_error "F2 empty layout cannot be published" "INSERT INTO seating_layouts (id, organisation_id, name, version) VALUES ('L-empty','org-a','Empty',1); UPDATE seating_layouts SET status='PUBLISHED', published_at=now() WHERE id='L-empty';" "SEATING_LAYOUT_EMPTY"
  expect_error "F3 layout must be created DRAFT" "INSERT INTO seating_layouts (organisation_id, name, version, status, published_at) VALUES ('org-a','P',1,'PUBLISHED',now());" "SEATING_LAYOUT_FROZEN"
  expect_error "F4 a DRAFT layout cannot be attached to an event" "INSERT INTO seating_layouts (id, organisation_id, name, version) VALUES ('L-draft','org-a','Draft',1); INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-2','org-a','L-draft',1);" "SEATING_LAYOUT_NOT_PUBLISHED"
  expect_error "F5 published layout: seat label edit refused" "UPDATE seating_layout_seats SET label='99' WHERE id='ls-A3';" "SEATING_LAYOUT_FROZEN"
  expect_error "F6 published layout: seat insert refused" "INSERT INTO seating_layout_seats (organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('org-a','L1','sec-st','g-A','4',4);" "SEATING_LAYOUT_FROZEN"
  expect_error "F7 published layout: section delete refused" "DELETE FROM seating_layout_sections WHERE id='sec-ball';" "SEATING_LAYOUT_FROZEN"
  expect_error "F8 published layout: group rename refused" "UPDATE seating_layout_groups SET label='AA' WHERE id='g-A';" "SEATING_LAYOUT_FROZEN"
  expect_error "F9 published layout: rename refused" "UPDATE seating_layouts SET name='Renamed' WHERE id='L1';" "SEATING_LAYOUT_FROZEN"
  expect_error "F10 published layout: delete refused" "DELETE FROM seating_layouts WHERE id='L1';" "SEATING_LAYOUT_FROZEN"
  expect_error "F11 published layout cannot go back to DRAFT" "UPDATE seating_layouts SET status='DRAFT', published_at=NULL WHERE id='L1';" "SEATING_LAYOUT_FROZEN"
  expect_success "F12 new version v2 can be created and edited as DRAFT" "INSERT INTO seating_layouts (id, organisation_id, venue_id, name, version) VALUES ('L1v2','org-a','ven-a','Main floor',2); INSERT INTO seating_layout_sections (id, organisation_id, layout_id, name, sort_order) VALUES ('v2-sec','org-a','L1v2','Stalls (renumbered)',1); INSERT INTO seating_layout_groups (id, organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('v2-g','org-a','L1v2','v2-sec','ROW','AA',1); INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('v2-1','org-a','L1v2','v2-sec','v2-g','101',1); UPDATE seating_layouts SET status='PUBLISHED', published_at=now() WHERE id='L1v2';"
  expect_success "F13 v1 can be retired while events still use it" "UPDATE seating_layouts SET status='RETIRED', retired_at=now() WHERE id='L1';"
  expect_error "F14 retired layout is immutable" "UPDATE seating_layouts SET retired_at=now() - interval '1 day' WHERE id='L1';" "SEATING_LAYOUT_FROZEN"
  expect_eq "F15 ev-1 inventory unchanged by v2 / retirement" "SELECT string_agg(section_name||'/'||group_kind||'/'||group_label||'/'||seat_label, ',' ORDER BY section_sort, group_sort, seat_sort) FROM event_seats WHERE event_session_id='s1' AND layout_section_id='sec-st';" "Stalls/ROW/A/1,Stalls/ROW/A/2,Stalls/ROW/A/3,Stalls/ROW/B/1,Stalls/ROW/B/2,Stalls/ROW/B/3"
  expect_error "F16 the attached layout of an event cannot be swapped in place" "UPDATE event_seating SET layout_id='L1v2' WHERE event_id='ev-1';" "SEATING_LAYOUT_FROZEN|fkey"
  expect_error "F17 event seat snapshot columns are immutable" "UPDATE event_seats SET seat_label='99' WHERE id='es-s1-A1';" "SEAT_SNAPSHOT_IMMUTABLE"
  expect_success "F18 caller-supplied snapshot values are ignored (filled from the layout)" "INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-2','org-a','L1v2',42); INSERT INTO event_seats (id, organisation_id, event_id, event_session_id, layout_seat_id, section_name, group_kind, group_label, seat_label, section_sort, group_sort, seat_sort, wheelchair_space, companion_seat, step_free, restricted_view) VALUES ('es-ev2','org-a','ev-2','s-other','v2-1','FORGED','TABLE','Z','Z',0,0,0,true,true,true,true);"
  expect_eq "F19 stored snapshot is the layout's, not the caller's" "SELECT (SELECT layout_version FROM event_seating WHERE event_id='ev-2')||':'||section_name||'/'||group_kind||'/'||group_label||'/'||seat_label||'/'||wheelchair_space FROM event_seats WHERE id='es-ev2';" "2:Stalls(renumbered)/ROW/AA/101/false"
  expect_eq "F20 wheelchair / companion facts copied" "SELECT wheelchair_space||','||companion_seat FROM event_seats WHERE id IN ('es-s1-A1','es-s1-A2') ORDER BY id;" "true,falsefalse,true"
  expect_success "F21 sale_status may change (block / unblock)" "UPDATE event_seats SET sale_status='BLOCKED', block_note='sound desk' WHERE id='es-s1-B3'; UPDATE event_seats SET sale_status='AVAILABLE', block_note=NULL WHERE id='es-s1-B3';"
  expect_error "F22 inactive layout seats cannot be copied" "INSERT INTO seating_layouts (id, organisation_id, name, version) VALUES ('L-inact','org-a','Inactive',1); INSERT INTO seating_layout_sections (id, organisation_id, layout_id, name, sort_order) VALUES ('i-sec','org-a','L-inact','S',1); INSERT INTO seating_layout_groups (id, organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('i-g','org-a','L-inact','i-sec','ROW','A',1); INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order, active) VALUES ('i-1','org-a','L-inact','i-sec','i-g','1',1,true),('i-2','org-a','L-inact','i-sec','i-g','2',2,false); UPDATE seating_layouts SET status='PUBLISHED', published_at=now() WHERE id='L-inact'; INSERT INTO events (id, organisation_id, name, slug, starts_at, ends_at, timezone) VALUES ('ev-3','org-a','Three','three','2026-12-08 09:00Z','2026-12-08 12:00Z','UTC'); INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-3','org-a','L-inact',1); INSERT INTO event_seats (organisation_id, event_id, layout_seat_id) VALUES ('org-a','ev-3','i-2');" "SEAT_INACTIVE"
  expect_error "F23 NULL-session inventory is still unique (NULLS NOT DISTINCT)" "INSERT INTO event_seats (id, organisation_id, event_id, layout_seat_id) VALUES ('es-ev3','org-a','ev-3','i-1'); INSERT INTO event_seats (organisation_id, event_id, layout_seat_id) VALUES ('org-a','ev-3','i-1');" "event_seats_inventory_key"

  echo "-- H: holds"
  expect_success "H1 10-minute initial hold" "INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('h1','org-a','ev-1','es-s1-A3','$HASH_A', now(), now() + interval '10 minutes');"
  expect_eq "H2 hold event/session filled from the seat" "SELECT event_id||'/'||event_session_id FROM event_seat_holds WHERE id='h1';" "ev-1/s1"
  expect_error "H3 second ACTIVE hold on the same seat refused" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-1','es-s1-A3','$HASH_B', now(), now() + interval '10 minutes');" "event_seat_holds_one_active_per_seat"
  expect_success "H4 same seat in the OTHER session is independent" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-1','es-s2-A3','$HASH_B', now(), now() + interval '10 minutes');"
  expect_error "H5 initial window longer than 10 minutes refused" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-1','es-s1-B1','$HASH_C', now(), now() + interval '11 minutes');" "event_seat_holds_window_check"
  expect_error "H6 window beyond the 20-minute cap refused even with renewal" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at, renewal_count) VALUES ('org-a','ev-1','es-s1-B1','$HASH_C', now(), now() + interval '21 minutes', 1);" "event_seat_holds_window_check"
  expect_error "H7 more than one renewal refused" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at, renewal_count) VALUES ('org-a','ev-1','es-s1-B1','$HASH_C', now(), now() + interval '5 minutes', 2);" "renewal_count_check"
  expect_error "H8 malformed secret hash refused" "INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-1','es-s1-B1','not-a-hash', now(), now() + interval '5 minutes');" "secret_hash_check"
  expect_success "H9 one renewal: forward, before expiry, within 20 minutes" "UPDATE event_seat_holds SET renewal_count=1, expires_at = hold_started_at + interval '20 minutes' WHERE id='h1';"
  expect_error "H10 second renewal refused" "UPDATE event_seat_holds SET renewal_count=1, expires_at = expires_at - interval '1 second' WHERE id='h1';" "HOLD_RENEWAL_REFUSED"
  expect_error "H11 renewal beyond 20 minutes from the hold start refused" "UPDATE event_seat_holds SET renewal_count=1, expires_at = hold_started_at + interval '25 minutes' WHERE id='h1';" "HOLD_RENEWAL_REFUSED|window_check"
  expect_success "H12 expired hold (created 15 min ago, expired 5 min ago)" "INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, created_at, expires_at) VALUES ('h-old','org-a','ev-1','es-s1-B1','$HASH_C', now() - interval '15 minutes', now() - interval '15 minutes', now() - interval '5 minutes');"
  expect_success "H13 an expired ACTIVE hold does not block a new hold (no cleanup ran)" "INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('h-new','org-a','ev-1','es-s1-B1','$HASH_A', now(), now() + interval '10 minutes');"
  expect_error "H14 renewing the expired hold refused" "UPDATE event_seat_holds SET renewal_count=1, expires_at = now() + interval '1 minute' WHERE id='h-old';" "HOLD_RENEWAL_REFUSED"
  expect_error "H15 an expired hold cannot be consumed" "UPDATE event_seat_holds SET state='CONSUMED', consumed_at=now(), order_id='ord-1' WHERE id='h-old';" "HOLD_EXPIRED"
  expect_error "H16 a live hold cannot be marked EXPIRED" "UPDATE event_seat_holds SET state='EXPIRED' WHERE id='h-new';" "HOLD_STATE_INVALID"
  expect_success "H17 sweep may mark the expired hold EXPIRED" "UPDATE event_seat_holds SET state='EXPIRED' WHERE id='h-old';"
  expect_error "H18 terminal holds are immutable" "UPDATE event_seat_holds SET state='ACTIVE' WHERE id='h-old';" "HOLD_IMMUTABLE"
  expect_error "H19 CONSUMED needs an order" "UPDATE event_seat_holds SET state='CONSUMED', consumed_at=now() WHERE id='h-new';" "lifecycle_check"
  expect_success "H20 release frees the seat immediately" "UPDATE event_seat_holds SET state='RELEASED', released_at=now() WHERE id='h-new'; INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('h-after','org-a','ev-1','es-s1-B1','$HASH_B', now(), now() + interval '10 minutes');"
  expect_error "H21 hold on a BLOCKED seat refused" "UPDATE event_seats SET sale_status='BLOCKED' WHERE id='es-s1-B2'; INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-1','es-s1-B2','$HASH_A', now(), now() + interval '10 minutes');" "SEAT_UNAVAILABLE"
  expect_error "H22 hold identity columns immutable" "UPDATE event_seat_holds SET event_seat_id='es-s1-A1' WHERE id='h-after';" "HOLD_IMMUTABLE"
  expect_success "H23 consume a live hold with its order" "UPDATE event_seat_holds SET state='CONSUMED', consumed_at=now(), order_id='ord-1' WHERE id='h-after';"
  # Concurrent proof: A inserts and sleeps inside its transaction; B inserts the same seat.
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb >/tmp/seat-race-a-$$ 2>&1 <<SQL &
BEGIN; INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('race-a','org-a','ev-1','es-s2-B1','$HASH_A', now(), now() + interval '10 minutes'); SELECT pg_sleep(2); COMMIT;
SQL
  local pid_a=$!
  sleep 0.7
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb >/tmp/seat-race-b-$$ 2>&1 <<SQL
INSERT INTO event_seat_holds (id, organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('race-b','org-a','ev-1','es-s2-B1','$HASH_B', now(), now() + interval '10 minutes');
SQL
  wait "$pid_a"
  if grep -q "event_seat_holds_one_active_per_seat" /tmp/seat-race-b-$$ && ! grep -qi error /tmp/seat-race-a-$$; then ok "H24 concurrent holds on one seat: first wins, second waits then fails"
  else bad "H24 concurrent hold race"; sed 's/^/    A: /' /tmp/seat-race-a-$$; sed 's/^/    B: /' /tmp/seat-race-b-$$; fi
  expect_eq "H25 exactly one hold row from the race" "SELECT count(*) FROM event_seat_holds WHERE event_seat_id='es-s2-B1';" "1"

  echo "-- A: attendee seat assignment"
  expect_success "A1 GA attendee in a seated event needs no seat" "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token) VALUES ('att-ga','org-a','ev-1','ord-1','it-ga','Gus','tok-ga');"
  expect_success "A2 seated attendee assigned with a matching snapshot" "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token, event_seat_id, seat_snapshot) VALUES ('att-1','org-a','ev-1','ord-1','it-res','Jane','tok-1','es-s1-A1','$SNAP_A1');"
  expect_success "A3 mixed order: GA + Stalls + Gala table attendees in one order" "INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, ticket_token, event_seat_id, seat_snapshot) VALUES ('att-t','org-a','ev-1','ord-1','it-gala','Tia','tok-t','es-s1-T1-1','$SNAP_T1');"
  expect_eq "A4 mixed order shape (GA no seat, two seated)" "SELECT string_agg(coalesce(seat_snapshot->>'display','GA'), ';' ORDER BY id) FROM event_attendees WHERE order_id='ord-1';" "Stalls·RowA·Seat1;GA;Table1·Seat1"
  expect_error "A5 second unreleased attendee on the same seat refused" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-res','Dup','es-s1-A1','$SNAP_A1');" "event_attendees_active_seat_key"
  expect_error "A6 GA ticket type cannot carry a seat" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-ga','G','es-s1-A2','$SNAP_A2');" "SEAT_NOT_ALLOWED"
  expect_error "A7 ticket type cannot use an unmapped section" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-gala','G','es-s1-A2','$SNAP_A2');" "SECTION_NOT_ELIGIBLE"
  expect_error "A8 seat must be in the attendee's own session" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s2-A2','$SNAP_A2');" "SEAT_SESSION_MISMATCH"
  expect_error "A9 snapshot must describe the seat (wrong label)" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s1-A2','$SNAP_A3');" "SEAT_SNAPSHOT_INVALID"
  expect_error "A10 snapshot cannot carry extra (e.g. buyer / health) keys" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s1-A2', '$SNAP_A2'::jsonb || '{\"needs\":\"wheelchair\"}');" "SEAT_SNAPSHOT_INVALID"
  expect_error "A11 seat without snapshot refused" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s1-A2');" "seat_snapshot_check|SEAT_SNAPSHOT_INVALID"
  expect_error "A12 BLOCKED seat cannot be assigned" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s1-B2','$(snap L1 1 Stalls ROW B 2 'Stalls · Row B · Seat 2')');" "SEAT_UNAVAILABLE"
  expect_error "A13 an assigned seat cannot be blocked" "UPDATE event_seats SET sale_status='BLOCKED' WHERE id='es-s1-A1';" "SEAT_ASSIGNED"
  expect_error "A14 attendee cannot be created with a released seat" "INSERT INTO event_attendees (organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot, seat_released_at) VALUES ('org-a','ev-1','ord-1','it-res','G','es-s1-A2','$SNAP_A2', now());" "SEAT_HISTORY_IMMUTABLE"
  expect_success "A15 admin reassignment in place: Jane A1 → A2 (A1 freed)" "UPDATE event_attendees SET event_seat_id='es-s1-A2', seat_snapshot='$SNAP_A2' WHERE id='att-1'; INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('att-2','org-a','ev-1','ord-1','it-res','Max','es-s1-A1','$SNAP_A1');"
  expect_error "A16 clearing a seat refused (release keeps history)" "UPDATE event_attendees SET event_seat_id=NULL, seat_snapshot=NULL WHERE id='att-2';" "SEAT_HISTORY_IMMUTABLE"
  expect_error "A17 release cannot rewrite the snapshot" "UPDATE event_attendees SET seat_released_at=now(), seat_snapshot='$SNAP_A3' WHERE id='att-2';" "SEAT_HISTORY_IMMUTABLE"
  expect_success "A18 cancellation release frees the seat; another attendee can take it" "UPDATE event_attendees SET seat_released_at=now() WHERE id='att-2'; INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('att-3','org-a','ev-1','ord-1','it-res','Ola','es-s1-A1','$SNAP_A1');"
  expect_eq "A19 released history keeps its snapshot" "SELECT seat_snapshot->>'display' FROM event_attendees WHERE id='att-2';" "Stalls·RowA·Seat1"
  expect_error "A20 released history is immutable" "UPDATE event_attendees SET seat_released_at = seat_released_at - interval '1 hour' WHERE id='att-2';" "SEAT_HISTORY_IMMUTABLE"
  expect_error "A21 re-activating a released row onto a taken seat refused" "UPDATE event_attendees SET seat_released_at=NULL WHERE id='att-2';" "event_attendees_active_seat_key"
  expect_error "A22 ASSIGNED type cannot go back to GA while seated attendees exist" "UPDATE event_ticket_types SET seating_mode='GENERAL_ADMISSION' WHERE id='tt-res';" "SEATING_IN_USE"
  expect_error "A23 section mapping cannot be removed while in use" "DELETE FROM event_ticket_type_sections WHERE ticket_type_id='tt-res' AND layout_section_id='sec-st';" "SEATING_IN_USE"
  expect_error "A24 event seating cannot be detached while ASSIGNED types exist" "DELETE FROM event_seating WHERE event_id='ev-1';" "SEATING_IN_USE"
  # Concurrent assignment race on one seat.
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb >/tmp/seat-race-c-$$ 2>&1 <<SQL &
BEGIN; INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('race-c','org-a','ev-1','ord-1','it-res','C','es-s1-B1','$SNAP_B1'); SELECT pg_sleep(2); COMMIT;
SQL
  local pid_c=$!
  sleep 0.7
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb >/tmp/seat-race-d-$$ 2>&1 <<SQL
INSERT INTO event_attendees (id, organisation_id, event_id, order_id, order_item_id, attendee_name, event_seat_id, seat_snapshot) VALUES ('race-d','org-a','ev-1','ord-1','it-res','D','es-s1-B1','$SNAP_B1');
SQL
  wait "$pid_c"
  if grep -q "event_attendees_active_seat_key" /tmp/seat-race-d-$$ && ! grep -qi error /tmp/seat-race-c-$$; then ok "A25 concurrent assignment of one seat: exactly one succeeds"
  else bad "A25 concurrent assignment race"; sed 's/^/    C: /' /tmp/seat-race-c-$$; sed 's/^/    D: /' /tmp/seat-race-d-$$; fi
  expect_eq "A26 exactly one unreleased attendee per seat across the event" "SELECT count(*) FROM (SELECT event_seat_id FROM event_attendees WHERE event_seat_id IS NOT NULL AND seat_released_at IS NULL GROUP BY 1 HAVING count(*) > 1) d;" "0"
  expect_success "A27 deleting a seated event (ASSIGNED type, mapping, hold) cascades cleanly" "INSERT INTO event_ticket_types (id, event_id, organisation_id, name, capacity, seating_mode) VALUES ('tt-ev3','ev-3','org-a','Seat',1,'ASSIGNED'); INSERT INTO event_ticket_type_sections (organisation_id, event_id, ticket_type_id, layout_id, layout_section_id) VALUES ('org-a','ev-3','tt-ev3','L-inact','i-sec'); INSERT INTO event_seat_holds (organisation_id, event_id, event_seat_id, secret_hash, hold_started_at, expires_at) VALUES ('org-a','ev-3','es-ev3','$HASH_A', now(), now() + interval '10 minutes'); DELETE FROM events WHERE id='ev-3';"
  expect_eq "A28 nothing of ev-3 left behind" "SELECT (SELECT count(*) FROM event_seating WHERE event_id='ev-3') + (SELECT count(*) FROM event_seats WHERE event_id='ev-3') + (SELECT count(*) FROM event_seat_holds WHERE event_id='ev-3') + (SELECT count(*) FROM event_ticket_type_sections WHERE event_id='ev-3');" "0"
  expect_eq "A29 legacy rows still identical at the end" "$FINGERPRINT_SQL" "$fp_before"
  expect_success "A30 deleting an organisation with a PUBLISHED layout + seated event still cascades" "INSERT INTO organisations VALUES ('org-c','Org C','org-c'); INSERT INTO seating_layouts (id, organisation_id, name, version) VALUES ('LC','org-c','C',1); INSERT INTO seating_layout_sections (id, organisation_id, layout_id, name, sort_order) VALUES ('c-sec','org-c','LC','S',1); INSERT INTO seating_layout_groups (id, organisation_id, layout_id, section_id, kind, label, sort_order) VALUES ('c-g','org-c','LC','c-sec','ROW','A',1); INSERT INTO seating_layout_seats (id, organisation_id, layout_id, section_id, group_id, label, sort_order) VALUES ('c-1','org-c','LC','c-sec','c-g','1',1); UPDATE seating_layouts SET status='PUBLISHED', published_at=now() WHERE id='LC'; INSERT INTO events (id, organisation_id, name, slug, starts_at, ends_at, timezone) VALUES ('ev-c','org-c','C','c','2026-12-09 09:00Z','2026-12-09 12:00Z','UTC'); INSERT INTO event_seating (event_id, organisation_id, layout_id, layout_version) VALUES ('ev-c','org-c','LC',1); INSERT INTO event_seats (organisation_id, event_id, layout_seat_id) VALUES ('org-c','ev-c','c-1'); DELETE FROM organisations WHERE id='org-c';"
  expect_eq "A31 nothing of org-c left behind" "SELECT (SELECT count(*) FROM seating_layouts WHERE organisation_id='org-c') + (SELECT count(*) FROM seating_layout_seats WHERE organisation_id='org-c') + (SELECT count(*) FROM event_seats WHERE organisation_id='org-c');" "0"
  expect_error "A32 a PUBLISHED layout of a live organisation still cannot be deleted" "DELETE FROM seating_layouts WHERE id='L1v2';" "SEATING_LAYOUT_FROZEN"

  echo "-- I: indexes"
  expect_eq "I1 seat-map / door-list ordering index" "SELECT count(*) FROM pg_indexes WHERE indexname='event_seats_map_idx' AND indexdef LIKE '%(event_id, event_session_id, section_sort, group_sort, seat_sort)%';" "1"
  expect_eq "I2 occupancy-by-section, active-hold, secret and attendee-by-seat indexes" "SELECT count(*) FROM pg_indexes WHERE indexname IN ('event_seats_section_idx','event_seat_holds_active_event_idx','event_seat_holds_secret_idx','event_attendees_active_seat_key','event_seat_holds_one_active_per_seat');" "5"

  docker rm -f "$CONTAINER" >/dev/null 2>&1; CONTAINER=""
}

for v in $PG_VERSIONS; do run_version "$v"; done

echo
echo "RESULT: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then printf '  - %s\n' "${FAILURES[@]}"; exit 1; fi
exit 0
