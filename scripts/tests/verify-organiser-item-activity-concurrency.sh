#!/usr/bin/env bash
# Organiser Phase D.4.5C-B — repeatable behavioral validation for atomic
# item activity history (app/api/organiser/boards/[boardId]/items/route.ts
# POST, app/api/organiser/items/[itemId]/route.ts PATCH/DELETE).
#
# WHY THIS EXISTS: D.4.5C-A's audit concluded that a race-safe item PATCH
# needs a `FOR UPDATE`-locked "old" CTE combined with the UPDATE and the
# organiser_activity INSERT in ONE writable-CTE statement — modeled
# directly on the ALREADY-PROVEN, ALREADY-SHIPPED pattern in
# app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts
# (the "R1" fix) and this repo's own established harness convention
# (scripts/tests/verify-events-phase2-concurrency.sh,
# scripts/tests/verify-import-batches-migration.sh). Static/mocked tests
# cannot prove MVCC/locking correctness by construction (no real
# transaction, snapshot, or locking semantics in a mock) — this harness
# exists specifically to make a regression in that correctness
# mechanically detectable, exactly as the Events precedent already does
# for its own comparable problem.
#
# WHAT THIS DOES: bootstraps a disposable postgres:16-alpine container
# with the REAL organiser_boards/organiser_items/organiser_activity DDL
# (extracted verbatim from app/api/admin/migrate/route.ts, steps 33/35/40,
# plus the organiser_activity_sanitise_scalar function from step 41), then
# executes the SAME structural SQL pattern the production item routes
# submit (the old/updated/field_diff/custom_diff/activity_row writable-CTE
# statement), via `docker exec ... psql`. Two genuinely concurrent psql
# connections are used for the race scenarios, with a `pg_sleep()` CTE
# injected right after the FOR UPDATE lock to force real overlap/blocking
# — the same forced-blocking technique
# scripts/tests/verify-events-phase2-concurrency.sh already established.
#
# WHAT THIS DOES NOT DO: it is not wired into CI (Docker is not part of
# the standard CI workflow in this repo, matching every prior harness of
# this kind). It requires only Docker. It never touches Production or any
# already-running database — it creates and destroys its own disposable
# container, and cleans up on exit even on failure (trap on EXIT).
#
# USAGE:
#   bash scripts/tests/verify-organiser-item-activity-concurrency.sh
#
# Exits 0 if every check passes, non-zero and prints a summary of what
# failed otherwise.

set -uo pipefail

CONTAINER="organiser-activity-harness-$$"
PASS=0
FAIL=0
FAILURES=()

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "${OUT_A:-}" "${OUT_B:-}" 2>/dev/null || true
}
trap cleanup EXIT

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

OUT_A="/tmp-not-used-see-scratchpad"
OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

psql_exec() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d testdb -v ON_ERROR_STOP=1
}
psql_query() {
  docker exec -i "$CONTAINER" psql -X -t -A -U postgres -d testdb -v ON_ERROR_STOP=1
}
reset_db() {
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "DROP DATABASE IF EXISTS testdb;" >/dev/null 2>&1
  docker exec -i "$CONTAINER" psql -X -q -U postgres -d postgres -c "CREATE DATABASE testdb;" >/dev/null 2>&1
}

# ─── Real, unmodified DDL — extracted verbatim from the same source as
# every other organiser_* table (app/api/admin/migrate/route.ts). ────────
bootstrap() {
  cat <<'SQL' | psql_exec
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);

CREATE TABLE organiser_boards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name            TEXT NOT NULL,
  color           TEXT,
  icon            TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organiser_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name            TEXT NOT NULL,
  color           TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organiser_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  group_id        UUID REFERENCES organiser_groups(id) ON DELETE SET NULL,
  parent_item_id  UUID REFERENCES organiser_items(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Not Started',
  priority        TEXT,
  owner           TEXT,
  due_date        DATE,
  notes           TEXT,
  fields          JSONB NOT NULL DEFAULT '{}',
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}';

CREATE TABLE organiser_activity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  board_id        UUID NOT NULL,
  item_id         UUID,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                     'board.created', 'board.updated', 'board.deleted',
                     'group.created', 'group.updated', 'group.deleted',
                     'column.created', 'column.updated', 'column.deleted',
                     'item.created', 'item.updated', 'item.moved', 'item.deleted',
                     'comment.created',
                     'file.added', 'file.deleted',
                     'import.completed'
                   )),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('board', 'group', 'item', 'column', 'file', 'comment', 'import')),
  entity_id       TEXT NOT NULL,
  before_json     JSONB,
  after_json      JSONB,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase D.4.5F — added for the board/group/comment/file harness sections
-- below. Verbatim from app/api/admin/migrate/route.ts steps 38/39.
CREATE TABLE organiser_item_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES organiser_items(id) ON DELETE CASCADE,
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  file_name       TEXT NOT NULL,
  file_url        TEXT NOT NULL,
  file_size       INTEGER,
  uploaded_by     TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organiser_item_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES organiser_items(id) ON DELETE CASCADE,
  board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  author_name     TEXT,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION organiser_activity_sanitise_scalar(value jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $f$
  SELECT CASE
    WHEN value IS NULL OR jsonb_typeof(value) = 'null' THEN value
    WHEN jsonb_typeof(value) = 'string' THEN
      to_jsonb(
        CASE WHEN length(value #>> '{}') > 200
          THEN left(value #>> '{}', 200) || '…(truncated)'
          ELSE value #>> '{}'
        END
      )
    WHEN jsonb_typeof(value) IN ('object', 'array') THEN
      to_jsonb(
        CASE WHEN length(value::text) > 200
          THEN left(value::text, 200) || '…(truncated)'
          ELSE value::text
        END
      )
    ELSE value
  END
$f$;

INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'u1', 'James'), ('user-2', 'org-a', 'u2', 'Luke');
INSERT INTO organiser_boards (id, organisation_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'org-a', 'Board A');
INSERT INTO organiser_boards (id, organisation_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'org-b', 'Board B');
SQL
}

expect_success() {
  local desc="$1" sql="$2"
  local out; out="$(echo "$sql" | psql_exec 2>&1)"
  if [ $? -eq 0 ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL (expected success, got error): $desc"
    echo "$out" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
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

# ─── The PATCH statement, as REAL Postgres SQL text — mirrors, statement-
# for-statement, exactly what app/api/organiser/items/[itemId]/route.ts's
# PATCH submits as one writable-CTE statement.
# $1=itemId $2=org $3=actorUserId $4=actorName
# $5=hasGroupId $6=groupIdVal $7=hasParentId $8=parentIdVal
# $9=hasDueDate $10=dueDate $11=name $12=status $13=priority $14=owner
# $15=notes $16=position $17=hasCustomValues $18=customValuesJson
# $19=inject (delay CTE injection point, empty in normal-path tests)
patch_item_sql() {
  local id="$1" org="$2" actor_id="$3" actor_name="$4"
  local has_group="$5" group_val="$6" has_parent="$7" parent_val="$8"
  local has_due="$9" due_val="${10}" name_val="${11}" status_val="${12}" priority_val="${13}" owner_val="${14}"
  local notes_val="${15}" position_val="${16}" has_cv="${17}" cv_json="${18}" inject="${19:-}"
  cat <<SQL
WITH old AS MATERIALIZED (
  SELECT id, board_id, group_id, parent_item_id, name, status, priority, owner, due_date, notes, position, custom_values
  FROM organiser_items WHERE id = '$id' AND organisation_id = '$org' FOR UPDATE
),
$inject
updated AS (
  UPDATE organiser_items i SET
    group_id       = CASE WHEN $has_group THEN $group_val ELSE old.group_id END,
    parent_item_id = CASE WHEN $has_parent THEN $parent_val ELSE old.parent_item_id END,
    due_date       = CASE WHEN $has_due THEN $due_val ELSE old.due_date END,
    name           = COALESCE($name_val, old.name),
    status         = COALESCE($status_val, old.status),
    priority       = COALESCE($priority_val, old.priority),
    owner          = COALESCE($owner_val, old.owner),
    notes          = COALESCE($notes_val, old.notes),
    position       = COALESCE($position_val, old.position),
    custom_values  = CASE WHEN $has_cv THEN old.custom_values || '$cv_json'::jsonb ELSE old.custom_values END,
    updated_at     = NOW()
  FROM old${inject:+, delay}
  WHERE i.id = old.id
  RETURNING i.id, i.board_id, i.group_id, i.parent_item_id, i.name, i.status, i.priority, i.owner,
            i.due_date::text AS due_date, i.notes, i.custom_values, i.position, i.updated_at
),
field_diff AS (
  SELECT
    jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
    jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
    bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
  FROM old, updated,
  LATERAL (VALUES
    ('group_id', organiser_activity_sanitise_scalar(to_jsonb(old.group_id)), organiser_activity_sanitise_scalar(to_jsonb(updated.group_id))),
    ('parent_item_id', organiser_activity_sanitise_scalar(to_jsonb(old.parent_item_id)), organiser_activity_sanitise_scalar(to_jsonb(updated.parent_item_id))),
    ('due_date', organiser_activity_sanitise_scalar(to_jsonb(old.due_date)), organiser_activity_sanitise_scalar(to_jsonb(updated.due_date))),
    ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
    ('status', organiser_activity_sanitise_scalar(to_jsonb(old.status)), organiser_activity_sanitise_scalar(to_jsonb(updated.status))),
    ('priority', organiser_activity_sanitise_scalar(to_jsonb(old.priority)), organiser_activity_sanitise_scalar(to_jsonb(updated.priority))),
    ('owner', organiser_activity_sanitise_scalar(to_jsonb(old.owner)), organiser_activity_sanitise_scalar(to_jsonb(updated.owner))),
    ('notes', organiser_activity_sanitise_scalar(to_jsonb(old.notes)), organiser_activity_sanitise_scalar(to_jsonb(updated.notes)))
  ) AS f(key, old_val, new_val)
),
custom_diff AS (
  SELECT
    jsonb_object_agg(kv.key, organiser_activity_sanitise_scalar(old.custom_values -> kv.key)) FILTER (WHERE old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS before_obj,
    jsonb_object_agg(kv.key, organiser_activity_sanitise_scalar(kv.value)) FILTER (WHERE old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS after_obj,
    bool_or(old.custom_values -> kv.key IS DISTINCT FROM kv.value) AS any_changed
  FROM old, jsonb_each('$cv_json'::jsonb) AS kv(key, value)
),
activity_row AS (
  INSERT INTO organiser_activity (
    organisation_id, board_id, item_id, actor_user_id, actor_name,
    event_type, entity_type, entity_id, before_json, after_json, metadata_json
  )
  SELECT
    '$org', updated.board_id, updated.id, '$actor_id', '$actor_name',
    CASE WHEN old.group_id IS DISTINCT FROM updated.group_id OR old.parent_item_id IS DISTINCT FROM updated.parent_item_id
      THEN 'item.moved' ELSE 'item.updated' END,
    'item', updated.id::text,
    COALESCE(field_diff.before_obj, '{}'::jsonb) ||
      (CASE WHEN custom_diff.any_changed THEN jsonb_build_object('custom_values', custom_diff.before_obj) ELSE '{}'::jsonb END),
    COALESCE(field_diff.after_obj, '{}'::jsonb) ||
      (CASE WHEN custom_diff.any_changed THEN jsonb_build_object('custom_values', custom_diff.after_obj) ELSE '{}'::jsonb END),
    '{}'::jsonb
  FROM old, updated, field_diff, custom_diff
  WHERE field_diff.any_changed IS TRUE OR custom_diff.any_changed IS TRUE
  RETURNING id
)
SELECT updated.id, updated.status, updated.priority FROM updated;
SQL
}

# ─── The POST/create statement, as REAL Postgres SQL text — mirrors,
# statement-for-statement, exactly what app/api/organiser/boards/
# [boardId]/items/route.ts's POST submits as one writable-CTE statement.
# Phase D.4.5C-T/U — added specifically because the disposable harness
# previously only ever seeded organiser_items via a plain INSERT and
# never exercised POST's own atomic CTE against real Postgres. That gap
# is exactly why the "inserted" CTE's RETURNING list omitting board_id
# (while activity_row referenced inserted.board_id) went undetected
# through every prior 40/40 harness run — a mocked/structural test can
# confirm the query TEXT mentions board_id, but only real Postgres
# execution can catch a "column does not exist" error. P1 below is that
# regression test: it fails with exactly that error against the
# pre-fix SQL, and passes against the fixed SQL.
# $1=boardId $2=org $3=groupId(SQL literal or NULL) $4=parentItemId(SQL literal or NULL)
# $5=name(quoted) $6=status(quoted) $7=position $8=actorUserId $9=actorName
create_item_sql() {
  local board="$1" org="$2" group_val="$3" parent_val="$4"
  local name_val="$5" status_val="$6" position_val="$7" actor_id="$8" actor_name="$9"
  cat <<SQL
WITH inserted AS (
  INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, status, position)
  VALUES ('$board', '$org', $group_val, $parent_val, $name_val, $status_val, $position_val)
  RETURNING id, board_id, group_id, parent_item_id, name, status, priority, owner, due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
),
activity_row AS (
  INSERT INTO organiser_activity (
    organisation_id, board_id, item_id, actor_user_id, actor_name,
    event_type, entity_type, entity_id, before_json, after_json
  )
  SELECT
    '$org', inserted.board_id, inserted.id, '$actor_id', '$actor_name',
    'item.created', 'item', inserted.id::text, NULL,
    jsonb_build_object(
      'name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)),
      'status', organiser_activity_sanitise_scalar(to_jsonb(inserted.status)),
      'group_id', to_jsonb(inserted.group_id),
      'parent_item_id', to_jsonb(inserted.parent_item_id)
    )
  FROM inserted
  RETURNING id
)
SELECT id, group_id, parent_item_id, name, status, priority, owner, due_date, notes, fields, custom_values, position, created_at, updated_at
FROM inserted;
SQL
}

run_concurrent_pair() {
  local sql_a="$1" sql_b="$2"
  (echo "$sql_a" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1) &
  local pid_a=$!
  sleep 0.5
  (echo "$sql_b" | docker exec -i "$CONTAINER" psql -X -U postgres -d testdb -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1) &
  local pid_b=$!
  wait "$pid_a" "$pid_b"
}

echo ""
echo "=== BOOTSTRAP ==="
reset_db
bootstrap
echo "  bootstrap applied (real organiser_boards/organiser_items/organiser_activity DDL + sanitiser function)"

echo ""
echo "=== ITEM CREATE (POST) — regression test for the inserted.board_id RETURNING bug ==="
expect_success "P1. POST item-create CTE succeeds (previously failed in production: column inserted.board_id does not exist)" \
  "$(create_item_sql 11111111-1111-1111-1111-111111111111 org-a NULL NULL "'Created Item'" "'Not Started'" 0 user-1 James)"
expect_eq "P2. exactly one organiser_items row created" \
  "SELECT count(*) FROM organiser_items WHERE name='Created Item';" "1"
expect_eq "P3. exactly one item.created activity row" \
  "SELECT count(*) FROM organiser_activity WHERE event_type='item.created';" "1"
expect_eq "P4. activity row's board_id matches the created item's board_id (the exact column that was missing from RETURNING)" \
  "SELECT (a.board_id = i.board_id)::text FROM organiser_activity a JOIN organiser_items i ON i.name='Created Item' WHERE a.event_type='item.created';" "true"
expect_eq "P5. activity actor_user_id/actor_name correct (session-derived, not request-derived)" \
  "SELECT actor_user_id || '/' || actor_name FROM organiser_activity WHERE event_type='item.created';" "user-1/James"
expect_eq "P6. after_json contains name and status, not position (position never enters activity payloads)" \
  "SELECT (after_json ? 'name')::text || (after_json ? 'status')::text || (after_json ? 'position')::text FROM organiser_activity WHERE event_type='item.created';" "truetruefalse"
expect_eq "P7. before_json is NULL for a create (no prior state to diff against)" \
  "SELECT (before_json IS NULL)::text FROM organiser_activity WHERE event_type='item.created';" "true"

echo ""
echo "=== ITEM CREATE ATOMIC FAILURE — activity insert fails, item INSERT must roll back too ==="
BEFORE_CREATE_ITEMS="$(echo "SELECT count(*) FROM organiser_items;" | psql_query | tr -d '[:space:]')"
BEFORE_CREATE_ACT="$(echo "SELECT count(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"
BROKEN_CREATE_SQL="
WITH inserted AS (
  INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, status, position)
  VALUES ('11111111-1111-1111-1111-111111111111', 'org-a', NULL, NULL, 'Should Rollback', 'Not Started', 0)
  RETURNING id, board_id, name
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', inserted.board_id, inserted.id, 'user-1', 'James', 'item.NOT_A_REAL_EVENT_TYPE', 'item', inserted.id::text, NULL, jsonb_build_object('name', to_jsonb(inserted.name))
  FROM inserted
  RETURNING id
)
SELECT inserted.id FROM inserted;
"
OUT="$(echo "$BROKEN_CREATE_SQL" | psql_exec 2>&1)"
if [ $? -ne 0 ]; then
  echo "  PASS: P8. forced-invalid-event-type POST statement correctly rejected by CHECK constraint"
  PASS=$((PASS + 1))
else
  echo "  FAIL: P8. forced-invalid POST statement unexpectedly succeeded"
  FAIL=$((FAIL + 1))
  FAILURES+=("P8. forced-invalid POST statement should have failed")
fi
expect_eq "P9. item INSERT ROLLED BACK too (organiser_items count unchanged)" \
  "SELECT count(*) FROM organiser_items;" "$BEFORE_CREATE_ITEMS"
expect_eq "P9b. no activity row was written either" \
  "SELECT count(*) FROM organiser_activity;" "$BEFORE_CREATE_ACT"

# Isolate the POST section's rows from the PATCH sections below, several
# of which assert an exact global organiser_activity row count — matches
# this file's own existing convention (see DIFFERENT-FIELD CONCURRENCY).
reset_db; bootstrap

echo ""
echo "=== NORMAL PATH ==="
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status, priority) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'org-a', 'Test Item', 'Not Started', 'Low');" | psql_exec >/dev/null

expect_success "1. status-only PATCH succeeds" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL "'Working on it'" NULL NULL NULL NULL false '{}')"
expect_eq "1b. status updated" \
  "SELECT status FROM organiser_items WHERE id='33333333-3333-3333-3333-333333333333';" "Workingonit"
expect_eq "1c. exactly one activity row, correct before/after" \
  "SELECT (before_json->>'status') || '->' || (after_json->>'status') FROM organiser_activity;" "NotStarted->Workingonit"

echo ""
echo "=== POSITION-ONLY SUPPRESSION ==="
expect_success "2. position-only PATCH succeeds" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL NULL NULL NULL NULL 7 false '{}')"
expect_eq "2b. position updated" \
  "SELECT position FROM organiser_items WHERE id='33333333-3333-3333-3333-333333333333';" "7"
expect_eq "2c. still exactly one activity row (no new row for position-only)" \
  "SELECT count(*) FROM organiser_activity;" "1"

echo ""
echo "=== SAME-VALUE SUPPRESSION ==="
expect_success "3. same-value PATCH (status already 'Working on it') succeeds" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL "'Working on it'" NULL NULL NULL NULL false '{}')"
expect_eq "3b. still exactly one activity row (no false-positive)" \
  "SELECT count(*) FROM organiser_activity;" "1"

echo ""
echo "=== CUSTOM_VALUES DIFF ==="
echo "UPDATE organiser_items SET custom_values='{\"a\":1,\"b\":2}'::jsonb WHERE id='33333333-3333-3333-3333-333333333333';" | psql_exec >/dev/null
expect_success "4. custom_values partial-key update succeeds" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL NULL NULL NULL NULL NULL true '{"b":3}')"
expect_eq "4b. merged custom_values correct ({a:1,b:3})" \
  "SELECT custom_values FROM organiser_items WHERE id='33333333-3333-3333-3333-333333333333';" '{"a":1,"b":3}'
expect_eq "4c. activity before/after custom_values diff is key-level only ({b:2}->{b:3})" \
  "SELECT (before_json->'custom_values')::text || '->' || (after_json->'custom_values')::text FROM organiser_activity ORDER BY created_at DESC LIMIT 1;" '{"b":2}->{"b":3}'

echo "UPDATE organiser_items SET custom_values='{\"a\":1,\"b\":2}'::jsonb WHERE id='33333333-3333-3333-3333-333333333333';" | psql_exec >/dev/null
expect_success "5. custom_values same-value request produces no diff" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL NULL NULL NULL NULL NULL true '{"b":2}')"
BEFORE_CNT="$(echo "SELECT count(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"
expect_eq "5b. no new activity row for same-value custom_values" "SELECT count(*) FROM organiser_activity;" "$BEFORE_CNT"

expect_success "6. custom_values explicit null request records value->null" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James false NULL false NULL false NULL NULL NULL NULL NULL NULL NULL true '{"b":null}')"
expect_eq "6b. before=2 after=null" \
  "SELECT (before_json->'custom_values')::text || '->' || (after_json->'custom_values')::text FROM organiser_activity ORDER BY created_at DESC LIMIT 1;" '{"b":2}->{"b":null}'

echo ""
echo "=== ITEM.MOVED CLASSIFICATION ==="
echo "INSERT INTO organiser_groups (id, board_id, organisation_id, name) VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'org-a', 'Group X');" | psql_exec >/dev/null
expect_success "7. group_id change -> item.moved" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James true "'44444444-4444-4444-4444-444444444444'" false NULL false NULL NULL NULL NULL NULL NULL NULL false '{}')"
expect_eq "7b. event_type is item.moved" \
  "SELECT event_type FROM organiser_activity ORDER BY created_at DESC LIMIT 1;" "item.moved"

echo "UPDATE organiser_items SET group_id = NULL WHERE id='33333333-3333-3333-3333-333333333333';" | psql_exec >/dev/null
expect_success "8. group_id + status change together -> ONE item.moved with both diffs" \
  "$(patch_item_sql 33333333-3333-3333-3333-333333333333 org-a user-1 James true "'44444444-4444-4444-4444-444444444444'" false NULL false NULL NULL "'Done'" NULL NULL NULL NULL false '{}')"
expect_eq "8b. event_type is item.moved (not item.updated, not two rows)" \
  "SELECT event_type FROM organiser_activity ORDER BY created_at DESC LIMIT 1;" "item.moved"
expect_eq "8c. before/after diff contains BOTH group_id and status keys" \
  "SELECT (before_json ? 'group_id' AND before_json ? 'status' AND after_json ? 'group_id' AND after_json ? 'status')::text FROM organiser_activity ORDER BY created_at DESC LIMIT 1;" "true"

echo ""
echo "=== DELETE ==="
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'org-a', 'Delete Me', 'Not Started');" | psql_exec >/dev/null
DELETE_SQL="
WITH deleted AS (
  DELETE FROM organiser_items
  WHERE id = '55555555-5555-5555-5555-555555555555' AND organisation_id = 'org-a'
  RETURNING id, board_id, group_id, parent_item_id, name, status
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', deleted.board_id, deleted.id, 'user-1', 'James', 'item.deleted', 'item', deleted.id::text,
    jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name)), 'status', organiser_activity_sanitise_scalar(to_jsonb(deleted.status)), 'group_id', to_jsonb(deleted.group_id), 'parent_item_id', to_jsonb(deleted.parent_item_id)),
    NULL
  FROM deleted
  RETURNING id
)
SELECT deleted.id FROM deleted;
"
expect_success "9. DELETE succeeds" "$DELETE_SQL"
expect_eq "9b. item is gone" \
  "SELECT count(*) FROM organiser_items WHERE id='55555555-5555-5555-5555-555555555555';" "0"
expect_eq "9c. item.deleted activity row survives (no FK, row still queryable)" \
  "SELECT event_type FROM organiser_activity WHERE entity_id='55555555-5555-5555-5555-555555555555';" "item.deleted"
expect_eq "9d. before_json contains the identity summary" \
  "SELECT before_json->>'name' FROM organiser_activity WHERE entity_id='55555555-5555-5555-5555-555555555555';" "DeleteMe"

echo ""
echo "=== CROSS-TENANT ==="
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'org-b', 'Org B Item', 'Not Started');" | psql_exec >/dev/null
BEFORE_ACT="$(echo "SELECT count(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"
expect_success "10. cross-tenant PATCH (org-a session against org-b item) executes without error but matches zero rows" \
  "$(patch_item_sql 66666666-6666-6666-6666-666666666666 org-a user-1 James false NULL false NULL false NULL NULL "'Hacked'" NULL NULL NULL NULL false '{}')"
expect_eq "10b. org-b item untouched" \
  "SELECT status FROM organiser_items WHERE id='66666666-6666-6666-6666-666666666666';" "NotStarted"
expect_eq "10c. no new activity row from the cross-tenant attempt" \
  "SELECT count(*) FROM organiser_activity;" "$BEFORE_ACT"

echo ""
echo "=== ATOMIC FAILURE — activity insert fails, mutation must roll back ==="
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'org-a', 'Atomic Test', 'Not Started');" | psql_exec >/dev/null
# Force the activity INSERT's CHECK constraint to fail by injecting an
# invalid event_type directly into the activity_row CTE (ad hoc, this
# harness's own scratch copy only — never the real route file).
BROKEN_SQL="
WITH old AS MATERIALIZED (
  SELECT id, board_id, status FROM organiser_items WHERE id = '77777777-7777-7777-7777-777777777777' AND organisation_id = 'org-a' FOR UPDATE
),
updated AS (
  UPDATE organiser_items i SET status = 'Done', updated_at = NOW()
  FROM old WHERE i.id = old.id
  RETURNING i.id, i.board_id, i.status
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.board_id, updated.id, 'user-1', 'James', 'item.NOT_A_REAL_EVENT_TYPE', 'item', updated.id::text, '{}'::jsonb, '{}'::jsonb
  FROM old, updated
  RETURNING id
)
SELECT updated.status FROM updated;
"
OUT="$(echo "$BROKEN_SQL" | psql_exec 2>&1)"
if [ $? -ne 0 ]; then
  echo "  PASS: forced-invalid-event-type statement correctly rejected by CHECK constraint"
  PASS=$((PASS + 1))
else
  echo "  FAIL: forced-invalid statement unexpectedly succeeded"
  FAIL=$((FAIL + 1))
  FAILURES+=("forced-invalid statement should have failed")
fi
expect_eq "11. item mutation ROLLED BACK — status is still 'Not Started', not 'Done'" \
  "SELECT status FROM organiser_items WHERE id='77777777-7777-7777-7777-777777777777';" "NotStarted"
expect_eq "11b. no activity row was written either" \
  "SELECT count(*) FROM organiser_activity WHERE item_id='77777777-7777-7777-7777-777777777777';" "0"

echo ""
echo "=== FAILED PRIMARY MUTATION -> NO ACTIVITY ROW (nonexistent item id) ==="
BEFORE_ACT2="$(echo "SELECT count(*) FROM organiser_activity;" | psql_query | tr -d '[:space:]')"
expect_success "12. PATCH against a nonexistent item id executes without SQL error" \
  "$(patch_item_sql 99999999-9999-9999-9999-999999999999 org-a user-1 James false NULL false NULL false NULL NULL "'X'" NULL NULL NULL NULL false '{}')"
expect_eq "12b. no activity row was created" \
  "SELECT count(*) FROM organiser_activity;" "$BEFORE_ACT2"

echo ""
echo "=== DIFFERENT-FIELD CONCURRENCY (section 26) ==="
reset_db; bootstrap
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status, priority) VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'org-a', 'Race Item', 'Not Started', 'Low');" | psql_exec >/dev/null
SQL_DF_A="$(patch_item_sql 88888888-8888-8888-8888-888888888888 org-a user-1 James false NULL false NULL false NULL NULL "'Working on it'" NULL NULL NULL NULL false '{}' 'delay AS (SELECT pg_sleep(2) FROM old),')"
SQL_DF_B="$(patch_item_sql 88888888-8888-8888-8888-888888888888 org-a user-2 Luke false NULL false NULL false NULL NULL NULL "'High'" NULL NULL NULL false '{}')"
run_concurrent_pair "$SQL_DF_A" "$SQL_DF_B"
echo "  (A held the row lock 2s changing status; B changed priority, blocked behind A, then proceeded)"
expect_eq "13. final status is A's value" \
  "SELECT status FROM organiser_items WHERE id='88888888-8888-8888-8888-888888888888';" "Workingonit"
expect_eq "13b. final priority is B's value" \
  "SELECT priority FROM organiser_items WHERE id='88888888-8888-8888-8888-888888888888';" "High"
expect_eq "13c. exactly two activity rows (one per PATCH)" \
  "SELECT count(*) FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888';" "2"
expect_eq "13d. A's row: status Not Started -> Working on it, NO stale/wrong before value" \
  "SELECT (before_json->>'status') || '->' || (after_json->>'status') FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888' AND event_type='item.updated' AND before_json ? 'status' ORDER BY created_at ASC LIMIT 1;" "NotStarted->Workingonit"
expect_eq "13e. B's row: priority Low -> High, correctly observed the current (not stale) priority" \
  "SELECT (before_json->>'priority') || '->' || (after_json->>'priority') FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888' AND before_json ? 'priority' ORDER BY created_at ASC LIMIT 1;" "Low->High"
echo "  Commit order: A committed first (held lock 2s from t=0), B blocked until ~t=2, committed second."
echo "  Activity timeline: [A: status Not Started->Working on it] then [B: priority Low->High] — both correct, neither stale."

echo ""
echo "=== SAME-FIELD CONCURRENCY (section 27 — HARD GATE) ==="
reset_db; bootstrap
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'org-a', 'Race Item 2', 'Not Started');" | psql_exec >/dev/null
SQL_SF_A="$(patch_item_sql 88888888-8888-8888-8888-888888888888 org-a user-1 James false NULL false NULL false NULL NULL "'Working on it'" NULL NULL NULL NULL false '{}' 'delay AS (SELECT pg_sleep(2) FROM old),')"
SQL_SF_B="$(patch_item_sql 88888888-8888-8888-8888-888888888888 org-a user-2 Luke false NULL false NULL false NULL NULL "'Done'" NULL NULL NULL NULL false '{}')"
run_concurrent_pair "$SQL_SF_A" "$SQL_SF_B"
echo "  Resulting activity chain (before->after per row, in commit order):"
docker exec "$CONTAINER" psql -X -t -A -U postgres -d testdb -c \
  "SELECT (before_json->>'status') || ' -> ' || (after_json->>'status') FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888' ORDER BY created_at ASC;"
FINAL_STATUS="$(echo "SELECT status FROM organiser_items WHERE id='88888888-8888-8888-8888-888888888888';" | psql_query | tr -d '[:space:]')"
echo "  Final DB status: $FINAL_STATUS"
# The hard invariant: the chain must be a VALID, connected sequence
# (each row's before == the previous row's after, OR the first row's
# before == the true original 'Not Started'), never two rows both
# claiming to start from 'Not Started'.
CHAIN_OK="$(docker exec "$CONTAINER" psql -X -t -A -U postgres -d testdb -c "
WITH ordered AS (
  SELECT before_json->>'status' AS b, after_json->>'status' AS a, created_at,
         row_number() OVER (ORDER BY created_at ASC) AS rn
  FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888'
),
joined AS (
  SELECT o1.rn, o1.b, o1.a, o2.a AS prev_a
  FROM ordered o1 LEFT JOIN ordered o2 ON o2.rn = o1.rn - 1
)
SELECT bool_and(
  (rn = 1 AND b = 'Not Started') OR (rn > 1 AND b = prev_a)
) FROM joined;
" | tr -d '[:space:]')"
if [ "$CHAIN_OK" = "t" ]; then
  echo "  PASS (HARD GATE): activity chain is a valid, connected sequence — no invalid fork"
  PASS=$((PASS + 1))
else
  echo "  FAIL (HARD GATE): activity chain is INVALID — this is the exact bug this phase exists to prevent"
  FAIL=$((FAIL + 1))
  FAILURES+=("same-field concurrency chain invalid")
fi
expect_eq "14. exactly two activity rows" \
  "SELECT count(*) FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888';" "2"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "=== MUTATION PROOF A (section 39.A) — remove FOR UPDATE, prove the harness detects it ==="
  reset_db; bootstrap
  echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'org-a', 'Mutation Item', 'Not Started');" | psql_exec >/dev/null
  MUT_A_SQL_A="
WITH old AS MATERIALIZED (
  SELECT id, board_id, status FROM organiser_items WHERE id = '88888888-8888-8888-8888-888888888888' AND organisation_id = 'org-a'
),
delay AS (SELECT pg_sleep(2) FROM old),
updated AS (
  UPDATE organiser_items i SET status = 'Working on it', updated_at = NOW()
  FROM old, delay WHERE i.id = old.id
  RETURNING i.id, i.board_id, i.status
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.board_id, updated.id, 'user-1', 'James', 'item.updated', 'item', updated.id::text,
    jsonb_build_object('status', old.status), jsonb_build_object('status', updated.status)
  FROM old, updated WHERE old.status IS DISTINCT FROM updated.status RETURNING id
)
SELECT updated.status FROM updated;
"
  MUT_A_SQL_B="
WITH old AS MATERIALIZED (
  SELECT id, board_id, status FROM organiser_items WHERE id = '88888888-8888-8888-8888-888888888888' AND organisation_id = 'org-a'
),
updated AS (
  UPDATE organiser_items i SET status = 'Done', updated_at = NOW()
  FROM old WHERE i.id = old.id
  RETURNING i.id, i.board_id, i.status
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.board_id, updated.id, 'user-2', 'Luke', 'item.updated', 'item', updated.id::text,
    jsonb_build_object('status', old.status), jsonb_build_object('status', updated.status)
  FROM old, updated WHERE old.status IS DISTINCT FROM updated.status RETURNING id
)
SELECT updated.status FROM updated;
"
  run_concurrent_pair "$MUT_A_SQL_A" "$MUT_A_SQL_B"
  MUT_CHAIN_OK="$(docker exec "$CONTAINER" psql -X -t -A -U postgres -d testdb -c "
WITH ordered AS (
  SELECT before_json->>'status' AS b, after_json->>'status' AS a, created_at, row_number() OVER (ORDER BY created_at ASC) AS rn
  FROM organiser_activity WHERE item_id='88888888-8888-8888-8888-888888888888'
),
joined AS (SELECT o1.rn, o1.b, o1.a, o2.a AS prev_a FROM ordered o1 LEFT JOIN ordered o2 ON o2.rn = o1.rn - 1)
SELECT bool_and((rn = 1 AND b = 'Not Started') OR (rn > 1 AND b = prev_a)) FROM joined;
" | tr -d '[:space:]')"
  if [ "$MUT_CHAIN_OK" != "t" ]; then
    echo "  PASS (mutation A correctly reintroduces the invalid-fork bug — harness is sensitive to removing FOR UPDATE): chain invalid as expected"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: mutation A (no FOR UPDATE) did NOT reproduce the invalid fork — harness may not be sensitive to this defect class"
    FAIL=$((FAIL + 1))
    FAILURES+=("mutation A did not reproduce the invalid fork")
  fi
fi

echo ""
echo "=== PHASE D.4.5F — BOARD/GROUP/COMMENT/FILE INSTRUMENTATION ==="
# Real Postgres execution of the exact writable-CTE statements each new
# route submits (literal-substituted, mirroring patch_item_sql/
# create_item_sql's own convention above). Proves: valid SQL (a static
# query-text test cannot catch a typo Postgres itself would reject),
# atomicity (mutation + activity_row commit together), same-value
# suppression, and deletion-safe history.
reset_db; bootstrap

echo ""
echo "--- board.created ---"
echo "
WITH inserted AS (
  INSERT INTO organiser_boards (id, organisation_id, name, color, position, created_by)
  VALUES ('99999999-9999-9999-9999-999999999991', 'org-a', 'WORK', NULL, 0, 'user-1')
  RETURNING id, name
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', inserted.id, 'user-1', 'James', 'board.created', 'board', inserted.id::text, NULL,
    jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)))
  FROM inserted RETURNING id
)
SELECT id FROM inserted;
" | psql_exec >/dev/null
expect_eq "board.created row exists with correct event_type/entity_type/actor" \
  "SELECT event_type || ':' || entity_type || ':' || actor_name FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991' AND event_type='board.created';" \
  "board.created:board:James"

echo ""
echo "--- board.updated (rename) ---"
echo "
WITH old AS MATERIALIZED (
  SELECT id, name, color, position FROM organiser_boards WHERE id='99999999-9999-9999-9999-999999999991' AND organisation_id='org-a' FOR UPDATE
),
updated AS (
  UPDATE organiser_boards b SET name = 'Operations', updated_at = NOW() FROM old WHERE b.id = old.id
  RETURNING b.id, b.name, b.color, b.position
),
field_diff AS (
  SELECT jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
         jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
         bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
  FROM old, updated,
  LATERAL (VALUES
    ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
    ('color', organiser_activity_sanitise_scalar(to_jsonb(old.color)), organiser_activity_sanitise_scalar(to_jsonb(updated.color)))
  ) AS f(key, old_val, new_val)
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.id, 'user-1', 'James', 'board.updated', 'board', updated.id::text, field_diff.before_obj, field_diff.after_obj
  FROM updated, field_diff WHERE field_diff.any_changed IS TRUE RETURNING id
)
SELECT id FROM updated;
" | psql_exec >/dev/null
expect_eq "board.updated recorded with correct before/after name" \
  "SELECT (before_json->>'name') || '->' || (after_json->>'name') FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991' AND event_type='board.updated';" \
  "WORK->Operations"

echo ""
echo "--- board.updated same-value (name unchanged) -> NO activity row ---"
BEFORE_COUNT="$(echo "SELECT count(*) FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991';" | psql_query | tr -d '[:space:]')"
echo "
WITH old AS MATERIALIZED (
  SELECT id, name, color, position FROM organiser_boards WHERE id='99999999-9999-9999-9999-999999999991' AND organisation_id='org-a' FOR UPDATE
),
updated AS (
  UPDATE organiser_boards b SET name = 'Operations', updated_at = NOW() FROM old WHERE b.id = old.id
  RETURNING b.id, b.name, b.color, b.position
),
field_diff AS (
  SELECT jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
         jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
         bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
  FROM old, updated,
  LATERAL (VALUES
    ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
    ('color', organiser_activity_sanitise_scalar(to_jsonb(old.color)), organiser_activity_sanitise_scalar(to_jsonb(updated.color)))
  ) AS f(key, old_val, new_val)
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.id, 'user-1', 'James', 'board.updated', 'board', updated.id::text, field_diff.before_obj, field_diff.after_obj
  FROM updated, field_diff WHERE field_diff.any_changed IS TRUE RETURNING id
)
SELECT id FROM updated;
" | psql_exec >/dev/null
expect_eq "same-value board rename adds no new activity row" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991';" \
  "$BEFORE_COUNT"

echo ""
echo "--- group.created, group.updated, group.deleted (+ item moved to No group by FK, not by fabricated event) ---"
echo "INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('99999999-9999-9999-9999-999999999992', '99999999-9999-9999-9999-999999999991', 'org-a', 'Item In Group', 'Not Started');" | psql_exec >/dev/null
echo "
WITH inserted AS (
  INSERT INTO organiser_groups (id, board_id, organisation_id, name, color, position)
  VALUES ('99999999-9999-9999-9999-999999999993', '99999999-9999-9999-9999-999999999991', 'org-a', 'Backlog', NULL, 0)
  RETURNING id, name
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', '99999999-9999-9999-9999-999999999991', 'user-1', 'James', 'group.created', 'group', inserted.id::text, NULL,
    jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name)))
  FROM inserted RETURNING id
)
SELECT id FROM inserted;
" | psql_exec >/dev/null
echo "UPDATE organiser_items SET group_id='99999999-9999-9999-9999-999999999993' WHERE id='99999999-9999-9999-9999-999999999992';" | psql_exec >/dev/null
expect_eq "group.created recorded" \
  "SELECT event_type FROM organiser_activity WHERE entity_id='99999999-9999-9999-9999-999999999993' AND event_type='group.created';" \
  "group.created"

echo "
WITH old AS MATERIALIZED (
  SELECT id, board_id, name, color, position FROM organiser_groups WHERE id='99999999-9999-9999-9999-999999999993' AND organisation_id='org-a' FOR UPDATE
),
updated AS (
  UPDATE organiser_groups g SET name = 'In Progress' FROM old WHERE g.id = old.id
  RETURNING g.id, g.board_id, g.name, g.color, g.position
),
field_diff AS (
  SELECT jsonb_object_agg(f.key, f.old_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS before_obj,
         jsonb_object_agg(f.key, f.new_val) FILTER (WHERE f.old_val IS DISTINCT FROM f.new_val) AS after_obj,
         bool_or(f.old_val IS DISTINCT FROM f.new_val) AS any_changed
  FROM old, updated,
  LATERAL (VALUES
    ('name', organiser_activity_sanitise_scalar(to_jsonb(old.name)), organiser_activity_sanitise_scalar(to_jsonb(updated.name))),
    ('color', organiser_activity_sanitise_scalar(to_jsonb(old.color)), organiser_activity_sanitise_scalar(to_jsonb(updated.color)))
  ) AS f(key, old_val, new_val)
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', updated.board_id, 'user-1', 'James', 'group.updated', 'group', updated.id::text, field_diff.before_obj, field_diff.after_obj
  FROM updated, field_diff WHERE field_diff.any_changed IS TRUE RETURNING id
)
SELECT id FROM updated;
" | psql_exec >/dev/null
expect_eq "group.updated recorded with correct before/after name" \
  "SELECT (before_json->>'name') || '->' || (after_json->>'name') FROM organiser_activity WHERE entity_id='99999999-9999-9999-9999-999999999993' AND event_type='group.updated';" \
  "Backlog->InProgress"

echo "
WITH deleted AS (
  DELETE FROM organiser_groups WHERE id='99999999-9999-9999-9999-999999999993' AND organisation_id='org-a'
  RETURNING id, board_id, name
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', deleted.board_id, 'user-1', 'James', 'group.deleted', 'group', deleted.id::text,
    jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name))), NULL
  FROM deleted RETURNING id
)
SELECT id FROM deleted;
" | psql_exec >/dev/null
expect_eq "group.deleted recorded with the group's final name snapshot (renamed to In Progress above), even though the group row itself is now gone" \
  "SELECT before_json->>'name' FROM organiser_activity WHERE entity_id='99999999-9999-9999-9999-999999999993' AND event_type='group.deleted';" \
  "InProgress"
expect_eq "the item that was in the deleted group now has group_id NULL — via the FK ON DELETE SET NULL constraint alone" \
  "SELECT group_id IS NULL FROM organiser_items WHERE id='99999999-9999-9999-9999-999999999992';" \
  "t"
expect_eq "no fabricated item.moved event was written for the affected item — only the one group.deleted row exists for this entity" \
  "SELECT count(*) FROM organiser_activity WHERE entity_id='99999999-9999-9999-9999-999999999993';" \
  "3"
expect_eq "and definitively: zero item.moved rows exist anywhere for this item as a side effect of the group delete" \
  "SELECT count(*) FROM organiser_activity WHERE entity_id='99999999-9999-9999-9999-999999999992' AND event_type='item.moved';" \
  "0"

echo ""
echo "--- comment.created (bounded excerpt, item_id set) ---"
echo "
WITH inserted AS (
  INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
  VALUES ('99999999-9999-9999-9999-999999999992', '99999999-9999-9999-9999-999999999991', 'org-a', 'James', 'Waiting on supplier confirmation')
  RETURNING id, body
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', '99999999-9999-9999-9999-999999999991', '99999999-9999-9999-9999-999999999992', 'user-1', 'James',
    'comment.created', 'comment', inserted.id::text, NULL,
    jsonb_build_object('excerpt', organiser_activity_sanitise_scalar(to_jsonb(inserted.body)))
  FROM inserted RETURNING id
)
SELECT id FROM inserted;
" | psql_exec >/dev/null
expect_eq "comment.created recorded with item_id set and the excerpt matching the posted body" \
  "SELECT (item_id = '99999999-9999-9999-9999-999999999992') AND (after_json->>'excerpt' = 'Waiting on supplier confirmation') FROM organiser_activity WHERE entity_type='comment' AND event_type='comment.created';" \
  "t"

echo ""
echo "--- file.added, file.deleted (deletion-safe: activity survives the file metadata row's own removal) ---"
echo "
WITH inserted AS (
  INSERT INTO organiser_item_files (item_id, board_id, organisation_id, file_name, file_url, file_size, uploaded_by)
  VALUES ('99999999-9999-9999-9999-999999999992', '99999999-9999-9999-9999-999999999991', 'org-a', 'invoice.pdf', '/organiser-attachments/x/invoice.pdf', 1024, 'user-1')
  RETURNING id, file_name, file_size
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', '99999999-9999-9999-9999-999999999991', '99999999-9999-9999-9999-999999999992', 'user-1', 'James',
    'file.added', 'file', inserted.id::text, NULL,
    jsonb_build_object('file_name', organiser_activity_sanitise_scalar(to_jsonb(inserted.file_name)), 'file_size', to_jsonb(inserted.file_size))
  FROM inserted RETURNING id
)
SELECT id FROM inserted;
" | psql_exec >/dev/null
FILE_ID="$(echo "SELECT id FROM organiser_item_files WHERE file_name='invoice.pdf';" | psql_query | tr -d '[:space:]')"
expect_eq "file.added recorded with file_name and file_size, no file_url" \
  "SELECT (after_json->>'file_name' = 'invoice.pdf') AND ((after_json->>'file_size')::int = 1024) AND (after_json ? 'file_url') = false FROM organiser_activity WHERE entity_id='$FILE_ID' AND event_type='file.added';" \
  "t"

echo "
WITH deleted AS (
  DELETE FROM organiser_item_files WHERE id='$FILE_ID' AND item_id='99999999-9999-9999-9999-999999999992' AND organisation_id='org-a'
  RETURNING id, board_id, file_name, file_url
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', deleted.board_id, '99999999-9999-9999-9999-999999999992', 'user-1', 'James',
    'file.deleted', 'file', deleted.id::text,
    jsonb_build_object('file_name', organiser_activity_sanitise_scalar(to_jsonb(deleted.file_name))), NULL
  FROM deleted RETURNING id
)
SELECT file_url FROM deleted;
" | psql_exec >/dev/null
expect_eq "organiser_item_files row is actually gone" \
  "SELECT count(*) FROM organiser_item_files WHERE id='$FILE_ID';" \
  "0"
expect_eq "file.deleted history remains readable, with the filename preserved, even though the file metadata row itself is gone" \
  "SELECT before_json->>'file_name' FROM organiser_activity WHERE entity_id='$FILE_ID' AND event_type='file.deleted';" \
  "invoice.pdf"

echo ""
echo "--- board.deleted: history for every entity on this board (item/group/comment/file activity) survives the board's own CASCADE delete ---"
PRE_DELETE_COUNT="$(echo "SELECT count(*) FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991';" | psql_query | tr -d '[:space:]')"
echo "
WITH deleted AS (
  DELETE FROM organiser_boards WHERE id='99999999-9999-9999-9999-999999999991' AND organisation_id='org-a'
  RETURNING id, name
),
activity_row AS (
  INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, before_json, after_json)
  SELECT 'org-a', deleted.id, 'user-1', 'James', 'board.deleted', 'board', deleted.id::text,
    jsonb_build_object('name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name))), NULL
  FROM deleted RETURNING id
)
SELECT id FROM deleted;
" | psql_exec >/dev/null
expect_eq "organiser_boards row is gone (and its organiser_items/organiser_item_files/organiser_item_updates cascaded with it)" \
  "SELECT count(*) FROM organiser_boards WHERE id='99999999-9999-9999-9999-999999999991';" \
  "0"
expect_eq "organiser_items row cascaded away too (board_id ON DELETE CASCADE)" \
  "SELECT count(*) FROM organiser_items WHERE id='99999999-9999-9999-9999-999999999992';" \
  "0"
expect_eq "every activity row for this board — board.created/updated, group.created/updated/deleted, comment.created, file.added/deleted, and now board.deleted itself — remains queryable after the board and everything under it is gone" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991';" \
  "$((PRE_DELETE_COUNT + 1))"
expect_eq "board.deleted itself carries the correct before_json name snapshot" \
  "SELECT before_json->>'name' FROM organiser_activity WHERE board_id='99999999-9999-9999-9999-999999999991' AND event_type='board.deleted';" \
  "Operations"

echo ""
echo "=== PHASE D.4.6B — HELENA READ FOUNDATION (lib/organiser/helenaRead.ts) ==="
echo "Proves the SQL shapes listOrganiserBoards/listOrganiserItems/the NULL-safe"
echo "start-end activity extension actually execute correctly against real"
echo "Postgres — the JS-level containment tests already prove parameterization/"
echo "clamping/determinism with a mocked sql client; this section proves the"
echo "underlying queries themselves are correct."

echo "INSERT INTO organiser_boards (id, organisation_id, name, color, position) VALUES
  ('77777777-7777-7777-7777-777777777771', 'org-a', 'Founder Tasks', '#4F46E5', 0),
  ('77777777-7777-7777-7777-777777777772', 'org-a', 'Marketing', NULL, 1);" | psql_exec >/dev/null

echo "--- board list: tenant filtering, ordering, NULL color ---"
expect_eq "org-a board list (position-ordered) returns both new boards in position order" \
  "SELECT string_agg(name, ',' ORDER BY position ASC) FROM organiser_boards WHERE organisation_id='org-a' AND id IN ('77777777-7777-7777-7777-777777777771','77777777-7777-7777-7777-777777777772');" \
  "FounderTasks,Marketing"
expect_eq "org-b's own tenant-scoped board query never returns an org-a board" \
  "SELECT count(*) FROM organiser_boards WHERE organisation_id='org-b' AND id='77777777-7777-7777-7777-777777777771';" \
  "0"
expect_eq "a NULL board color is preserved, not coerced to a default" \
  "SELECT color IS NULL FROM organiser_boards WHERE id='77777777-7777-7777-7777-777777777772';" \
  "t"
expect_eq "board search (ILIKE) matches case-insensitively" \
  "SELECT count(*) FROM organiser_boards WHERE organisation_id='org-a' AND id='77777777-7777-7777-7777-777777777771' AND name ILIKE '%founder%';" \
  "1"
expect_eq "board LIMIT enforcement: LIMIT 1 returns exactly one row even though 2+ boards exist" \
  "SELECT count(*) FROM (SELECT id FROM organiser_boards WHERE organisation_id='org-a' ORDER BY position ASC, created_at ASC LIMIT 1) x;" \
  "1"

echo "--- item list: board+tenant filtering, group_name resolution ---"
echo "INSERT INTO organiser_groups (id, board_id, organisation_id, name) VALUES ('77777777-7777-7777-7777-777777777773', '77777777-7777-7777-7777-777777777771', 'org-a', 'Backlog');" | psql_exec >/dev/null
echo "INSERT INTO organiser_items (id, board_id, organisation_id, group_id, name, status) VALUES
  ('77777777-7777-7777-7777-777777777774', '77777777-7777-7777-7777-777777777771', 'org-a', '77777777-7777-7777-7777-777777777773', 'Ship the deck', 'In Progress'),
  ('77777777-7777-7777-7777-777777777775', '77777777-7777-7777-7777-777777777771', 'org-a', NULL, 'No group item', 'Not Started');" | psql_exec >/dev/null

expect_eq "item list scoped to board+org returns exactly the 2 seeded items" \
  "SELECT count(*) FROM organiser_items i WHERE i.organisation_id='org-a' AND i.board_id='77777777-7777-7777-7777-777777777771' AND i.id IN ('77777777-7777-7777-7777-777777777774','77777777-7777-7777-7777-777777777775');" \
  "2"
expect_eq "group_name resolves via LEFT JOIN for a grouped item" \
  "SELECT g.name FROM organiser_items i LEFT JOIN organiser_groups g ON g.id=i.group_id WHERE i.id='77777777-7777-7777-7777-777777777774';" \
  "Backlog"
expect_eq "group_name is NULL (not fabricated) for an ungrouped item" \
  "SELECT g.name FROM organiser_items i LEFT JOIN organiser_groups g ON g.id=i.group_id WHERE i.id='77777777-7777-7777-7777-777777777775';" \
  ""
expect_eq "wrong-tenant board id against org-b's own item query produces zero rows — no existence side channel" \
  "SELECT count(*) FROM organiser_items i WHERE i.organisation_id='org-b' AND i.board_id='77777777-7777-7777-7777-777777777771';" \
  "0"
expect_eq "item search (ILIKE) matches case-insensitively" \
  "SELECT count(*) FROM organiser_items WHERE board_id='77777777-7777-7777-7777-777777777771' AND name ILIKE '%ship%';" \
  "1"

echo "--- NULL-safe start/end activity window extension ---"
echo "INSERT INTO organiser_activity (organisation_id, board_id, actor_user_id, actor_name, event_type, entity_type, entity_id, after_json, created_at) VALUES
  ('org-a', '77777777-7777-7777-7777-777777777771', 'user-1', 'James', 'board.created', 'board', '77777777-7777-7777-7777-777777777771', '{}', NOW() - INTERVAL '10 days'),
  ('org-a', '77777777-7777-7777-7777-777777777771', 'user-1', 'James', 'group.created', 'group', '77777777-7777-7777-7777-777777777773', '{}', NOW() - INTERVAL '2 hours');" | psql_exec >/dev/null

expect_eq "start filter alone: only the 2h-old row falls within the last 1 day, the 10-day-old row is excluded" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='77777777-7777-7777-7777-777777777771' AND (NULL::timestamptz IS NULL OR created_at >= NULL::timestamptz) AND created_at >= NOW() - INTERVAL '1 day';" \
  "1"
expect_eq "both start and end NULL (existing-caller shape): both rows returned, byte-for-byte the pre-D.4.6B behaviour" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='77777777-7777-7777-7777-777777777771' AND (NULL::timestamptz IS NULL OR created_at >= NULL::timestamptz) AND (NULL::timestamptz IS NULL OR created_at < NULL::timestamptz);" \
  "2"
expect_eq "end-exclusive boundary: a row exactly AT the end timestamp is excluded, not included" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='77777777-7777-7777-7777-777777777771' AND created_at < (SELECT created_at FROM organiser_activity WHERE board_id='77777777-7777-7777-7777-777777777771' AND event_type='group.created');" \
  "1"

echo "--- deletion-safe: activity and item list behave correctly after the board itself is deleted ---"
echo "DELETE FROM organiser_boards WHERE id='77777777-7777-7777-7777-777777777771';" | psql_exec >/dev/null
expect_eq "board activity (both rows) remains fully queryable after the board is deleted — no FK, no join, no error" \
  "SELECT count(*) FROM organiser_activity WHERE board_id='77777777-7777-7777-7777-777777777771';" \
  "2"
expect_eq "item list for the now-deleted board returns empty (items cascaded away with the board), not an error" \
  "SELECT count(*) FROM organiser_items WHERE board_id='77777777-7777-7777-7777-777777777771';" \
  "0"

echo ""
echo "=== SUMMARY ==="
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
