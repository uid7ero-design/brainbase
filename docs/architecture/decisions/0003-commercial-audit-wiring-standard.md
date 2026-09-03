# 0003 — Audit-Wiring Standard for Future Commercial Writes

Status: Accepted (Phase C1.8, Foundation Repair)

## 1. Context

The C0/C0-R audit found `AuditLog`/`audit_logs` (`prisma/schema.prisma`)
to be a generic, reusable schema — `organisation_id`, `user_id?`,
`action`, `resource_type`, `resource_id?`, `before_state`/`after_state`
(JSON), indexed on `(resource_type, resource_id)` and `created_at` — but
very thinly and inconsistently wired:

- `services/persistence.ts`'s `writeAuditLog()` helper has zero callers
  anywhere in the live tree — dead code, confirmed by repo-wide grep both
  in C0 and again in C0-R.
- The one previously-working consumer (`app/api/ops/alerts/**`) remains
  excluded from Vercel deploy (`.vercelignore`, marked WIP) — not live in
  production.
- `lib/tennisSchedule.ts` has one real, deployed, transactional raw-SQL
  write (`INSERT INTO audit_logs ...` inside the same `sql.transaction()`
  as the business-data write it describes) — scoped narrowly to session
  archive/restore.
- Phase C1.7 (this same phase) added a second real, deployed pattern:
  `lib/events/auditLog.ts` (separate-statement, best-effort, for
  human-initiated Events actions — refund/cancel/edit/check-in/notes) and,
  newly, an atomic UPDATE+audit CTE pattern inside `lib/events/stripe.ts`
  itself for the three Stripe-webhook-driven payment-state transitions
  (see that file's own `handleCheckoutSessionCompleted` comment).

This is now genuinely two proven, deployed patterns rather than zero —
this ADR is what generalizes them into a standard for C2 and later,
rather than leaving every future commercial write to reinvent the
question of "how do I log this" from scratch, or to copy whichever
pattern happens to be nearest in the codebase without knowing why it was
chosen.

`writeAuditLog()` is judged genuinely unsuitable as the canonical helper
going forward — not because it is poorly written, but because it is
Prisma-Client-based (`services/persistence.ts`'s whole vertical is
Prisma-only, per CLAUDE.md), while every general-purpose, organisation-
scoped write path in this codebase — including every Commercial Suite
table this ADR anticipates — uses `lib/db.ts`'s raw-SQL `sql` client
instead (the dominant, documented convention). Forcing a raw-SQL-vertical
feature to route through a Prisma-Client helper would mean either a second
Prisma connection/transaction boundary that cannot be combined with a raw-
SQL `sql.transaction()` (exactly the limitation `lib/tennisSchedule.ts`'s
own comment on `sql.transaction()` vs. Prisma's `$transaction()` already
documents), or abandoning transactional alignment (Section 3) entirely.
It is explicitly deprecated below (Section 6), not deleted — deleting a
function with zero current callers is a judgment call outside this
narrowly-scoped ADR's remit, and it costs nothing to leave in place,
clearly marked.

## 2. Which events require an audit entry

An audit entry is required for any write that:

- Changes a commercial document's **status** (draft → sent, sent →
  accepted/rejected, issued → paid, requested → approved, etc.).
- Records a **money-moving** event (a payment, a refund, a credit note).
- Represents an **approval or rejection** decision by a human actor
  (discount approval, PO approval, expense approval).
- Is a **system-initiated** transition equivalent in effect to one of the
  above (a payment-gateway webhook flipping payment status — see Phase
  C1.7's Stripe example — or a scheduled job voiding an expired quote).
- Produces a **commercial export** (a generated PDF/CSV a person could
  later need to prove was sent, and what it contained at that time).

Routine reads, and internal recalculations that do not change a
persisted document's externally-visible state (e.g. a report dashboard
recomputing a KPI from already-audited rows), do NOT require their own
audit entry — the events that produced the underlying data already have
one. This is a deliberate boundary, not an oversight: this ADR does not
ask every future feature to wire every application to `AuditLog`,
matching the C1.8 brief's own explicit instruction.

## 3. When an audit write must be in the same transaction as the business-state write

**Required** (same statement or same explicit transaction) when:

- The mutation is a **system-initiated, idempotency-sensitive**
  transition — e.g. a payment webhook that may be redelivered. Phase
  C1.7's atomic `WITH updated AS (UPDATE ... RETURNING ...) INSERT INTO
  audit_logs ... FROM updated` pattern (`lib/events/stripe.ts`) is the
  reference implementation: the audit row's existence is *derived from*
  the mutation's own `RETURNING` result, so a retry that matches zero
  rows produces zero audit rows, by construction, with no separate
  idempotency check to get wrong.
- The absence of the audit entry would make the business-state change
  itself ambiguous or unexplainable later (e.g. "this invoice is marked
  VOID, but there is no record of who voided it or when" is a data-
  integrity gap, not merely a missing log line).

**Acceptable as a separate, best-effort, non-transactional write** when:

- The action is **human-initiated and already gated by session/role/
  capability checks** before the mutation runs — a person who just
  successfully clicked "Approve" already proved who they are; a dropped
  audit write afterward does not retroactively make the approval
  ambiguous the way a dropped webhook-audit write would (there is no
  webhook-style redelivery to create a duplicate-vs-missing ambiguity).
  `lib/events/auditLog.ts`'s existing pattern (call the logging function
  *after* the real mutation has already committed successfully; log
  failure is caught, logged to console, and never surfaces to or fails
  the caller) is the reference implementation for this case.
- A transactional write is architecturally unavailable — e.g. a fire-and-
  forget background job with no natural transaction boundary to join.

The deciding question is not "is this important" (most audited events
are) — it is "can this specific write recur/retry in a way that would
produce a misleading duplicate or a silent gap if the audit write and the
business write are not atomic." Webhooks and other automated retries
answer yes; a single human click, already behind an auth gate, answers
no.

## 4. Required fields

Every audit entry (regardless of transactional/best-effort path) MUST
carry:

- `organisation_id` — the tenant the event belongs to. Sourced from the
  same trusted value the mutation itself was scoped by (the transaction's
  own `RETURNING organisation_id`, or the caller's already-validated
  `session.organisationId`) — never independently re-resolved, and never
  taken from client-supplied input.
- `action` — a namespaced string, `<resource_type>.<verb>` (e.g.
  `event_order.refunded`, `quote.sent`, `invoice.paid`) — see Section 12
  for the naming convention in full.
- `resource_type` — the entity kind (`event_order`, `quote`, `invoice`,
  ...), always a literal matching the namespace prefix in `action`.
- `resource_id` — the specific row's id.

Every audit entry SHOULD carry, where applicable:

- `user_id` — the human actor's id, when one exists (Section 5). `NULL`
  for a system-initiated event (Section 5) — never a placeholder/sentinel
  user row invented to avoid a nullable column, since `user_id` is
  already nullable on `AuditLog`.
- `before_state`/`after_state` — the specific fields that changed,
  never the entire row. Money fields inside these snapshots follow ADR
  0002 (integer `*_cents`, not floats).

## 5. Automated/system actor vs. human actor representation

- **Human actor**: `user_id` = the authenticated user's id (already
  resolved and trusted by the route's own session/role/capability gate
  before the mutation ran — see `lib/organiser/authorize.ts`/
  `lib/events/authorize.ts`/`lib/debtors/authorize.ts`'s shared pattern,
  Phase C1.1/C1.3/C1.4). `after_state` (and `before_state`, where an edit)
  carries the actual changed field values — this is the entire point of
  a human-edit audit trail (`lib/events/auditLog.ts`'s own
  `logPurchaserEdited`/`logAttendeeEdited` are the reference examples).
- **System/automated actor**: `user_id` = `NULL`. The event's automated
  origin MUST be explicit and machine-readable inside `after_state`
  (never left to be inferred from `user_id` being null alone, which is
  also true of a data-quality gap) — a `"source"` key naming the system
  that generated the event, e.g. `{"source": "stripe_webhook", ...}`
  (Phase C1.7's own convention) or `{"source": "scheduled_job:
  quote_expiry", ...}` for a future cron-driven transition. This is a
  deliberate, minimal convention (one JSON key), not a schema change —
  `AuditLog` gets no new column for this.

## 6. `writeAuditLog()` (`services/persistence.ts`) status

**Deprecated, not adopted as the canonical path, not deleted.** Left in
place (it has no current callers, so leaving it costs nothing) with an
inline comment pointing future readers at this ADR, because:

- It is Prisma-Client-based, while every Commercial Suite write path this
  ADR anticipates will use `lib/db.ts`'s raw-SQL `sql` client, matching
  the dominant, already-established convention for organisation-scoped
  business logic in this repository (CLAUDE.md; confirmed again by every
  audit phase of this Commercial Suite work).
- Its Prisma `$transaction()` cannot be combined with a raw-SQL
  `sql.transaction()` in one atomic unit (`lib/tennisSchedule.ts`'s own
  comment on exactly this limitation is the precedent this observation is
  drawn from) — so a future write needing Section 3's transactional
  guarantee could not use it regardless of the convention question above.

The canonical path for a NEW commercial-suite audit write is a raw-SQL
`INSERT INTO audit_logs (...)` — either standalone (best-effort case,
following `lib/events/auditLog.ts`'s `insertAuditLog()` shape) or as a
CTE alongside its business-state `UPDATE`/`INSERT` (transactional case,
following `lib/events/stripe.ts`'s Phase C1.7 pattern). No new helper
module is introduced by this ADR — the two existing, now-proven shapes
are the pattern to copy per-vertical (e.g. a future `lib/invoicing/
auditLog.ts` modeled on `lib/events/auditLog.ts`), not a shared generic
utility, matching how `lib/organiser/authorize.ts`/`lib/events/
authorize.ts`/`lib/debtors/authorize.ts` are each their own small,
capability-specific file rather than one shared parametrized function.

## 7. PII redaction

Never log a field whose *content* is the sensitive artifact itself when a
reference to it is sufficient — `lib/events/auditLog.ts`'s
`logResponseEdited` (logs which question/field type changed, never the
answer text) and `logNoteAdded`/`logNoteEdited`/`logNoteDeleted` (log that
a note changed, never its body) are the reference examples. Fields that
identify *who* an action concerns (a customer's name/email/phone on a
quote or invoice) are not treated the same as free-text content — Section
4's `before_state`/`after_state` may include them, matching
`logPurchaserEdited`'s existing, deliberate precedent (see that
function's own comment for why this is not a new category of exposure
for data already duplicated into CRM once sync has run).

## 8. Secrets prohibition

No API key, session token, Stripe signature, webhook signing secret, raw
payment-card field, or password/password-hash may ever appear in
`before_state`/`after_state`, `action`, or any other audit_logs column —
verified for Phase C1.7's own new writes by
`tests/containment/stripeWebhookAudit.test.ts`'s explicit assertion. A
future audited feature should add the equivalent assertion for its own
domain rather than relying on convention alone.

## 9. Organisation scoping

`organisation_id` is always sourced from the same trusted value the
business-state mutation itself was scoped by (Section 4) — never
independently resolved, and never accepted from client-supplied request
data, matching every other organisation-scoped write in this codebase's
documented tenant-isolation discipline (C0-R Section H).

## 10. Resource type / id and source route/event

`resource_type` + `resource_id` together must be sufficient to answer
"show me every audit entry for this one commercial document" as a single,
already-indexed query (`@@index([resource_type, resource_id])` on
`AuditLog`) — `lib/events/auditLog.ts`'s convention of a single
`resource_type` value per audited entity (always `'event_order'`, never a
finer-grained sub-resource) is the pattern to follow: audit entries for a
document's line items, attachments, or sub-objects still use the parent
document's `resource_type`/`resource_id`, not their own, unless a future
feature has a genuine, demonstrated need to query them independently.
The originating route/event is implied by `action`'s namespace (Section
12) — no separate "source route" column is introduced.

## 11. Failure handling

- **Best-effort (non-transactional) writes**: wrapped in their own
  try/catch; a failure is logged via `console.error` with enough context
  to investigate (action, resource id) and MUST NOT fail, retry, or roll
  back the business-state mutation it describes — `lib/events/
  auditLog.ts`'s `insertAuditLog()` is the reference implementation.
- **Transactional (atomic CTE) writes**: a failure here IS a failure of
  the whole statement, by construction (both the business-state change
  and its audit entry are one atomic unit) — this is intentional for the
  cases Section 3 designates as requiring transactional alignment; the
  business-state change must not happen without its audit record in
  those specific cases.

## 12. Event naming convention

`<resource_type>.<verb>`, snake_case verb, past tense for something that
already happened (`quote.sent`, `invoice.paid`, `event_order.refunded`) —
matching every existing `action` value across both live patterns
(`lib/tennisSchedule.ts`, `lib/events/auditLog.ts`, and Phase C1.7's new
webhook actions). `resource_type` is always the literal noun a future
`WHERE resource_type = '...'` query would filter on — never abbreviated,
never pluralized.

## 13. Retention

No retention/purge policy is introduced by this ADR. `audit_logs` has no
existing TTL/archival mechanism anywhere in this codebase, and inventing
one is outside this narrowly-scoped standardisation task — noted here so
a future phase that DOES need one (e.g. for storage-cost or compliance
reasons) starts from an explicit acknowledgement that none exists today,
rather than discovering that gap mid-implementation.

## 14. What this ADR does not do

- Does not wire every existing application feature to `AuditLog` —
  standardisation for *future* commercial writes only, per the C1.8
  brief's own explicit scope.
- Does not delete `services/persistence.ts::writeAuditLog()` — deprecated
  and documented, not removed (Section 6).
- Does not introduce a competing audit table or a new generic helper
  module — reuses `audit_logs` and the two now-proven per-vertical
  patterns already in this codebase.
- Does not implement retention/purge policy (Section 13).
