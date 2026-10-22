# Scheduling Phase 2A: merge readiness and Preview rehearsal (2026-10-22)

Read with `scheduling-phase2a-rehearsal.md` and `scheduling-phase2a-migration-package.md`. Nothing here touched
Production. No PR has been merged.

## 1. Merge readiness

| Question | Finding |
| --- | --- |
| Heads unchanged since approval | #461 `e01fd83b`, #463 `0ffad82c`, #466 `e80cd04e`: identical to the reviewed commits |
| CI | All three green on those commits. GitHub reports each mergeable and clean on its own |
| Conflicts when merged in order #461, #463, #466 | **One**, in a document: `docs/architecture/decisions/0014-scheduling-and-bookings-foundation.md` (both #463 and #466 append an amendment). Resolution: keep both. A worked resolution is saved as `scheduling-phase2a-evidence/adr-0014-merge-resolution.patch`. No code conflicts. |
| Checks on the merged result (simulated locally, not pushed) | `tsc` clean, ESLint clean on the scheduling code, 371 scheduling and containment tests pass |
| Runs a migration at build or deploy | **No.** `build` is `prisma generate && next build`; CI has no SQL or deploy step; `vercel.json` has only cron routes. The tables are not in `prisma/schema.prisma` (the one "scheduling" match there is a comment) |
| Does merging to `main` deploy Production | **Yes.** GitHub's deployment record shows each `main` commit deployed to "Production - brainbase" by the Vercel integration (most recent: `f9f0288b`, 2026-10-21). So a merge is a Production deployment and needs an approved rollout |
| Other effect of merging | The `neon-preview-cleanup` workflow deletes the Neon preview branch of a merged PR's source branch (`preview/feat/scheduling-phase2a-db-foundation` on merging #466) |
| New code connected to existing workflows | **No.** The only files outside the scheduling packages, docs and tests are two new files under `lib/scheduling/` that nothing imports, plus the `@scheduling/*` aliases in `tsconfig.json` and the vitest configs. Containment tests pin that no app route, page or job imports them |
| LD Tennis | Unchanged. No LD Tennis runtime file is touched (the diff touches only LD Tennis *documents*, and a Phase 1 compatibility map in `lib/scheduling/compatibility/tennis`, which nothing imports) |
| Retargeting after #461 merges | #463 and #466 are both based on the Phase 1 branch. **Correction (2026-10-22):** GitHub retargets them to `main` only if the source branch is deleted on merge, which is not confirmed for this repository. Set each base to `main` by hand and check the file list; see `scheduling-release-checklist.md`. Merge #463 first, then apply the ADR resolution when merging #466 |

Why merging was not done: the merge deploys Production, no rollout has been approved, and this environment has no
GitHub write access.

## 2. Preview rehearsal

Target: Neon project `brainbase-db`, branch `preview/feat/scheduling-phase2a-db-foundation`
(`br-falling-mouse-a7wsum7i`), PostgreSQL 17.11. Vercel-created for this feature branch; not the primary, default or
protected branch; created from Production data on 2026-10-21 21:08Z; no other sessions were connected.

| Step | Result |
| --- | --- |
| Baseline | 212 tables / 58 functions / 64 triggers; 0 scheduling objects; 6 organisations; `organisations.id` is `text` |
| Recovery point | Restore point LSN `0/2DDFB988` at 2026-10-22 01:58:56Z, inside the project's 6 hour history window. Preview is also re-creatable from Production |
| Scripts | `001`, `010`, `020`, `090`, `110`, `190` are byte-identical to the committed files at `e80cd04e`; marker `2a.2` |
| Application without the tables | Nothing in the app imports or queries `scheduling_*` (static check and containment tests). The Preview deployment of `e80cd04e` was running before any table existed |
| `001` preflight | Clean. One deliberate deviation: `btree_gist` and the `scheduling_ext` schema were created first as the branch owner, so the extension is owned by the normal owner |
| `010` | Applied; 225 / 69 / 80 (+13 / +11 / +16) |
| `020` | Marker `2a.2`; 13 tables; exclusion constraint `... WHERE ((released_at IS NULL))`; 16 triggers enabled; 0 host keys; 0 legacy dependencies |
| Suites against Preview (between `020` and `110`) | contract 13, exclusive 13, appointments 21, concurrency 27, contention 16, schema 31 (+1 deliberately skipped), repositories 28, Neon driver matrix 76 (direct and pooled hosts): **225 pass**. They are run before `110` because they use synthetic tenants that the host keys correctly refuse |
| `110` then `020` | 3 foreign keys, all to `organisations`; inventory unchanged; markers `2a.1-brainbase`, `2a.2` |
| Foreign keys bite | A self-rolling-back check: a missing organisation is refused (`23503`), a real one accepted, 0 rows left |
| Tenant isolation, capacity, exclusion, appointment assignment, idempotency, reapplication | Covered by the suites above (each is a named test) and by the byte-for-byte re-apply test |
| Test data | Truncated afterwards; reservations 0 |

### Ownership correction

The suites needed a login role, and the platform does not allow the branch owner to take over objects created by
another role. The schema first applied was therefore owned by that temporary role. To leave Preview exactly as a
manual owner-run migration would, it was rolled back with the approved scripts and re-applied as `neondb_owner`
(`010` as 64 statements in one transaction, then `110` as 7). The statement splitting was first proven on the
disposable copy to give an identical schema. Result on Preview: the **same 325 definitions with the same fingerprint**
(`52d792c7d93701285c1af6e9db123cea`) as the validated instance, every object owned by `neondb_owner`, 225 / 69 / 80,
3 host keys, 0 reservations. The temporary role's grants were revoked and the role deleted.

Note for the production handoff: after `110` the marker table lists **two** rows (`2a.1-brainbase`, `2a.2`), so check 1
of `020` shows two rows after the host file, one before it.

## 3. Rollback rehearsal (disposable copy)

A child branch of the validated Preview was used: `temp/scheduling-2a-rollback-rehearsal-20261022`
(`br-shiny-smoke-a7bb3pen`). The validated Preview schema was not touched by it.

| Step | Result |
| --- | --- |
| Start | 225 / 69 / 80, 3 host keys (identical to Preview) |
| `190` | host keys removed; marker `2a.1-brainbase` removed |
| `090` with one reservation present | **Refused**: "scheduling_reservations holds 1 rows; rollback would destroy them" |
| `090` after clearing test data | **212 / 58 / 64**, 0 scheduling tables or functions, 6 organisations untouched |
| Re-apply `010` (split statements, one transaction) | Schema fingerprint identical to the file-applied one (322 definitions) |
| `110`, then `190` | works both ways |
| Full schema suite on the copy (includes the rollback-and-reapply test) | **32 of 32** pass |

The copy is left in place pending approval to delete it (it holds a copy of Production data and the temporary role).
