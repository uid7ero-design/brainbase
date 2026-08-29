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
