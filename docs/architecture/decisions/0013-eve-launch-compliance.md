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
`event_registration_responses.buyer_acknowledged_at` schema/control is **not built**
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

### 4a. Built (2026-10-23, branch `feat/eve-registration-questions`) — not yet live

Schema gate `scripts/add-eve-registration-questions.sql` (additive; must be applied
before the code deploys):

- `events.eve_questions_enabled` (default false): per-event Eve opt-in, manager+,
  audited (`event.eve_questions_toggled`). Off, Eve receives no question
  definitions and the shared services refuse any answer submitted through the EVE
  surface; an event with a required question shows "Online registration isn't
  available for this event." on Eve instead of failing at submit.
- Category model (superseded the first draft's `sensitive` boolean before any
  migration ran) — see §4b.
- Answer visibility: manager+ only, in both the Eve organiser API and the BrainBase
  registrations read (previously viewer+ in BrainBase; no viewer/analyst users
  existed in any affected organisation on 2026-10-23). Answer COUNTS are manager+
  too. Unchanged: never in CRM, emails, the CSV export, audit-log content, search,
  or any buyer/public endpoint.
- Once a question has answers its type and scope are locked and select options can
  only be added.
- Privacy Policy sections 2, 3, 4, 5 and 8 rewritten — **requires legal review
  before merge** (merging publishes it).

### 4b. Privacy decisions (2026-10-24) — categories, retention, legal hold

Decided by the operator on 2026-10-24; implemented on the same branch, not live.

**Categories** (`event_registration_questions.data_category`, snapshotted per
answer as `data_category_snapshot`):

| Category | Meaning | Explicit agreement on Eve | Removed |
|---|---|---|---|
| STANDARD | ordinary personal information | no | 12 months after event end |
| SENSITIVE | may reveal health/disability (accessibility, dietary) | yes | 30 days after event end; cancelled: 7 days after cancellation |
| THIRD_PARTY | another person's details (emergency contact) | yes | 7 days after event end; cancelled: 7 days after cancellation |
| CONSENT | a recorded choice (photo consent) | no | 3 years after event end |

Existing questions and answers default to STANDARD (no guessing). Built-in
templates carry a category; a template in a protected category (SENSITIVE,
THIRD_PARTY, CONSENT) cannot be lowered and its template link cannot be changed.

**Retention** (`lib/events/answerRetention.ts`, daily cron
`/api/cron/registration-answer-retention`): removal sets `answer := NULL` and
`redacted_at`; the row keeps only structure (question, label/type/category/help
snapshots, timestamps, agreement time). Orders, payments, refunds, tickets,
check-in, legal acceptance and audit history are never touched. Report-only unless
`EVE_ANSWER_RETENTION_ENFORCE` is exactly `true`. Audit: one
`event_responses.redacted` row per event with ids and counts only.

**Legal hold** (`events.answers_legal_hold`, `event_orders.answers_legal_hold`; reason
code COMPLAINT | INCIDENT | DISPUTE | LEGAL_OBLIGATION), admin+, audited. Pauses
removal for that event/order only.

**Copies:** Preview/test branches and manual snapshots hold Production data; see
`docs/compliance/eve-production-data-copies.md` for the inventory, rule and
cleanup plan, which must be in force before Eve collects Production answers.

**Purchaser acknowledgements (2026-10-24 clarification).** The purchaser gives two
separate, unticked acknowledgements:
- `agree_sensitive`: agreement to the organiser collecting SENSITIVE answers;
- `confirm_third_party`: confirmation that the person whose details they gave knows
  those details are being given to the organiser, or that they may give them.

Both are the purchaser's own statements. The platform never records or treats either
one as the third party's consent. The column is accordingly
`buyer_acknowledged_at`, not "consent". The draft name `sensitive_consent_at` never
reached any database.

**CONSENT retention is provisional.** 3 years is the default for implementation and
testing, pending legal advice. All timers live in one table (`RETENTION_POLICY`), and
`afterEnd: null` means "not removed automatically". Enforcement stays off until the
period is settled.

**Legal review pack:** `docs/compliance/eve-registration-questions-legal-review-pack.md`.

### 4c. Privacy model refinement (2026-10-24) — internal

Decided by the operator on 2026-10-24; implemented in the draft Privacy text on the same
branch, not live.

**Platform / organiser responsibility.** The Privacy Policy (§5) now says, in plain
Australian English and without GDPR controller/processor terms:
- Eve/HLNA provides the platform and handles the core booking and platform information.
- The Event Organiser decides which questions to ask, why, and whether each is required.
- Eve collects and stores the answers on the organiser's behalf.
- Organisers should ask only for what is reasonably needed to run the event.
- The organiser remains responsible for its own use of the answers and any copies.

**Controls unchanged.** All of these are unchanged:
- the four categories;
- the separate unticked SENSITIVE and THIRD_PARTY acknowledgements, where the purchaser's
  confirmation is never the third party's consent;
- Manager/Admin/Super Admin-only access and tenant isolation;
- question/answer snapshots and legal holds;
- no answer text in audits;
- no CRM, ticket-email or marketing copying;
- Eve questions default OFF;
- retention enforcement report-only.

**Public retention wording simplified.** Privacy §8 describes answer retention by
purpose only:
- answers are kept only as long as reasonably needed for the event and their purpose;
- sensitive and other-person details are generally removed sooner;
- answers may be kept longer for an incident, complaint, dispute or legal obligation;
- backups expire after a limited period.

No exact period is published. The internal timers are unchanged:
- `RETENTION_POLICY`: STANDARD 12 months; SENSITIVE 30 days; THIRD_PARTY 7 days;
  CONSENT 3 years (provisional);
- on cancellation, SENSITIVE and THIRD_PARTY answers are removed 7 days after
  cancellation;
- legal holds pause removal.

The timers are recorded here (§4b), in `docs/compliance/eve-data-retention.md` and in
the review pack §C, and are pinned by a test.

**Exports — future feature, not in the initial release.** Answers stay out of the
registrations CSV export (`app/api/events/[id]/orders/export/route.ts`). Adding them
later needs all of the following before it ships:
- a permission model (who may export which categories);
- sensitive-data handling (whether SENSITIVE/THIRD_PARTY answers are exportable at all,
  and on what terms);
- auditing of each export;
- a privacy review, including the Privacy wording, because an exported copy is the
  organiser's copy and is outside Eve's retention.

**Future product idea (not built).** Consider asking for detailed attendee information
through post-checkout registration questions, to reduce checkout friction. Not
implemented and not scheduled. If it is pursued, it needs its own design and privacy
review.

**Benchmark note.** Eve's design was benchmarked against established ticketing-platform
practice. Observed facts:
- event hosts commonly ask custom registration questions;
- those questions can include accessibility, dietary and next-of-kin information;
- ticketing platforms commonly distinguish platform data from host/event-specific data;
- mature platforms use finite retention periods for checkout-question answers.

Eve deliberately adopts shorter, category-based retention and tighter access controls.
No other platform's policy text is reused in Eve's public policy.

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

## 8. Eve paid-checkout kill switch and version 2026-10-21 (2026-10-21)

A Production paid-safety check found `ld-tennis` has a connected Stripe account with
charges enabled and a published paid ticket type, and the Eve checkout path accepts any
organisation slug. Removing the draft-version guard alone would therefore have opened
real paid checkout through Eve. Decision: add an explicit, fail-closed server-side switch.

- `EVE_PAID_CHECKOUT_ENABLED` (BrainBase project env; the checkout handler runs there).
  Paid Eve checkout is available only when it is exactly the string `true` (no trimming,
  no case folding). Unset, empty, `false`, `0`, `TRUE`, ` true` and everything else block it.
- Enforced first in `handleTicketingCheckout` (`lib/ticketing/publicApi.ts`), straight after
  the server-to-server gate: before the rate limiter, body parsing, event lookup, any
  reservation or order, and any Stripe call. Response: 503 "Paid checkout is not currently
  available." (nothing about Stripe or the organisation).
- Scope: Eve paid checkout only. BrainBase's public checkout route, Stripe Connect, the
  webhook, retry, refunds, lifecycle email and free Eve registration do not read it.
- Independent of the draft legal-version guard: either control blocks alone.
- **Must stay unset in Production** until the paid-event gate is separately approved.

The legal version is now `2026-10-21` and the last-updated date `21 October 2026`; the
approved text is unchanged. `EVE_LEGAL_PUBLISHED` stays unset, so Production legal pages
still render "Not yet published".

## 9. Eve sender domain and Reply-To (2026-10-21)

Eve buyer email is sent by BrainBase (one Resend account, one `sendEmail()`), from
`EVE_EMAIL_FROM`. The target sender is `Eve <tickets@mail.eveevents.com.au>` (Resend domain
`mail.eveevents.com.au`, verified); the previous `eve-mail.thebrainbase.com.au` domain stays
verified as the rollback until Production is proven on the new one.

Replies to a transactional sender address would go nowhere, so an Eve buyer email now carries
`Reply-To: <EVE_SUPPORT_EMAIL>`:

- `sendEmail()` gained an optional `replyTo` (sent as Resend `reply_to` only when passed; no
  default, no env source). BrainBase and LD Tennis callers do not pass it, so their request body is
  unchanged.
- `resolveBuyerProduct` sets `replyTo` for Eve orders only, from `EVE_SUPPORT_EMAIL` under the same
  validation as the footer Support link (real address, not a placeholder domain). A missing or
  malformed value yields no Reply-To — never a BrainBase address — and does not block the send.
- Only the two Eve-aware send sites (`ticketEmail.ts`, `notificationDelivery.ts`) forward it.

### Proof status (Preview, 2026-10-21)

One free Preview registration was sent from `Eve <tickets@mail.eveevents.com.au>` and delivered to
Gmail with `Reply-To: support@eveevents.com.au`:

- DKIM: pass (`d=mail.eveevents.com.au`, selector `resend`).
- SPF: pass (return-path `rsend.mail.eveevents.com.au`).
- Domain alignment: DKIM and SPF domains are the From domain or a subdomain of it, so the message
  would align.
- DMARC: **not configured / no result.** `eveevents.com.au` publishes no `_dmarc` record, so Gmail
  reported no DMARC verdict. DMARC is not claimed as passing. Publishing a monitoring record is a
  separate, optional DNS step.
- Delivered webhook: **not demonstrated in Preview.** The Preview delivery row stayed `accepted`. The
  Resend webhook is account-wide and has a single Enabled endpoint (the Production URL); it received
  the `email.delivered` event for the Preview message (200), but that message id has no row in the
  Production database, so the handler correctly did nothing. The Preview deployment has no webhook
  endpoint or signing secret of its own. The `delivered` outcome for the new sender is therefore
  expected to be demonstrated only by the controlled Production test, not shown here.

## 10. Paid-checkout readiness fixes (2026-10-22)

Found by the paid-checkout readiness review; all generic to the shared paid-order engine (BrainBase,
LD Tennis and Eve), none changes pricing, Stripe objects or the kill switch.

- **Cancelling a PENDING paid order closes its Checkout Session first.** `cancelOrder` retrieves the
  order's own stored session on the order's own stored connected account, checks that the session's
  order id matches, and expires it if open. Already expired / not found => cancel proceeds. Completed
  (paid or settling) => refused (`PAYMENT_IN_PROGRESS`), nothing changes. Any other failure => refused
  (`STRIPE_EXPIRE_FAILED`), the order stays PENDING and the manager can retry — there is no state where
  the database says cancelled while a known-payable session is open. The cancel UPDATE is tied to the
  session id that was inspected (a concurrent Retry yields `CHANGED_CONCURRENTLY`). A session id can no
  longer be written back to an order that is no longer PENDING (checkout and Retry), so a cancel that
  lands between reservation and session creation cannot end up with a payable session.
- **Late webhook after the hold lapsed.** The seat hold (`event_orders.expires_at`) now outlasts the
  Stripe payment window by `RESERVATION_HOLD_GRACE_SECONDS` (60 min), so a delayed webhook for a payment
  made near the end of the session finds the seat still held. The Stripe session length is unchanged;
  abandoned sessions still release when `checkout.session.expired` arrives. Residual risk, not closed:
  a webhook delayed beyond the grace (an outage of over an hour) and any payment method that settles
  asynchronously (days). Keep asynchronous methods (e.g. bank debit) disabled for Eve until the hold
  is extended on `completed` with an unpaid status.
- **Prompt paid ticket email.** The webhook handler still only schedules (`ticket_email_status =
  'pending'`). The webhook route now makes one delivery attempt after its response (`after()`) through
  the same claim-lease / deterministic idempotency-key machinery; a replay finds nothing to claim.
  The hourly recovery cron remains the fallback for failures. This applies to every product surface.

## 11. Eve paid-checkout organisation allow-list (2026-10-22)

`EVE_PAID_CHECKOUT_ENABLED` opens Eve paid checkout for every organisation at once, and
Production has other organisations with published paid tickets (`ld-tennis`, whose stored
Connect account is not a live account, and `school-test-organisation`). Decision: Eve paid
checkout also needs the organisation to be allow-listed, so a controlled live proof can open
one organisation only.

- `EVE_PAID_CHECKOUT_ORGS` (BrainBase project env): comma-separated organisation slugs, e.g.
  `brainbase`. Each entry must be a lowercase slug; no trimming, no wildcard. Unset, empty or
  any malformed entry (`*`, `Brainbase`, ` brainbase`, a trailing comma) denies every
  organisation. There is no allow-all fallback.
- Both controls are required: the global flag exactly `true` AND the request's organisation
  slug on the list (exact match, the same exact slug `resolvePublicEvent` uses). Enforced at the
  same point as the flag, before the limiter, body, event lookup, reservation, order or Stripe
  call, with the same 503 body.
- Same scope as the flag: Eve paid checkout only. Free Eve registration and BrainBase's own
  public checkout are unaffected.
- **Both must stay unset in Production** except during an approved, time-boxed proof.