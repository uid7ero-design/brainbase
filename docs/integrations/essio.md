# Essio integration (Brainbase side)

Status: **B3 — API surface complete for Essio M3B.** Essio can create
Organiser work, discover targets and read the status of the work it created,
with a per-organisation integration credential that a super_admin manages.
Timeline append is later. Nothing here is applied to Production by this branch.

Essio is HLNA Labs' visibility-evidence product. It hands accepted
recommendations to Brainbase as work. Essio's own contract is
`docs/BRAINBASE-INTEGRATION.md` in the Essio repository; this document covers
only how Brainbase implements its side.

## Ownership boundaries

| Brainbase owns (never set from Essio) | Essio owns (shown as source context) |
|---|---|
| work status, priority, assignee/owner, due date, comments, board/group placement after creation, the item's title and notes once created | the recommendation, its evidence, its priority band/score/confidence, its lifecycle |

The Essio priority band, score and confidence appear in the item's notes,
explicitly labelled as **Essio's evidence-based assessment, not a Brainbase
priority**. They never populate the Organiser priority field.

## Target mapping

An Essio site maps to a **Brainbase organisation + one Organiser board +
optional group**. The organisation is always the credential's; Essio stores the
board id (and group id) — never names, which are not unique. Discovery (below)
lists the valid targets.

## Credentials

### Model (`integration_credentials`, B1)

| Column | Notes |
|---|---|
| `id` | UUID, public part of the token |
| `organisation_id` | the only organisation the credential can act for; immutable |
| `integration_key` | `'essio'` (CHECK) |
| `label` | 1–120 chars, trimmed |
| `secret_hash`, `hash_version` | sha256 digest (v1); the plaintext is never stored |
| `scopes` | grantable: `work:create`, `work:read`, `targets:read` |
| `enabled` | reversible pause |
| `revoked_at`, `revoked_by` | terminal; a revoked credential cannot be re-enabled |
| `created_by`, `created_at`, `updated_at`, `last_used_at` | `last_used_at` is refreshed at most every 5 minutes, best effort |

Rows are never deleted and identity/organisation/secret columns are immutable
(trigger). `work:append` is reserved for timeline append and not grantable.
Lifecycle changes write an `audit_logs` row (`resource_type =
'integration_credential'`, `user_id` = the super_admin) in the same statement,
with no secret material.

### Token format and verification

```
bbint_<credential id: 32 lowercase hex>_<secret: 43 base64url chars>
```

The secret is 32 CSPRNG bytes; the stored digest is
`sha256_hex('bbint:v1:' || <credential id> || ':' || <secret>)`. Verification:
parse the public id → load exactly that row → constant-time secret check →
reject revoked, then disabled → organisation from the credential only →
required scope → `essio_integration` capability enabled for that organisation
→ typed principal. `CRON_SECRET` is not used.

### Super-admin management

All routes require `requireRole('super_admin')` (role and status re-read from
the database on every call; the JWT role claim alone is never trusted). Every
response is `Cache-Control: no-store`.

| Method & path | Body | Result |
|---|---|---|
| `GET /api/admin/integration-credentials?organisation_id=<org>` | — | `{ credentials: [...] }` — metadata only |
| `POST /api/admin/integration-credentials` | `{ organisation_id, label, scopes }` | `201 { credential, token, token_warning }` |
| `PATCH /api/admin/integration-credentials/<id>` | `{ organisation_id, action: "disable" \| "enable" \| "revoke" }` | `{ credential }` or `{ outcome, credential }` |

- `integration_key` is always `essio`; scopes must be grantable
  (`work:append` → `400 scope_reserved`, unknown → `400 scope_unknown`).
- The plaintext token appears **only** in the POST response, with
  `token_warning`: it is shown once and cannot be recovered. Lost tokens are
  revoked and replaced, never re-issued.
- List and lifecycle responses never contain a token or `secret_hash`.
- A credential can only be managed through its own organisation (`404`
  otherwise). Revoking twice returns `already_revoked`; enabling a revoked
  credential returns `409 revoked`.
- There is no admin UI yet (follow-up); the routes are the management path.

## Capability gate

`essio_integration` is a normal `modules` row
(`scripts/seed-essio-integration-capability.sql`), off for every organisation
until a super_admin enables it. Every Essio request needs **both** a valid
credential **and** the capability enabled for the credential's organisation.
It does not change any person's Organiser permissions.

## API (machine)

Base path `/api/integrations/essio/v1`. Headers:

```
Authorization: Bearer bbint_…            (required)
Essio-Contract-Version: 1                (optional; any other value → 400)
Idempotency-Key: <handoff id>            (create-work only; must equal handoff.idempotency_key)
Content-Type: application/json
```

Responses are JSON and `no-store`.

### Create work — `POST /work` (scope `work:create`)

Request (body ≤ 64 KiB, checked before parsing):

```json
{
  "target": { "board_id": "<uuid>", "group_id": "<uuid or null>" },
  "handoff": { "schema": "essio.recommendation-handoff", "version": 1, "idempotency_key": "<uuid>", "...": "the frozen Essio v1 document" }
}
```

- `handoff` is Essio's frozen v1 document, validated strictly: every key is
  known and required; unknown keys anywhere (AI wording, provider/model data,
  raw crawl or Search Console rows, …) are rejected; `wording_source` must be
  `deterministic`. Caps: title 300; summary/reason/suggested action 4,000;
  expected check 2,000; names 200; keys 300; ids 128; URLs 2,048 (http/https);
  target query 500; evidence ≤ 50 items with ≤ 8 numeric metrics each.
- `target.organisation_id` may be present but is never authority: if it is not
  the credential's organisation the target is reported as not found.
- The board must belong to the credential's organisation; the group (optional)
  must belong to that board and organisation.

Mapping to the Organiser item:

| Organiser | From |
|---|---|
| `name` | `content.title` |
| `notes` | summary, "Why:" reason, "Suggested action:", "How to check:", the labelled Essio assessment, target URL/query, evidence date, site, "Open in Essio:" deep link |
| `board_id`, `group_id` | `target` |
| `status` | Organiser default (`Not Started`) |
| `priority`, `owner`, `assignee_user_id`, `due_date` | **not set** (Brainbase-owned) |

The item, its `organiser_item_external_links` row and its `item.created`
activity are written by **one SQL statement** (one transaction). The activity
actor is the Essio system actor: `actor_user_id = NULL`, `actor_name =
"Essio"`, `metadata_json = { source: "essio", credential_id, idempotency_key,
external_recommendation_id, handoff_fingerprint, request_fingerprint }`. No
Essio user exists.

### Two fingerprints

| | Essio handoff fingerprint | Brainbase create-request fingerprint |
|---|---|---|
| Column | `handoff_fingerprint` | `request_fingerprint` |
| Over | the frozen Essio v1 `handoff` document | `{ "target": { "board_id", "group_id" }, "handoff" }` |
| Algorithm | `sha256(stableStringify(handoff))` — identical to the fingerprint Essio records | `sha256(stableStringify({ target, handoff }))`, ids lower-cased, absent `group_id` ≡ `null` |
| Meaning | identity/provenance: Brainbase received exactly this Essio snapshot | identity of the complete Brainbase creation instruction |
| Used for | provenance only | the replay/conflict decision |

`stableStringify` sorts object keys, so neither depends on JSON key order. The
request fingerprint contains only the request's own intent: no credential, no
organisation (never request authority) and no Brainbase-owned operational field.
The link also keeps `handoff_snapshot` (the exact Essio payload) and the
original `target_board_id` / `target_group_id`: Brainbase users may move the
item later, so its current placement is never treated as the original target.

Success (`201` created, `200` replay):

```json
{
  "version": 1,
  "created": true,
  "state": "linked",
  "idempotency_key": "6f1c2a4e-…",
  "work_item": { "id": "<uuid>", "url": "https://<brainbase>/organiser?board=<board uuid>", "status": "Not Started" },
  "accepted_at": "2026-10-03T07:50:00.000Z"
}
```

`work_item.id` is opaque. `url` is board-level (Brainbase has no item-level
link yet). `accepted_at` is when the request identity was first accepted
(unchanged on replays).

### Idempotency

Keyed on `(organisation, 'essio', idempotency_key)`; decided on the
create-request fingerprint (target + handoff):

| Situation | Response |
|---|---|
| first request | `201`, `created: true` — item, link and activity created atomically |
| same key, same target, same handoff (any key order) | `200`, `created: false`, same item — nothing written |
| same key, different handoff | `409 idempotency_conflict` — nothing changed |
| same key, same handoff, **different board** | `409 idempotency_conflict` — nothing changed |
| same key, same handoff, **different group** (or group added/removed) | `409 idempotency_conflict` — nothing changed |
| same key, identical request, item since deleted (or its board deleted) | `410 work_item_deleted`, `state: "item_deleted"`, `deleted_at` — **no replacement item** |
| same key, changed request, item since deleted | `409 idempotency_conflict` |
| concurrent duplicates | exactly one item, link and activity; the others replay |

**An idempotency key can never be reused to redirect the same handoff to
another board or group.** A replay is answered from the stored identity even if
the item was later moved or deleted. Another organisation's key is a different
identity (it never replays across organisations).

**For Essio M3B:** the Brainbase target (board and group) used for a queued
delivery is part of that delivery's immutable intent, exactly like the frozen
handoff. It must be fixed when the delivery is queued and must not silently
change between retries; changing the site's mapping afterwards applies to new
handoffs only (a retry with a different target is refused with `409`).

### Discovery — `GET /targets` (scope `targets:read`)

```json
{
  "version": 1,
  "organisation": { "id": "<org>", "name": "HLNA Labs" },
  "boards": [
    { "id": "<uuid>", "name": "Website", "groups": [ { "id": "<uuid>", "name": "Now" } ] }
  ]
}
```

Only the credential organisation's boards and groups, ids and names, ordered by
Organiser position, then name, then id. No items, users, colours or other data.

### Status read — `GET /work/<idempotency key>` (scope `work:read`)

Reads the state of work **Essio created**, addressed by the same Essio
idempotency key (the Essio handoff id) used to create it.

Why the key and not the Brainbase item id: Essio holds the key before delivery
and stores it anyway; it never changes; it is the unique identity of the
external link; and it survives deletion of the Organiser item (the link's item
id becomes `NULL` when the item is hard-deleted, so an item-id lookup could not
report a deleted item). One identifier, no alternatives.

The lookup is always constrained to the credential's organisation,
`source_system = 'essio'` and the key; the item is joined through the link.
Brainbase edits (moving board/group, renaming, priority, assignee, due date,
status) never break it: the link is authoritative for "the item Essio created".

Linked (`200`):

```json
{
  "version": 1,
  "state": "linked",
  "idempotency_key": "6f1c2a4e-…",
  "work_item": {
    "id": "<item uuid>",
    "status": { "raw": "Working on it", "category": "in_progress" },
    "updated_at": "2026-10-05T01:02:03.000Z",
    "url": "https://<brainbase>/organiser?board=<current board uuid>"
  }
}
```

Deleted (`200` — the surviving link proves the work existed; nothing is recreated):

```json
{
  "version": 1,
  "state": "item_deleted",
  "idempotency_key": "6f1c2a4e-…",
  "work_item": { "id": null, "deleted_at": "2026-10-06T09:00:00.000Z" }
}
```

- **Status categories** (raw Organiser text is always returned unchanged; the
  Organiser status model is not changed): `Not Started` → `not_started`,
  `Working on it` → `in_progress`, `Stuck` → `blocked`, `Done` → `done`
  (case and surrounding whitespace ignored); anything else, including custom
  text, → `other`.
- **`updated_at`** is the Organiser item's application-maintained
  `updated_at` (set by Brainbase routes; no database trigger). It is a
  change hint, not a strict monotonic row version.
- **`url`** is the board-level Organiser URL of the item's *current* board.
- **Minimal response:** never notes, title, owner, assignee, priority, due
  date, comments, users, group, snapshot, fingerprints, credential or
  organisation data.
- **404 `work_not_found`** for an unknown key, a malformed key, another
  organisation's key, or any Organiser item not created through this Essio
  integration — all identical, so existence of other items is never revealed.
- Read only: a status read writes nothing (apart from the credential's
  throttled `last_used_at`).

### Errors

Envelope: `{ "error": { "code": "…", "message": "…" } }` (+ `details` paths for
`invalid_payload`, `idempotency_key`/`state` where relevant). Never SQL, table
names, stack traces, credential ids or secrets.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_json`, `invalid_payload`, `idempotency_key_mismatch`, `unsupported_contract_version` | malformed request |
| 401 | `invalid_credentials` (+ `WWW-Authenticate: Bearer`) | missing, malformed, unknown, wrong, disabled or revoked credential — indistinguishable |
| 403 | `insufficient_scope` | credential lacks the scope |
| 403 | `integration_disabled` | `essio_integration` not enabled for the organisation |
| 404 | `target_not_found`, `target_group_not_found` | board/group not in the credential's organisation/board |
| 404 | `work_not_found` | status read: no Essio work for this key in the credential's organisation |
| 409 | `idempotency_conflict` | same key, different request (handoff, board or group) |
| 409 | `idempotency_key_unavailable` | identity exists without an item (not produced by this API) |
| 410 | `work_item_deleted` | the item created for this key was deleted |
| 413 | `payload_too_large` | body over 64 KiB |
| 503 | `unavailable` | database unavailable (nothing was written) |

### Rate limiting

Not applied. Brainbase's only limiter (`lib/rateLimit.ts`) is an in-memory map
per serverless instance, which is not a meaningful bound for machine traffic,
so it is deliberately not reused. Exposure is limited to authenticated,
capability-gated, per-organisation credentials that a super_admin issues.
A shared (database/edge) limiter is a production-hardening follow-up.

## External link identity (`organiser_item_external_links`, B1)

- `UNIQUE (organisation_id, source_system, idempotency_key)`; `source_system`
  is `'essio'`.
- `(organisation_id, organiser_item_id) → organiser_items(organisation_id, id)`
  and `(organisation_id, credential_id) → integration_credentials(organisation_id, id)`.
- Stores `external_recommendation_id`, `source_url` (deep link),
  `handoff_fingerprint`, `request_fingerprint`, `handoff_snapshot` (exact
  payload), `target_board_id`, `target_group_id` (original creation target,
  no FK), `created_at`, `item_deleted_at`. An item belongs to at most one link.
  Rows are never deleted; identity (including both fingerprints and the
  target) is immutable.
- Organiser items are hard-deleted: the FK is `ON DELETE SET NULL
  (organiser_item_id)`, the trigger stamps `item_deleted_at`, and a deleted
  link can never be re-pointed or given a replacement item.

## A0.1A repository/Production drift

Production has `organiser_items_organisation_id_id_key UNIQUE (organisation_id,
id)` (verified read-only, Essio B0), used by `assurance_action_tasks`; no
repository step created it. `scripts/create-organiser-items-org-id-key-a01a.sql`
is that step: a no-op when any equivalent uniqueness exists (Production),
otherwise it adds the constraint under the Production name; it never modifies
data and fails clearly on duplicates or a conflicting name.

## Migrations and verification

Order: `create-organiser-items-org-id-key-a01a.sql` →
`create-essio-integration-b1.sql` → `seed-essio-integration-capability.sql`
(idempotent; PostgreSQL 15+). B2 and B3 add no schema.

- `scripts/tests/verify-essio-integration-b1.sh` — migration scenarios +
  credential/link/actor suite.
- `scripts/tests/verify-essio-integration-b2.sh` — the API routes against the
  real schema (create, replay, conflict, concurrency, deletion, isolation,
  validation, injected failures, discovery, admin lifecycle).
- `scripts/tests/verify-essio-integration-b3.sh` — status read (linked,
  deleted, moved/edited items, status categories, isolation, auth).
- All use `scripts/tests/essio-integration-base-schema.sql` and a disposable
  Docker Postgres 17.

## Follow-ups

- Super-admin UI for credentials (the API exists).
- Shared rate limiter for machine routes.
- Timeline append (`work:append`), item-level deep links: later.
- Production rollout: apply the three migrations (A0.1A is a no-op there),
  enable `essio_integration` only for the organisation that will use it, then
  issue a credential through the admin route.
