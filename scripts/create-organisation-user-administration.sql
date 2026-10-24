-- Organisation-owned access and invitations. Apply manually before releasing code.
-- Existing users without an access row retain their existing domain permissions.
BEGIN;
CREATE TABLE IF NOT EXISTS organisation_user_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS organisation_user_access_org ON organisation_user_access(organisation_id);
CREATE TABLE IF NOT EXISTS organisation_user_invitations (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
