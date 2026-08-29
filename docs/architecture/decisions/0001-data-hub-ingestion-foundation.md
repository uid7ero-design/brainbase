# 0001 — Data Hub Ingestion Foundation

Status: Accepted (Phase 5A.1)

## 1. Context

BrainBase has at least five independent file-upload code paths today
(`/api/upload` + `/api/upload/confirm`, `/api/files/upload`,
`/api/onboarding/upload`, `/api/trial/upload`, and the unrelated
`/api/hlna/upload` proxy), each with its own permission floor, parser
behavior, and persistence destination. Independent discovery (Phase
5A.1A) found, with direct code evidence, that:

- XLS/XLSX parsing in the two primary pipelines reads only the first
  worksheet (`wb.Sheets[wb.SheetNames[0]]`), silently discarding every
  other sheet.
- `/api/upload/confirm` hardcodes `parseFile(buffer, "text/csv", ...)` in
  every importer, so a confirmed XLS/XLSX upload is always re-parsed as
  CSV — a live, unconditional correctness defect.
- Preview→confirm relies on a literal `os.tmpdir()` path persisted as
  `stored_path`, which is not guaranteed to survive across separate
  serverless invocations.
- A Prisma `Upload` row conflates "one physical file" with "one
  worksheet's dataset" — there is no representation for sheets 1..n of a
  multi-sheet workbook anywhere in the schema.
- `/api/files/upload` requires only `requireSession()` (any authenticated
  user, including `viewer`) to write directly into operational KPI
  tables, while the more mature `/api/upload` requires `manager`.

This ADR does not fix those pipelines. It establishes the foundation a
future canonical pipeline will be built on.

## 2. Canonical future semantic model

- **ImportBatch** = one physical uploaded file / ingestion event.
- **Upload** = one worksheet-level detected/importable dataset, belonging
  to exactly one ImportBatch.

Neither entity is implemented in this phase. This ADR fixes the target
vocabulary so 5A.2's schema work has an agreed name for each concept
before it writes a single migration.

## 3. Parser architecture

`lib/data-hub/workbookParser.ts` exposes two independent, stateless, pure
functions — deliberately not one eager "parse everything" API:

- `inspectWorkbook(bytes, input, options?) -> WorkbookInspection` — format,
  content identity, and a bounded-preview inventory of every worksheet.
- `decodeWorksheet(bytes, input, selection, options?) -> DecodedWorksheet`
  — full decode of exactly one worksheet, selected by index.

Both functions independently classify format and validate signature —
neither assumes the other ran first, and neither shares mutable state.
Both take `input: WorkbookInput` (`{ filename, mimeType? }`) because
format classification is required to decide *how* to parse the bytes at
all, in either operation.

The parser returns only serialization-safe plain values (strings,
numbers, booleans, `null`, and plain arrays/objects of those) — it never
exposes a mutable SheetJS `WorkBook`/`WorkSheet` object to callers, and no
`Date` instance can escape either. SheetJS's `cellDates: true` can hand
back a JavaScript `Date`; every such value is normalized to an ISO-8601
UTC string (`Date.toISOString()`) before it reaches a caller, in both
`inspectWorkbook`'s previews and `decodeWorksheet`'s rows/headers. An
invalid `Date` (SheetJS can produce one from a malformed date serial)
normalizes to `null` rather than letting `toISOString()` throw. This
module contains no BrainBase schema detection, column mapping, or import
logic; `lib/schema-detector.ts` and `lib/column-mapper.ts` remain the
layer above it, operating on the plain rows this module returns, and are
not imported by it.

## 4. Identity

- **SHA-256** is computed over the exact original byte sequence
  (`inspectWorkbook` only) and exposed on `WorkbookInspection.sha256`. It
  is not persisted anywhere by this phase — there is no database
  integration yet. A single changed byte changes the digest
  (behaviorally proven in tests).
- **Worksheet index is the sole authoritative selector.** `decodeWorksheet`
  selects by zero-based index only; an out-of-range index returns
  `WORKSHEET_NOT_FOUND` and never silently falls back to worksheet 0.
- **Worksheet name is descriptive only** — used for display/lineage, never
  for selection. Excel worksheet names are unique within a workbook by
  construction, so no duplicate-name handling was invented; there is no
  evidence today that one is needed.

## 5. Policy boundary

`WorksheetInspection` exposes `visibility` and `isEmpty` as parser facts.
It deliberately does **not** expose an `eligible` field — whether a
hidden or empty worksheet may be imported is a Data Hub policy decision
that belongs above the parser (5A.2+), not a fact the parser can know.

## 6. Validation

- Format is classified from the filename extension only
  (`.csv`/`.xls`/`.xlsx`). A client-supplied MIME type is accepted as
  input metadata but never consulted for classification or gating.
- XLSX requires the ZIP local-file-header signature (`PK\x03\x04`), then
  successful structural recognition by SheetJS (non-zero worksheet
  count). **Signature alone is insufficient** — every ZIP file shares
  that signature, so a *genuinely valid* ZIP archive that isn't an OOXML
  workbook still passes it and is only rejected at the
  structural-recognition step, as `MALFORMED_WORKBOOK`. This is proven
  with a real, standards-compliant ZIP fixture (hand-built with a correct
  local file header, central directory, and end-of-central-directory
  record — independently verified to extract correctly with a real ZIP
  tool during development), not merely with malformed bytes that happen
  to start with the right 4 bytes.
- XLS requires the OLE/Compound-File signature
  (`D0 CF 11 E0 A1 B1 1A E1`), then successful structural recognition.
- CSV has no magic-byte signature. The closest pre-parse gate is
  rejecting content containing a NUL byte, as an "obviously not text"
  check; genuine malformed CSV structure surfaces as `MALFORMED_WORKBOOK`
  from the parse step itself.
- Formulas are never evaluated — proven behaviorally by round-tripping a
  cell whose cached value (`999`) deliberately disagrees with what
  evaluating its formula (`1+1`) would produce, and asserting the cached
  value is what's returned. This is a statement about the installed
  SheetJS Community Edition's actual behavior, not a stronger guarantee.
- **Numeric parser options are validated before they can influence
  parsing.** `maxOriginalBytes`, `maxWorksheetCount`,
  `maxSelectedWorksheetRows`, `maxSelectedWorksheetColumns`, and
  `maxSelectedWorksheetCells` must each be a positive safe integer;
  `previewRowCount` must be a nonnegative safe integer (`0` is a
  deliberately supported "headers only, no preview" contract — it is not
  the same thing as an *unvalidated* negative value, which previously
  reached SheetJS's `sheetRows` option as `0` and was misinterpreted as
  "unlimited"). `NaN`, `Infinity`, negative values, fractional values, and
  unsafe integers are all rejected. Invalid configuration is a programmer
  error: it throws `RangeError` directly, outside of and never caught by
  any of this module's parsing `try`/`catch` blocks, so it can never be
  reclassified as `MALFORMED_WORKBOOK`.

## 7. Resource limits (approved 5A.1 defaults)

| Limit | Value | Enforcement point |
|---|---|---|
| Original file bytes | 20 MiB | Before any parsing, in both `inspectWorkbook` and `decodeWorksheet` |
| Worksheet count | 50 | After a cheap `bookSheets: true` metadata-only read, before any cell data is decoded |
| Selected worksheet rows | 100,000 | `decodeWorksheet`, checked against declared range first (cheap, conservative preflight), then against actual materialized rows (authoritative) |
| Selected worksheet columns | 1,000 | Same as above |
| Selected worksheet cells | 2,000,000 | Same as above |

**Two distinct, deliberately-labeled bases exist for these checks** (each
`WorkbookParserError`'s `details.basis` says which one tripped):

- **`"declaredRange"`** — a cheap, intentionally conservative preflight
  gate using the worksheet's *declared* rectangular dimension (SheetJS's
  `!ref`/`!fullref`), before any row is materialized. It is a rectangular
  estimate (declared rows × declared columns for the cell check), not a
  measurement of real content — a sparse worksheet can declare a large
  range with few real values. It is kept because it is a useful defense
  even though it is approximate, not removed merely for being
  conservative.
- **`"materialized"`** — the authoritative, post-decode check, computed
  from what `decodeWorksheet` actually returns:
  - **columns**: the widest row actually returned — `max(headers.length,
    every decoded data row's length)` — not `headers.length` alone. CSV
    permits ragged rows, so a later row with more fields than the header
    must not bypass this limit merely because the header was narrow.
  - **cells**: `headers.length + sum(row.length for every decoded data
    row)` — the actual number of value slots retained in the returned
    `DecodedWorksheet`. This deliberately does not invent values for
    absent rectangular positions in a sparse/ragged table (it is *not*
    `rowCount × columnCount`), so a worksheet with a wide header but
    mostly-empty rows is never over-counted, and a worksheet with a
    narrow header but a genuinely wide row is never under-counted.

`declaredRangeRows`/`declaredRangeColumns` on `WorksheetInspection` are
exposed as metadata for the same reason: a preflight/early-rejection
signal, never a guarantee of actually-populated rows/columns. **This
phase does not implement an exact workbook-wide row/cell limit** (i.e.
summed across all worksheets) — only per-selected-worksheet limits, per
the approved 5A.1 scope.

**`previewTruncated` is also a conservative signal, not a data
guarantee.** For CSV it is exact (parsing counts real rows, so it is
literally "there is at least one more row"). For XLS/XLSX it is derived
from whether the worksheet's declared range extends beyond the bounded
preview window (SheetJS's `!fullref` marker) — it does **not** by itself
prove another populated data row exists; a single real cell declared far
beyond the preview window can trip it with no additional real content in
between. No unbounded parse was added to make this flag exact for
XLS/XLSX, per the approved containment for this phase.

Legacy `.xls` (BIFF8) is a single sequential stream, not independently
addressable ZIP entries like `.xlsx`. Empirically, SheetJS's `sheets`
filter option does not reduce the amount of the stream it parses
internally for XLS the way it does for XLSX — `decodeWorksheet` still
requests the filter (for consistency and forward-compatibility), but for
`.xls` specifically this does not achieve genuine per-sheet decode cost
avoidance the way it does for `.xlsx`. This is a known, accepted
limitation of the underlying library for the legacy format, not a defect
in this module.

## 8. Security limitation — explicitly not solved here

SheetJS is a fully in-memory parser. **Nothing in this phase — the 20 MiB
byte limit, `bookSheets: true`, `sheetRows`, or the worksheet-count
limit — defends against malicious archive decompression (a "ZIP bomb").**
A small, compliant-looking `.xlsx` file can still expand to a large
in-memory structure once SheetJS decompresses its ZIP entries, before any
limit in this module has a chance to run. No new archive-inspection
dependency was added to solve this in 5A.1, per containment.

**A real decompression boundary is a 5A.2 entry requirement before any
canonical ingestion endpoint is exposed to end users.** Two directions
are plausible and neither is chosen here: a ZIP central-directory
preflight enforcing explicit uncompressed-size/entry-count/compression-
ratio limits before SheetJS ever decompresses the archive, or running the
parse in an isolated worker/process with an enforceable memory and time
boundary. Whichever is chosen must be decided and implemented before
5A.2's canonical endpoint accepts untrusted uploads.

## 8a. Decompression boundary implemented (5A.2D)

Section 8's requirement is now met by `lib/data-hub/workbookArchiveGuard.ts`
(`assertSafeXlsxArchive`), called from both `inspectWorkbook` and
`decodeWorksheet` for every `"xlsx"`-classified input, before either
function's first call into SheetJS. Neither function makes any assumption
that the other has already run — each independently awaits the guard.
`"xls"` (legacy BIFF8, a single sequential stream, not a ZIP archive) is
deliberately never subjected to this guard — no ZIP-decompression vector
exists for that format. `"csv"` never touches it either.

**Concrete risk confirmed before implementation.** Direct inspection of
the installed `cfb`/`xlsx@0.18.5` source (not vendor documentation) showed:
`cfb`'s ZIP reader (`parse_zip`) unconditionally decompresses *every*
central-directory entry before `sheets`/`bookSheets`/`sheetRows` have any
effect — those options limit later worksheet *materialization* only, never
decompression itself (a correction to this file's own §7 wording, which
previously overclaimed that `sheets: [index]` "genuinely decodes only the
selected sheet" for xlsx; see the corrected comment at the `xlsxAdapter.read`
call site in `decodeSpreadsheetWorksheet`). Because this application never
registers Node's native `zlib` with `cfb` (`CFB.use_zlib` is never called
anywhere in this codebase), decompression runs through `cfb`'s pure-JS
`inflate()`, whose output buffer is allocated directly from each entry's
*declared* uncompressed size (`Buffer.allocUnsafe(usz)`) with no cap — a
tiny, standards-shaped `.xlsx` file can declare an arbitrary uncompressed
size and trigger that allocation the instant `XLSX.read` is called, before
this module's pre-existing raw/logical limits (§8 above) have any chance to
run. The pre-existing 20 MiB raw-input cap does not neutralize this: a
realistic ~1000:1 single-layer DEFLATE ratio against a 20 MiB compressed
input still yields ~20 GB decompressed, and a declared-size lie requires no
real compression ratio at all.

**Why metadata-only inspection is insufficient.** A central-directory-only
preflight (reading declared sizes without verifying them) cannot detect a
declared-size lie — the entire vulnerability *is* a declared value with no
relationship to genuine content. `assertSafeXlsxArchive` therefore performs
bounded, streamed, actual decompression of every entry through `yauzl`
(`yauzl@3.4.0`, direct dependency; `pend@1.2.0` its only transitive
dependency), counting real decompressed bytes as they arrive (never
buffering or concatenating them) and verifying CRC-32 incrementally
(`node:zlib`'s native `crc32`, added in Node 20.15/22.2, when available —
mirroring the exact same fallback pattern `yauzl` itself uses internally —
falling back to the `crc-32` npm package otherwise, already present
transitively via `xlsx -> cfb -> crc-32` and declared here directly rather
than relied upon implicitly).

**Initial accepted ZIP contract (intentionally narrow).** Accepts:
single-disk, non-ZIP64, STORED/DEFLATE entries, ASCII-only archive paths, no
archive/entry comments, no data descriptors. Rejects everything else
(ZIP64, data descriptors, traditional/strong encryption, multi-disk,
unsupported compression methods, comments, unsafe or colliding names,
structurally ambiguous layout). This contract may be widened later with
evidence; it must never be silently broadened.

**Central/local header equivalence and range safety.** For every entry,
the module reads the *local* file header (via `yauzl`'s own
`readLocalFileHeaderPromise`, which reads from the same original buffer —
no independent ZIP parsing is implemented here) and verifies it agrees with
the *central* directory's declared compression method, flags, CRC-32,
compressed size, uncompressed size, and raw filename bytes (compared as
raw `Buffer`s, never as decoded strings — proven by a dedicated test using
two ASCII names differing only by case, which a case-insensitive or
decoded-string comparison would incorrectly treat as equal). A small,
narrowly-scoped independent parse of the end-of-central-directory record
(fixed-position, since this module's zero-comment policy makes that
position unambiguous) cross-checks entry count/size/comment-length against
`yauzl`'s own interpretation, closing the specific class of risk where two
different parsers could interpret the same bytes as two different
archives — this also transparently rejects materially trailing data or a
concatenated second archive whose declared comment length doesn't match
its actual trailing bytes, with no separate case needed. Every entry's
computed byte range is checked against every other entry's range (rejecting
duplicate local-header offsets and overlaps) and against the central
directory's own start offset.

**Required limits (all inclusive — value == limit passes, limit + 1
fails):** `maxArchiveEntryCount` 1000; `maxCompressedEntryBytes` 20 MiB;
`maxDeclaredEntryUncompressedBytes` / `maxActualEntryUncompressedBytes` 64
MiB each; `maxDeclaredAggregateUncompressedBytes` /
`maxActualAggregateUncompressedBytes` 128 MiB each; `maxFilenameBytes` 512;
`maxExtraFieldBytes` 4 KiB; `archiveCommentBytes` / `entryCommentBytes` 0.
Compression **ratio** is deliberately not a hard limit — a legitimate,
highly-repetitive `.xlsx` (e.g. a column of a repeated constant across
100k rows) can compress at extreme ratios while remaining absolutely
small; the absolute byte caps above are the real, false-positive-resistant
safety boundary.

**Async public contract.** `inspectWorkbook` and `decodeWorksheet` are now
`async`, returning `Promise<WorkbookInspection>` /
`Promise<DecodedWorksheet>` respectively (CSV/XLS decoding remains
internally synchronous; only the public contract changed). 5A.2D discovery
confirmed zero production callers of either function existed at the time of
this change, making it the correct moment to make the contract consistently
Promise-based rather than adding a parallel sync/async API surface.

**Triple-decompression transitional cost, accepted.** Every public XLSX
operation already called `XLSX.read` twice before this phase (once via
`bookSheets: true` for sheet-name inventory, once for the actual
materialization pass — both already fully re-decompress the archive, per
the `cfb` finding above). Adding this module's own bounded validation pass
makes it three decompression passes total — a ~50% marginal increase, not
a doubling from a 1x baseline. This module never retains a full
decompressed entry's bytes (proven by a dedicated static containment test
asserting the source contains no chunk-accumulation pattern), keeping its
own peak memory bounded by the streaming chunk size regardless of an
entry's declared or actual size. Combining this security slice with a
broader optimization to remove one of the two pre-existing SheetJS passes
was explicitly deferred, not attempted, in 5A.2D.

**Residual exposure — not solved here.** This module protects only
`lib/data-hub/workbookParser.ts`'s two public entry points. It does **not**
protect, and 5A.2D made no changes to: `services/upload.ts` (the live
`/data` upload pipeline), `app/api/files/upload/route.ts`,
`app/api/onboarding/upload/route.ts`, or
`app/api/organiser/boards/[boardId]/import/route.ts` — all of which call
`xlsx`'s `XLSX.read`/`sheet_to_json` directly today and remain equally
exposed to the same decompression risk until a later 5A.3 adoption phase
reconciles them against the canonical parser. This phase does not claim
application-wide XLSX protection.

**SheetJS 0.18.5 dependency-security prerequisite — separately gating
canonical endpoint exposure.** This module closes the ZIP-decompression
boundary specifically. It does **not** make SheetJS's own XLSX/XLS parsing
of already-decompressed content generally secure against every other class
of parser defect. A canonical, untrusted-upload-facing ingestion endpoint
built on `lib/data-hub/workbookParser.ts` remains blocked pending a
separately evidenced decision on the `xlsx@0.18.5` dependency line
(upgrade, replacement, or an explicitly accepted-risk decision) — this
phase does not authorize or perform that upgrade. This applies to `"xls"`
input as much as `"xlsx"`, since the archive guard is never applied to the
legacy format at all.

## 9. Durable storage decision (direction for 5A.2)

No durable file-storage capability exists anywhere in the codebase today
(no `@vercel/blob`/`aws-sdk`/GCS dependency, no configured env var, no
`bytea` column). **Private, immutable Vercel Blob storage is the selected
direction for 5A.2** — same platform as the existing Vercel deployment,
no new vendor relationship. Provisioning a Blob store and adding
`BLOB_READ_WRITE_TOKEN` is a one-time account-level action for the
project owner; it is not performed by this phase.

The SHA-256 computed by `inspectWorkbook`, together with a future
database lineage record, is the authoritative way to identify an
uploaded file's content. **A Blob URL or storage key, by itself, is never
lineage** — it is a retrieval address, not an identity or an audit trail.

## 10. Permission (direction for 5A.2)

The canonical Data Hub mutation path — whatever endpoint 5A.2 builds —
must require `manager` minimum, enforced via `requireRole("manager")`
(`lib/org.ts`), matching the existing `/api/upload` precedent and
CLAUDE.md's documented convention that meaningful write actions require
manager+. This closes the gap where `/api/files/upload` today accepts
any authenticated `viewer`. No existing endpoint's permission is changed
by this phase.

## 11. Phase split

- **5A.1** (this phase): pure parser foundation, identity, resource
  limits, validation, behavioral tests. No schema, no storage, no API, no
  UI.
- **5A.2**: `ImportBatch` + worksheet-level `Upload` lineage schema, a
  canonical ingestion API built on `lib/data-hub/workbookParser.ts`, a
  durable storage adapter (Vercel Blob), the `manager`-minimum permission
  applied to the new endpoint, and a real decompression boundary (Section
  8) before that endpoint is exposed.
- **5A.3**: adoption/reconciliation of the legacy pipelines
  (`/api/files/**`, `/api/onboarding/upload`, `/api/trial/upload`)
  against the canonical architecture.

## 12. Legacy defects intentionally deferred, not fixed, by this phase

- `/api/upload/confirm`'s hardcoded CSV re-parse of XLS/XLSX uploads.
- The `/tmp`-based preview→confirm storage lifecycle.
- `/api/files/upload` accepting any authenticated `viewer`, not just
  `manager`+.
- Non-atomic legacy imports (per-row autocommit in `/api/files/upload`;
  no transaction wrapping in `/api/upload/confirm`).
- The divergent, undocumented `/api/onboarding/upload` and
  `/api/trial/upload` pipelines, including `/api/trial/upload`'s
  `${orgId}::uuid` cast, which contradicts the documented `TEXT`/cuid
  `organisation_id` convention.
- Classification/ownership of the organiser-facing import surfaces
  relative to the canonical Data Hub path.
- The `organisation_id` UUID-vs-TEXT conflict between
  `scripts/migrate-waste.mjs` and the documented convention, which needs
  a live-schema check against the actual database before any lineage
  schema work touches the `uploaded_files` table family.

None of these are fixed by this phase. They are recorded here so 5A.2/5A.3
planning does not need to rediscover them.
