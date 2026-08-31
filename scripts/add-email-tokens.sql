-- Password-reset and email-verification tokens. Run once, manually,
-- against the target database. NOT run automatically by this task —
-- follows the same manual-authorization discipline as every other
-- schema-creation script in this repository.
--
-- Purpose: backs lib/tokens.ts's createToken()/consumeToken(), the
-- single mechanism every email-token-dependent flow already calls
-- through — POST /api/admin/users' optional verification email,
-- POST /api/auth/forgot-password, POST /api/auth/reset-password,
-- GET /api/auth/verify-email, and POST /api/auth/resend-verification.
-- None of those call sites change here; this script only creates the
-- table they already assume exists.
--
-- Root cause this corrects: app/api/admin/migrate/route.ts's own
-- email_tokens definition (step 15) declares
-- `user_id UUID NOT NULL REFERENCES users(id)` — but users.id is TEXT
-- in the real, Production-confirmed schema (verified via the Neon SQL
-- editor; also already established for organisations.id by
-- scripts/create-organisation-modules.sql's own header comment, which
-- documents this exact class of legacy UUID/TEXT mismatch in that same
-- file). A UUID column cannot FK-reference a TEXT column at all, so
-- that statement would fail outright if ever executed against the real
-- users table — this script is the corrected, standalone replacement,
-- following this repository's established convention of a dedicated
-- scripts/*.sql file per object rather than extending the stale,
-- unused migrate route (see that route's own steps 33+ for the same
-- organisation_id-is-TEXT convention already followed for later
-- tables, and PRODUCTION READINESS reports for the full account of why
-- the migrate route is not the source of truth here).
--
-- Prerequisites: the users table must already exist with a TEXT
-- primary key `id` (already true — this is existing, Production-
-- confirmed schema, not something this script creates or assumes
-- without verification).
--
-- Id / type conventions: TEXT id via gen_random_uuid()::text, matching
-- every other standalone table-creation script in this repository
-- (events, event_sessions, organisation_modules, microsoft_connections,
-- ...) — never a native UUID column, and user_id is never cast to
-- ::uuid anywhere this table is read or written (see lib/tokens.ts).
--
-- token: TEXT, matching lib/tokens.ts's own generation exactly —
-- randomBytes(32).toString('hex'), a 64-character hex string (256 bits
-- of entropy) — server-generated only, never client-supplied. UNIQUE
-- is the structural collision guard; 256-bit entropy makes an actual
-- collision practically impossible, but the constraint means one would
-- fail loud (an INSERT error) rather than silently issuing an
-- ambiguous token.
--
-- type: TEXT + CHECK ('verify' | 'reset'), matching lib/tokens.ts's own
-- TokenType union exactly — not a native Postgres enum, following this
-- schema's established convention for small closed vocabularies
-- (events.status, event_orders.payment_status, and others all use the
-- same TEXT + CHECK shape rather than a native enum type).
--
-- expires_at: NOT NULL — every token is created with an explicit TTL
-- (lib/tokens.ts's createToken() always supplies one; callers default
-- to 24h for verification, 1h for password reset). used_at: nullable,
-- set exactly once by consumeToken()'s own atomic conditional UPDATE
-- (WHERE used_at IS NULL AND expires_at > NOW()) — never touched
-- anywhere else, so a token can be consumed at most once even under
-- concurrent requests.
--
-- ON DELETE CASCADE on user_id: a token for a since-deleted user has no
-- remaining purpose — matches the existing convention for genuinely
-- ownership-scoped child rows in this schema (e.g.
-- contact_journal.contact_id, pipeline_messages.pipeline_id), as
-- distinct from the ON DELETE SET NULL convention used for pure
-- attribution columns like events.created_by.
--
-- Idempotency: every statement uses IF NOT EXISTS. Safe to re-run; a
-- second execution changes nothing. No row is inserted by this script.
--
-- Additive only: creates one new table and two new indexes, referencing
-- the already-existing users table. Does not touch users, organisations,
-- events, organisation_modules, or any other existing table or row.

CREATE TABLE IF NOT EXISTS email_tokens (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  type       TEXT        NOT NULL CHECK (type IN ('verify', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user   ON email_tokens(user_id);

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
-- Confirms the table, column types, constraints, and indexes landed
-- exactly as declared. Not executed by this script — paste into the
-- same SQL editor session after the statements above.
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'email_tokens'
--   ORDER BY ordinal_position;
--   -- Expect: id/user_id/token TEXT; expires_at/used_at/created_at
--   -- timestamp with time zone; user_id/token/type/expires_at/created_at
--   -- all is_nullable = 'NO'; id/created_at carry a column_default.
--
--   SELECT conname, contype, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'email_tokens'::regclass
--   ORDER BY contype;
--   -- Expect: a 'p' (primary key) on id, an 'f' (foreign key) on
--   -- user_id referencing users(id) with ON DELETE CASCADE, a 'u'
--   -- (unique) on token, and a 'c' (check) restricting type to
--   -- ('verify','reset').
--
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'email_tokens'
--   ORDER BY indexname;
--   -- Expect: the primary key index, a unique index backing the
--   -- token UNIQUE constraint, idx_email_tokens_token, and
--   -- idx_email_tokens_user.
--
-- ─── Rollback (not run automatically — keep for reference if this
-- needs to be reverted) ─────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_email_tokens_user;
--   DROP INDEX IF EXISTS idx_email_tokens_token;
--   DROP TABLE IF EXISTS email_tokens;
-- Safe at any time before this table holds data anyone depends on:
-- nothing else references email_tokens (no inbound FK from any other
-- table), so dropping it cannot cascade into unrelated data.
