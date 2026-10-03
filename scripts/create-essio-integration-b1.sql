-- BrainBase Essio integration B1 — machine credentials + Organiser external links
-- ==================================================================================
--
-- Creates:
--   1. integration_credentials          per-organisation machine credentials
--                                       (hashed secret, scopes, enabled/revoked)
--   2. organiser_item_external_links    durable external-source identity of an
--                                       Organiser item (idempotency key, source
--                                       snapshot) that survives item deletion
--
-- Design: docs/integrations/essio.md. No route, no Organiser write path and no
-- capability grant is added by this file. The capability registry row lives in
-- scripts/seed-essio-integration-capability.sql (separate, like every other
-- seed-*-capability.sql).
--
-- Additive only: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER (for the new tables only), read-only
-- preflight/post-condition DO blocks. No ALTER of an existing table, no
-- INSERT/UPDATE/DELETE of existing data. Safe to rerun.
--
-- Run order:
--   1. scripts/create-organiser-items-org-id-key-a01a.sql (A0.1A)
--   2. this file
--   3. scripts/seed-essio-integration-capability.sql
--
-- Requires PostgreSQL >= 15 (FK action with a column list:
-- ON DELETE SET NULL (organiser_item_id)). Production is 17.
-- Not applied to any environment by this branch.

BEGIN;

-- =====================================================================
-- 0. PRE-FLIGHT — READ ONLY
-- =====================================================================

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: PostgreSQL 15+ is required (found %)',
      current_setting('server_version');
  END IF;

  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: public.organisations is missing';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: public.users is missing';
  END IF;
  IF to_regclass('public.organiser_items') IS NULL THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: public.organiser_items is missing';
  END IF;
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: gen_random_uuid() is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organisations'
      AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: organisations.id must be NOT NULL TEXT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: users.id must be NOT NULL TEXT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organiser_items'
      AND column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organiser_items'
      AND column_name = 'organisation_id' AND data_type = 'text' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Essio B1 preflight failed: organiser_items.id must be NOT NULL UUID and organisation_id NOT NULL TEXT';
  END IF;

  -- A0.1A: any equivalent uniqueness on organiser_items(organisation_id, id).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index ix
    WHERE ix.indrelid = 'public.organiser_items'::regclass
      AND ix.indisunique AND ix.indisvalid AND ix.indimmediate
      AND ix.indpred IS NULL AND ix.indexprs IS NULL AND ix.indnkeyatts = 2
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
        WHERE k.ord <= ix.indnkeyatts
      ) = ARRAY['id', 'organisation_id']
  ) THEN
    RAISE EXCEPTION
      'Essio B1 preflight failed: organiser_items has no UNIQUE (organisation_id, id); apply scripts/create-organiser-items-org-id-key-a01a.sql first';
  END IF;
END $$;

-- =====================================================================
-- 1. integration_credentials
-- =====================================================================
--
-- One row per machine credential. The plaintext secret is never stored: only
-- secret_hash = sha256_hex('bbint:v1:' || id || ':' || secret) (see
-- lib/integrationCredentials/token.ts). Binding the id into the digest means a
-- hash copied onto another row never verifies.
--
-- enabled = false is a reversible pause; revoked_at is terminal (a revoked
-- credential can never be re-enabled or un-revoked). Credentials are never
-- deleted, so external links keep a resolvable credential_id.

CREATE OR REPLACE FUNCTION integration_scopes_are_distinct(scopes TEXT[])
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $f$
  SELECT cardinality(scopes) = (SELECT count(DISTINCT s) FROM unnest(scopes) AS s)
$f$;

CREATE TABLE IF NOT EXISTS integration_credentials (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL,
  integration_key  TEXT        NOT NULL,
  label            TEXT        NOT NULL,
  secret_hash      TEXT        NOT NULL,
  hash_version     SMALLINT    NOT NULL DEFAULT 1,
  scopes           TEXT[]      NOT NULL,
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  last_used_at     TIMESTAMPTZ,

  CONSTRAINT integration_credentials_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT integration_credentials_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT integration_credentials_revoked_by_fkey
    FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
  -- Target of same-organisation composite FKs (organiser_item_external_links).
  CONSTRAINT integration_credentials_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT integration_credentials_integration_key_check
    CHECK (integration_key IN ('essio')),
  CONSTRAINT integration_credentials_label_check
    CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 120),
  CONSTRAINT integration_credentials_secret_hash_check
    CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_credentials_hash_version_check
    CHECK (hash_version = 1),
  -- Grantable scopes only. 'work:append' is reserved for B4/M3E and is
  -- deliberately NOT grantable yet; widening this CHECK is the gate.
  CONSTRAINT integration_credentials_scopes_check
    CHECK (
      cardinality(scopes) >= 1
      AND array_position(scopes, NULL) IS NULL
      AND scopes <@ ARRAY['work:create', 'work:read', 'targets:read']::TEXT[]
      AND integration_scopes_are_distinct(scopes)
    ),
  CONSTRAINT integration_credentials_revoked_disabled_check
    CHECK (revoked_at IS NULL OR enabled = false),
  CONSTRAINT integration_credentials_revoked_by_check
    CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_org
  ON integration_credentials (organisation_id, integration_key);

-- Identity, tenant and secret are immutable; revocation is terminal;
-- credentials are never deleted.
CREATE OR REPLACE FUNCTION integration_credentials_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'integration_credentials rows are never deleted; revoke the credential instead'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.integration_key IS DISTINCT FROM OLD.integration_key
     OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash
     OR NEW.hash_version IS DISTINCT FROM OLD.hash_version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'integration_credentials identity, organisation and secret are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.revoked_at IS NOT NULL AND (
       NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.enabled
       OR NEW.scopes IS DISTINCT FROM OLD.scopes
     ) THEN
    RAISE EXCEPTION 'a revoked integration credential cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_integration_credentials_guard ON integration_credentials;
CREATE TRIGGER trg_integration_credentials_guard
BEFORE UPDATE OR DELETE ON integration_credentials
FOR EACH ROW
EXECUTE FUNCTION integration_credentials_guard();

-- =====================================================================
-- 2. organiser_item_external_links
-- =====================================================================
--
-- Typed link: one external request (source_system + idempotency_key) that
-- created (or will create) one Organiser item. Not a polymorphic relation.
--
-- * (organisation_id, source_system, idempotency_key) is unique: a retried
--   request resolves to this row instead of creating new work.
-- * (organisation_id, organiser_item_id) -> organiser_items(organisation_id, id)
--   while the item exists (same organisation, enforced by the database).
--   Brainbase hard-deletes Organiser items; ON DELETE SET NULL
--   (organiser_item_id) keeps the link (and its organisation_id) and the
--   guard trigger stamps item_deleted_at, so a retry after deletion is
--   recognised as the same request and does not create a replacement.
-- * (organisation_id, credential_id) -> integration_credentials: the
--   credential that made the request belongs to the same organisation.
-- * Rows are never deleted; identity columns are immutable.

CREATE TABLE IF NOT EXISTS organiser_item_external_links (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             TEXT        NOT NULL,
  organiser_item_id           UUID,
  source_system               TEXT        NOT NULL,
  idempotency_key             TEXT        NOT NULL,
  external_recommendation_id  TEXT        NOT NULL,
  source_url                  TEXT,
  payload_fingerprint         TEXT        NOT NULL,
  snapshot_json               JSONB       NOT NULL,
  credential_id               UUID        NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_deleted_at             TIMESTAMPTZ,

  CONSTRAINT organiser_item_external_links_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT,
  CONSTRAINT organiser_item_external_links_item_fkey
    FOREIGN KEY (organisation_id, organiser_item_id)
    REFERENCES organiser_items (organisation_id, id)
    ON DELETE SET NULL (organiser_item_id),
  CONSTRAINT organiser_item_external_links_credential_fkey
    FOREIGN KEY (organisation_id, credential_id)
    REFERENCES integration_credentials (organisation_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT organiser_item_external_links_idempotency_key
    UNIQUE (organisation_id, source_system, idempotency_key),
  CONSTRAINT organiser_item_external_links_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT organiser_item_external_links_source_system_check
    CHECK (source_system IN ('essio')),
  CONSTRAINT organiser_item_external_links_idempotency_key_check
    CHECK (idempotency_key = btrim(idempotency_key) AND char_length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT organiser_item_external_links_external_recommendation_id_check
    CHECK (external_recommendation_id = btrim(external_recommendation_id)
           AND char_length(external_recommendation_id) BETWEEN 1 AND 128),
  CONSTRAINT organiser_item_external_links_source_url_check
    CHECK (source_url IS NULL OR (char_length(source_url) <= 2048 AND source_url ~* '^https?://[^[:space:]]+$')),
  CONSTRAINT organiser_item_external_links_payload_fingerprint_check
    CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT organiser_item_external_links_snapshot_check
    CHECK (jsonb_typeof(snapshot_json) = 'object' AND octet_length(snapshot_json::text) <= 262144),
  CONSTRAINT organiser_item_external_links_deleted_check
    CHECK (item_deleted_at IS NULL OR organiser_item_id IS NULL)
);

-- An Organiser item is created by at most one external request.
CREATE UNIQUE INDEX IF NOT EXISTS organiser_item_external_links_item_key
  ON organiser_item_external_links (organisation_id, organiser_item_id)
  WHERE organiser_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organiser_item_external_links_recommendation
  ON organiser_item_external_links (organisation_id, source_system, external_recommendation_id);

-- Identity is immutable and rows are never deleted. organiser_item_id may only:
--   * be attached once (NULL -> item) while the link has never lost an item,
--   * become NULL when the item is deleted (FK SET NULL), which stamps
--     item_deleted_at.
-- It can never be re-pointed at a different item.
CREATE OR REPLACE FUNCTION organiser_item_external_links_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'organiser_item_external_links rows are never deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.source_system IS DISTINCT FROM OLD.source_system
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.external_recommendation_id IS DISTINCT FROM OLD.external_recommendation_id
     OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.payload_fingerprint IS DISTINCT FROM OLD.payload_fingerprint
     OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
     OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'organiser_item_external_links identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organiser_item_id IS NOT NULL AND NEW.organiser_item_id IS NULL THEN
    -- The Organiser item was deleted (FK ON DELETE SET NULL).
    NEW.item_deleted_at := COALESCE(OLD.item_deleted_at, now());
    RETURN NEW;
  END IF;

  IF OLD.organiser_item_id IS NOT NULL
     AND NEW.organiser_item_id IS DISTINCT FROM OLD.organiser_item_id THEN
    RAISE EXCEPTION 'an external link cannot be re-pointed at a different Organiser item'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organiser_item_id IS NULL AND NEW.organiser_item_id IS NOT NULL
     AND OLD.item_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'the Organiser item of this external link was deleted; it cannot be replaced'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.item_deleted_at IS DISTINCT FROM OLD.item_deleted_at THEN
    RAISE EXCEPTION 'item_deleted_at is set only by Organiser item deletion'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organiser_item_external_links_guard ON organiser_item_external_links;
CREATE TRIGGER trg_organiser_item_external_links_guard
BEFORE UPDATE OR DELETE ON organiser_item_external_links
FOR EACH ROW
EXECUTE FUNCTION organiser_item_external_links_guard();

-- =====================================================================
-- 3. POST-CONDITIONS — READ ONLY
-- =====================================================================

DO $$
DECLARE
  expected RECORD;
  actual   TEXT;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('integration_credentials', 'integration_credentials_organisation_id_id_key',
       'UNIQUE (organisation_id, id)'),
      ('organiser_item_external_links', 'organiser_item_external_links_idempotency_key',
       'UNIQUE (organisation_id, source_system, idempotency_key)'),
      ('organiser_item_external_links', 'organiser_item_external_links_item_fkey',
       'FOREIGN KEY (organisation_id, organiser_item_id) REFERENCES organiser_items(organisation_id, id) ON DELETE SET NULL (organiser_item_id)'),
      ('organiser_item_external_links', 'organiser_item_external_links_credential_fkey',
       'FOREIGN KEY (organisation_id, credential_id) REFERENCES integration_credentials(organisation_id, id) ON DELETE RESTRICT')
    ) AS t(table_name, constraint_name, definition)
  LOOP
    SELECT pg_get_constraintdef(c.oid)
      INTO actual
    FROM pg_constraint c
    WHERE c.conrelid = ('public.' || expected.table_name)::regclass
      AND c.conname = expected.constraint_name;

    IF actual IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'Essio B1 post-condition failed: %.% is "%" but "%" was expected',
        expected.table_name, expected.constraint_name, COALESCE(actual, '<missing>'), expected.definition;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_integration_credentials_guard'
                   AND tgrelid = 'public.integration_credentials'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_organiser_item_external_links_guard'
                   AND tgrelid = 'public.organiser_item_external_links'::regclass) THEN
    RAISE EXCEPTION 'Essio B1 post-condition failed: guard trigger missing';
  END IF;
END $$;

COMMIT;
