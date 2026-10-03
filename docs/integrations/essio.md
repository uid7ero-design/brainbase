# Essio integration (Brainbase side)

Status: **B1 — foundation only.** Machine credentials, the `essio_integration`
capability, the Organiser external-link identity and the system actor exist as
schema + internal services. **No route exposes them yet** (create-work,
discovery and status read are B2/B3). Nothing here is applied to Production by
the B1 branch.

Essio is HLNA Labs' visibility-evidence product. It hands accepted
recommendations to Brainbase as work. Essio's own contract is
`docs/BRAINBASE-INTEGRATION.md` in the Essio repository; this document covers
only how Brainbase implements its side.

## Target mapping

An Essio site maps to a **Brainbase organisation + one Organiser board +
optional group**. Brainbase has no "workspace" or "project" container for
Organiser work. Essio stores the board id (never the name — board names are not
unique). Boards can be hard-deleted, so B2 must report a missing board cleanly.

## Machine credentials (`integration_credentials`)

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

Rows are never deleted (trigger). Identity, organisation and secret columns are
immutable (trigger). `work:append` is **reserved** for timeline append
(B4/M3E): named in code, rejected by the service and excluded by the DB CHECK.

Lifecycle changes (created / disabled / enabled / revoked) write an
`audit_logs` row in the same statement, with `resource_type =
'integration_credential'` and no secret material.

### Token format

```
bbint_<credential id: 32 lowercase hex>_<secret: 43 base64url chars>
```

The secret is 32 bytes from the CSPRNG. Stored digest:
`sha256_hex('bbint:v1:' || <credential id> || ':' || <secret>)`. A fast hash is
appropriate for a 256-bit random secret; binding the id means a digest copied
onto another row never verifies. The plaintext token is returned exactly once,
by `createIntegrationCredential`, and never logged, audited or included in an
error. `CRON_SECRET` is not used.

### Verification (`authenticateIntegrationCredential`)

1. parse the public credential id (strict shape; otherwise `MALFORMED`)
2. load exactly that row (no scanning)
3. verify the secret in constant time (`lib/secureCompare`); an unknown id does
   the same hashing work
4. reject revoked, then disabled credentials
5. take the organisation **only** from the credential row — the function has
   no organisation parameter, and the returned principal is frozen
6. require the requested scope
7. require the `essio_integration` capability for that organisation
8. return `IntegrationPrincipal { kind: 'integration', credentialId,
   organisationId, integrationKey, scopes, label }`

Failure reasons are for server-side use. Routes must map them with
`toPublicIntegrationAuthError`: every credential problem is the same `401
invalid_credentials`; missing scope and disabled capability are `403`;
infrastructure is `503`.

## Capability gate

`essio_integration` is a normal `modules` row (`scripts/seed-essio-integration-capability.sql`),
off for every organisation until a super_admin enables it in /admin/orgs.
Access requires **both** a valid credential **and** the capability enabled for
the credential's organisation. It does not change Organiser permissions for
people.

## External link identity (`organiser_item_external_links`)

A typed link from one external request to the Organiser item it created (not a
polymorphic `entity_type/entity_id` relation).

- `UNIQUE (organisation_id, source_system, idempotency_key)` — the request
  identity. `source_system` is `'essio'` (CHECK); the Essio idempotency key is
  the Essio handoff id.
- `(organisation_id, organiser_item_id) → organiser_items(organisation_id, id)`
  and `(organisation_id, credential_id) → integration_credentials(organisation_id, id)`:
  same-organisation references enforced by the database.
- `external_recommendation_id`, `source_url` (Essio deep link, http(s) only),
  `handoff_snapshot` (the exact Essio payload, ≤ 256 KiB), `created_at`,
  `item_deleted_at`.
- Two fingerprints, never overloaded:
  - `handoff_fingerprint` — identity/provenance of the frozen Essio payload
    (sha256 hex, equal to the fingerprint Essio records);
  - `request_fingerprint` — identity of the complete Brainbase creation
    instruction (target + handoff). Replay vs conflict is decided on this one,
    so an idempotency key can never redirect the same handoff to another
    board or group.
- `target_board_id` / `target_group_id` — the original creation target (no FK).
  Brainbase users may move the item later; its current placement is never
  treated as the original target.
- An item belongs to at most one link (partial unique index).
- Rows are never deleted; identity columns — including both fingerprints and
  the target — are immutable (trigger).

### Deletion

Organiser items are hard-deleted. The item FK is `ON DELETE SET NULL
(organiser_item_id)`: the link and its `organisation_id` stay, and the trigger
stamps `item_deleted_at`. A deleted link can never be re-pointed or given a
replacement item, so a retry after deletion is recognised as the same request
(`itemState: 'item_deleted'`) instead of creating new work. While the item
exists, the composite FK keeps the link in the same organisation (and blocks
moving a linked item to another organisation).

### Idempotency (`claimOrganiserItemExternalLink`)

Insert-first (`ON CONFLICT … DO NOTHING`), scoped to the principal's
organisation and integration:

| Result | Meaning | B2 response |
|---|---|---|
| `created` | first time this key is seen | create the item and attach it |
| `replayed` | same key, same request fingerprint | return the existing item (or "deleted") |
| `fingerprint_conflict` | same key, different request (payload and/or target) | refuse (409), no side effects |

Concurrent claims of one key produce exactly one row. B2 attaches the item in
one statement guarded by `organiser_item_id IS NULL AND item_deleted_at IS
NULL` (pattern proven in the B1 harness), so a crash between claim and create
leaves an `unattached` identity that a retry can complete, and never two items.

## System actor

`lib/organiser/systemActor.ts` formalises ADR-0003 §5 for integration writes:
`actor_user_id = NULL`, `actor_name = 'Essio'`, `metadata.source = 'essio'`
(+ `credential_id`), and for `audit_logs` `user_id = NULL` with
`after_state.source = 'essio'`. No Essio user account exists or is created; an
integration write is never attributed to a person.

## A0.1A repository/Production drift

Production has `organiser_items_organisation_id_id_key UNIQUE (organisation_id,
id)` (verified read-only, Essio B0) and `assurance_action_tasks` already uses
it, but no repository step created it. `scripts/create-organiser-items-org-id-key-a01a.sql`
is that step: a no-op when any equivalent uniqueness exists (Production keeps
its constraint untouched), otherwise it adds the constraint under the
Production name; it never modifies data and fails clearly on duplicate data or
a conflicting name.

## Migrations and verification

Order: `create-organiser-items-org-id-key-a01a.sql` →
`create-essio-integration-b1.sql` → `seed-essio-integration-capability.sql`.
All are idempotent and require PostgreSQL 15+ (Production is 17).

`scripts/tests/verify-essio-integration-b1.sh` (disposable Docker Postgres 17)
proves: repo-style and Production-like schemas, equivalent-index, name-clash,
duplicate-data and missing-A0.1A cases, idempotent reruns, then the service and
database suite `scripts/tests/essioIntegrationB1.integration.test.ts`.

## Dependencies for B2

- An admin surface (super_admin) to create, list, disable and revoke
  credentials using the B1 service (shows the token once).
- Routes: create work (`work:create`), board/group discovery (`targets:read`),
  status read (`work:read`, B3) — each calling
  `authenticateIntegrationCredential` and `toPublicIntegrationAuthError`,
  validating input length/shape, and returning sanitised errors.
- Create work: claim the link, then create the item, its `item.created`
  activity (system actor) and the attachment in one statement; map Essio
  content to `name`/`notes`; leave priority, assignee and due date to
  Brainbase users.
- Apply the three migrations to Production (A0.1A is a no-op there), then
  enable `essio_integration` only for the organisation that will use it.
