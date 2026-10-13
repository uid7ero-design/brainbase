# Reproducible isolated Data Hub acceptance

This package extends planning acceptance upstream through the existing
normalization executor and profiler. It also records a repeatable local result
against a clean candidate commit. It adds test/operational tooling, not an
application endpoint, migration, analytical operation or release permission.

## What is exercised

The fixture begins with governed schema/mapping metadata and synthetic raw
staging records in the owned disposable database. A real signed manager session
invokes the existing normalization route, including its executor, batch
persistence and completion guards. The existing profiler then reads those real
normalized records. Explicit semantic/quality decisions are saved through the
review routes, and selected governed descriptions are planned with matching
normalization/profile lineage.

Acceptance checks preserved raw evidence, authenticated actor attribution,
zero/null data, leading-zero identifiers, one normalization/profile run on
replay, and one saved review. A blocking invalid decimal durably stops
normalization; profiling/review/planning do not proceed and responses omit source
diagnostics. Browser-ready/held fixtures now use these same real executor and
profiler paths instead of directly inserting normalized records. The browser
journey still begins after profiling; setup-time route/service proof and browser
proof are distinct.

The raw staging records are synthetic inserts. File upload, storage, workbook
inspection, raw-staging execution and hosted Neon transport are not certified.
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

Each invocation replaces the latest receipt with `running`, then `passed` or
`failed`. A failed run cannot leave an old passing receipt looking current.
Failure records contain fixed stage/code metadata, not captured exception text
or credentials. A just-generated login fixture is removed on failure; an
earlier pending fixture is preserved. Successful receipts bind the six evidence
artifacts by hash and deliberately project away diagnostics and actor data.

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
