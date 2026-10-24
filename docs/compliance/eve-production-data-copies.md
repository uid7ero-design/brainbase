# Copies of Production data — inventory, cleanup plan and operating standard

**Status:** Operating direction approved 2026-10-24. Group A was fully deleted on
2026-10-24 (see the cleanup log). Group B awaits
owner decisions; silence is not approval. The standard is **not** enforced automatically
across other workstreams without owner review. This must be in place, to the extent needed
to make the Privacy Policy's backup statement true, **before** the Eve registration-questions
migration is applied (ADR 0013 §4b; release runbook gate).

## Why

The answer-retention job removes answers in the Production database only. A Neon branch
or snapshot taken from Production is a full, independent copy, so removing an answer in
Production never reaches it. The Privacy Policy may only say "deleted information may
remain in our controlled backups for a limited period before those copies expire" if
every copy we control has a bounded, enforced life.

## Inventory (Neon project `brainbase-db` / `empty-fire-62164682`, read 2026-10-24)

Every branch below was created from `production` (`br-lingering-bird-a7aif5zw`) and has
**no child branches**, so no branch blocks deleting another. Every one was created after
Production held live booking/purchaser data, so all **contain current-era Production
personal data** (orders, purchasers/attendees; from 2026-08-30 also School Test
registration answers). Point-in-time history (PITR) on `production`: **6 hours**.

PR states read from GitHub on 2026-10-24.

| # | Name / id | Type | Created | Owner / workstream | Personal data | Still needed | Proposed delete | Protected | Group |
|---|---|---|---|---|---|---|---|---|---|
| 1 | preview/feat/eve-launch-compliance · br-rough-mode-a7kh690l | Preview | 2026-10-21 | Eve | yes | no — PR #455 merged 2026-10-21 | **DELETED 2026-10-24** | no | **A** |
| 2 | preview/feat/hr7e7b-employee-acknowledgement-ui · br-solitary-mud-a7q1iq74 (archived) | Preview | 2026-10-05 | HR | yes | no — PR #331 closed 2026-10-06 | **DELETED 2026-10-24** | no | **A** |
| 3 | temp/eve-phase3-1-product-surface-proof · br-solitary-king-a79pas6t | proof | 2026-10-17 | Eve | yes | no — proof reported, work merged | **DELETED 2026-10-24** | no | **A** |
| 4 | snap-odd-math-a7unns1t · c1-pre-production-migration-2026-09-04 | snapshot | 2026-09-04 | Commercial (C1) | yes | no — C1 migration verified long ago | **DELETED 2026-10-24** | n/a | **A** |
| 5 | preview/fix/scheduling-reservation-integrity · br-withered-snow-a7xze8gz | Preview | 2026-10-23 | Scheduling | yes | — | **gone** — absent from the 2026-10-24 re-list; removed outside this cleanup | no | **B** |
| 6 | preview/feat/scheduling-phase2b2c-dashboard · br-morning-tree-a7gshdt2 | Preview | 2026-10-23 | Scheduling | yes | — | **gone** — absent from the 2026-10-24 re-list; removed outside this cleanup | no | **B** |
| 7 | preview/docs/scheduling-phase2b2-plan · br-still-mountain-a7p5p3qp | Preview | 2026-10-23 | Scheduling | yes | no — PR #477 **merged** 2026-10-24 | owner — now | no | **B** |
| 8 | preview/docs/datahub-pilot-v2-mapping-proposal · br-royal-king-a75w342t | Preview | 2026-10-23 | Data Hub | yes | while PR #480 open | PR close, max 2026-11-06 | no | **B** |
| 9 | preview/fix/crm-contact-duplicate-prevention · br-nameless-queen-a7h1dx3f | Preview | 2026-10-22 | CRM | yes | while PR #472 (draft) open | PR close, max 2026-11-05 | no | **B** |
| 10 | preview/feat/scheduling-enablement-sql-settings · br-empty-thunder-a7vgbzga | Preview | 2026-10-23 | Scheduling | yes | while PR #476 (draft) open | PR close, max 2026-11-06 | no | **B** |
| 11 | preview/docs/scheduling-phase2b1-plan · br-floral-bird-a7dqcjx2 | Preview | 2026-10-22 | Scheduling | yes | owner — no PR found | owner / max 2026-11-05 | no | **B** |
| 12 | preview/fix/ld-tennis-booking-capacity-race · br-floral-star-a70xop1v | Preview | 2026-10-21 | LD Tennis | yes | while PR #462 (draft) open | PR close, max 2026-11-04 | no | **B** |
| 13 | preview/feat/assurance-incidents-investigations · br-lively-credit-a7e3yss6 (archived) | Preview | 2026-10-07 | Assurance | yes | PR #398 still open; already >14 days | owner — now or PR close | no | **B** |
| 14 | assurance-incidents-investigations-proof · br-nameless-frog-a7g3g75x (archived) | proof | 2026-10-07 | Assurance | yes | owner — proof for PR #398 | owner — now | no | **B** |
| 15 | preview/feat/hr7h1-lifecycle-workload-overview-ui · br-solitary-mode-a7jz7sx6 (archived) | Preview | 2026-10-06 | HR | yes | owner — no PR found | owner — now | no | **B** |
| 16 | preview/feat/hr7e8b-employee-document-upload-ui · br-lingering-darkness-a7bz59r6 (archived) | Preview | 2026-10-05 | HR | yes | owner — no PR found | owner — now | no | **B** |
| 17 | temp/scheduling-resource-concurrency-proof-20261023 · br-dry-hat-a776i1ru | proof | 2026-10-23 | Scheduling | yes | — | **gone** — absent from the 2026-10-24 re-list; removed outside this cleanup | no | **B** |
| 18 | temp/d4c-b2b1-migration-proof-20261006 · br-solitary-voice-a7kc1tb1 (archived) | proof | 2026-10-06 | Data Hub | yes | owner — 18 days old | owner — now | no | **B** |
| 19 | rollback/post-credential-rotation-20261001 · br-sparkling-truth-a7j0qisk (archived) | rollback | 2026-10-01 | Platform ops | yes | owner — confirm no open rotation follow-up needs it | owner — now | no | **B** |
| 20 | preview/feat/eve-registration-questions · br-polished-dust-a7iw42u3 | Preview | 2026-10-23 | Eve | yes | yes — PR #483 open (draft) | PR close, max 2026-11-06 | no | **C** |
| 21 | migration-backup/scheduling-2b2-pre-20261023 · br-holy-snow-a72pqc7e | migration backup | 2026-10-23 | Scheduling | yes | yes — rollback point | 30 days after 2B.2 verified (≈2026-11-22) | no | **C** |
| 22 | snap-icy-firefly-a7m0b8os · pre-eve-launch-compliance-migrations-2026-10-19 | snapshot | 2026-10-19 | Eve | yes | yes — rollback point | 2026-11-18 | n/a | **C** |
| 23 | snap-rapid-queen-a78cx09w · pre-eve-live-1-dollar-proof-2026-10-22 | snapshot | 2026-10-22 | Eve | yes | yes — rollback point | 2026-11-21 | n/a | **C** |
| 24 | migration-backup/scheduling-2a-pre-20261022 · br-quiet-river-a722xo9q | migration backup | 2026-10-22 | Scheduling | yes | yes — rollback point | unprotect + delete 30 days after 2A verified (≈2026-11-21) | **yes** | **D** |
| 25 | migration-backup/scheduling-2b0-pre-20261023 · br-muddy-bread-a7wkhazl | migration backup | 2026-10-23 | Scheduling | yes | yes — rollback point | unprotect + delete 30 days after 2B.0 verified (≈2026-11-22) | **yes** | **D** |
| 26 | vercel-dev · br-delicate-wind-a7ja54b8 (archived) | dev | 2026-09-04 | Platform (Vercel Development env) | yes | **investigate** — check whether the Vercel Development environment's DATABASE_URL still points here before deleting | after investigation | no | **D** |

| 30 | rehearse/scheduling-032-after-031-20261024 · br-muddy-mode-a724td4r | proof | 2026-10-24 | Scheduling | yes | yes — active 030/031/032 rehearsal, kept pending owner review | max 2026-10-31 (owner decision pending) | no | **B** |

#30: parent `production`, no children, no Vercel DB setting.

#27–#29 were added on 2026-10-24 and were gone by the hold-phase re-list the same day. They are no longer active copies; see the cleanup log.

Not a copy: `production` itself (kept).

### Groups and recommended batches

- **A — safe to delete now (on approval): #1, #2, #3, #4.** Finished work with a merged or closed PR or a verified migration, and no other user. **Recommended first batch.**
- **B — needs owner approval: #5–#19 and #30.** These belong to other workstreams' open, missing or unclear PRs, proofs or rollback points. Ask each owner. Anything already over 14 days old, or with no PR (#6, #11, #13–#16, #18, #19), should be deleted unless the owner gives a reason.
- **C — retain temporarily, with dates: #20–#23.** Live rollback points and the open PR #483 preview. Delete on the dates shown.
- **D — protected or investigate: #24–#26.**
  - Protected migration backups must be unprotected on their date, then deleted.
  - `vercel-dev` needs a check of the Vercel Development environment first.

Before any deletion: re-list branches (names change as PRs open and close), confirm the PR state, and record the deletion here. Deleting a Preview branch for an **open** PR removes that PR's Preview database, so do it at PR close.

## Cleanup log

### 2026-10-24 — Group A

Pre-delete checks for each item:
- the exact id was re-listed;
- no branch has it as parent (every non-production branch's parent is `production`);
- Vercel env var scopes were read by name only with `vercel env ls` (`brainbase` and `eve` projects);
- the PR/work state was read from GitHub.

| Item | Purpose | Created | Work state | Vercel reference | Outcome |
|---|---|---|---|---|---|
| br-solitary-king-a79pas6t · temp/eve-phase3-1-product-surface-proof | Eve 3.1 product_surface proof | 2026-10-17 | merged (7c5cbf3c on main) | none | **deleted** |
| snap-odd-math-a7unns1t · c1-pre-production-migration-2026-09-04 | C1 pre-migration rollback point | 2026-09-04 | C1 verified | n/a (snapshot) | **deleted** |
| br-rough-mode-a7kh690l · preview/feat/eve-launch-compliance | PR #455 Preview DB | 2026-10-21 | PR merged 2026-10-21; later commits on the branch are all on main (#468) | removed first (below) | **deleted 2026-10-23T23:58Z** |
| br-solitary-mud-a7q1iq74 · preview/feat/hr7e7b-employee-acknowledgement-ui | PR #331 Preview DB | 2026-10-05 | PR closed unmerged 2026-10-06 | removed first (below) | **deleted 2026-10-23T23:58Z** |

The two Preview branches were first held because the Neon integration had not removed their branch-scoped Vercel vars on PR close.

Approved the same day, these were removed:
- Command: `vercel env rm <key> preview <branch>`, run 2026-10-23T23:56:49Z–23:56:58Z.
- Project: `brainbase` only.
- Entries: all integration-managed, `icfg_GE0tnru22Wz5NmKlUcJgFa87`.

| Env entry id | Key | Scope |
|---|---|---|
| b3tYQ1a0QEZ9qt4v | DATABASE_URL | Preview · feat/eve-launch-compliance |
| Z4HiIGYTDuoIygbX | DATABASE_URL_UNPOOLED | Preview · feat/eve-launch-compliance |
| sbhmzrZuu6JHrcC1 | DATABASE_URL | Preview · feat/hr7e7b-employee-acknowledgement-ui |
| ns3cJjPDpSnIfwXj | DATABASE_URL_UNPOOLED | Preview · feat/hr7e7b-employee-acknowledgement-ui |

Checks after the env removal, before deleting:
- Neither branch has a DB var left.
- Production, Development and all other Preview DB vars are unchanged.
- No deployment was created by the env change.
- Neither Neon branch has a child.

Not changed:
- non-DB vars still scoped to feat/eve-launch-compliance in `brainbase` and `eve`;
- the git branches.

The old feat/eve-launch-compliance Preview deployments (last built 2026-10-22) lost their database. They are superseded previews of a merged PR, not aliased to production.

Post-delete verification:
- `production` is present and still restricted from deletion.
- Read-only baseline equals 2026-10-23: 6 events, 41 orders, 6 questions, 14 responses; answers_md5 `2aeccf4f8c51a8afdcba1d77d88d6d3c`; questions_md5 `460bea39ba500c494b2a8e3e47a96759`.
- 20 non-production branches and 2 snapshots remain. Every other item is unchanged.
- `br-dry-hat-a776i1ru` (#17) was already absent, and was not deleted by this cleanup.
- Re-checked 2026-10-23T23:58Z after the last two deletions:
  - same baseline and checksums;
  - `production` present;
  - 20 non-production branches + 2 snapshots remain;
  - Groups C/D and the PR #483 Preview are untouched.
- #5 and #6 had also disappeared, removed outside this cleanup. #27–#29 were new at that point.

### 2026-10-24 — hold-phase re-list (read-only; nothing deleted by this workstream)

Neon now has 19 non-production branches and 2 snapshots.

Copies gone since the cleanup, all removed outside this workstream:

| # | Item | What happened |
|---|---|---|
| 27 | preview/fix/scheduling-schedule-archive-race · br-sweet-waterfall-a7sgevio | Preview for PR #486. #486 merged 2026-10-24; the integration removed the branch and its Vercel DB settings. |
| 28 | rehearse/scheduling-030-031-20261024 · br-quiet-river-a7m9vn0v | Deleted 2026-10-24 by the Scheduling workstream (owner brief). |
| 29 | rehearse/scheduling-030-031-rollback-copy-20261024 · br-bitter-recipe-a76cfqh7 | Child of #28; deleted with it. The #28 → #29 dependency no longer applies. |

Other changes:
- PR #477 merged 2026-10-24. Its Vercel DB settings were removed; Neon branch #7 remains.
- New: #30 `br-muddy-mode-a724td4r`.

### Orphan configuration (no cleanup approved)

The `brainbase` project has a Vercel Preview `DATABASE_URL_UNPOOLED` scoped to `test/c73c74-smoke-202609231055`:
- Entry `orrMR0gyLnt6YCEJ`, managed by the Neon integration, created 2026-09-23.
- There is **no matching Neon branch**.

Facts:
- The same scope also holds `COMMERCIAL_BLOB_STORE_ID` and `COMMERCIAL_BLOB_READ_WRITE_TOKEN` (sensitive, set by hand).
- The stale git branch still exists on origin. Its tip `f7e5872a` is the #250 merge commit, so it holds no unique work; no PR.
- One old READY Preview deployment exists (`dpl_5ARBUtKTA4tFkHJSLRbX9kCUXaZi`, 2026-09-23), plus one cancelled. None since.

If cleanup is approved later:
1. remove all three settings in that scope;
2. then delete the git branch.

### Group B — owner actions (re-read 2026-10-24; nothing deleted)

Owner decision is **NOT GIVEN** for every row. Silence is not approval.

| # | Branch | Owner | PR | Age | Vercel Preview DATABASE_URL | Documented purpose | Recommended action | Owner decision |
|---|---|---|---|---|---|---|---|---|
| 5 | br-withered-snow-a7xze8gz | Scheduling | #484 merged 10-23 | — | none | — | already gone (no action) | n/a |
| 6 | br-morning-tree-a7gshdt2 | Scheduling | #485 | — | none | — | already gone (no action) | n/a |
| 7 | br-still-mountain-a7p5p3qp | Scheduling | #477 merged 10-24 | 1 d | none (removed on merge) | none | **delete** | NOT GIVEN |
| 8 | br-royal-king-a75w342t | Data Hub | #480 open | 1 d | yes | PR Preview | retain until PR close, max 2026-11-06 | NOT GIVEN |
| 9 | br-nameless-queen-a7h1dx3f | CRM | #472 open draft | 2 d | yes | PR Preview | retain until PR close, max 2026-11-05 | NOT GIVEN |
| 10 | br-empty-thunder-a7vgbzga | Scheduling | #476 open draft | 1 d | yes | PR Preview | retain until PR close, max 2026-11-06 | NOT GIVEN |
| 11 | br-floral-bird-a7dqcjx2 | Scheduling | none found | 2 d | yes | none | **investigate** — owner gives reason + expiry, else delete by 2026-11-05 | NOT GIVEN |
| 12 | br-floral-star-a70xop1v | LD Tennis | #462 open draft | 3 d | yes | PR Preview | retain until PR close, max 2026-11-04 | NOT GIVEN |
| 13 | br-lively-credit-a7e3yss6 | Assurance | #398 open, idle since 10-07 | 17 d | yes | PR Preview, >14 d | owner gives reason + expiry, else **delete** | NOT GIVEN |
| 14 | br-nameless-frog-a7g3g75x | Assurance | proof for #398 | 17 d | none | proof, >7 d | owner gives reason + expiry, else **delete** | NOT GIVEN |
| 15 | br-solitary-mode-a7jz7sx6 | HR | none found | 18 d | yes | none, >14 d | **delete** unless the owner gives a reason | NOT GIVEN |
| 16 | br-lingering-darkness-a7bz59r6 | HR | none found (related #335 merged 10-05) | 19 d | yes | none, >14 d | **delete** unless the owner gives a reason | NOT GIVEN |
| 18 | br-solitary-voice-a7kc1tb1 | Data Hub | related #296 merged 09-29 | 18 d | none | proof, >7 d | **delete** unless the owner gives a reason | NOT GIVEN |
| 19 | br-sparkling-truth-a7j0qisk | Platform ops | rollback for the 2026-10-01 credential rotation | 23 d | none | rollback, no documented hold | **investigate** — owner records a hold, else delete | NOT GIVEN |
| 30 | br-muddy-mode-a724td4r | Scheduling | 030/031/032 rehearsal (#486 merged 10-24) | 0 d | none | active proof | retain through 2026-10-31 max, then delete | NOT GIVEN |

Where a Preview row has an env var, remove the branch-scoped var (or the git branch) in the same step as the Neon delete.

### Group C — retained, with dates

| Item | Delete on |
|---|---|
| br-polished-dust-a7iw42u3 (PR #483 Preview) | when PR #483 closes |
| br-holy-snow-a72pqc7e (Scheduling 2B.2 backup) | ≈2026-11-22 |
| snap-icy-firefly-a7m0b8os | 2026-11-18 |
| snap-rapid-queen-a78cx09w | 2026-11-21 |
| snap-red-dream-a7t242s1 · pre-eve-registration-questions-20261024 (rollback point before the registration-questions migration; created 2026-10-24 11:32Z) | 2026-11-23 (Neon `expires_at` set, auto-expires) |

Note (2026-10-24): br-polished-dust-a7iw42u3 now has the registration-questions migration applied. It was the Production rehearsal; no data changed.

### Group D — findings (no change made)

- `br-quiet-river-a722xo9q`:
  - Scheduling 2A backup, protected.
  - PR #466 merged 2026-10-22.
  - Proposed: unprotect and delete ≈2026-11-21, once the owner confirms 2A is Production-verified.
- `br-muddy-bread-a7wkhazl`:
  - Scheduling 2B.0 backup, protected.
  - PR #470 merged 2026-10-23.
  - Proposed: ≈2026-11-22, on the same condition.
- `vercel-dev` (`br-delicate-wind-a7ja54b8`):
  - The `brainbase` project still has Development-scoped `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, set 49 days ago (≈2026-09-05). `vercel-dev` was created by Vercel on 2026-09-04.
  - So the Development env most likely points here. The value was not read, so this is not confirmed.
  - Do not delete it until the Development env is repointed or removed.

## Operating standard (approved operating direction, 2026-10-24)

1. **PR Preview branches:** deleted when the PR merges or closes. Never kept beyond **14 days** without a recorded reason. Target state: previews are created from a masked or synthetic `preview-base` branch instead of Production, where practical.
2. **Temporary / proof copies:** deleted within **7 days**, as soon as the proof is reported.
3. **Migration backups and manual snapshots:** the name states the migration and date, and a delete-by date is recorded here. Deleted within **30 days** after the migration is verified, unless under a documented hold. Protection is removed at that point.
4. **Investigation copies:** only under a documented legal or incident hold (reason, owner, review date), and deleted when the hold ends.
5. **Once Eve collects SENSITIVE / THIRD_PARTY answers in Production:** creating a new raw Production-derived copy needs a recorded purpose, owner and expiry date (default 30 days). Previews should use masked or synthetic data. Any undocumented copy, or any copy past its date, is deleted or escalated at the monthly review.
6. **Monthly review:** re-list branches and snapshots, reconcile them against this document, and record the result.

### How Neon's 6-hour point-in-time window fits

- **PITR is on `production` only and lasts 6 hours.** After the retention job removes an answer, the removed value can be recovered through PITR for at most 6 hours. After that it is gone from `production`'s history.
- **Branches and snapshots are separate.** They are not shortened by PITR; they last until deleted. That is why rules 1–5 bound their life.
- **Worst case under this standard:** a removed answer may persist in a controlled copy for up to about **30 days** (migration backups and snapshots), or until an investigation hold ends. Previews last at most 14 days and proofs at most 7.
- Together this is the "limited period" the Privacy Policy refers to. The wording is unchanged and is no longer a separate legal question (review pack §E, "No longer asked").
- Copies the organiser makes themselves (screenshots, spreadsheets) are outside this standard; the Privacy Policy states they are the organiser's responsibility.
