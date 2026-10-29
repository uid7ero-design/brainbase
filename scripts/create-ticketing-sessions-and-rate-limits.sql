-- Ticketing (Eve) — Phase 3.5: SERVER-SIDE SESSION REVOCATION and a SHARED
-- (distributed) RATE LIMITER.
-- Run once, manually, against the target database. NOT run automatically and
-- NOT applied to Production by the phase that adds it: the Production
-- migration is a separate, explicitly approved gate, and (as with every
-- additive migration here) is applied BEFORE the application code that uses
-- it is deployed. Requires only that users(id) and organisations(id) exist.
--
-- ── ticketing_sessions ──────────────────────────────────────────────────
-- One row per issued Eve session. The Eve token carries the row id as its
-- `jti`; a token is accepted only while its row exists for the same user and
-- organisation, is not revoked and has not expired. The row does NOT replace
-- the per-request database checks (active user, organisation, role, Events
-- capability) — it only makes a session individually revocable:
--   LOGOUT           the user signed out
--   ORG_SWITCH       replaced by a session for another organisation
--   PASSWORD_CHANGE  every open session of the user, on any password change
--   ADMIN            reserved for an operator action
-- Rows are written BEFORE the token is signed; a token without a row is never
-- returned. No backfill: tokens issued before this migration have no `jti`
-- and fail closed.
--
-- ── ticketing_rate_limits ───────────────────────────────────────────────
-- Fixed-window counters shared by every serverless instance. key_hash is the
-- SHA-256 of the limiter class + canonical dimensions, so no email, IP, token
-- or id is ever stored in the clear. One atomic INSERT ... ON CONFLICT DO
-- UPDATE ... RETURNING count increments and reads in a single statement.
-- Abuse protection only: it is never an authorisation, payment-idempotency or
-- capacity mechanism.
--
-- Idempotent: CREATE ... IF NOT EXISTS throughout; re-running changes nothing.
-- Retention: expired rows are deleted in small bounded batches by the
-- application (no cron).
--
-- ── Rollback (manual; safe once the application no longer uses them) ────
--   DROP TABLE IF EXISTS ticketing_rate_limits;
--   DROP TABLE IF EXISTS ticketing_sessions;
-- Roll the application back first: code that needs the sessions table fails
-- CLOSED (denies) without it, and code that predates it never reads it.

CREATE TABLE IF NOT EXISTS ticketing_sessions (
  id              TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT        NULL,
  CONSTRAINT ticketing_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT ticketing_sessions_revoked_reason_check
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('LOGOUT', 'ORG_SWITCH', 'PASSWORD_CHANGE', 'ADMIN')),
  CONSTRAINT ticketing_sessions_revocation_pair_check
    CHECK ((revoked_at IS NULL AND revoked_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ticketing_sessions_user_open
  ON ticketing_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ticketing_sessions_expires_at
  ON ticketing_sessions (expires_at);

CREATE TABLE IF NOT EXISTS ticketing_rate_limits (
  key_hash     TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key_hash, window_start),
  CONSTRAINT ticketing_rate_limits_count_check CHECK (count > 0),
  CONSTRAINT ticketing_rate_limits_expiry_check CHECK (expires_at > window_start),
  CONSTRAINT ticketing_rate_limits_key_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_ticketing_rate_limits_expires_at
  ON ticketing_rate_limits (expires_at);
