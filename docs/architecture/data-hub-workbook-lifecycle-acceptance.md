# Workbook-to-planning isolated acceptance

## Guided preparation

The worksheet inventory, import-history worksheet list and review page now link
to `/data-hub/prepare/[uploadId]`. Opening that page only reads status. A manager
explicitly prepares source rows, standardizes values, and builds a dataset
profile, in that order. Existing staging and normalization endpoints retain
their execution and lease rules. A yielded 202 needs another explicit action;
there is no automatic mutation loop. A completed step is not run again when
the page is reopened.

`GET /api/data-hub/worksheets/[id]/profile` reads metadata only, in a repeatable
read transaction. A completed profile is accepted only after the existing
authoritative analysis-context resolver verifies its upload, tenant,
normalization, mapping and profiler-version lineage. Only status and bounded
row/column counts are returned. Failure details, cells, execution credentials
and internal run identifiers are excluded.

The manager-only, bodyless POST invokes the existing `profileUploadDataset`
service using session-derived organisation and actor identity. Missing and
foreign uploads return the same 404 before execution. It preserves the
service's reuse and one-running-attempt behavior, reports RUNNING as 202,
and rechecks the authoritative completed profile before returning readiness.
New interactive profiling is limited to 100,000 normalized cells because the
existing evidence adapter reads those cells into memory. Existing completed
profiles can still be reused above that limit. The pure profiler and SQL
completion functions are unchanged; this slice needs no migration.

After any write, the UI reloads all three statuses before offering the next
step or opening review. Timeout, cancellation, invalid responses and failed
requests clear local readiness and require a read-only status refresh. Stopping
the browser wait does not cancel server work. A running profile cannot be
restarted from this page; an unexpectedly persistent RUNNING attempt requires
administrator investigation under the existing service's lifecycle policy.

Preparation does not select meanings, acknowledge notices, save reviews,
calculate counts or execute planned analysis. Those remain explicit steps in
the existing review/count/planning screen. Production release, large-workload
qualification and disaster recovery remain separate from this implementation.

The local acceptance description below records the earlier workbook fixture
boundary and is retained as historical evidence; its release-status statements
are not a current GitHub or Production status report.

The acceptance boundary now starts at synthetic XLSX bytes instead of inserted
raw rows. It uses the existing manager routes and parser, real PostgreSQL
functions/constraints, existing normalization/profiling and governed saved
review/planning. No endpoint, analytic executor, migration or release grant is
added. Production remains outside the package.

## Missing-cell correction

A SheetJS worksheet need not contain an object for every governed column on
every nonblank row. The physical-row reader previously returned `undefined`
for an absent cell despite declaring `string | number | boolean | null`.
Serialization omitted `rawValue`; the staging function received SQL NULL and
its non-null raw-value guard rejected the entire batch. The existing staging
error surface reported a conflict, and the worksheet could not complete.

The reader now passes `cell?.v ?? null` into its existing value normalization.
The change applies only to physical data-row reading. Missing cells become
explicit JSON null/`NULL` evidence; numeric zero, boolean false, empty strings
and identifier leading zeros remain unchanged. Blank rows still do not become
data rows. No SQL guard is weakened or migration changed.

## Complete local chain

1. Seed synthetic governing schema/mapping metadata and a READY import batch.
   Construct XLSX bytes with a header at physical row 3, governed columns and
   representative values; bind the real SHA-256 to the batch. Use the existing
   in-memory storage implementation through a setup-only factory seam.
2. Invoke the unchanged inspection route using a signed manager session and
   real DB-backed authorization. It creates structural canonical worksheet
   metadata. Reinspection preserves batch/worksheet identity and adds no rows.
3. Invoke the existing staging route. Storage hash checks and actual workbook
   parsing precede batch inserts; the real SQL batch/completion functions
   reconcile rows/cells and publish the completed raw pointer with actor data.
4. Normalize through the existing signed-manager route, then profile through
   the existing service. Save an explicit semantic/quality review and submit
   a closed governed planning selection. Verify normalized/profile lineage,
   descriptions only, unchanged raw evidence and replay-safe pointers.
5. Build browser fixtures through the same chain, including a held worksheet
   and a 54-column/51-measure worksheet. The built browser starts after profile
   preparation and uses real login/session/review/count/planning routes.

## Failure and recovery matrix

| Condition | Required evidence |
| --- | --- |
| Leading-zero IDs, numeric zero, missing cells | Preserved identifier, NUMBER zero and explicit NULL raw evidence; normalized zero; planning contains no private values |
| Physical blank-row gaps | Raw row numbers remain the actual workbook addresses |
| First request yields | 202 with durable progress, no completed pointer; immediate next request resumes |
| Active mapping changes after yield | Original run mapping/header remain pinned; normalization uses that completed raw lineage |
| Inspection/staging/normalization/profile replay | Stable worksheet/run pointers, no duplicate successful attempts or rewritten raw evidence |
| Missing source object | No staging evidence/downstream run; explicitly restoring the same bytes allows staging |
| Changed or malformed bytes before staging | Fixed safe denial, no raw run/rows or downstream work |
| Changed bytes after partial staging | Failed original run, retained partial evidence, no completed upload pointer |
| Invalid decimal after staging | Durable normalization failure; no profile/review/plan; private source diagnostic hidden |
| Missing session, live demotion, foreign tenant | Denial before storage read or execution |

The malformed-byte probe deliberately supplies a matching synthetic hash so
that the actual parser rejection is tested independently of the hash check.
That is fault injection in the owned database/storage fixture.

## Evidence and limits

The browser runtime independently joins each prepared fixture's persisted
tenant/upload/raw/normalization/profile lineage and mapping version, checks
authenticated actor pointers, successful statuses and reconciled totals before
using it. This verifies three prepared worlds; it is not an independent
attestation that arbitrary external databases followed these routes.

The repeatable clean-candidate command writes a v2 acceptance receipt with build
and commit identities, unchanged D4D5Q blob, all six artifact hashes, cleanup
checks, workbook preparation and the explicit storage seam. It rejects the old
raw-insert preparation description or missing lineage/world checks. Receipt
diagnostics and actor data are projected away; release authorization stays
false. See [isolated acceptance](data-hub-isolated-acceptance.md).

File upload/finalization, hosted object storage and database transport, real
schema/mapping selection/activation, large-workload performance, screen-reader
and color-contrast acceptance, target migrations/backup readiness and release
authority remain unverified. The browser does not perform the setup-time file
inspection or staging actions. Main auto-deploys to Production, so PR #419
remains unmerged under the existing owner verification/release hold.
