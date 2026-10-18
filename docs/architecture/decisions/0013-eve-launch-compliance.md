# 0013 — Eve launch compliance (legal pages, notices, acceptance)

Status: Part implemented (no schema); three schema-dependent items WAIT FOR
APPROVAL (see §3). Eve Production is unchanged by this ADR.

## 1. Implemented without schema

- **Legal routes** `/terms`, `/privacy`, `/refunds` in Eve, first-draft wording
  from `apps/eve/content/legal.ts`. Operator facts come from
  `apps/eve/config/legal.ts` (environment, no invented values). On Vercel
  **production** the pages are FAIL-CLOSED: unless every fact is set, a real
  support address exists and `EVE_LEGAL_PUBLISHED=true`, a "not yet published"
  state is shown instead of legal text. Preview shows the draft with every
  unresolved fact highlighted and a DRAFT banner; drafts are `noindex`.
- **Footer links** (Terms, Privacy, Refunds & cancellations, Support) in the
  marketing footer, the buyer layout footer, and every Eve email (ticket and
  lifecycle; Support only when a real address is configured). Eve has no
  organiser footer.
- **Free registration:** linked notice, no checkbox. **Paid checkout:** an
  unticked, required checkbox, re-validated SERVER-SIDE (`accept_terms === true`
  or HTTP 400 `TERMS_NOT_ACCEPTED`, before the event is resolved or anything is
  reserved). Acceptance does not waive consumer rights.
- **Collection notice** on the booking form: details go to the organiser, name,
  email and phone may appear in the organiser's contact records, and this is
  not marketing consent. The CRM copy is unchanged (purchaser name/email/phone
  only; no consent flag; registration answers never copied) and is now pinned
  by tests.
- **Bearer-link notice** in Eve emails and on the Eve ticket and wallet pages.
- Retention inventory and the manual request process: `docs/compliance/eve-data-retention.md`.

## 2. Limits to state plainly

- **Acceptance is not persisted** (no version/timestamp is stored on the order).
  The server proves acceptance was asserted in the request, but there is no
  durable evidence per order. See §3.1.
- **Eve does not render registration questions.** Its booking form never shows
  or submits them, so no sensitive answer can be collected through Eve today;
  an event with a REQUIRED question cannot be booked on Eve at all. The
  sensitive-question consent control (§3.2) is therefore only needed when Eve
  gains question rendering, or for BrainBase's own public pages.
- **Event-change notices** do not exist yet (§3.3); the Refunds policy says the
  organiser is responsible for telling buyers until
  `EVENT_CHANGE_NOTICES_ENABLED` is switched on.

## 3. Schema gate — proposals, NOT written or run

### 3.1 Acceptance snapshot — `event_orders`
`terms_accepted_at TIMESTAMPTZ NULL`, `terms_version TEXT NULL`,
`refunds_version TEXT NULL`, plus a CHECK that the three are all NULL or all set.
Additive, no backfill, no index. Written in the same INSERT as the order (Eve
paid checkout only; historical and BrainBase orders stay NULL). Rollback: drop
the CHECK then the columns.

### 3.2 Sensitive question flag — `event_registration_questions`
`may_collect_sensitive_information BOOLEAN NOT NULL DEFAULT false`
(constant default, metadata-only on PostgreSQL 11+, no backfill, no index). The
existing `options` column is a plain array of strings and cannot carry it safely.
Optional second column on `event_registration_responses`:
`sensitive_consent_at TIMESTAMPTZ NULL` (consent evidence). Rollback: drop the
columns.

### 3.3 Material event change — `event_notifications`
The `event_notifications_type_check` CHECK currently allows exactly four types.
Proposal: replace it with the four plus `EVENT_UPDATED`, and add
`payload JSONB NULL` with `CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object')`
to hold the before/after date, time and venue so the email can say what changed.
Idempotency key (already UNIQUE, TEXT):
`event-notification:EVENT_UPDATED:<order_id>:<sha256 of the new date/time/venue>` —
a replay of the same change is a no-op, a later different change is a new
notification. Rollback: delete `EVENT_UPDATED` rows, restore the four-type CHECK,
drop `payload`.

All three are additive; Preview Neon branch first; Production is a separate gate.
