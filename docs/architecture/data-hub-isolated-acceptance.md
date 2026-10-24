# Reproducible isolated Data Hub acceptance

This package extends planning acceptance upstream through workbook inspection,
raw staging, the existing normalization executor and profiler. It records a repeatable local result
against a clean candidate commit. It adds test/operational tooling, not an
application endpoint, migration, analytical operation or release permission.

## What is exercised

The fixture begins with seeded schema/mapping metadata, a READY import batch
and synthetic XLSX bytes held in the setup-only `InMemoryFileStore`. A real
signed manager session invokes the existing structural inspection route, which
creates the canonical worksheet. The existing staging route verifies the byte
hash, reads actual physical worksheet rows and commits raw evidence through the
real batch/completion SQL functions. It then invokes normalization, including its executor, batch
persistence and completion guards. The existing profiler then reads those real
normalized records. Explicit semantic/quality decisions are saved through the
review routes, and selected governed descriptions are planned with matching
normalization/profile lineage.

Acceptance checks preserved raw evidence, authenticated actor attribution,
zero/null data, leading-zero identifiers, blank-row physical addresses, one
staging/normalization/profile run on replay, and one saved review. Immediate
continuation keeps the original mapping after its active pointer changes.
Missing, changed and malformed bytes stop before downstream work; changed bytes
on a resumed run retain partial evidence with a failed run and no completed
upload pointer. Missing storage can recover explicitly. A blocking invalid decimal durably stops
normalization; profiling/review/planning do not proceed and responses omit source
diagnostics. Browser-ready/held/wide fixtures use these same inspection,
staging, executor and profiler paths. Before starting the browser, the runtime
checks all three fixtures' persisted tenant, actor, mapping and run lineage,
successful statuses and reconciled row/cell/column totals. The browser
journey still begins after profiling; setup-time route/service proof and browser
proof are distinct.

File upload/finalization, hosted object storage, schema/mapping selection and
hosted Neon transport are not certified. READY batches and governing metadata
are seeded; their creation/activation flows are not exercised. Setup-only
inspection/staging adapt the existing storage factory to in-memory bytes.
No customer source values are used. Existing review/count/planning, timeout,
cancellation, stale-pin, quality-hold and tenant/session acceptance still runs.

## Run the complete package

Commit the candidate and leave the checkout clean. Install the repository's
locked dependencies, make local Docker available, and use the existing Git Bash
installation on Windows. Then run from the checkout:

```text
node scripts/tests/verify-datahub-analysis-acceptance.mjs
```

The command accepts no target, URL, credential or release arguments. It:

1. Rejects a dirty checkout, pending fixture, or changed pinned D4D5Q script.
2. Builds the current application with external build-only loopback placeholders.
3. Calls the owned PostgreSQL/browser harness, which provisions its own loopback
   database, applies unchanged prerequisite scripts, runs integration tests,
   exercises the real built app and replays D4D5Q with unchanged stored history.
4. Verifies the specifically named test container was removed, its generated
   login fixture is gone, and the local HTTP listener is closed. Other containers
   are inspected by name only; they are never removed or modified.
5. Rejects changed HEAD/dirty state at completion, then records the commit,
   migration Git blob, build ID, artifact SHA-256 hashes and proof limits.

No environment pull, hosted database target, migration outside the disposable
database, deployment, merge, AI or new execution path is provided. Preflight does
not reset, clean, stash or edit user work. A pre-existing fixture stops the run;
inspect and resolve that earlier owned run instead of assuming it belongs to
this invocation.

## Read the result

Generated output stays in ignored `test-results/datahub-runtime`:

| Artifact | Interpretation |
| --- | --- |
| `acceptance-receipt.json` | Latest run status, source/build identity, cleanup and proof limits |
| `evidence.json` | Detailed browser assertions, with intentional fault probes identified |
| `next-server.log` | Local server diagnostics |
| `counts-mobile.png` | Existing count screen |
| `planning-mobile.png` | Governed planning screen |
| `planning-timeout-mobile.png` | Explicit timeout recovery |
| `planning-paging-mobile.png` | Cross-page selection and bounded measure choices |
| `workbook-reviews-mobile.png` | Current saved-review observations and profile/revision references |
| `review-session-mobile.png` | Recovered individual review session and confirmed workbook navigation |
| `review-history-mobile.png` | Historical decision changes compared with a current held review |

Each invocation replaces the latest v2 receipt with `running`, then `passed` or
`failed`. A failed run cannot leave an old passing receipt looking current.
Failure records contain fixed stage/code metadata, not captured exception text
or credentials. A just-generated login fixture is removed on failure; an
earlier pending fixture is preserved. Successful receipts bind the nine evidence
artifacts by hash and deliberately project away diagnostics and actor data.
The v2 receipt requires the current workbook preparation description, setup
storage seam, verified fixture lineage and exactly three fixture worlds. Earlier
raw-insert v1 receipts cannot satisfy the new acceptance input requirements.

A passed receipt means this command's build and owned harness succeeded. It
does not prove repository-wide CI, hosted behavior, tamper-proof provenance,
large-tenant performance or release authority. It checks Git state before/after
the run; it is not an immutable-build sandbox. `releaseAuthorized` is always
false, including when receipt input data attempts to claim otherwise.

## Failure and release handover

For preflight failures, preserve user work and resolve the named condition. For
build, test or cleanup failures, keep the failed receipt and local diagnostics;
do not treat partial screenshots or old evidence as a passing run. The existing
harness removes its own database on exit. If cleanup cannot be confirmed,
identify that owned resource before retrying; never remove unrelated containers.

Before release, independently record the approved exact commit, clean hosted
CI/security/build, target schema and D4D5Q owner verification, backup/restore
readiness, hosted authenticated acceptance and explicit release authorization.
Main auto-deploys. PR #419 remains unmerged under that separate release hold.
Rollback restores the approved application while retaining additive schema and
append-only review history. See [release plan](data-hub-analysis-release-plan.md).

The workbook reader now projects absent governed cells to explicit `null`,
matching its declared scalar contract and the raw-evidence SQL shape. Zero,
false and empty strings retain their values. See
[workbook lifecycle acceptance](data-hub-workbook-lifecycle-acceptance.md).
