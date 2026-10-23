# Copies of Production data — inventory, rule and cleanup proposal

Status: PROPOSAL (2026-10-24). Nothing has been deleted. Every deletion below needs
separate operator approval. Required before Eve collects Production registration
answers (ADR 0013 §4b, Decision 4).

## Why this matters

The answer-retention job removes answers in the Production database only. A Neon
branch or snapshot taken from Production is a full, independent copy: deleting or
redacting an answer in Production never reaches it. The Privacy Policy may only
say "deleted information may remain in our controlled backups for a limited
period" if every copy we control has a bounded life.

## Inventory (Neon project `brainbase-db`, read 2026-10-23)

Point-in-time history: **6 hours** (`history_retention_seconds = 21600`) — a
redacted answer leaves PITR within 6 hours.

### Branches copied from Production (21, plus `production` itself)

| Branch | Kind | Created | State | Proposed action |
|---|---|---|---|---|
| production | live | 2026-04-28 | ready | keep |
| migration-backup/scheduling-2b2-pre-20261023 | migration backup | 2026-10-23 | ready | expire 30 days after the 2B.2 migration is verified |
| migration-backup/scheduling-2b0-pre-20261023 | migration backup (protected) | 2026-10-23 | ready | expire 30 days after 2B.0 verified; unprotect then |
| migration-backup/scheduling-2a-pre-20261022 | migration backup (protected) | 2026-10-22 | ready | expire 30 days after 2A verified; unprotect then |
| temp/scheduling-resource-concurrency-proof-20261023 | proof | 2026-10-23 | ready | delete once that proof is reported (owner to confirm) |
| temp/eve-phase3-1-product-surface-proof | proof | 2026-10-17 | ready | delete (proof reported, PR merged) |
| temp/d4c-b2b1-migration-proof-20261006 | proof | 2026-10-06 | archived | delete |
| assurance-incidents-investigations-proof | proof | 2026-10-07 | archived | delete once PR #398 is closed/merged (owner to confirm) |
| rollback/post-credential-rotation-20261001 | rollback point | 2026-10-01 | archived | delete (rotation verified 2026-10-01) |
| vercel-dev | Vercel dev | 2026-09-04 | archived | delete; recreate from masked data if needed |
| preview/feat/eve-registration-questions | Vercel Preview | 2026-10-23 | ready | delete when PR #483 closes |
| preview/docs/datahub-pilot-v2-mapping-proposal | Vercel Preview | 2026-10-23 | ready | delete when its PR closes |
| preview/docs/scheduling-phase2b2-plan | Vercel Preview | 2026-10-23 | ready | delete when its PR closes |
| preview/feat/scheduling-enablement-sql-settings | Vercel Preview | 2026-10-23 | ready | delete when its PR closes |
| preview/fix/crm-contact-duplicate-prevention | Vercel Preview | 2026-10-22 | ready | delete when its PR closes |
| preview/docs/scheduling-phase2b1-plan | Vercel Preview | 2026-10-22 | ready | delete when its PR closes |
| preview/feat/eve-launch-compliance | Vercel Preview | 2026-10-21 | ready | delete (merged) |
| preview/fix/ld-tennis-booking-capacity-race | Vercel Preview | 2026-10-21 | ready | delete when its PR closes |
| preview/feat/assurance-incidents-investigations | Vercel Preview | 2026-10-07 | archived | delete |
| preview/feat/hr7h1-lifecycle-workload-overview-ui | Vercel Preview | 2026-10-06 | archived | delete |
| preview/feat/hr7e8b-employee-document-upload-ui | Vercel Preview | 2026-10-05 | archived | delete |
| preview/feat/hr7e7b-employee-acknowledgement-ui | Vercel Preview | 2026-10-05 | archived | delete |

"Owner to confirm" = the branch belongs to another workstream (scheduling, HR,
assurance, CRM, Data Hub); its PR state must be checked before deletion.

### Manual snapshots (3, no expiry set)

| Snapshot | Created | Purpose | Proposed delete-by |
|---|---|---|---|
| c1-pre-production-migration-2026-09-04 | 2026-09-04 | C1 migration rollback point (verified long ago) | now (on approval) |
| pre-eve-launch-compliance-migrations-2026-10-19 | 2026-10-19 | Eve compliance migration rollback point | 2026-11-18 |
| pre-eve-live-1-dollar-proof-2026-10-22 | 2026-10-22 | live $1 proof rollback point | 2026-11-21 |

## Proposed rule (to adopt before Eve collects Production answers)

1. **Preview branches** — created by the Vercel integration per PR. Delete when
   the PR merges or closes; never older than 14 days (set a Neon branch expiry on
   creation). Target state: Preview branches are created from a masked
   `preview-base` branch (registration answers, purchaser/attendee details and
   notes replaced with synthetic values), not from Production.
2. **Migration-backup branches and snapshots** — name states the migration and
   date; delete-by date recorded here; default 30 days after the migration is
   verified; a protected flag is removed at expiry.
3. **Temporary / proof branches** — deleted when the proof is reported, at most
   7 days.
4. **Incident investigation copies** — only under a legal hold, recorded here with
   the hold reason; deleted when the hold is cleared.
5. **Once Production holds sensitive registration answers** — no new
   Production-derived copy except (2) or (4); everything else uses masked or
   synthetic data. Any Production-derived copy older than 30 days is a breach of
   this rule and is reported. The inventory above is re-checked monthly.

With this rule, a removed answer survives in our copies for at most ~30 days
(migration backups) plus 6 hours (PITR), which is what "a limited period" in the
Privacy Policy means. Organiser-made copies (screenshots, spreadsheets) are the
organiser's responsibility under its own privacy practices.
