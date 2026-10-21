# 0013 — Eve launch compliance (legal pages, notices, acceptance, event-change notices)

Status: Implemented on `feat/eve-launch-compliance`. Two additive migrations
approved for the **Preview** database only; **Production is a separate gate** and
Eve Production is unchanged by this ADR. Counsel review of the legal text is
still required (all legal text is DRAFT).

## 1. Implemented without schema

- **Legal routes** `/terms`, `/privacy`, `/refunds` in Eve, first-draft wording
  from `apps/eve/content/legal.ts`. Operator facts come from
  `apps/eve/config/legal.ts` (reviewed constants since Phase 3.6, see section 6). On Vercel
  **production** the pages are FAIL-CLOSED: unless every fact is set, a real
  support address exists and `EVE_LEGAL_PUBLISHED=true`, a "not yet published"
  state is shown instead of legal text. Preview shows the draft with every
  unresolved fact highlighted and a DRAFT banner; drafts are `noindex`.
- **Footer links** (Terms, Privacy, Refunds & cancellations, Support) in the
  marketing footer, the buyer layout footer, and every Eve email (ticket and
  lifecycle; Support only when a real address is configured).
- **Free registration:** linked notice, no checkbox. **Paid checkout:** an
  unticked, required checkbox, re-validated SERVER-SIDE (`accept_terms === true`
  or HTTP 400 `TERMS_NOT_ACCEPTED`, before the event is resolved or anything is
  reserved). Acceptance does not waive consumer rights.
- **Collection notice** on the booking form (CRM copy is purchaser name/email/
  phone only; no consent flag; registration answers never copied — pinned by tests).
- **Bearer-link notice** in Eve emails and on the Eve ticket and wallet pages.
- Retention inventory and the manual request process: `docs/compliance/eve-data-retention.md`.

## 2. Schema (approved with amendments) — two separate migrations

Both are additive, idempotent, table-scoped (`conrelid = '<table>'::regclass`),
`NOT VALID` then `VALIDATE`, with the rollback documented in the file header.
Proven on real Postgres 17 (applied twice) by
`tests/containment/eveLaunchComplianceSchemaRealPostgres.test.ts`.
Run manually; **never applied to Production by this slice**; apply BEFORE the
application code that writes them.

### 2.1 `scripts/add-events-order-legal-acceptance.sql` — `event_orders`
`terms_accepted_at TIMESTAMPTZ NULL`, `terms_version TEXT NULL`,
`refunds_version TEXT NULL`, with `event_orders_legal_acceptance_check` (all NULL
or all set). No backfill, no index. Behaviour:

- Stamped only by `startPaidCheckout` in the SAME INSERT as the order, only when
  the gated Eve path passes `legalAcceptance` after `accept_terms === true`.
- The timestamp is the database's `NOW()`; the versions are the server constants
  `EVE_TERMS_VERSION` / `EVE_REFUNDS_VERSION` in `@ticketing/core`
  (`legalVersions.ts`), which Eve's legal pages also render — what the buyer saw
  and what is recorded cannot drift. Nothing from the request body is used.
- Never updated afterwards (retry, webhook and refund do not touch the columns —
  pinned by a source-containment test and a real-Postgres retry test). Stripe
  metadata is not an authority.
- **Production refuses a draft version**: on `VERCEL_ENV=production`, paid
  checkout returns 503 while the constants end in `-draft`. Preview records the
  draft id. Publishing requires bumping the constants to a non-draft id that
  matches the published text.
- Historical, free and **all BrainBase orders stay NULL**; BrainBase checkout is
  unchanged and no acceptance is imposed on it.

### 2.2 `scripts/add-events-notification-event-updated.sql` — `event_notifications`
Adds `EVENT_UPDATED` to `event_notifications_type_check` (the four existing types
unchanged) and `payload JSONB NULL` with `CHECK (payload IS NULL OR
jsonb_typeof(payload) = 'object')`. Payload is ONLY
`{before:{starts_at,ends_at,venue}, after:{…}, change_version}` — buyer-safe, no
purchaser data, tokens, secrets or internal configuration.

## 3. Material event-change notice (EVENT_UPDATED)

- **Material** = `starts_at`, `ends_at` or (trimmed) `venue` changed, on an event
  that is `PUBLISHED` before and after. Description, name, artwork, branding,
  reminder and other settings, same-value PATCHes and whitespace-only venue edits
  are not material. A cancel has its own notice; a draft edit is not a change to
  something buyers were told. (Event *name* changes are deliberately deferred.)
- **Idempotency is not a hash of the new values.** The key is
  `event-notification:EVENT_UPDATED:<order_id>:<committed change version>`. The
  version is the `events` row's own `updated_at` in epoch microseconds, written by
  the very UPDATE that made the change. `updated_at` is reliable for this because
  the PATCH writes `GREATEST(clock_timestamp(), prev.updated_at + 1µs)` under a
  `FOR UPDATE` lock in one statement: versions are strictly increasing per event,
  concurrent edits serialise and each sees the previous edit as its "before"
  (proved with four concurrent PATCHes). Replaying the same committed change is a
  `ON CONFLICT DO NOTHING` no-op; a later change — including reverting to an
  earlier date, time or venue — has a new version and so a new notice.
  (Therefore no separate change-id column was needed.)
- **Before/after** are determined server-side from the locked pre-update row in
  the same statement as the UPDATE; internal `__` columns are stripped from the
  response.
- **Eligible orders** = the same live bookings a reminder goes to: `CONFIRMED`
  with `NOT_REQUIRED`/`PAID` payment, non-blank email, created before the change.
  Cancelled, refunded, failed, expired and pending orders are never notified.
  Eligibility is re-checked at claim time; ineligible rows are closed out by the
  hourly recovery run instead of retrying forever.
- **Delivery** uses the existing architecture: scheduling is one idempotent
  statement (rows + audit with a masked recipient); the PATCH sends at most
  `EVENT_UPDATED_INLINE_SEND_LIMIT` (10) inline, best-effort after the event
  update has committed; the hourly run delivers the rest. The product identity
  (Eve vs BrainBase sender, links, footer) comes from the underlying order.
- **Email**: lists the previous and new time/venue, links to the event page (and
  the Refunds & cancellations page on Eve), says a significant change may give
  rights under applicable law or the organiser's terms, and **does not promise or
  issue a refund**. No marketing language. `EVENT_CHANGE_NOTICES_ENABLED` is now
  `true`, so the Refunds policy states that a notice is emailed.
- **Known limitation:** the notice is scheduled in a statement after the event
  UPDATE commits (same pattern as EVENT_CANCELLED). A process crash in that window
  loses the notice; re-saving the identical values does not recreate it (it is not
  a new change). Closing this fully would need scheduling inside the UPDATE
  statement.

## 4. Sensitive registration questions — DEFERRED (explicit launch limitation)

The proposed `event_registration_questions.may_collect_sensitive_information` and
`event_registration_responses.sensitive_consent_at` schema/control is **not built**
and no migration exists for it. Reason: **Eve does not render registration
questions** — its booking form never shows or submits them, so no sensitive
answer can be collected through Eve today, and an event with a REQUIRED question
cannot be booked on Eve at all.

- Eve's Privacy text now says Eve does not currently collect registration
  answers and that the policy will be updated first if that changes. Eve must not
  be described as supporting registration questions.
- Current safe behaviour is preserved: answers (where collected via BrainBase) are
  never copied to CRM and never inferred as marketing consent (tests unchanged).
- **Trigger to build it:** before Eve renders any registration question, add the
  sensitive flag + consent control (and the matching Privacy wording) behind a new
  schema gate.

## 5. Remaining limits (unchanged)

- All legal text is DRAFT; operator name/ABN/address/state/retention/GST are
  explicit placeholders until counsel and the operator supply them.
- No automated retention or erasure (see the retention document).
- Production remains separately gated: apply both migrations to Production only
  after approval, then deploy the code, then publish non-draft legal text.

## 6. Phase 3.6 — operator facts and approved wording (2026-10-19)

The pages remain **DRAFT**: version `0.1-draft`, `EVE_LEGAL_PUBLISHED` unset,
visible draft banner, `noindex`, Production fail-closed. No Production migration,
deploy, Stripe or email change was made.

**Operator facts (supplied by the operator; awaiting accountant/counsel
confirmation)** now live in `apps/eve/config/legal.ts` as reviewed constants
(`OPERATOR_FACTS`), replacing the `EVE_LEGAL_*` environment variables:
James Ronald Palmer, sole trader, ABN 32 207 559 504, Adelaide, South Australia
(town/state level only — no street address), governing state South Australia.
Not registered for GST: no GST wording is used in the legal text or about Eve
platform fees. No ACN (not applicable). A fact set to `null` still renders as a
visible placeholder and keeps the pages non-final.

**Removed:** the privacy-contact and support-response-time facts/variables
(`EVE_PRIVACY_CONTACT`, `EVE_SUPPORT_RESPONSE_TIME`) and the retention-summary
variable (`EVE_LEGAL_RETENTION_SUMMARY`). The privacy contact is
`support@eveevents.com.au`. Support wording is not a service level: "We read
every message and will reply as soon as we reasonably can. We do not guarantee a
response time." Privacy access/correction requests: "We will respond within a
reasonable time, and we aim to do so within 30 days."

**Retention (public text):** superseded by section 7 — principle-based only, no
fixed period published. The per-category table in
`docs/compliance/eve-data-retention.md` is internal and is NOT published.

**Wording changes:** Privacy section 2 no longer claims registration answers or
attendee emails (Eve collects neither) and no longer contradicts section 5; the
"separate organiser agreement" claim is removed (none exists); the overseas
"you understand" wording is replaced by a plain statement of where processing
happens; the refund entitlement, charge correction, "right outcome" and marketing
statements are softened; event-change emails are "aimed" not guaranteed; the ACL
non-exclusion wording and the bearer-link warning are kept.

**Naming:** the document is "Refunds & cancellations" everywhere (page title,
metadata, footer links, emails, acceptance checkbox, Terms references). Event
changes are covered inside it.

**Still awaiting accountant / counsel:** the 7-year financial-record period; the
liability and ACL wording (Terms 9-10); the governing-law/jurisdiction clause;
whether the Privacy Act applies to a sole trader below the small-business
threshold (the text says "to the extent they apply to us"); whether the
town/state-level location is sufficient; whether a written organiser agreement or
organiser terms are needed before organisers other than the operator use Eve.

**To publish (separate gate, not done):** counsel sign-off, then bump the version
from `0.1-draft` (Production refuses a draft version for paid acceptance), update
the last-updated date and set `EVE_LEGAL_PUBLISHED=true`.

## 7. Self-published free-event private beta position (2026-10-19)

Decision: no solicitor sign-off is being sought at this stage. The legal set is
prepared for a **limited free-event private beta only**: operator-run events, no
external organisers, no paid events, Stripe live blocked. **The documents have not
been reviewed or approved by a solicitor or accountant and must not be described
as if they had.** They remain DRAFT (`0.1-draft`, `EVE_LEGAL_PUBLISHED` unset,
Production fail-closed). No migration, Production, Stripe or email change.

What changed from section 6:
- **Private-beta limitation** added to the Terms and Refunds policy: Eve is made
  available on a limited basis; paid ticketing and third-party organiser access may
  not yet be available; the operator may also be the Event Organiser.
- **No third-party organisers assumed:** "independent Event Organisers" and the
  "we are not the organiser" claim are removed. The Event Organiser concept is
  explained without implying external organisers are onboarded. No organiser terms
  exist or are created.
- **Paid ticketing marked not currently available** wherever it is described
  (Terms 3-4, Privacy 2/4/7, Refunds 1/3/6/7); Stripe appears only as a future,
  conditional processor. The booking-fee refund sentence is removed.
- **Free bookings:** the Refunds policy says there is no ticket price to refund.
- **Liability minimal:** the "not responsible for Event Organisers / not reasonably
  foreseeable" limb is removed. Terms 10 is now "Responsibility for events": the
  Event Organiser conducts the event and nothing limits any right or remedy under
  Australian law. No indemnity, waiver, consequential-loss or cap language.
- **Governing law kept** only in its safe form: non-exclusive jurisdiction,
  without limiting statutory rights.
- **Privacy:** APP wording is "to the extent the APPs and the Privacy Act apply to
  us" (no coverage claim); breach wording is "we will assess it and notify... where
  the law requires"; overseas wording names Resend only (Stripe not applicable yet)
  and is factual, not consent-based; support is the privacy contact; no-cookie and
  no-tracker statements stay only because they are verified true.
- **Retention:** principle-based only, no fixed period (the 7-year statement is
  withdrawn from the public text until the accountant has confirmed it and before
  paid events). The text does not imply automatic deletion.
- **Out of scope unless product behaviour requires it:** minors, transfer/resale
  and organiser terms.

Not claimed anywhere: legal review, regulatory compliance beyond what is verified,
GST, tax invoices, charity/NFP status, a residential address.

Before external organisers: organiser terms. Before paid events: accountant
confirmation of retention, GST/fee wording and receipts, then the live-Stripe gate.
