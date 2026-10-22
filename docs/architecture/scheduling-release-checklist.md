# Scheduling: controlled release checklist (2026-10-22)

Status: **prepared, not executed.** Nothing here has been merged, deployed or applied. This is the plan the owner
approves, step by step. Read with `scheduling-phase2a-merge-and-preview.md` (readiness findings) and
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
   deployments.
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
6. **No step in this checklist runs SQL.** Production SQL is a separate approval (section 7).

## 3. Consequences of each merge

| Merge | Production deployment | Neon branch the cleanup targets | Notes |
| --- | --- | --- | --- |
| #461 | Yes: deploys the merge commit. No behaviour change | `preview/feat/scheduling-phase1-foundation` (`br-lingering-bar-a76m15mk`): created from Production, no scheduling objects, no children | Safe to delete. Afterwards set #463 and #466 base to `main` |
| #463 | Yes. Documents only | `preview/docs/scheduling-phase2-design` (`br-empty-pine-a7px2le0`): same, empty | Safe to delete |
| #466 | Yes. Packages and SQL files, nothing wired | `preview/feat/scheduling-phase2a-db-foundation` (`br-falling-mouse-a7wsum7i`): **holds the validated 2A schema** | Will be **deleted**. Needs the evidence step (section 4) first. Has child `br-shiny-smoke-a7bb3pen`, which makes the cleanup **fail** until the child is deleted (approval in section 7) |
| #467 | Yes. Documents only | `preview/docs/scheduling-phase2a-preview-and-2b-plan` (`br-ancient-salad-a7dv08or`): created from Production, empty | Safe to delete |

Merging a PR never touches the Production Neon branch (`br-lingering-bird-a7aif5zw`, the primary), and the cleanup
script refuses the names `production`, `c1-migration-rehearsal` and `vercel-dev`.

## 4. Preserving the validated Preview schema evidence

The schema is deterministic: it is exactly what `001`, `010`, `020`, `110` produce, and its fingerprint is committed.
The evidence worth keeping is therefore the **record**, not the branch.

Recommended, in this order:

1. **Committed record (done).** `scheduling-phase2a-evidence/preview-schema-record.txt` holds per-kind definition hashes
   taken from the validated Preview branch (constraints 106, functions 11, indexes 37, triggers 16; 13 tables owned by
   `neondb_owner`; markers `2a.1-brainbase`, `2a.2`; 0 reservations), together with the earlier whole-schema
   fingerprint `52d792c7d93701285c1af6e9db123cea` (325 definitions) and the suite results already in
   `preview-suites.txt`, `preview-020-after-010.txt` and `preview-020-after-110.txt`. It survives any Neon deletion and
   can be re-checked against Production after the real migration with the same query.
2. **Optional Neon snapshot** of the Preview branch, taken before #466 merges, named
   `evidence-scheduling-2a-preview-20261022`. A snapshot does not make the source branch a parent, so it does not
   block the cleanup. This creates a stored copy of Production-derived data and needs an explicit yes (section 7).
   The project already uses snapshots for Production backups (`pre-eve-launch-compliance-migrations-2026-10-19`).
3. **Not recommended: a retained child or sibling branch.** A child blocks the cleanup of its parent, holds a copy of
   Production data indefinitely, and the project's point-in-time history is only 6 hours, so it is no substitute for
   a record.

If the Preview branch is wanted for the Phase 2B rehearsal, it can be re-created in minutes from the committed scripts.

## 5. Ordered release checklist

Owner approval of the window is required before step A1. Someone must watch the Production deployment and the health
checks. Do not start within five minutes either side of the top of the hour (`/api/cron/ticket-email-recovery` runs
hourly) or near 02:00 UTC (`/api/cron/sync`).

### A. Before the window (no merge yet)

- [ ] A1. Owner approves the window and names the person watching.
- [ ] A2. Recheck the four heads are unchanged (`e01fd83b`, `0ffad82c`, `e80cd04e`, and #467's head) and every PR is
      mergeable, `clean`, checks green. **Stop if any head moved without a review.**
- [ ] A3. Recheck `main`. If it moved since `e5dde004`, repeat the four-way simulation (clean except the ADR file; tsc,
      ESLint and scheduling tests pass). **Stop on any new conflict.**
- [ ] A4. Record a baseline: the latest Production deployment (id, commit, state), `GET /api/health/db` result, the
      current runtime-error count for the last hour (Vercel dashboard, or the Vercel connection once re-authorised).
- [ ] A5. Neon: confirm the Production branch is `br-lingering-bird-a7aif5zw`. A Production snapshot is **not** required
      for these merges (no SQL is run); it is required before the later Production SQL (section 7, item 5).
- [ ] A6. Evidence: the committed record in section 4 is on the #467 branch. If the optional snapshot is approved, take
      it now.
- [ ] A7. If approved: delete the disposable branch `br-shiny-smoke-a7bb3pen` (section 6). **Do this before merging
      #466**; otherwise the cleanup fails (harmless to Production, but noisy).
- [ ] A8. Confirm the merge method will be "Create a merge commit".

### B. Merge #461

- [ ] B1. Merge #461 (merge commit).
- [ ] B2. Wait for the Production deployment of the merge commit to reach `success` (GitHub deployments API, or Vercel).
- [ ] B3. Health: `GET /api/health/db` returns 200 `{ ok: true }`; the sign-in page and the public LD Tennis booking page
      load (GET only, submit nothing); no new runtime-error signature in the 15 minutes after the deploy.
- [ ] B4. The `Neon Preview Branch Cleanup` run for #461 succeeded (it deletes `preview/feat/scheduling-phase1-foundation`).
- [ ] B5. Set #463 **and** #466 base to `main` by hand if GitHub did not. Confirm each shows exactly its own files
      (table in section 1) and that checks re-run green.

**Stop and roll back if** the deployment is not `success`, health fails, or a new error signature appears. Rollback
is a Vercel instant rollback to the baseline deployment recorded in A4, then a revert PR for the merge commit
(`git revert -m 1 <merge sha>`). No database step is ever needed.

### C. Merge #463

- [ ] C1. Merge #463. C2 to C4 as B2 to B4 (documents only; cleanup deletes `preview/docs/scheduling-phase2-design`).

### D. Merge #466

- [ ] D1. Confirm: A7 done (no child branch), base is `main`, changed files match section 1, checks green.
- [ ] D2. Resolve the ADR 0014 conflict by keeping both amendments exactly as in
      `scheduling-phase2a-evidence/adr-0014-merge-resolution.patch` (see section 8). Re-run checks if the PR is updated.
- [ ] D3. Merge #466 (merge commit).
- [ ] D4. Deployment `success`; health as B3.
- [ ] D5. The cleanup run deletes `preview/feat/scheduling-phase2a-db-foundation`. **Expected.** The schema evidence
      is already preserved (section 4).
- [ ] D6. Read-only confirmation that nothing scheduling-related exists on Production:
      `SELECT count(*) FROM pg_tables WHERE tablename LIKE 'scheduling\_%'` returns 0. (Run only with approval; it is
      a read on Production.)

### E. Merge #467

- [ ] E1. Set base to `main`; confirm only documents and evidence; checks green.
- [ ] E2. Merge; deployment `success`; health as B3; cleanup deletes `preview/docs/scheduling-phase2a-preview-and-2b-plan`.

### F. After the window

- [ ] F1. The four Production deployments are `success`; the final one is the live deployment.
- [ ] F2. LD Tennis public pages unchanged (GET only). No LD Tennis file is in any diff.
- [ ] F3. Record merge commit hashes and deployment ids in `scheduling-phase2a-merge-and-preview.md`.
- [ ] F4. Update the project notes. Phase 2B, Production SQL and the capability stay **not started**.

## 6. The disposable rollback branch

`temp/scheduling-2a-rollback-rehearsal-20261022` (`br-shiny-smoke-a7bb3pen`):

| Check | Finding |
| --- | --- |
| Purpose | Rehearse `190`, `090`, re-apply and the schema suite on a copy of the validated Preview. Done: all passed (see `scheduling-phase2a-merge-and-preview.md`) |
| Still needed for evidence? | **No.** Results and outputs are committed; the 2B.0 rehearsal will use a fresh copy |
| Parent | `br-falling-mouse-a7wsum7i` (the validated Preview). Deleting the child does not alter the parent |
| Children | None. No other branch lists it as a parent |
| Used by | Nothing in the application, CI or Vercel. It was created from the console, not by Vercel |
| Contents | A copy of Production data as of 2026-10-22 02:06Z, the 2A schema in its post-rehearsal state, and the temporary login role `sched_preview_migrator` (its password is the one in this session's transcript; deleting the branch removes the role with it) |
| Blocks anything? | **Yes: it blocks the automatic cleanup of its parent when #466 merges** (a branch with children cannot be deleted) |
| Created | By this session, with approval, for the rehearsal |

Recommendation: delete it before the window (step A7). It is not deleted now; the deletion needs your approval.

## 7. Approvals required

1. The Production release window and the named watcher for merges #461, #463, #466, #467, in that order, as merge
   commits, with the base set to `main` before each (sections 2 and 5).
2. Deletion of the disposable branch `br-shiny-smoke-a7bb3pen` (section 6).
3. Whether to take the optional Neon snapshot of the Preview branch (section 4). Default if unanswered: do not.
4. Whether to run the read-only Production check D6.
5. **Separately, later:** Production SQL (backup first, quiet period, manual SQL Editor run as owner:
   `001`, `010`, `020`, `110`, `020`), then `120` and `130` with Phase 2B, then creating and enabling the internal test
   organisation. None of these are requested here.

## 8. ADR 0014 resolution

The conflict is two appended sections at the same place: #463 adds "7. Amendment (2026-10-21): multiple presets per
organisation (implemented)"; #466 adds "Amendment: Phase 2A database foundation (2026-10-22)". Resolution: keep both,
in that order, with one blank line between, and remove the markers. No wording changes.

`scheduling-phase2a-evidence/adr-0014-merge-resolution.patch` is the diff from the file as it stands after #463 to the
resolved file. It was regenerated and verified byte for byte against a real four-way merge simulation. (The version
saved earlier in this project added an extra bullet that is in neither amendment; it was replaced.)

One sentence in the 2A amendment is now out of date: "Phase 2A applies it nowhere" (the SQL has since been applied to
a Preview branch). It is left as written, because the instruction is to preserve both amendments. A one-line
follow-up amendment can correct it once Production SQL is approved.

## 9. Open risks

| Risk | Status |
| --- | --- |
| Each merge redeploys Production (four deployments) | Accepted for approval; no behaviour change; rollback is a Vercel rollback plus a revert PR |
| Stack merged into a stale base | Mitigated by setting each base to `main` by hand and checking the file list |
| Squash merge used by mistake | Mitigated by A8 and a stop condition if the footprint does not match section 1 |
| `main` moves during the window | A3 and a re-check before each merge |
| Vercel connection needs re-authorisation, so Production project settings and runtime errors cannot be read from here | Production-branch behaviour is established from GitHub's deployment records. Re-authorise to automate the health checks |
| Cleanup fails on #466 if the child branch still exists | Delete the child first (A7) |
| Validated Preview schema is deleted by the cleanup | Mitigated by the committed record and reproducible scripts |
| Production performance of the 2A schema is unproven | Unchanged; the migration is a separate approval and will be measured |
| Windows test-host worker deaths, cause unexplained | CI does not depend on the local harness |
