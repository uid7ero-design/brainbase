# Scheduling: controlled release checklist (2026-10-22)

Status: **prepared, not executed; waiting for the release window and watcher (section 10).** Nothing here has been
merged, deployed or applied. The disposable rollback branch has been deleted. This is the plan the owner approves, step by step. Read with `scheduling-phase2a-merge-and-preview.md` (readiness findings) and
`scheduling-phase2b-plan.md`.

## 1. What is being released

Four stacked PRs. Together they put **no behaviour change** on Production: no route, page, job, migration or
navigation entry uses the new code, and no SQL is run by the build or the deployment.

| Order | PR | Head | Base (now) | Expected footprint in the merge |
| --- | --- | --- | --- | --- |
| 1 | #461 Phase 1 foundation | `e01fd83b` | `main` | 27 files, +4073/-1. Runtime paths: `lib/scheduling/adapters/brainbase/index.ts`, `lib/scheduling/compatibility/tennis/index.ts` (nothing imports either); config: `tsconfig.json`, `vitest.config.ts` |
| 2 | #463 Phase 2 architecture | `0ffad82c` | Phase 1 branch | 4 files, +1139/-103, documents only |
| 3 | #466 Phase 2A database foundation | `e80cd04e` | Phase 1 branch | 62 files, +7070/-27. Packages, SQL **files** (not executed), tests, docs, config: `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`. **One conflict**, the ADR 0014 document |
| 4 | #467 Preview verification and 2B plan | `1bc5dc0d` (will advance) | 2A branch | documents and evidence only |

Footprints are from a local simulation of all four merges against `main` at `e5dde004`, in this order, never pushed:
`tsc` clean, ESLint clean on the scheduling code, 248 non-database scheduling and containment tests pass. A Vercel
Preview build of each head succeeded; the #467 head contains every runtime change in the stack, so it is the build
proof for the whole set.

## 2. Facts that shape the process

1. **Merging to `main` deploys Production.** GitHub deployment records show every `main` commit deployed to
   "Production - brainbase" and every other branch to "Preview - brainbase". Four merges are four Production
   deployments of `brainbase` and, from the Vercel records, four of `eve`.
2. **`main` is moving.** Other work merged to `main` on 2026-10-22 (`b973b5df`, `e5dde004`). The simulation must be
   repeated if `main` has moved by the time of the window (step A3).
3. **Stacked PRs do not retarget themselves unless the source branch is deleted on merge.** This is not confirmed for
   this repository (repository settings are not readable without write access). Before each merge after the first,
   **set the base to `main` by hand and confirm the changed-file list matches the table above.** A PR merged into a
   stale base would not reach `main`.
4. **Merge method must be "Create a merge commit" for all four.** `main` has used both merge commits and squashes. A
   squash of #461 would rewrite history under the other three and produce large, false conflicts.
5. **The Neon preview-branch cleanup runs on every merge** and deletes only the exactly named `preview/<head ref>`
   branch (never `production`, never a partial match). A branch with child branches cannot be deleted
   ([Neon: manage branches](https://neon.com/docs/manage/branches)); the script then fails visibly.
6. **No step in this checklist changes a database.** The only database access is the approved read-only Production
   check (section 6). Production SQL is a separate, later approval.
7. **Both Vercel projects built from this repo redeploy on every merge**, and `brainbase` also serves LD Tennis (section 5).

## 3. Consequences of each merge

| Merge | Production deployment | Neon branch the cleanup targets | Notes |
| --- | --- | --- | --- |
| #461 | Yes: deploys the merge commit. No behaviour change | `preview/feat/scheduling-phase1-foundation` (`br-lingering-bar-a76m15mk`): created from Production, no scheduling objects, no children | Safe to delete. Afterwards set #463 and #466 base to `main` |
| #463 | Yes. Documents only | `preview/docs/scheduling-phase2-design` (`br-empty-pine-a7px2le0`): same, empty | Safe to delete |
| #466 | Yes. Packages and SQL files, nothing wired | `preview/feat/scheduling-phase2a-db-foundation` (`br-falling-mouse-a7wsum7i`): **holds the validated 2A schema** | Will be **deleted**; the evidence is already committed (section 4). Its former child `br-shiny-smoke-a7bb3pen` was deleted on 2026-10-22 (section 8), so the cleanup is no longer blocked |
| #467 | Yes. Documents only | `preview/docs/scheduling-phase2a-preview-and-2b-plan` (`br-ancient-salad-a7dv08or`): created from Production, empty | Safe to delete |

Merging a PR never touches the Production Neon branch (`br-lingering-bird-a7aif5zw`, the primary), and the cleanup
script refuses the names `production`, `c1-migration-rehearsal` and `vercel-dev`.

## 4. Preserving the validated Preview schema evidence

Decision (2026-10-22): **no additional snapshot** is taken. The schema is deterministic (it is exactly what `001`, `010`,
`020`, `110` produce) and the evidence worth keeping is the committed record:

- `scheduling-phase2a-evidence/preview-schema-record.txt`: per-kind definition hashes read from the validated Preview
  branch (constraints 106, functions 11, indexes 37, triggers 16; 13 tables owned by `neondb_owner`; markers
  `2a.1-brainbase`, `2a.2`; 0 reservations) with the query that produced them, so it can be re-run on Production after
  the real migration and compared.
- The whole-schema fingerprint `52d792c7d93701285c1af6e9db123cea` (325 definitions) and the suite outputs
  `preview-suites.txt`, `preview-020-after-010.txt`, `preview-020-after-110.txt`.

When #466 merges, the cleanup deletes `preview/feat/scheduling-phase2a-db-foundation`. That is expected and accepted.
The Phase 2B.0 rehearsal re-creates a Preview branch from the committed scripts.

## 5. Verified Production configuration (from authoritative sources, 2026-10-22)

Source: the Vercel CLI, logged in as the account owner, read-only commands (`project ls`, `project inspect`, `inspect`
on the live hostname, `alias ls`). The Vercel connector in this tool has no team access and was not used. Nothing was
guessed.

| Item | Value |
| --- | --- |
| Vercel project | `brainbase` (`prj_6WnZrDXumaQzpfR63awLy2CWTxJE`), root directory `.` |
| Production URL reported by Vercel | `https://hlna.com.au` |
| Current Production deployment | `dpl_BpECPy1rorqMG8NS2GRvUhHwhQPz`, target production, Ready, commit `e5dde004` |
| Aliases on that deployment | `hlna.com.au`, `www.hlna.com.au`, `app.hlna.com.au`, `thebrainbase.com.au`, `www.thebrainbase.com.au`, `ldtennis.com.au`, `www.ldtennis.com.au`, `brainbase-omega.vercel.app`, `brainbase-uid7ero-designs-projects.vercel.app`, `brainbase-git-main-...` |
| Health endpoint | `GET /api/health/db` (`app/api/health/db/route.ts` on `main`): unauthenticated, runs `SELECT 1`, returns `{"ok":true,"latencyMs":n}` or 503. `middleware.ts` excludes `/api` from its matcher, so it is public |
| Baseline taken | `GET https://hlna.com.au/api/health/db` returned 200 `{"ok":true,"latencyMs":650}`; `GET https://hlna.com.au/login` 200; `GET https://www.ldtennis.com.au/` 307 to `/tennis`, then 200 |
| Which deployment is serving | Every page embeds `data-dpl-id="dpl_..."`. Both `hlna.com.au/login` and `www.ldtennis.com.au/tennis` showed `dpl_BpECPy1r...`. After a merge, the new id appearing there is the proof the new deployment is live |
| Second project built from this repo | `eve` (`prj_wrOFEl9HxxbVLlXN9VBHA5ExIoa8`), root `apps/eve`, serves `eveevents.com.au`, current `dpl_28rMCXUcfkirmZQ1voUYBWj9ptm2`, commit `77b76e9b`+, baseline `GET /` 200. Its Production deployment was created at the same second as brainbase's (12:52:59), so **every merge to `main` also redeploys Eve's Production site** (unchanged Eve code) |
| LD Tennis | `ldtennis.com.au` and `www.ldtennis.com.au` are aliases of the **same** `brainbase` Production deployment. LD Tennis is therefore redeployed by every merge, with no LD Tennis file changed. It is verified after each merge (GET only) |
| Not verifiable here | The project's "Production Branch" setting and runtime-error logs (no connector access). The Production branch behaviour is established from GitHub deployment records and the identical creation time of the deployments |

## 6. Read-only Production database check (approved)

A single catalog `SELECT`, run against the Production Neon branch `br-lingering-bird-a7aif5zw` (database `neondb`). It
writes nothing and takes no lock beyond a catalog read.

```sql
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE c.relname LIKE 'scheduling\_%' AND n.nspname NOT IN ('pg_catalog','information_schema'))::int AS scheduling_relations,
       (SELECT count(*) FROM pg_proc p WHERE p.proname LIKE 'scheduling\_%')::int AS scheduling_functions,
       (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'scheduling\_%')::int AS scheduling_triggers,
       (SELECT count(*) FROM pg_namespace WHERE nspname='scheduling_ext')::int AS scheduling_ext_schema,
       (SELECT count(*) FROM pg_extension WHERE extname='btree_gist')::int AS btree_gist,
       (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS public_tables;
```

| When | Result |
| --- | --- |
| **Before** (2026-10-22 06:14Z) | scheduling_relations 0, scheduling_functions 0, scheduling_triggers 0, scheduling_ext_schema 0, **btree_gist 0**, public_tables 211 |
| **After** the last merge | To be run in step F. Expected: identical to the row above |

Note for the later Production SQL: `btree_gist` is **not installed on Production**, so `001` will create it and the
migration role needs permission to do so. The rehearsal pre-created it as the branch owner; the Production handoff must
say the same.

## 7. Ordered release checklist

The release window and the person watching have **not** been agreed. Nothing below has been executed.
Do not start within five minutes either side of the top of the hour (`/api/cron/ticket-email-recovery` runs hourly) or
near 02:00 UTC (`/api/cron/sync`).

### A. Before the window (no merge yet)

- [ ] A1. Owner agrees the window (date, start time, expected duration) and names the watcher.
- [ ] A2. Recheck the four heads (`e01fd83b`, `0ffad82c`, `e80cd04e`, #467's current head), `mergeable_state` `clean`
      and CI green. **Stop if a head moved without review.**
- [ ] A3. Recheck `main` (`e5dde004` at preparation). If it moved, repeat the four-way simulation (clean except the
      ADR file; tsc, ESLint and scheduling tests pass). **Stop on any new conflict.**
- [ ] A4. Baseline, taken inside the window: Production deployment id (`vercel inspect https://hlna.com.au`), the
      `data-dpl-id` served by `hlna.com.au/login` and `www.ldtennis.com.au/tennis`, `GET /api/health/db` 200, the
      same for `eveevents.com.au`, and the current runtime-error count for the last hour.
- [ ] A5. Run the read-only Production check (section 6) again; expect all zeros and `public_tables` unchanged.
- [x] A6. Evidence preserved (section 4). No snapshot (decision).
- [x] A7. Disposable branch `br-shiny-smoke-a7bb3pen` deleted (section 8). No child branch now blocks the #466 cleanup.
- [ ] A8. Confirm the merge method is "Create a merge commit" on every merge.

### B. Merge #461

- [ ] B1. Confirm base is `main` and the changed files match section 1. Merge (merge commit).
- [ ] B2. Wait for **both** Production deployments (`brainbase` and `eve`) to reach Ready.
      `vercel inspect https://hlna.com.au` shows a new `dpl_...` id and the merge commit.
- [ ] B3. Health, in this order: `GET https://hlna.com.au/api/health/db` is 200 `ok:true`; `hlna.com.au/login` 200 and
      shows the **new** `data-dpl-id`; `www.ldtennis.com.au/` 307 to `/tennis` then 200 with the same new id (GET
      only; no booking is attempted); `eveevents.com.au/` 200; no new runtime-error signature in the 15 minutes after.
- [ ] B4. The `Neon Preview Branch Cleanup` run for #461 succeeded (deletes `preview/feat/scheduling-phase1-foundation`).
- [ ] B5. Set the base of #463 and #466 to `main` by hand if GitHub did not. Confirm each lists only its own files and
      that checks re-run green.

**Stop and roll back if** either deployment is not Ready, any health step fails, a new error signature appears, or the
LD Tennis page differs from baseline. Rollback is a Vercel instant rollback to the baseline deployment recorded in A4
(for `brainbase`, and for `eve` if it is affected), then a revert PR (`git revert -m 1 <merge sha>`). No database step
is ever needed.

### C. Merge #463

- [ ] C1. Confirm base `main` and 4 documents only. Merge. C2 to C4 as B2 to B4 (cleanup deletes `preview/docs/scheduling-phase2-design`).

### D. Merge #466

- [ ] D1. Confirm base `main`, the changed files match section 1, checks green, and no child branch exists under
      `br-falling-mouse-a7wsum7i`.
- [ ] D2. Apply the ADR 0014 resolution (section 9): keep both amendments, in order.
- [ ] D3. Merge #466 (merge commit). D4 as B2 and B3.
- [ ] D5. The cleanup deletes `preview/feat/scheduling-phase2a-db-foundation`. **Expected.**

### E. Merge #467

- [ ] E1. Confirm base `main`, only documents and evidence, checks green on its current head. Merge. E2 as B2 to B4
      (cleanup deletes `preview/docs/scheduling-phase2a-preview-and-2b-plan`).

### F. After the window

- [ ] F1. All Production deployments Ready; the live `data-dpl-id` is the last merge commit's deployment.
- [ ] F2. **Read-only Production check again (section 6): must equal the "before" row.** Any scheduling object appearing
      is a stop-and-investigate condition (nothing in this release creates one).
- [ ] F3. LD Tennis public pages equal baseline (GET only); no LD Tennis file appears in any merge.
- [ ] F4. Record merge commit hashes, deployment ids and the F2 result in `scheduling-phase2a-merge-and-preview.md`.
- [ ] F5. Phase 2B, Production SQL and enabling scheduling stay **not started**.

**Global stop conditions:** a deployment not Ready; any failed health step; a new runtime-error signature; a diff
footprint that differs from section 1; `mergeable_state` not clean; `main` moving unexpectedly; a squash or rebase used;
any step that touches a database other than the read-only check.


## 8. The disposable rollback branch: deleted

`temp/scheduling-2a-rollback-rehearsal-20261022` (`br-shiny-smoke-a7bb3pen`) was deleted on 2026-10-22 with the owner's
approval, after this recheck:

| Check | Finding before deletion |
| --- | --- |
| Child branches | None. No branch listed it as `parent_id` |
| Active sessions | 0 other sessions in its database |
| Protected, primary or default | No, no, no |
| Created by | The console (this project's owner, for the rehearsal); not by Vercel, CI or any workflow |
| Referenced by | Nothing in the app, CI, Vercel or the cleanup script |
| Disposable role | `sched_preview_migrator` existed on this branch only; it goes with the branch |
| Still needed for evidence | No: results are committed |

After deletion: the branch no longer appears in the project; the validated Preview branch `br-falling-mouse-a7wsum7i` is
unchanged (13 scheduling tables, 0 reservations, no `sched_` role); the Production branch has only the role
`neondb_owner`. **No other branch was deleted.** Every other branch, including the four Vercel preview branches for this
stack, is left for the merge-time cleanup workflow.

## 9. ADR 0014 resolution

The conflict is two appended sections at the same place: #463 adds "7. Amendment (2026-10-21): multiple presets per
organisation (implemented)"; #466 adds "Amendment: Phase 2A database foundation (2026-10-22)". Resolution: keep both, in
that order, with one blank line between, and remove the markers. No wording changes.

`scheduling-phase2a-evidence/adr-0014-merge-resolution.patch` is the diff from the file as it stands after #463 to the
resolved file. Verified on 2026-10-22 by applying it to #463's file and checking against both PR heads:

- #463's amendment (11 lines) appears verbatim in the result: yes.
- #466's amendment (15 lines) appears verbatim in the result: yes.
- Order (7 first, then 2A): yes. Sections 1 to 6 unchanged: yes. Conflict markers: none.
- It also reproduces, byte for byte, a real four-way merge simulation against `main`.

One sentence in the 2A amendment is now out of date: "Phase 2A applies it nowhere" (the SQL has since been applied to
a Preview branch). It is preserved as written, because both approved amendments must be preserved. A one-line follow-up
amendment can correct it after Production SQL is approved.

## 10. Remaining information needed to authorise a monitored deployment

1. **The release window**: date, start time and expected duration (outside the cron times in section 7).
2. **The named watcher** who runs the health checks in section 7 and can trigger a Vercel rollback, and a way to reach
   them during the window.
3. **Acknowledgement** that each merge redeploys both Production projects (`brainbase`, which also serves LD Tennis, and
   `eve`), with unchanged behaviour and a stated rollback.

That is all. The hostname (`hlna.com.au`), the health endpoint, the merge method, the evidence approach and the
disposable-branch cleanup are settled. Two optional items would remove manual steps but are not required: re-authorise
the Vercel connector (so runtime errors can be read from here), and grant GitHub write access (so merges and base
changes could be made from here; otherwise the watcher does them).

## 11. Open risks

| Risk | Status |
| --- | --- |
| Each merge redeploys two Production projects, including the LD Tennis site (four merges, eight deployments) | Accepted for approval; no behaviour change; rollback is a Vercel rollback plus a revert PR |
| Stack merged into a stale base | Mitigated by setting each base to `main` by hand and checking the file list |
| Squash merge used by mistake | Mitigated by A8 and the global stop condition |
| `main` moves during the window | A3 and a re-check before each merge |
| Runtime errors cannot be read from this tool | Health endpoint, served `data-dpl-id` and the watcher's dashboard are the checks |
| Validated Preview schema deleted by the cleanup | Mitigated by the committed record and reproducible scripts |
| `btree_gist` is absent on Production | Recorded for the Production SQL handoff; not part of this release |
| Production performance of the 2A schema is unproven | Unchanged; the migration is a separate approval and will be measured |
| Windows test-host worker deaths, cause unexplained | CI does not depend on the local harness |
