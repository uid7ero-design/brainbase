-- Events & Ticketing — Phase 4B: configurable registration questions /
-- attendee requirements. Run once, manually, against the target
-- database, AFTER scripts/create-events.sql, create-events-phase2.sql,
-- add-events-ticketing.sql, add-events-payments.sql, and
-- add-events-payment-connect.sql. NOT run automatically — same
-- manual-authorization discipline as every schema script here.
--
-- Purpose: let organisers collect information such as dietary
-- requirements, accessibility/support requirements, or free-form
-- notes, per organisation, per event — fully configurable, never
-- hardcoded question text baked into the Events engine itself.
--
-- ── Preferred model chosen (§1): configurable question definitions +
-- stored responses ─────────────────────────────────────────────────
--
-- Rejected alternative: fixed columns (dietary_requirements,
-- disability_requirements, notes, ...) directly on event_attendees.
-- That would hardcode BrainBase's own opinion of what every
-- organisation needs to ask, force a schema migration for every new
-- question any organiser ever wants, and cannot express "asked once
-- per booking" vs "asked once per attendee" or reorder/optionality at
-- all. A generic question-definition + response model is the smallest
-- schema that is genuinely reusable across every BrainBase
-- organisation, matching this migration's own explicit goal.
--
-- ── event_registration_questions ─────────────────────────────────────
--
-- Tenant-scoped (organisation_id) and event-scoped (event_id, via the
-- same composite-FK-to-events(id, organisation_id) pattern
-- event_sessions/event_ticket_types already use) — a question defined
-- for one organisation's event can never be referenced by another.
--
-- field_type / scope: TEXT + CHECK, matching every other status-like
-- vocabulary column in this schema (events.status,
-- event_orders.status/payment_status) — not a native Postgres enum.
-- field_type: SHORT_TEXT | LONG_TEXT | YES_NO | SINGLE_SELECT |
-- MULTI_SELECT. scope: ORDER (answered once for the whole booking) |
-- ATTENDEE (answered once per attendee/ticket holder).
--
-- options: JSONB, nullable — a plain ordered array of strings (e.g.
-- ["Vegetarian","Vegan","Gluten-free","No restrictions"]), only
-- meaningful for SINGLE_SELECT/MULTI_SELECT. A JSONB column here
-- (rather than a separate EventRegistrationQuestionOption table)
-- matches this schema's own existing precedent for a small,
-- always-read/written-as-a-whole, never-independently-queried list
-- attached to one parent row (Organisation.settings,
-- Contract.metadata) — a second relational table would be
-- over-modeling for what is fundamentally one question's own
-- configuration blob.
--
-- active: soft-retirement only (§4's explicit "remove/deactivate" —
-- never a hard DELETE route in the application layer; the
-- question_id FK below is ON DELETE RESTRICT specifically so a
-- question that already has responses cannot be hard-deleted even by
-- direct DB access, only ever deactivated).
--
-- sort_order: manager-controlled ordering within (event_id, scope) —
-- matches event_ticket_types.sort_order's own existing convention
-- exactly.
--
-- ── event_registration_responses ─────────────────────────────────────
--
-- Links to organisation, event (denormalized, matching
-- event_attendees.event_id's own precedent), the question asked, the
-- order it was submitted with, and — only for scope = ATTENDEE — the
-- specific attendee it belongs to (NULL for ORDER-scoped responses).
--
-- question_label_snapshot / field_type_snapshot: captured once, at
-- response-write time, from the question definition as it existed
-- then (§3's explicit "preserve historical response even if question
-- wording later changes... do not rely solely on the current mutable
-- question definition when rendering historical registrations"). The
-- live question_id FK still exists (so the CURRENT definition can
-- always be looked up too, e.g. for the question-builder UI), but
-- every historical-registration display path reads the snapshot
-- columns, never the live question row's current label/type.
--
-- answer: JSONB, not several nullable typed columns — a single
-- column that natively holds whatever shape the snapshotted
-- field_type implies (a JSON string for SHORT_TEXT/LONG_TEXT/
-- SINGLE_SELECT, a JSON boolean for YES_NO, a JSON array of strings
-- for MULTI_SELECT) is simpler than a discriminated union of
-- textual/boolean/array columns for one underlying concept, and
-- avoids ever having "the wrong nullable column populated" as a
-- possible invalid state.
--
-- Tenant/cross-linkage safety (§3's explicit requirements): every FK
-- below is a COMPOSITE (foreign_id, organisation_id) FK against the
-- SAME organisation_id this row itself carries — a response can
-- physically never reference a question, order, or attendee belonging
-- to a different organisation; this is enforced by the database
-- itself, not only application code. The partial UNIQUE index further
-- prevents two response rows ever existing for the same
-- (question, order, attendee) triple — see its own comment.
--
-- No sensitive response content is ever written into event_attendees,
-- ticket_token, or anywhere Stripe-adjacent — this is a fully separate
-- table with its own access path (application code enforces "manager
-- read, public write-only-at-submission-time, never on the public
-- ticket route" — see lib/events/registrationQuestions.ts).
--
-- Idempotency: IF NOT EXISTS / idempotent guards throughout. Safe to
-- re-run.
--
-- ROLLBACK: additive only, no other table depends on these two — safe
-- to drop at any time:
--
--   DROP TABLE IF EXISTS event_registration_responses;
--   DROP TABLE IF EXISTS event_registration_questions;
--   ALTER TABLE event_attendees DROP CONSTRAINT IF EXISTS event_attendees_id_organisation_id_key;
--
-- (Not executed by this script — recorded here for the record only.)

-- Prerequisite: event_attendees needs a UNIQUE(id, organisation_id)
-- constraint to be a valid composite-FK TARGET (every other table in
-- this chain already has one; event_attendees never needed one until
-- now, since nothing previously referenced it). Adding a uniqueness
-- guarantee on (id, organisation_id) where id alone is already the
-- primary key is a trivial, instant, data-safe addition.
ALTER TABLE event_attendees
  ADD CONSTRAINT event_attendees_id_organisation_id_key UNIQUE (id, organisation_id);

CREATE TABLE IF NOT EXISTS event_registration_questions (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id TEXT        NOT NULL,
  event_id        TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  help_text       TEXT,
  field_type      TEXT        NOT NULL CHECK (field_type IN ('SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT')),
  required        BOOLEAN     NOT NULL DEFAULT false,
  scope           TEXT        NOT NULL CHECK (scope IN ('ORDER', 'ATTENDEE')),
  options         JSONB,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_questions_id_organisation_id_key UNIQUE (id, organisation_id),
  CONSTRAINT event_registration_questions_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_registration_questions_organisation_id ON event_registration_questions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_questions_event_id ON event_registration_questions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_questions_event_scope ON event_registration_questions(event_id, scope) WHERE active = true;

CREATE TABLE IF NOT EXISTS event_registration_responses (
  id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id         TEXT        NOT NULL,
  event_id                TEXT        NOT NULL,
  question_id             TEXT        NOT NULL,
  order_id                TEXT        NOT NULL,
  attendee_id             TEXT,
  question_label_snapshot TEXT        NOT NULL,
  field_type_snapshot     TEXT        NOT NULL,
  answer                  JSONB       NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_responses_question_org_fkey FOREIGN KEY (question_id, organisation_id)
    REFERENCES event_registration_questions (id, organisation_id) ON DELETE RESTRICT,
  CONSTRAINT event_registration_responses_order_org_fkey FOREIGN KEY (order_id, organisation_id)
    REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_registration_responses_attendee_org_fkey FOREIGN KEY (attendee_id, organisation_id)
    REFERENCES event_attendees (id, organisation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_registration_responses_organisation_id ON event_registration_responses(organisation_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_responses_event_id ON event_registration_responses(event_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_responses_order_id ON event_registration_responses(order_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_responses_attendee_id ON event_registration_responses(attendee_id);

-- Prevents two response rows ever existing for the same
-- (question, order, attendee) — the mechanism that makes "retry does
-- not duplicate responses" (§8) hold even as a DB-level guarantee,
-- not only an application-level one (retry itself never re-inserts
-- responses at all — see the checkout/retry routes — this is defense
-- in depth). A plain UNIQUE(question_id, order_id, attendee_id) would
-- NOT correctly catch a duplicate ORDER-scoped response, because
-- Postgres treats every NULL as distinct from every other NULL in a
-- unique constraint — COALESCE(attendee_id, '') collapses every
-- ORDER-scoped row's NULL to the same sentinel value for uniqueness
-- purposes, which is exactly what's needed since an attendee id can
-- never legitimately be the empty string.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registration_responses_unique_answer
  ON event_registration_responses (question_id, order_id, COALESCE(attendee_id, ''));
