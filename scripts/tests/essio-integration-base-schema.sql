-- Essio integration test base schema (B1/B2 harnesses). The real organiser/platform
-- tables the Essio migrations and services touch, as created by
-- app/api/admin/migrate/route.ts, scripts/create-modules.sql,
-- scripts/create-organisation-modules.sql and the Prisma AuditLog model —
-- WITHOUT A0.1A (the repository never created it before Essio B1).
-- Disposable test databases only.

CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE organiser_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL, color TEXT, icon TEXT, position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE organiser_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id), name TEXT NOT NULL, color TEXT,
  position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE organiser_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  group_id UUID REFERENCES organiser_groups(id) ON DELETE SET NULL,
  parent_item_id UUID REFERENCES organiser_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not Started', priority TEXT, owner TEXT,
  due_date DATE, notes TEXT, fields JSONB NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}';
ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_organiser_items_org ON organiser_items(organisation_id);
CREATE TABLE organiser_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  board_id UUID NOT NULL, item_id UUID,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'board.created','board.updated','board.deleted','group.created','group.updated','group.deleted',
    'column.created','column.updated','column.deleted','item.created','item.updated','item.moved','item.deleted',
    'comment.created','comment.deleted','file.added','file.deleted','import.completed')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('board','group','item','column','file','comment','import')),
  entity_id TEXT NOT NULL, before_json JSONB, after_json JSONB,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- organiser_activity_sanitise_scalar — verbatim from app/api/admin/migrate/route.ts step 41.
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

CREATE TABLE modules (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE organisation_modules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organisation_id TEXT NOT NULL, module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false, config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organisation_modules_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_module_key_fkey FOREIGN KEY (module_key) REFERENCES modules(key) ON DELETE RESTRICT,
  CONSTRAINT organisation_modules_organisation_id_module_key_key UNIQUE (organisation_id, module_key)
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  before_state JSONB, after_state JSONB, ip_address TEXT, user_agent TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO organisations VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-a', 'org-a', 'ua', 'User A'), ('user-b', 'org-b', 'ub', 'User B');
INSERT INTO organiser_boards (id, organisation_id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a', 'Board A'),
  ('22222222-2222-4222-8222-222222222222', 'org-b', 'Board B');
INSERT INTO organiser_items (board_id, organisation_id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'org-a', 'Seed item A'),
  ('22222222-2222-4222-8222-222222222222', 'org-b', 'Seed item B');
