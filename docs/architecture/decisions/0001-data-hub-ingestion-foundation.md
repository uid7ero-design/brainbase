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

- `inspectWorkbook(bytes, input, options?) -> Promise<WorkbookInspection>` —
  format, content identity, and a bounded-preview inventory of every
  worksheet.
- `decodeWorksheet(bytes, input, selection, options?) -> Promise<DecodedWorksheet>`
  — full decode of exactly one worksheet, selected by index.

Both are `async` (5A.2D) specifically because an "xlsx"-classified input
must first pass through `assertSafeXlsxArchive` (Section 8) — a genuinely
asynchronous, streaming operation — before either function may call
`XLSX.read`. CSV/XLS decoding remains internally synchronous; the public
contract is uniformly `Promise`-based regardless of format, so callers
never need to know which input format triggered the async archive-guard
path.

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
archives — this transparently rejects materially trailing data (a real
archive followed by bytes that are not themselves a complete, honest
archive) via the comment-length/actual-trailing-bytes consistency check.
**A concatenated second complete archive is a distinct case, rejected by a
different mechanism — see Section 8b, which corrects this paragraph's
original (incorrect) claim that the comment-length check alone was
sufficient for that case too.** Every entry's
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

## 8b. Security remediation after independent review (5A.2D-R1)

An independent (Codex) review of the 5A.2D-R0 candidate proved two
concrete bypasses and identified two further structural gaps. All four
are fixed in this remediation; none required any change to the
architecture, dependency, or limit values recorded in Section 8a.

**Blocker 1 — general-purpose flag policy.** R0 checked only two named
bits (encrypted `0x0001`, data descriptor `0x0008`) and let everything
else — including `0x2000` ("masking of values," used with strong/
central-directory encryption) — through unexamined as long as the
central and local copies agreed with each other. Codex independently
constructed an archive with `0x2000` set consistently on both headers
and proved it passed R0's guard even though `cfb`'s own hardcoded
rejection mask (`flags & 0x2041` — bits 0/6/13) throws on it. Fixed with
an explicit ALLOW-list, `KNOWN_ALLOWED_GENERAL_PURPOSE_FLAGS = 0x0000`,
rather than an ever-growing deny-list — `flags & ~KNOWN_ALLOWED_...`
nonzero is rejected regardless of which bit it is, so an unnamed future
bit fails closed by construction. `0x0000` is not an arbitrary strict
default: it is the empirically-observed value for every entry in both
real xlsx byte-streams available in this repository (SheetJS's own
`XLSX.write` output and the checked-in `public/fleet-dummy-data.xlsx`),
verified directly against both during this remediation. Widening this
mask later requires the same kind of real-byte evidence, never
assumption. Applied independently to both the central directory's Entry
and the local header — not merely relied on via the pre-existing
central/local equality check — so that a value the two headers happen to
*agree* on (the realistic bypass shape) is still caught. A related,
Codex-anticipated risk was also found and fixed during this remediation:
`yauzl` itself throws its own uncoded `Error("strong encryption is not
supported")` for `0x0040` *during central-directory parsing*, before this
module's own per-entry check ever runs — left unhandled, that would have
surfaced as a generic `MALFORMED_WORKBOOK` rather than this module's own
specific `UNSAFE_ARCHIVE` classification. A narrow, internal (never
publicly exposed) reclassification step now attributes that one specific,
well-understood `yauzl` message to `UNSAFE_ARCHIVE`.

**Blocker 2 — local ZIP64 extra field.** R0 only ever inspected the
*central* directory's extra fields for a ZIP64 id (`0x0001`) — the
*local* header's own, independent extra-field bytes (returned raw and
unparsed by `yauzl`'s `readLocalFileHeaderPromise`) were never examined
at all. Codex independently constructed an archive with a clean central
extra field but a local-only ZIP64 extra field and proved it passed.
Fixed by calling `yauzl`'s own exported `parseExtraFields` — the exact
function `yauzl` uses internally to build the central copy's
`entry.extraFields` — against the local header's raw extra-field bytes.
This is reuse of `yauzl`'s one implementation applied to a byte region it
never runs it against, not a second hand-rolled extra-field parser.
Rejected unconditionally, including an empty-payload ZIP64 field: the
mere presence of the id is the policy violation. `yauzl`'s own
`parseExtraFields` throws on a declared field size that runs past the
buffer (truncated framing); this module additionally requires the
declared extra-field length to be *exactly* consumed by whole fields,
with zero leftover bytes — stricter than `yauzl`'s own silent tolerance
of a trailing 1-3-byte pad, because there is no legitimate reason for a
genuine OOXML writer's extra field region to end mid-header, and
admitting that ambiguity would reopen the same "two readers, two
interpretations" class of risk this module exists to close.

**Important finding 1 — incomplete EOCD single-disk validation.** R0
parsed and checked only "number of this disk" (EOCD offset +4). Two
further single-disk fields were never parsed at all: "disk where the
central directory starts" (offset +6) and "entries on this disk" (offset
+8). Codex independently reproduced acceptance of an archive with an
invalid value in one of these. Both are now parsed and required to hold
their single-disk values (`0` and `entryCount` respectively).

**Important finding 2 — central-directory size/extent invariant.** The
EOCD's central-directory-size field (offset +12) was never parsed at
all, so nothing verified that the central directory actually occupies the
exact byte interval this module (and `yauzl`, independently) believes it
does. Fixed by requiring `centralDirectoryOffset + centralDirectorySize
== eocdOffset` exactly (plus explicit bounds checks against the buffer's
actual length) — verified empirically during this remediation, against
both real xlsx fixtures already referenced above, to hold exactly for
genuinely valid archives before being adopted as a hard invariant. No
tolerance was introduced (a mutation proof, `R7`, empirically confirmed
that even a generously-sized 4096-byte tolerance window silently
re-admits a dangerous concatenated archive once the constituent archives
are small enough — the correct fix is exact equality, not a bounded
slack).

**Concatenation/leading-byte investigation — corrected policy, with
evidence.** R0's `workbookArchiveGuard.test.ts` asserted, without
verifying it, that a complete second archive concatenated after a first
"resolves safely, interpreted as just the second archive." That claim
was independently checked during this remediation and found to be
**false**: it assumed `yauzl` and this module's own EOCD search always
"agree" on the trailing archive, but never actually exercised `yauzl` in
isolation to confirm it. Directly verified, both facts:

- This module's own newly-added central-directory extent invariant
  (Important finding 2) correctly rejects a naive `ZIP A || ZIP B`
  concatenation: the second archive's own declared
  `centralDirectoryOffset` is relative to *its own* original standalone
  byte layout, which no longer equals `(eocdOffset - centralDirectorySize)`
  in the combined buffer once a first archive's bytes are prepended.
- Called directly, bypassing this module (for evidence only): `yauzl`
  itself does **not** reject this case. It proceeds using the second
  archive's un-adjusted (and therefore wrong) offset, which — purely by
  coincidence of both test archives being built to an identical byte
  length — happened to land back inside the *first* archive's own byte
  range, silently returning entries read from the wrong archive's data
  with no error at all. This is the real, live divergent-interpretation
  risk this module exists to close; R0's "both agree" comment was an
  unverified assumption, not a fact.

The equivalent "arbitrary leading bytes || ZIP" case (self-extractor-style
stub layout) was also directly verified: `yauzl` does **not** perform any
base-offset adjustment for a shifted archive and fails outright ("invalid
central directory file header signature") once leading bytes shift the
declared central-directory position — this module's own extent invariant
independently rejects the identical bytes first, before `yauzl` is ever
given them, for the same structural reason as the concatenation case.
Both concatenation-family test cases are now corrected to assert
rejection, with this evidence recorded directly in the test file.
"Multiple/ambiguous EOCD signatures" (a third variant considered) is not
separately constructible under this module's zero-comment contract — any
byte sequence that could hide a decoy EOCD signature is already covered
by the "materially trailing data" case, since a genuine comment (the only
place a decoy could plausibly live) is unconditionally rejected before
that question could even arise.

**No architecture change.** All four fixes above are additions to the
same design recorded in Section 8a — no dependency changed
(`yauzl@3.4.0` / `@types/yauzl@3.4.0` / `crc-32@1.2.2`, unchanged), no
limit value changed, and the bounded-streamed-validation-before-SheetJS
architecture is unchanged. Mutation-proved (temporarily, never committed):
loosening the flag allow-mask broadly; permitting `0x2000` specifically;
disabling local ZIP64-extra detection; skipping either new EOCD
single-disk check; disabling the central-directory extent reconciliation;
and weakening that reconciliation to a tolerance window instead of exact
equality — each caused a real, previously-passing test to fail, then was
reverted and reconfirmed clean before this remediation was committed.


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

## 13. RawFileStore — storage contract and local/test foundation (5A.2E)

`lib/data-hub/storage/rawFileStore.ts` establishes the minimum durable
object-storage abstraction so a future private Vercel Blob adapter
(5A.2F) can be built without redesign, and so the eventual
initiate/finalize ImportBatch lifecycle (5A.2G) can depend on a stable
contract rather than a concrete provider. It knows nothing about HTTP,
organisations, ImportBatch rows, or the workbook parser.

Interface (preserved exactly as reviewed):

    interface RawFileStore {
      readonly provider: string
      put(key, body: Uint8Array, opts?: { contentType? }): Promise<RawFilePutResult>
      head(key): Promise<RawFileMetadata | null>
      get(key, opts?: { maxBytes? }): Promise<{ metadata, body: Uint8Array }>
      delete(key): Promise<void>
    }

put() is Uint8Array only — no AsyncIterable/streaming input. This was
deliberately narrowed during independent architecture review: the
committed direct-browser-to-private-Blob protocol (Section 9) means
canonical Production code never calls RawFileStore.put() with uploaded
workbook bytes at all — the browser writes directly to the provider via
a separate, not-yet-built direct-upload capability (own module in
5A.2F/5A.2G, entirely outside RawFileStore). put() exists for test-
fixture seeding and any reference/reconciliation writes only. No
identified caller ever needed streaming input, so it was not added.

Provider identity: every implementation exposes a stable, explicit
`provider` string (`"memory"`, `"test-fs"`; a future Blob adapter would
use e.g. `"vercel-blob"`). It is never inferred from environment and
never left for a caller to supply.

Canonical key construction: `buildImportBatchKey(organisationId,
importBatchId)` is the single sanctioned way canonical code mints a
storage key. Grammar: `org_<organisationId>/importbatch_<importBatchId>`
— ASCII letters/digits/underscore/hyphen segments joined by `/`, no
leading/trailing slash, no `.`/`..` segment, no empty segment, no
backslash, no NUL, no colon (rules out Windows drive forms). Never
embeds the original filename (untrusted, unsafe-character-bearing
client input) and never embeds SHA-256 (explicitly non-unique per the
5A.2C ImportBatch schema's own idempotency design — two distinct
ImportBatch rows may legitimately share identical bytes).

Key validation (`validateStorageKey`) enforces this same grammar
independently and identically inside every RawFileStore implementation
— not only relied upon via the builder — so a caller that bypasses the
builder, or a future bug in it, still cannot produce a key one
implementation accepts and another rejects. Proven by a shared
invalid-key matrix test run against both implementations.

Tenant isolation boundary: RawFileStore remains tenant-agnostic. No
operation accepts an `organisationId` parameter. Isolation is enforced
one layer up, by `buildImportBatchKey`'s organisation-scoped namespace
plus the database's existing composite-FK tenant-scoping discipline
(the same pattern already used by ImportBatch/Upload in 5A.2C). The
storage layer validates key syntax, never authorization.

No-overwrite semantics: `put()` on an existing key always throws
ALREADY_EXISTS, including for byte-identical content. There is no
read-compare-write, no hash comparison, and no silent-success-on-retry
behavior. RawFileStore does not implement API/import idempotency —
ImportBatch/API orchestration owns retry/idempotency semantics (the
5A.2C schema's own `idempotency_key` column exists for exactly this
purpose, one layer above storage).

Idempotent delete: `delete()` returns `void`. A missing key is success,
not an error — repeated deletes are always safe. This matches live-
verified current `@vercel/blob` behavior: `del()` on the real provider
already returns `void` and is documented as never throwing when the
target doesn't exist; inventing a `{ deleted: boolean }` return would
require every implementation to fabricate a distinction the actual
target provider does not natively expose.

Minimized five-code error model: `NOT_FOUND` (get() on a missing key —
head() returns `null` instead, deliberately asymmetric with the real
Blob SDK's own head()-throws/get()-returns-null convention, chosen for
internal consistency and documented as a required adapter-side
translation point for 5A.2F), `ALREADY_EXISTS`, `INVALID_KEY`,
`SIZE_LIMIT`, `PROVIDER_FAILURE`. `INTEGRITY_FAILURE` was considered and
rejected — no identified caller in this phase; content-integrity
verification is finalize's own sha256 computation over already-
retrieved bytes, not a storage-layer concern. No raw filesystem/provider
error object, class, or message is ever required by a caller to
determine behavior — every implementation normalizes its own errors
before they cross the interface (proven by a dedicated EISDIR-forcing
test against the filesystem implementation, which also caught and fixed
a real gap: `get()`'s read path originally had no `catch` clause at all
and would have leaked a raw Node `ErrnoException` for any error
surfacing only once a read is attempted, e.g. opening a directory
succeeds but reading it throws EISDIR).

Bounded get()/maxBytes requirement: `get(key, { maxBytes })` enforces a
hard ceiling on materialized bytes. This exists because a future direct-
upload flow lets an untrusted browser place an object into storage
*before* the parser ever sees it — finalize must not blindly download an
arbitrarily large stored object into memory and only discover
`bytes.byteLength > maxOriginalBytes` afterward. The intended application
flow is head() first (cheap, checks declared size against policy) then
get() with the same maxBytes — but maxBytes still exists and is still
enforced independently at get() time even after a successful head(),
because head()'s reported size must never be blindly trusted as an
unconditional license to materialize without limit (a provider
inconsistency, or in the filesystem implementation a declared-vs-actual
mismatch, must not silently produce an over-limit result). The
filesystem implementation enforces this by reading at most
`maxBytes + 1` content bytes regardless of the object's declared size —
never allocating a buffer sized to the untrusted/declared length — and
treats actually reading more than `maxBytes` bytes as SIZE_LIMIT even
when the declared header size looked acceptable. `maxBytes` itself is
validated as a finite, non-negative integer; a malformed value throws a
plain `TypeError`, not a sixth storage error code — this is a programmer
error, not a domain failure, mirroring the identical discipline already
established for `WorkbookLimits` validation in `workbookParser.ts`.

contentType is non-authoritative, opaque metadata: preserved exactly as
given at put() time, returned as-is by head()/get(), never parsed,
validated, or used for authorization, and never fabricated when absent.
Live verification of `@vercel/blob`'s `put()` shows its own `contentType`
option "by default... extracted from the pathname's extension" — since
canonical keys are deliberately opaque and extension-free, a future Blob
adapter cannot rely on that fallback and must always pass `contentType`
explicitly when known.

etag is optional and never fabricated: both reference implementations
leave it `undefined` because neither has a genuine provider-native
etag. No implementation computes a hash of the content merely to
populate this field — a fabricated etag would let a contract test pass
while proving nothing about real provider parity, and could tempt a
future caller into trusting a same-shaped-but-meaningless value as if
it were provider-authoritative.

uploadedAt and SHA-256/expectedSha256 are excluded entirely from
RawFileMetadata — no identified caller needs them from the storage
layer. ImportBatch already owns `created_at`/`updated_at` independently
(set by the database, not the storage provider), and `sha256` remains
exclusively finalize's own server-computed value over retrieved bytes,
never anything storage reports.

In-memory vs. filesystem test roles: `InMemoryFileStore` (`provider =
"memory"`) is a Map-backed implementation with zero I/O and zero
filesystem/network/environment dependence — it proves the contract's
*logical* semantics (no-overwrite, idempotent delete, cross-key
isolation) with no I/O flakiness, but a Map's "no overwrite" is
trivially true by construction and can never prove anything about a
genuine OS-level race. `TestFileStore` (`provider = "test-fs"`) is the
only implementation that exercises *real* atomic-write/no-overwrite-race
semantics a Map cannot simulate. Both are needed; neither substitutes
for the other.

TestFileStore is explicitly TEST-ONLY, never a Production storage
adapter. This is enforced two ways: (1) naming/location — its module
name and this documentation make clear it is a reference/test
implementation, never presented as a Blob-adapter candidate; (2) a hard
runtime guard — its constructor throws immediately if
`process.env.VERCEL` is set, so it fails loudly rather than silently
degrading if ever accidentally wired into a Vercel deployment. No
environment-based provider auto-selection exists anywhere: there is no
`getDefaultStore()`, no `NODE_ENV`-based switch, and no configuration
infrastructure. Every caller must receive a concrete RawFileStore
instance via explicit dependency injection (a function/constructor
parameter), matching this repository's existing convention of explicit,
per-call primitives (`requireRole()`, the `sql` tagged template) rather
than a hidden DI container or module-global singleton.

Filesystem publication algorithm — the mechanism proving both required
safety properties. An earlier draft considered `rename(tempPath,
finalPath)` for exclusive publish and rejected it: POSIX `rename()`
silently REPLACES an existing destination — it is atomic with respect to
visibility, but it is NOT exclusive, and two concurrent writers to the
same key using `rename()` would have the second writer's rename
silently clobber the first, with no error raised to either caller. This
was proven, not merely reasoned about: temporarily reintroducing
`rename()` in place of the real mechanism (mutation M11) reliably
reproduced exactly this failure across repeated runs, with the shared
concurrency test (write-collision + one-winner-one-ALREADY_EXISTS)
failing every time.

The mechanism actually used: every write is (1) fully assembled
in-memory as a single length-prefixed-JSON-header-plus-content buffer
and written to a uniquely-named temporary file in the same directory as
the final destination (`fs.writeFile(tempPath, framed, { flag: "wx" })`),
then (2) published by calling `fs.link(tempPath, finalPath)` — a hard
link, not a rename. POSIX (and Windows NTFS, which Node maps to
`CreateHardLink`) specifies `link()` as atomic and exclusive: for any set
of concurrent `link()` calls targeting the same destination name, the
filesystem guarantees exactly one succeeds and every other fails with
EEXIST. This is the same "atomic exclusive publish via hard link"
technique long used by other file-based systems needing this exact
guarantee (e.g. Maildir-style safe delivery).

  Property A (no silent overwrite race): proven by the shared
  concurrent-same-key-write contract test (two writers race `put()` on
  the same key; exactly one must succeed, the other must receive
  ALREADY_EXISTS, and the final stored bytes must exactly equal one
  complete submitted payload, never mixed/truncated). Confirmed passing
  reliably across repeated runs on the real mechanism, and confirmed
  reliably FAILING when weakened back to `rename()` (mutation M11).

  Property B (no partial visibility): the final key's path does not
  exist as a directory entry at all until `link()` succeeds, and by the
  time `link()` is attempted, the temp file it points at is already
  fully written and closed — there is no window in which the final path
  can be observed with partial content, because it has exactly two
  states: absent, or complete. Proven by a dedicated concurrent
  reader-vs-writer contract test that polls `get()`/`head()` in a tight
  loop for the entire duration of a large (200 KB) concurrent write and
  asserts every single observation was either NOT_FOUND or the complete,
  byte-exact object — never partial. Confirmed reliably FAILING when the
  publish step was mutated to write directly to the final path in
  chunks with an artificial delay between them (mutation M12), which
  produced an observable partially-written object at the final key
  during the write.

  A candidate `open(finalPath, "wx")`-then-write-directly-to-final-path
  design (proposed during architecture review as a simpler alternative)
  was considered and rejected: opening a file exclusively at its final
  name and then writing content across one or more subsequent `write()`
  calls creates exactly the same partial-visibility window this
  algorithm eliminates — the final path already exists (empty or
  partially written) the instant `open()` succeeds, before any content
  has landed. The temp-file-then-link design avoids this entirely by
  never giving the final path an identity until the content behind it
  is already complete.

This phase exposes no new canonical endpoints, does not touch
`services/upload.ts` or any existing upload route, does not modify the
Prisma schema or migration SQL, and does not connect to Production/Neon
or Vercel Blob. **5A.2F** remains the private Vercel Blob adapter
implementing this exact `RawFileStore` interface (its `head()` must
translate the real SDK's `BlobNotFoundError` throw into this contract's
`null`-on-missing convention; its `get()` must translate the real SDK's
`ReadableStream` into a `maxBytes`-bounded `Uint8Array` using the same
streaming-with-a-hard-counter discipline already proven in 5A.2D's
`workbookArchiveGuard`). **5A.2G** remains the direct-upload
initiate/finalize API work, including the separate browser-direct-upload
capability that RawFileStore deliberately excludes.

### 13a. Framing hardening (5A.2E-R2 remediation)

An independent implementation review of the original candidate found
one BLOCKER-adjacent class of defect and several IMPORTANT gaps, all
confined to `TestFileStore`'s on-disk framing — none required changing
`RawFileStore`'s public interface, `InMemoryFileStore`, or the
publication/concurrency architecture in Section 13 above, which were
independently re-verified as correct and left untouched.

Why the framed single-file representation exists at all, honestly
addressed: an in-memory metadata index alongside filesystem-stored
content would have avoided the entire parsing surface below, since
nothing in this test-only, process-lifetime-scoped store needs metadata
to survive a process restart or be read by a separate process. The
format was already committed when this was raised; hardening it in
place — rather than redesigning it out from under an otherwise-correct
publication algorithm — is the narrowly scoped fix this remediation
performs. This framing is test-only. It is not, and must never become,
a Production object format — nothing about it is a candidate for what
a real provider adapter's storage representation should look like.

Maximum header size: `MAX_HEADER_BYTES = 2048`. The framed header's
schema is small and fixed (`{ size: number, contentType?: string up to
255 chars }`); a worst-case encoding is comfortably under 1 KiB, so 2048
bytes leaves generous headroom without being an arbitrary huge ceiling.
The declared 4-byte length prefix is bounds-checked against this
constant, and independently cross-checked against the file's real,
OS-reported size (via `fstat`) — both BEFORE any allocation is sized
from the declared value. This closes the exact defect an independent
review empirically reproduced: a corrupted 4-byte file claiming a
~2 GiB header length previously caused an immediate, unbounded
`Buffer.alloc(headerLength)` with zero validation.

`contentType` bound: `MAX_CONTENT_TYPE_LENGTH = 255` (defined on
`RawFileStore`, enforced by `validateContentType`) — this is the one
variable-length field ever embedded in the framed header, so bounding
it is what makes `MAX_HEADER_BYTES` a meaningful, computable ceiling
rather than an arbitrary guess. A caller supplying a longer value gets
a plain `TypeError` (programmer/caller error), not a storage error code.

Runtime metadata schema validation: `JSON.parse` alone proves only that
on-disk bytes were valid JSON, never that they match the `FileHeader`
shape — the original candidate performed a bare `as FileHeader` cast
with no runtime check. Every parsed header is now validated: it must be
a non-null, non-array object; `size` must be a non-negative safe
integer; `contentType`, if present, must be a string within the bound
above. Any violation is a malformed/corrupt framed object.

Exact body-length reconciliation: for every successful `get()`, the
file's real `fstat`-reported size must equal exactly
`header-prefix + header + declared content length` — no fewer bytes
(a truncated object) and no extra trailing bytes (hidden data past the
declared length). Either violation is `PROVIDER_FAILURE`, never a
silently truncated or silently over-read result. This check runs AFTER
the `SIZE_LIMIT` check against `maxBytes`, so a genuine size-ceiling
violation is never masked as corruption, and corruption is never
misreported as a size-ceiling violation. `head()` does not perform this
check — it never reads content at all, so body-length consistency is
exclusively a `get()`-time concern; this is a deliberate scope decision,
not an oversight.

Content offset comes from the actual validated on-disk header length
(returned alongside the parsed header by `readHeader`), never recomputed
via `JSON.stringify(header)` re-serialization — the original candidate's
fragile assumption that re-serializing a parsed header reproduces its
original on-disk byte length. A dedicated regression test constructs a
real, valid, schema-conforming header padded with insignificant JSON
whitespace (a legal but non-canonical encoding) to prove this: the
correct implementation still returns byte-exact content, while the
fragile recomputation was confirmed (via mutation) to compute the wrong
content offset and trip the body-length reconciliation check above.

Component-level validation before canonical key construction:
`buildImportBatchKey` now validates `organisationId`/`importBatchId`
independently, as opaque single-segment identifiers, BEFORE
interpolating them into the composed key — not only the composed
result, as the original candidate did. This closes a real,
independently-reproduced gap: a component containing `/` (e.g.
`organisationId = "x/y"`) is never rejected by validating only the final
string, because splitting on `/` turns it into additional
individually-valid segments — `validateStorageKey` has no way to know
those segments didn't come from a single component. A caller passing a
malformed identifier now gets a plain `TypeError`, mirroring the
existing `validateMaxBytes` discipline. Identifiers are validated as
opaque safe strings, not coupled to Prisma's cuid format specifically.

Filesystem errors normalized, including setup/read/close paths: two
raw-error-leak paths beyond the already-fixed `EISDIR` case were found
and closed. `ensureParentDir`'s `fs.mkdir` call is now wrapped and
normalized to `PROVIDER_FAILURE` (previously unguarded — a
permission-denied or similar failure propagated as a raw Node error
straight out of `put()`). Both `head()` and `get()`'s handle-close step
is now explicit rather than a bare `finally`, with deliberate
precedence: if the primary read already failed, a subsequent close
failure is swallowed and the primary (normalized) error wins; if the
primary read succeeded but close then fails, the overall operation
becomes `PROVIDER_FAILURE` rather than a silent, possibly-unsafe success.

Lexical containment is not a symlink sandbox (wording correction): an
earlier comment on `resolvePath` implied its containment re-check was
meaningful defense-in-depth against escape. In fact it performs only
lexical path resolution (no `fs.realpath`) — it correctly prevents the
canonical key grammar from ever producing a traversing string, but it
does NOT resolve or defend against an on-disk symlink placed inside
root by another process/test beforehand. That class of hostile-local-
machine precondition is explicitly outside this test-only adapter's
threat model. Ordinary use — a fresh root this store itself populates —
never introduces a symlink, since this module never creates one.
Sandbox-grade hardening (`fs.realpath`, symlink-aware containment) was
deliberately not added; it would be disproportionate for a reference
adapter that can never run in Production (enforced by the constructor's
own `process.env.VERCEL` guard).

No change to hard-link publication architecture: the exclusive
temp-write-then-`fs.link` mechanism, its no-overwrite and
no-partial-visibility properties, and the concurrency contract tests
proving both were independently re-verified during this remediation —
including a fresh, independently-run reproduction of the rejected
`rename()` design's exact failure mode — and were found correct as
designed. Nothing in this mechanism changed.

New regression coverage added in this remediation: fourteen malformed/
corrupt framed-object cases (empty, oversized, truncated, and
schema-invalid headers; wrong-typed/oversized `contentType`; truncated
and over-long bodies), a dedicated resource-bound regression proving a
tiny file with an astronomically large declared header length fails
immediately without a large allocation attempt, a dedicated mkdir-
failure normalization test using a real filesystem precondition (no
mocking framework), a dedicated content-offset regression distinguishing
the actual encoded header length from a re-serialization, explicit
key-component-validation coverage (separator/traversal/unsafe-character
values for both `organisationId` and `importBatchId`), a `maxBytes = 0`
boundary case, a `Number.isSafeInteger` boundary case
(`Number.MAX_SAFE_INTEGER + 1`), and a `Uint8Array` view with non-zero
`byteOffset` over a shared `ArrayBuffer`, proving `InMemoryFileStore`'s
defensive-copy semantics hold for an offset view, not only a
freshly-constructed array.

## 14. Private Vercel Blob adapter (5A.2F)

`lib/data-hub/storage/vercelBlobFileStore.ts` implements `RawFileStore`
against a **dedicated, PRIVATE** Vercel Blob store, provisioned
separately from — and never shared with — the pre-existing store Events
& Ticketing already uses for public artwork (`lib/events/blobStorage.ts`).

**Why a second store, not one shared store.** Vercel Blob's access mode
(public vs. private) is fixed per-store at creation time and cannot be
mixed within one store. Events' store is, and remains, public (its
artwork must be servable to anonymous visitors on the public booking
page). Data Hub's files are internal business data and must be private.
These two requirements are permanently incompatible within a single
store, so Data Hub was given its own store rather than reusing Events'.
The two stores' env vars are distinguished by prefix at the
infrastructure level (Events uses the project's default `BLOB_*` names;
Data Hub's store was connected with a custom prefix) — this ADR
documents that convention exists, not the values themselves.

**Explicit configuration, no default-store resolution.**
`createVercelBlobFileStore({ storeId, token })` takes both as required,
non-optional constructor arguments. Neither is read from `process.env`
by this module — the composition root (5A.2G) resolves the Data Hub
store's env vars and passes them in explicitly. This is a deliberate
choice, not an oversight: with two Blob stores connected to one Vercel
project, the installed SDK's own default credential/store resolution
(OIDC + `BLOB_STORE_ID`, or a bare `BLOB_READ_WRITE_TOKEN` env lookup)
has no way to know which store a caller means, and will silently
resolve to whichever store's env vars happen to be ambient. Making both
values explicit, required constructor inputs — never optional, never
env-sourced inside this module — removes that ambiguity structurally:
a missing value fails the adapter's construction outright rather than
falling back to a default store.

A verified, non-obvious property of the installed SDK (`@vercel/blob`
2.8.0): when a `token` option is supplied to `put`/`head`/`get`/`del`,
the SDK derives the actual target store from the token itself, not from
any `storeId` option passed alongside it — `storeId` only has live
effect on the OIDC-credential auth path, which this adapter never uses.
Consequently `token` being mandatory and always explicit is what
actually guarantees every call reaches the Data Hub store under the
currently installed SDK version; `storeId` is still passed explicitly
on every call as documented intent and defense-in-depth against a
future SDK version changing this precedence, but should not be
mistaken for the operative guarantee.

**Per-operation behavior:**
- `put`: `access: 'private'`, `allowOverwrite: false`,
  `addRandomSuffix: false`, explicit `storeId`/`token`. The canonical
  `RawFileStore` key is used as the Blob pathname verbatim — no
  generated suffix, no filename, no hash appended. If the provider ever
  returns a pathname different from the requested key, the put is
  treated as a provider failure rather than trusted.
- `head`: explicit `storeId`/`token`; the installed SDK's `head()` does
  not accept an `access` option at all (confirmed from the installed
  package's own type declarations) — only `get()` requires one.
- `get`: HEAD-first, with an early size-ceiling rejection before any
  body stream is opened, then a hard running-byte ceiling enforced
  during streaming (not only checked afterward), then a final
  actual-vs-declared size check. A `maxBytes` violation triggers a
  best-effort stream cancellation; a cancellation failure never masks
  the real size-limit error. `maxBytes` is enforced as a running,
  per-received-chunk application-level ceiling — the adapter checks
  immediately after each chunk and cancels on violation, but this
  cannot prevent the underlying stream from delivering a single chunk
  larger than `maxBytes` before application code has a chance to
  observe it; this is not a hard process-memory or OS-level allocation
  cap.
- `delete`: explicit `storeId`/`token`, the canonical key verbatim, no
  URL construction, no wildcard/prefix deletion. Idempotent on a
  missing object.
- All provider failure modes normalize to the existing five
  `RawFileStoreErrorCode` values; no raw SDK error or SDK-specific
  error class ever escapes this adapter.

**Known limitation, accepted as-is:** the installed SDK exports no
dedicated error class for a same-pathname overwrite conflict (the
`allowOverwrite: false` case) — that server-side failure surfaces as
the SDK's generic base error class, indistinguishable at the type level
from other "bad request" failures. Conflict detection therefore relies
on a narrow, explicitly-scoped message-substring check, which is
intentionally the one exception to this codebase's general preference
for typed-error detection over string matching — used only because no
typed mechanism exists for this specific case.

Collision classification currently depends on backend-provided
free-text wording. That wording is a Vercel API response string
returned at request time, not something baked into the installed
`@vercel/blob` package — pinning `@vercel/blob@2.8.0` pins the SDK's
code paths, it does not pin this server-side response text, which can
change independently of any client library version. The check still
fails closed: a wording change would degrade classification from
`ALREADY_EXISTS` to `PROVIDER_FAILURE`, never to a silent overwrite and
never to a swallowed failure. A future controlled live-integration test
that verifies the actual collision response against the real
provisioned private store, before this adapter is ever exposed via a
production API route, is recorded here as a pending 5A.2G / pre-live-
exposure integration-gate item — not as work already done.

**Token/storeId self-consistency (5A.2F-R1 remediation):** the
verified property above — that `storeId` has no live effect on the
token auth path — means a mismatched `{ storeId, token }` pair (a
correct storeId paired with a token for a different store) would
otherwise construct successfully and silently target the wrong store.
`createVercelBlobFileStore` now extracts the store id actually encoded
in the token (a small local parser matching the SDK's own verified
`vercel_blob_rw_<storeId>_<secret>` token format — not an SDK import,
since this helper is not part of the package's public API surface) and
throws a plain configuration error at construction time if it does not
match the supplied `storeId`, or if the token is too malformed for a
store id segment to be recovered at all. The thrown message never
includes the token value.

**Deferred to 5A.2G:** resolving the Data Hub store's env vars and
constructing this adapter (the composition root), wiring it into the
ImportBatch initiate/finalize lifecycle, and any direct-browser-upload
protocol. This phase is the storage adapter only — no schema change, no
API route, no live Blob call (all behavior is proven via a fully
mocked `@vercel/blob`).

## 15. ImportBatch/Upload worksheet-lineage schema — as actually implemented (5A.2C)

This section documents the schema exactly as it exists today
(`scripts/create-import-batches.sql`), superseding any earlier
aspirational framing without deleting the historical record above.

`public.import_batches` is the canonical durable ingestion-lineage table:
one row per physical uploaded file / storage-and-inspection event. Every
column, CHECK constraint, unique constraint, unique index, and foreign
key is applied idempotently by a single `pg_temp.ensure_*()` sequence
(repeatable and fail-loud by construction — see that script's own header
comment) rather than a one-shot `CREATE TABLE`. Key invariants:

- `organisation_id` carries **NO** `ON DELETE` action (not `CASCADE`,
  unlike `uploads.organisation_id`) — this row anchors a durable external
  Blob object via `storage_key`; a synchronous cascade on organisation
  deletion would hard-delete the row (and lose `storage_key`) before any
  tombstone-first Blob-cleanup step could run.
- `sha256` is nullable — under the direct browser-to-private-Blob
  protocol, the authoritative hash is genuinely unknown until finalize
  computes it. The one truthful invariant —
  `status = 'READY'` requires `sha256 IS NOT NULL` — is enforced by the
  `import_batches_ready_requires_sha256` CHECK constraint, not by
  application code alone.
- `expected_sha256` is a separate, client-declared, **non-authoritative**
  hint column — never to be confused with `sha256`. Every consumer of
  this schema (including 5A.2H.1's `inspectWorksheets.ts`) must reverify
  against `sha256`, never `expected_sha256`.
- `@@unique([id, organisation_id])` exists specifically to back a
  composite tenant-scoped foreign key from `uploads` — see below.

`public.uploads` gains additive, nullable canonical worksheet-lineage
columns (`import_batch_id`, `worksheet_index`, `worksheet_name`,
`worksheet_visibility`, `worksheet_is_empty`, `lineage_kind` — NOT NULL,
default `'LEGACY'` — and `canonical_status`). Every existing row is
`lineage_kind = 'LEGACY'` with all five canonical fields NULL, requiring
zero backfill; a canonical row has `lineage_kind = 'DATA_HUB'` and all of
`import_batch_id`/`worksheet_index`/`canonical_status` NOT NULL —
enforced by `uploads_lineage_coherence_check`. `uploads`' seven existing
domain FK relations (`Metric`, `IllegalDumping`, `MissedCollection`,
`DebtorAccount`, `ServiceRequest`, `HlnaInsight`, `EvidenceRecord`) are
untouched by this addition.

Tenant integrity is structural, not merely conventional: the composite
foreign key `uploads_import_batch_org_fkey` on
`(import_batch_id, organisation_id)` references
`import_batches (id, organisation_id)` as `MATCH SIMPLE` (Postgres's
default) — a legacy row (`import_batch_id IS NULL`) is trivially exempt;
a canonical row can never reference an `import_batches` row belonging to
a different organisation, at the database level. Worksheet identity is
likewise structural: `uploads_import_batch_worksheet_key`, a UNIQUE INDEX
on `(import_batch_id, worksheet_index)` — Postgres treats every `NULL`
pair as distinct, so all legacy rows coexist under it, while two
genuinely-identical canonical `(import_batch_id, worksheet_index)` pairs
are rejected outright. This is the exact database-level guarantee
5A.2H.1's real-Postgres proof (Section 18) exercises directly.

## 16. Attempt/failure metadata (5A.2G.0)

Both `import_batches` and `uploads` gain independent, additive
attempt/failure columns: `last_attempt_at`, `attempt_count` (default 0,
`>= 0` CHECK), `last_failure_code`, `last_failure_message` (`<= 500`
chars CHECK), `last_failure_retryable`. These are two **separate**
tracking surfaces for two separate lifecycles — `import_batches`' own
columns belong exclusively to the physical finalize lifecycle
(initiate/finalize/staleReclaim); `uploads`' own columns are reserved for
a **later**, still-unimplemented phase's worksheet-level import-attempt
tracking. 5A.2H.1's `inspectWorksheets.ts` writes to neither: it never
touches any `import_batches` column, and it deliberately leaves every new
`uploads` row's own attempt/failure columns at their schema defaults
(`attempt_count = 0`, the rest `NULL`) — see Section 18.

`import_batches_failure_retryable_status_check` requires
`last_failure_retryable IS NOT NULL` exactly when `status = 'FAILED'`,
and `NULL` otherwise — a targeted, idempotent, self-limiting backfill
(`last_failure_retryable = true` for any pre-existing FAILED row) runs
immediately before this CHECK is added, so a migration over a database
that already has FAILED rows does not fail the `ADD CONSTRAINT` scan.
Full failure-field coherence (code/message also required exactly when
`status = 'FAILED'`) is deliberately **not** a DB CHECK — fabricating
backfill diagnostic text for a pre-existing row would be a materially
different, unsafe kind of backfill; that coherence is left to the
5A.2G.1 service layer.

## 17. Dark direct-upload initiate/finalize architecture and READY semantics (5A.2G.1)

`lib/data-hub/importBatch/initiate.ts` and `finalize.ts` implement the
committed direct-browser-to-private-Blob protocol: `initiate` creates a
pending `ImportBatch` row (`AWAITING_UPLOAD`) and mints a scoped
direct-upload token via `directUploadAuth.ts`; the browser uploads
directly to the Data Hub's private Vercel Blob store; `finalize`
retrieves the bytes server-side, validates size/hash, runs format
preflight, and transitions the row to `READY` or `FAILED`. Both are
**dark, route-free, transport-independent services** — plain functions
taking an already-trusted `{organisationId, userId?}` context, never
resolving their own session/auth, never importing `lib/org.ts`'s
`requireRole`/`requireSession` (those require a real Next.js request
context these services must not depend on). There is no HTTP route
anywhere in this phase; a future route wrapping either service MUST
enforce `manager`+ authorization before ever calling it. Every lookup is
tenant-scoped (`id` AND `organisation_id` together), never global.

**READY semantics (load-bearing, restated precisely because later phases
depend on it):** `status = 'READY'` means **only** that the physical
source file has completed Data Hub's physical finalization stage —
durably stored in Blob, with an authoritative `sha256` computed and
recorded. READY does **not** mean worksheet contents have been parsed,
validated, or are safe to feed to `XLSX.read` without independent
re-verification. `finalize.ts` itself is deliberately **xlsx-free** — it
imports only `fileSignatures.ts` and `workbookArchiveGuard.ts` for
format preflight, and must never import `workbookParser.ts` at all (that
module imports `xlsx` unconditionally at top level, so even importing an
unrelated export would transitively pull `xlsx` into `finalize.ts`'s
import graph). `initiate.ts`'s own insert-first idempotency (a
`Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` on the
`(organisation_id, idempotency_key)` unique key, re-selected and
hard-fingerprint-compared) and `finalize.ts`'s atomic claim/fencing
scheme (`finalizeInternal.ts`'s `claimForFinalize` /
`completeReadyForFinalize` / `completeFailedForFinalize`, each a single
fully-predicated UPDATE keyed on `id` + `organisation_id` +
`attempt_count` generation) are the load-bearing concurrency primitives
5A.2H.1 depends on being already correct and already complete by the
time it ever runs.

## 18. Worksheet inspection/persistence service (5A.2H.1)

`lib/data-hub/importBatch/inspectWorksheets.ts` is the first consumer
that safely bridges from a `READY` `ImportBatch` to structural worksheet
knowledge, persisted as canonical `uploads` rows
(`lineage_kind = 'DATA_HUB'`). It is dark and route-free, exactly like
`initiate.ts`/`finalize.ts` — there is **no runtime caller of any kind**
in this slice (no route, no server action, no cron, no barrel export);
a future caller must enforce `manager`+ authorization before invoking it.

**Ownership split.** `ImportBatch` owns the one physical object (its
`storage_key`, `sha256`, `size_bytes`); a `uploads` `DATA_HUB` row is a
purely **logical** worksheet within that batch. This service never
writes to any `ImportBatch` column, on any path, success or failure —
the physical finalization lifecycle (Section 17) is already complete and
historically fixed by the time this service runs.

**Structural-only persistence.** Only `worksheet_index` (authoritative
identity), `worksheet_name` (descriptive only), `worksheet_visibility`,
`worksheet_is_empty`, and a derived `canonical_status` are persisted.
Headers, preview rows, cell values, mapping data, validation results,
schema classification, and row/column counts are never persisted by this
slice — `row_count`/`column_count` are left `NULL`, never populated from
`inspectWorkbook`'s `declaredRangeRows`/`declaredRangeColumns` (a
preflight signal, not a real count).

**`canonical_status` derivation:** visible AND non-empty →
`AWAITING_CONFIRMATION`; hidden, veryHidden, or empty (any visibility) →
`INELIGIBLE`. This slice never writes `SKIPPED` or `IMPORTED` — those are
later, separate transitions a future phase performs.

**Legacy `uploads` NOT-NULL compatibility fields**, all intentionally
non-authoritative:
- `original_name` — the physical filename combined with the worksheet's
  own name/index, for display only; `worksheet_index` remains the sole
  identity.
- `mimetype` — derived from the **physical** `ImportBatch.content_type`
  via a small fixed map; describes the physical source format, not a
  worksheet-specific MIME object.
- `size_bytes` — always exactly `0`. The physical object's real size
  belongs exclusively to `ImportBatch`; duplicating it across every
  worksheet row would create false accounting if anything ever sums
  `uploads.size_bytes`. `0` is a legacy-compatibility sentinel, never a
  measurement.
- `stored_path` — a deterministic, **deliberately non-operable**
  sentinel of the form `datahub-worksheet:<importBatchId>:<worksheetIndex>`.
  It contains `:`, which `RawFileStore`'s own, unmodified
  `validateStorageKey` rejects as `INVALID_KEY` — proven directly in
  `tests/containment/inspectWorksheets.test.ts`. Physical object
  ownership belongs exclusively to `ImportBatch`; this value can never be
  mistaken for an operable storage key by `RawFileStore.head()`/`get()`/
  `delete()`, by construction, without any special-cased carve-out in
  `RawFileStore`'s own validation logic.

**Mandatory SHA-256 re-verification.** Every invocation recomputes
SHA-256 over the bytes actually retrieved from storage and compares
against the batch's own persisted `sha256` column (never
`expected_sha256`) — unconditionally, not configurable. A mismatch
returns `STORAGE_INTEGRITY_MISMATCH` before any parsing is attempted.

**Idempotency / divergence (`PERSISTENCE_CONFLICT`).** A fresh
inspection derives an ordered, N-worksheet expected descriptor set on
every call. Compared against any existing tenant-scoped `DATA_HUB`
`uploads` rows for the batch: zero existing rows → first-time atomic
`createMany` (Prisma, without `skipDuplicates`, so a genuine
unique-constraint violation from a concurrent racer throws rather than
being silently absorbed — a real `P2002` triggers a re-read and
re-comparison, resolving to idempotent success only on an exact match);
an exact N-row match → idempotent success, zero writes; any partial set,
extra/out-of-range row, or same-index divergent metadata →
`PERSISTENCE_CONFLICT`, **never** topped up, truncated, or overwritten.
This five-case policy, and the real database-level unique index
(`uploads_import_batch_worksheet_key`, Section 15) it depends on, are
both proven against a real disposable Postgres container — see
`scripts/tests/inspectWorksheets.integration.test.ts` /
`scripts/tests/verify-inspect-worksheets.sh` — including a direct proof
that a multi-row `createMany` batch containing one CHECK-violating or
duplicate-index row rolls back in full, with zero rows landing.

**No route, still.** As with Section 17, the standing `xlsx@0.18.5`
route-exposure blocker (Section 8/8a/8b) remains unresolved. This slice
does not change that: `inspectWorksheets.ts` is dark, has zero runtime
callers, and no later phase may build a route that triggers fresh
untrusted-workbook parsing until that blocker is separately, explicitly
resolved.

**Known, accepted limitation — duplicate worksheet names — RESOLVED
(5A.2J.0), see Section 21 for the fix. The paragraph below is preserved
as the original historical record of the defect this phase (5A.2H.1)
knowingly shipped with; it is no longer current behavior.**
`workbookParser.ts`'s `inspectWorkbook` reads an entire
workbook's cell data into `wb.Sheets`, a dictionary keyed by **sheet
name**, not position. If two or more worksheets share an identical name,
`wb.Sheets[name]` resolves to the same, last-parsed physical sheet object
for every colliding index — so `isEmpty` (and, for any future caller
that materializes it, preview content) can reflect the **wrong** physical
sheet's content for a duplicate-named worksheet at a non-final colliding
index. `index`, `name`, and `visibility` remain positionally correct
regardless (both `sheetNames` and the workbook's visibility array are
consumed positionally, never through the name-keyed dictionary).
`decodeWorksheet` does **not** share this defect: it calls
`xlsxAdapter.read` with an explicit `sheets: [index]` option, materializing
exactly one worksheet per call, so there is no multi-entry name-keyed
dictionary in play for it to collide within. Because this slice persists
**no** preview content at all (structural-only, per above), the blast
radius here is limited to a possibly-incorrect `canonical_status` (via
`isEmpty`) for a duplicate-named worksheet — never a wrong index, name,
or existence, and never actual data corruption. A genuine duplicate-named
`.xlsx` fixture could not be constructed via SheetJS's own writer API
during this phase's implementation (`XLSX.write`'s own internal
`check_wb_names` validation rejects it outright, even when
`wb.SheetNames` is hand-edited to bypass `book_append_sheet`'s own
uniqueness guard) — see the code comment on `workbookParser.ts` (near
`inspectSpreadsheetWorksheets`) and
`tests/containment/inspectWorksheets.test.ts`'s own documented finding.
**This is not fixed by this phase.** It must be fixed before any future
phase relies on `inspectWorkbook`'s own preview/`isEmpty` output for a
duplicate-named worksheet.

## 19. Dark tenant-safe worksheet/ImportBatch read services (5A.2H.2)

Four read-only, transport-independent service functions in
`lib/data-hub/importBatch/read.ts` — `getImportBatch`, `listImportBatches`,
`getWorksheet`, `listWorksheetsForBatch` — over `ImportBatch` and the
`DATA_HUB`-lineage `Upload` rows 5A.2H.1's `inspectWorksheets.ts` already
persists. Still dark: zero runtime callers anywhere in the repository
(see `tests/containment/dataHubImportBatchDarkness.test.ts`, updated to
list `read.ts`, and `tests/containment/worksheetReadService.test.ts`'s
own darkness proof). Performs no writes, no storage/Blob access of any
kind, and no workbook parsing — it never imports `workbookParser.ts`,
`xlsx`, `rawFileStore.ts`, or `compositionRoot.ts`.

**Trusted tenant context.** Exactly the same AUTH BOUNDARY discipline as
`initiate.ts`/`finalize.ts`/`inspectWorksheets.ts`: every function accepts
an already-resolved `organisationId` as a plain trusted parameter, never
resolves its own session/cookies, and never imports `lib/org.ts`. A future
route (5A.2H.3) must derive `organisationId` from a real authenticated
session and must never accept it from request input.

**Tenant isolation.** Every query restates `organisation_id` directly in
its own `where` predicate — never solely through a nested relation
filter. `getImportBatch`/`getWorksheet`'s parent-existence check/
`listWorksheetsForBatch`'s parent-existence gate all use `ImportBatch`'s
`@@unique([id, organisation_id])` compound key (the identical
`id_organisation_id` lookup `inspectWorksheets.ts` already uses), so a
wrong-tenant batch and a genuinely nonexistent batch id produce the
identical `BATCH_NOT_FOUND` result. Proven adversarially against real
Postgres — see `scripts/tests/worksheetReadService.integration.test.ts`,
cases 1-8.

**Mandatory lineage predicate.** Every worksheet-shaped query explicitly
asserts `lineage_kind = 'DATA_HUB'` — never inferred merely from
`import_batch_id` being non-null. `getWorksheet` predicates
`id + organisation_id + lineage_kind` together in one query (never
fetched by id alone and permission-checked afterward), so a nonexistent
id, a wrong-tenant id, and a `LEGACY`-lineage id all collapse to the
identical `WORKSHEET_NOT_FOUND` result — deliberately not a distinguishable
`LINEAGE_MISMATCH` code, to avoid leaking which of those three cases
applied. `failureTaxonomy.ts` gains three new `CallerOnlyOutcomeCode`
members for this phase (`WORKSHEET_NOT_FOUND`, `INVALID_CURSOR`,
`INVALID_LIMIT`), reusing the existing `BATCH_NOT_FOUND` verbatim;
`BATCH_NOT_READY` (5A.2H.1's own code) is deliberately never repurposed
for a read outcome, since read.ts does not require `READY` at all.

**Tombstone policy.** `getImportBatch`/`listImportBatches` both exclude
any batch with `deleted_at IS NOT NULL`, folding it into the identical
`BATCH_NOT_FOUND` result rather than a separate `TOMBSTONED` code.
`listWorksheetsForBatch`'s parent-existence gate is the same check, so a
tombstoned parent yields `BATCH_NOT_FOUND` rather than an incorrectly
empty worksheet list. `getWorksheet` additionally re-checks its own
worksheet row's parent-batch tombstone status via a second, explicitly
tenant-scoped `ImportBatch` lookup — a `DATA_HUB` worksheet whose parent
has been tombstoned is never exposed, collapsing to the same
`WORKSHEET_NOT_FOUND`. Proven against real Postgres (cases 23/23b/23c):
a worksheet readable before its parent is tombstoned becomes
`WORKSHEET_NOT_FOUND` immediately after.

**Lifecycle read policy.** Batch reads are NOT restricted to `READY` —
every non-tombstoned physical lifecycle state (`AWAITING_UPLOAD`,
`PROCESSING`, `READY`, `FAILED`, `DELETION_PENDING`) is readable.
`listWorksheetsForBatch` does not require `READY` either: a valid
tenant-owned batch that has not yet had `inspectWorksheets` run against
it simply returns an empty worksheets array, never an error. Worksheet
metadata (visibility, isEmpty, canonicalStatus) is always returned
truthfully and unfiltered — hidden/veryHidden/empty/`INELIGIBLE` rows are
never silently dropped; any such filtering is a future caller's policy
decision. `canonicalStatus` is modeled as the full four-value DB-valid
union (`AWAITING_CONFIRMATION | INELIGIBLE | SKIPPED | IMPORTED`) even
though 5A.2H.1 only ever writes the first two today, so a future writer
of `SKIPPED`/`IMPORTED` requires no `read.ts` type change (proven
representable/readable in case 20, seeded directly since no writer of
those two values exists yet).

**Explicit DTO sanitization.** `ImportBatchSummaryDTO`,
`ImportBatchDetailDTO`, and `WorksheetSummaryDTO` are built via explicit,
field-by-field mapping functions — never a raw Prisma model returned or
spread. Storage internals (`storage_key`/`storage_provider`/
`storage_etag`/`storage_deletion_status`/`storage_deleted_at`), the
`DATA_HUB` `stored_path` sentinel, and every legacy-only `Upload` field
(`schema_type`, `module`, legacy `status`, `row_count`, `column_count`,
`columns_detected`, `field_mappings`, `validation_errors`,
`preview_rows`, `metadata`, `original_name`, `mimetype`, `size_bytes`)
never leave this module — proven both statically
(`tests/containment/worksheetReadService.test.ts`'s DTO-shape
containment) and against real Postgres (case 25's own-key-set proof on
every returned DTO). No join to `User` occurs — `uploadedBy` is exposed
as a bare id only.

**Batch pagination.** `listImportBatches` is bounded (default limit 50,
max 200; `limit <= 0`, `limit > 200`, or a non-integer limit all yield
`INVALID_LIMIT`) and keyset-paginated on `(created_at DESC, id DESC)`,
never offset-based and never a `COUNT(*)` — `hasNextPage` is derived from
fetching `limit + 1` rows. The opaque cursor encodes only the
`(createdAt, id)` ordering tuple, never organisation identity;
`organisation_id` always comes from the trusted context parameter and is
reasserted in the `WHERE` clause independent of any cursor value, so a
forged-but-well-formed cursor can only reposition a caller within their
own already-tenant-scoped result set. Proven against real Postgres:
multi-page traversal has no duplicates or omissions (case 12); a newer
batch inserted between page requests does not corrupt an
already-established traversal (case 13); pagination never crosses tenant
even across a full multi-page walk (case 14); a malformed or
structurally-wrong cursor yields `INVALID_CURSOR` (case 15/15b).

**Pagination-precision remediation (post-review).** An independent
adversarial review of the first candidate found that `created_at` is a
genuine microsecond-precision `TIMESTAMPTZ`, while a JS `Date` — and
therefore the cursor built from one — can only ever represent millisecond
precision. Ordering by the raw column while comparing the `WHERE`-clause
cursor boundary against that same raw column silently and permanently
omitted rows whose real `created_at` fell strictly between the cursor's
millisecond-truncated value and the next row's real value (reproduced
against real Postgres: two `ImportBatch` rows created within the same
millisecond for one organisation, a realistic condition under
concurrent/rapid `initiate()` calls). Fixed by keeping the `ORDER BY` and
the `WHERE`-clause cursor comparison at IDENTICAL precision: both now
operate on `date_trunc('milliseconds', created_at)`, computed by Postgres
itself and selected `AS created_at`, so the value that becomes a JS
`Date` (for both the DTO's `createdAt` field and the next cursor) is
already exactly millisecond-valued, leaving nothing for any driver-level
rounding/truncation to disagree about on the next page's comparison.
Because Prisma's query builder cannot express a function/expression in
`orderBy`/`where` for a non-generated column, `listImportBatches` alone
(no other H.2 operation needed this) uses a narrowly-scoped
`prisma.$queryRaw` built via `Prisma.sql` composition — never
`$queryRawUnsafe`, never string-built SQL; every value (`organisationId`,
the cursor's truncated timestamp and id, and `limit + 1`) is bound as a
real query parameter. Proven against real Postgres with a fixture seeded
via raw SQL (never a JS `Date`/Prisma typed `create()`, which is exactly
the blind spot that let the original bug through): rows sharing one
millisecond but differing only in microseconds are traversed with zero
omissions and zero duplicates; the same fixture, run against the
pre-remediation code, reproducibly fails. No schema/migration change was
required.

**Worksheet ordering.** `listWorksheetsForBatch` orders strictly by
`worksheet_index ASC` with no pagination — re-verified that
`workbookParser.ts`'s `maxWorksheetCount` remains 50 as of this phase, so
a single batch is structurally bounded to at most 50 `DATA_HUB` rows;
`read.ts` does not import `workbookParser.ts` or enforce this bound
itself.

**Read-committed consistency.** No transaction is used anywhere in this
module — none of the four operations combines multiple queries into an
invariant that requires snapshot isolation. `listWorksheetsForBatch`'s
two-step (parent-exists, then children) has a theoretical TOCTOU gap with
5A.2K's not-yet-implemented deletion mechanics; the worst outcome is a
possibly-stale-but-internally-consistent read, never a torn or
cross-tenant one, since `createMany`/`update` statements are atomic under
Postgres at the statement level.

**Darkness.** No `app/**`, `components/**`, `app/api/**`, server action,
cron, or webhook file references `read.ts` or any of its four exported
function names — proven statically
(`tests/containment/worksheetReadService.test.ts`) and by the updated
`tests/containment/dataHubImportBatchDarkness.test.ts`'s repo-wide
importer scan and expected-file-set check.

**Legacy `confirmImport` untouched.** `services/upload.ts`'s
`confirmImport()`/`getUploadHistory()` still have no `lineage_kind`
filtering, exactly as flagged at 5A.2H.2's own architecture-review stage
— this phase does not touch that file. No `read.ts` function calls into
the legacy upload pipeline, and no legacy code calls into `read.ts`.

**H.3 handoff.** A future read-only HTTP route layer can build directly
on these four functions without reimplementing tenant scoping, lineage
scoping, pagination, ordering, DTO sanitization, or error semantics.
H.3 still owns: HTTP authentication/authorization (`requireSession`/
`requireRole`, per this repo's two-layer auth architecture), HTTP status
mapping for the four read error codes, request-shape parsing into the
cursor/limit types this module expects, and the response envelope. As
with 5A.2H.1, the standing `xlsx@0.18.5` route-exposure blocker (Section
8/8a/8b) remains unresolved and is entirely orthogonal to this phase —
`read.ts` never touches `xlsx` directly or transitively — but no future
phase may add a route that re-triggers `inspectWorkbook`/parsing until
that blocker is separately, explicitly resolved.

## 20. Read-only Data Hub HTTP routes (5A.2H.3)

The first live HTTP exposure of `read.ts`. Four `GET`-only routes under
`app/api/data-hub/`: `import-batches` (list), `import-batches/[id]`
(detail), `import-batches/[id]/worksheets` (list), `worksheets/[id]`
(detail) — a thin, uniform adapter over the four 5A.2H.2 functions, with
no new domain logic of its own.

**Auth/role.** Every route requires `requireRole("manager")` — the same
bar the legacy `/api/upload/history` sibling already sets for this class
of upload/import metadata. `organisationId` is taken exclusively from
the resolved session's own `organisationId` (already correctly
resolving a `super_admin`'s active `org_override`/impersonation, exactly
as every other tenant-scoped route in this repo relies on) — never
`homeOrganisationId`, never anything derived from request input. No
route accepts an organisation identifier from a query/path/body/header
parameter at all.

**Prerequisite.** This phase depends on 5A.2H.3-PRE's `confirmImport()`
lineage guard (merged separately, `services/upload.ts`) having already
closed the one concrete attack path the architecture review found:
disclosing a `DATA_HUB` worksheet id through these routes and then
submitting it to the unrelated legacy `/api/upload/confirm` endpoint.

**Error mapping.** `BATCH_NOT_FOUND`/`WORKSHEET_NOT_FOUND` → 404,
`INVALID_CURSOR`/`INVALID_LIMIT` → 400, an unmapped auth rejection → 401,
`"Forbidden"` → 403, any unexpected throw → a generic 500 (never the raw
error). Every H.2 message is passed through verbatim; no route
introduces a new distinguishable outcome, so H.2's own wrong-tenant/
nonexistent/LEGACY/tombstoned indistinguishability guarantee survives
unchanged through the HTTP layer.

**Live-boundary hardening.** `listWorksheetsForBatch` gained a defensive
`take` bound (50, matching `workbookParser.ts`'s own
`maxWorksheetCount` — duplicated as a literal, not imported, since that
module pulls in `xlsx` and `read.ts` must not) now that the function has
a live HTTP caller, even though the bound changes no currently-reachable
behavior under the sole existing writer.

**Cache.** Every response, success or error, sets
`Cache-Control: private, no-store` — this is tenant-scoped operational
metadata with no reason to be cached anywhere.

**Darkness transition.** `tests/containment/dataHubImportBatchDarkness.test.ts`
and `tests/containment/worksheetReadService.test.ts` were both narrowed
from "zero importers of `read.ts`" to an exact-set assertion: precisely
these four route files, and nothing else. A new
`tests/containment/dataHubReadRoutes.test.ts` proves the routes
themselves stay parser/storage/write-free and GET-only. A new
`scripts/tests/dataHubReadRoutes.integration.test.ts` (via
`scripts/tests/verify-datahub-read-routes.sh`) exercises the real route
handlers against real Postgres, with only `lib/org`'s session resolution
mocked — the tenant/lineage/tombstone/pagination boundary itself is
never mocked — including the 5A.2H.2 sub-millisecond pagination
regression re-proven through the actual HTTP path.

**No schema, package, or `read.ts` behavioral change** beyond the one
defensive `take` bound above. The standing `xlsx@0.18.5` blocker remains
untouched and irrelevant — no route in this phase triggers parsing,
storage access, or any write.

## 21. Workbook parser correctness fix — duplicate worksheet names (5A.2J.0)

Resolves the limitation documented in Section 18 (5A.2H.1) — see that
section for the original defect write-up, preserved as historical
record.

**Root cause, empirically confirmed.** SheetJS's whole-workbook read
(`xlsxAdapter.read(bytes, { type: "buffer", sheetRows, ... })`) returns a
`WorkBook` whose `Sheets` property is a dictionary keyed by **sheet
name**. When two or more worksheets share an identical name, the
collision is not merely a lookup ambiguity on *our* side — it happens
inside SheetJS's own parse: `wb.Sheets[name]` after a whole-book read
retains only the **last-parsed** colliding sheet's cell data; the
earlier colliding sheet's content is not recoverable from that same
parsed `WorkBook` object under any property. This was verified directly
(5A.2J.0 discovery and implementation) with a hand-built OOXML `.xlsx`
package containing two identically-named worksheets with distinguishable
content — SheetJS's own writer (`XLSX.utils.book_append_sheet`) rejects
duplicate names outright via its internal `check_wb_names` validation
(even with `wb.SheetNames` hand-edited post-append), so a duplicate-named
fixture can only be constructed by hand-building the ZIP/OOXML package
directly, bypassing the writer entirely — see the fixture builders in
`tests/containment/workbookParser.test.ts` and
`tests/containment/inspectWorksheets.test.ts`.

**Fix.** `inspectSpreadsheetWorksheets` now counts name occurrences
across `sheetNames` up front. For a name that occurs exactly once, the
existing whole-book `wb.Sheets[name]` lookup is unchanged — zero added
cost for the overwhelmingly common case. For a name occurring more than
once, each colliding index is instead resolved via a **targeted,
per-index re-read** — `xlsxAdapter.read(bytes, { type: "buffer", sheets:
[index], ... })` — mirroring `decodeWorksheet`'s own already-safe
pattern below it in the same file exactly: requesting a single explicit
index materializes exactly that one physical worksheet, so there is no
multi-entry name-keyed dictionary left for it to collide within,
regardless of how many other worksheets share its name.

**Resource-bound impact, stated explicitly.** A workbook with no
duplicate names pays exactly the same cost as before this fix — one
whole-book read, zero additional parses. A workbook *with* duplicate
names pays one additional targeted read per **colliding index** (never
per total worksheet count), bounded by `maxWorksheetCount` (50) in the
pathological all-sheets-same-name case. Per the existing `CORRECTION
(5A.2D)` comment on `decodeSpreadsheetWorksheet`, the `sheets` read
option does not reduce ZIP-decompression cost — SheetJS's bundled `cfb`
reader decompresses every archive entry unconditionally regardless of
which sheet is requested — so each extra targeted read here re-pays
full-archive decompression, not merely cell materialization. This is a
real, bounded (by the pre-existing 50-worksheet cap) per-collision cost,
not an unbounded one, and it is paid only by workbooks that actually
contain duplicate-named sheets; it does not weaken the ZIP guard, the
source-file size bound, the sheet-count bound, or either row/column/cell
materialization bound, all of which apply identically to every targeted
read exactly as they already did to the single whole-book read.

**Worksheet identity, reaffirmed.** `worksheet_index` is, and remains,
the sole authoritative identity for every consumer of this module
(`inspectWorksheets.ts`'s persistence, `read.ts`'s reads, and any future
confirmation/decode flow) — `worksheet_name` is, and has always been,
descriptive only. Duplicate worksheet names are not an error condition
at the parser inspection boundary; they are explicitly, correctly
supported — every colliding index now receives its own genuinely
correct, independently-inspected `isEmpty`, `headers`, `previewRows`,
`declaredRangeRows`, and `declaredRangeColumns`, attributed to the
correct physical worksheet regardless of how many other worksheets share
its name. `visibility` was already index-based (via
`wb.Workbook.Sheets`, never the name-keyed dictionary) and remains
unaffected by this fix, empirically reconfirmed rather than merely
assumed.

**`decodeWorksheet` cross-checked, left unchanged.** Independently
re-verified (5A.2J.0) against the same duplicate-name fixtures that
reproduce the `inspectSpreadsheetWorksheets` defect: `decodeWorksheet`
already correctly decodes the exact physical worksheet at a given index
regardless of name collisions, exactly as Section 18 originally
predicted. No change was made to `decodeWorksheet` or
`decodeSpreadsheetWorksheet`.

**H.1 consequence, proven through the narrowest existing test seam.**
`tests/containment/inspectWorksheets.test.ts` now includes a duplicate-
name case (mocked Prisma/storage, no real Postgres, no HTTP —
`inspectWorksheets.ts` remains fully dark) proving a genuinely non-empty
worksheet at a colliding, non-final index now correctly persists
`canonical_status = AWAITING_CONFIRMATION` rather than the previous,
silent, replay-stable `INELIGIBLE` misclassification. Because
`inspectWorksheets.ts` has zero runtime caller anywhere (Section 18), no
already-persisted `DATA_HUB` `uploads` row is affected by this fix
retroactively — there is no live data to repair, and none was attempted.

**Scope discipline.** Production changes are confined to
`lib/data-hub/workbookParser.ts`'s `inspectSpreadsheetWorksheets`
function only. No schema, package, or dependency change — `xlsx@0.18.5`
is unchanged, and the standing public-parser-exposure blocker (Section
8/8a/8b) remains exactly as unresolved as before this phase. No HTTP
route was added, changed, or exposed — `inspectWorksheets.ts` (and, by
extension, `inspectWorkbook`) remains fully dark; this phase does not
begin worksheet-inspection HTTP exposure, `DATA_HUB` confirmation/
import, the canonical illegal-dumping importer, or deletion/retention.

## 22. Dark canonical DATA_HUB confirmation + illegal-dumping transactional importer foundation (5A.2K.1)

The first slice of the `DATA_HUB` confirmation/import step foreshadowed
(and explicitly deferred) by Section 21: a dark, CSV-only,
illegal-dumping-only service, `lib/data-hub/importBatch/
confirmWorksheet.ts`, that takes one worksheet `Upload` row in
`AWAITING_CONFIRMATION` whose parent `ImportBatch` is `READY`, re-verifies
it against trusted database and storage state, decodes and maps its rows,
and atomically commits the domain rows plus the worksheet's `IMPORTED`
transition. Zero HTTP route, zero UI, zero runtime caller of any kind —
see `tests/containment/confirmWorksheet.test.ts` and the exact-set
addition to `tests/containment/dataHubImportBatchDarkness.test.ts` for the
darkness proof.

**Trusted-context-only boundary, unchanged discipline.** `confirmDataHubWorksheet`
accepts exactly `{ organisationId, worksheetUploadId }`, mirroring every
other `importBatch` service (Sections 17-20). Storage locator, worksheet
identity beyond its primary key, lineage, and canonical status are all
resolved from trusted database state — never accepted as caller input.
Worksheet identity is resolved by `id` (primary key) only, reaffirming
Section 21's "`worksheet_index`/row identity, never `worksheet_name`"
principle at the confirmation layer too: two `Upload` rows sharing an
identical `worksheet_name` on the same batch resolve independently,
proven in `scripts/tests/confirmWorksheet.integration.test.ts`.

**xlsx-freedom, a new independent module.** `lib/data-hub/csvOnlyDecoder.ts`
duplicates only `workbookParser.ts`'s CSV-decode semantics (via
`csv-parse/sync` directly), the same "physically separate the xlsx-free
path from the xlsx-carrying path" discipline `fileSignatures.ts`
established in Section 13 — never importing `workbookParser.ts` or
`xlsx`, so this service carries zero transitive dependency on the
standing public-parser-exposure question (Section 8/8a/8b). XLS/XLSX
batches are deterministically rejected (`UNSUPPORTED_FORMAT`) against the
`ImportBatch`'s own trusted `content_type` before any decode is
attempted — never a fallback, never an attempt.

**Atomic claim, no durable `IMPORTING` state.** The service performs all
decode/validation/hash-verification work (storage `GET`, mandatory
SHA-256 re-verification against the batch's own persisted `sha256`, CSV
decode, illegal-dumping row mapping) strictly before opening any
transaction. The transaction itself contains exactly two statements: a
single conditional `tx.upload.updateMany` claim, whose own `WHERE` clause
encodes `id`, `organisation_id`, `lineage_kind: 'DATA_HUB'`, and
`canonical_status: 'AWAITING_CONFIRMATION'` in one predicate (never a
separate `SELECT`-then-`UPDATE`), followed by `tx.illegalDumping.createMany`
gated behind the claim's own row count. `uploads_canonical_status_check`
(Section 15) structurally forbids any value outside
`AWAITING_CONFIRMATION | INELIGIBLE | SKIPPED | IMPORTED` — there is no
"IMPORTING" value this service could persist even transiently; the
transaction boundary itself is the sole claim mechanism, proven
concurrency-safe (two simultaneous confirmation attempts against the same
worksheet converge to exactly one import, never a duplicate) in the real-Postgres
integration harness.

**Illegal-dumping mapper, deliberately not a general framework.**
`lib/data-hub/importBatch/illegalDumpingMapper.ts` matches CSV columns by
fixed, exact name only (`report_date`/`location`/`waste_type` required) —
no caller-supplied field-mapping indirection, unlike the legacy
`modules/dumping/index.ts` pipeline this replaces for the canonical path.
This is CSV-first, illegal-dumping-only by explicit scope: XLS/XLSX
canonical confirmation, every other domain's canonical importer, and any
field-mapping UI are all future, separate work.

**Real-Postgres falsification coverage.**
`scripts/tests/confirmWorksheet.integration.test.ts` (run via
`scripts/tests/verify-confirm-worksheet.sh`, the same disposable
`postgres:16-alpine` container methodology as every harness in Sections
13/17/18/19/20) proves, against the real unmodified service: wrong-tenant
rejection, `LEGACY`-lineage rejection, the full `canonical_status`
eligibility matrix, parent-batch-not-`READY`/tombstoned rejection,
storage-locator authority (the service cannot be redirected to an
attacker-planted key), mandatory hash re-verification, worksheet identity
by id, atomic all-or-nothing rollback of the claim and domain write
together on a mid-transaction failure, and the concurrent-claim race.

**Scope discipline.** Production changes are confined to the three new
files above plus two new `CallerOnlyOutcomeCode` additions to
`failureTaxonomy.ts` (`WORKSHEET_NOT_ELIGIBLE`, `UNSUPPORTED_FORMAT`). No
schema/migration change, no dependency change, no HTTP route, no UI. This
phase does not implement XLS/XLSX canonical confirmation, any other
domain's canonical importer, deletion/retention, or begin HTTP exposure
of any dark Data Hub service — including this one.

## 23. Zero-row-claim regression coverage + transaction-timeout hardening (5A.2K.1-R)

Independent adversarial review of Section 22's candidate found two
required-remediation-level gaps, both closed here on top of the same
commit, without touching its production files.

**Zero-row-claim regression coverage.** The review deterministically
proved (real Postgres, not a mock) that removing `confirmWorksheet.ts`'s
`claim.count === 0` early return produces a false success plus an
orphaned domain row when a worksheet is concurrently transitioned away
from `AWAITING_CONFIRMATION` between Step 1's eligibility read and the
transaction's own claim — and that no existing permanent test (static or
real-Postgres) caught it. Production source was already correct; the gap
was in test coverage. Closed two ways:
- `scripts/tests/confirmWorksheet.integration.test.ts` gained a permanent
  real-Postgres regression that forces this exact TOCTOU deterministically
  (not probabilistically): it spies on the shared production Prisma
  singleton's own `upload.findFirst` — the exact call `confirmWorksheet.ts`
  makes at Step 1 — lets the real read return, then performs a genuine
  concurrent-shaped `UPDATE ... SET canonical_status = 'SKIPPED'` before
  returning control, so the transaction's claim genuinely affects zero
  rows for a real reason. Asserts the intended loser outcome
  (`WORKSHEET_NOT_ELIGIBLE`), zero domain rows, and the worksheet
  remaining `SKIPPED`.
- `tests/containment/confirmWorksheet.test.ts` gained a brace-scoped
  structural assertion (balanced-brace block extraction, not a
  fixed-offset/text-precedes-text check) proving the `if (claim.count ===
  0)` block's own FINAL statement is a `return` — closing the specific gap
  the review identified in the pre-existing "guard text appears before
  createMany" test, which could not distinguish a real early return from
  the guard being present-but-inert.

Both were falsified against the exact review-identified mutation
(bypassing the early return) before being finalized: both failed as
required, then production source was restored byte-for-byte before commit.

**Transaction-timeout hardening.** The review found Prisma's default
5000ms interactive-transaction timeout fails within the documented
`CSV_ONLY_LIMITS.maxSelectedWorksheetRows` (100,000-row) contract.
Reproduced independently against real Postgres (disposable local
container, actual `confirmDataHubWorksheet` call path, unmodified at
measurement time): row counts 1,000–45,000 all completed inside the
default timeout; 60,000/80,000/100,000 all failed with the exact Prisma
message `"the timeout for this transaction was 5000 ms"`, confirming the
default interactive-transaction timeout (not a Postgres parameter-count
or memory limit) as the actual limiting factor. Failure mode was already
safe — real rollback, zero persisted domain rows, worksheet left exactly
`AWAITING_CONFIRMATION` — but left the documented 100,000-row contract
unable to reliably complete, via an unhandled/unsanitized exception.

Exploratory measurement with a temporarily widened timeout (3 runs each
at 50k/75k/100k rows, real Postgres) found true transaction durations of
~4.1–4.3s (50k), ~6.1–6.3s (75k), and ~8.2–8.5s (100k) — all real
`COMMIT`s, all rows persisted, no partial state. `confirmWorksheet.ts`'s
Step 8 transaction now passes an explicit
`{ timeout: IMPORT_TRANSACTION_TIMEOUT_MS }` (30,000ms) — over 3x headroom
above the worst of the three 100,000-row measurements — replacing the
5000ms default. `maxWait` (time to acquire/start the transaction, a
queueing concern independent of row count) is left at Prisma's default;
only the execution ceiling was widened. `createMany`'s existing
single-call structure is unchanged — 100,000 rows completes reliably
within the new bound with wide margin, so no chunking was introduced.
A permanent real-Postgres regression
(`scripts/tests/confirmWorksheet.integration.test.ts`) now seeds a full
100,000-row CSV (the decoder's own row-limit boundary — the header row is
not counted, see `csvOnlyDecoder.ts`) and asserts the import completes,
all 100,000 rows are persisted exactly once, and the worksheet reaches
`IMPORTED` — falsified against the pre-remediation 5000ms default before
being finalized (failed as required), then the timeout fix restored.

**Concurrency semantics unaffected.** Re-ran the zero-row-claim
regression above, the two-simultaneous-callers race, and the
mid-transaction-rollback/atomicity test after the timeout change — all
pass unchanged. A wider execution ceiling changes nothing about which
caller wins a race or whether a failed domain write still rolls back its
claim together with it; it only gives a large, legitimately-running
`createMany` more real time to finish before Prisma gives up on it.

**Error-handling convention, unchanged and now documented explicitly.**
`confirmWorksheet.ts` already had exactly one precedent for a genuinely
unexpected mid-transaction Postgres failure (Section 22's
CHECK-constraint-violation atomicity test, which asserts
`.rejects.toThrow()` rather than a typed `FailureCode`). The
now-eliminated-in-practice timeout error followed that same convention
before this fix (an unhandled `PrismaClientKnownRequestError` propagating
to the caller) and continues to on the rare residual case of a
genuinely-unbounded infra failure beyond the new 30s ceiling. This is a
deliberate, pre-existing dark-service convention, not a gap introduced
here: expected/anticipated outcomes (tenant/lineage/status/parent-state/
format/hash) go through the sanitized `FailureCode` taxonomy; genuinely
unexpected internal failures are left to propagate raw, for a future HTTP
route wrapper to catch and sanitize before this service is ever given a
live caller. No new taxonomy member was added for this, since the
realistic occurrence of this specific failure was eliminated by the
timeout fix itself rather than converted into a typed outcome.

**Scope discipline.** Changes are confined to: one
`IMPORT_TRANSACTION_TIMEOUT_MS` constant and one `{ timeout: ... }` option
on the existing `prisma.$transaction(...)` call in `confirmWorksheet.ts`
(no change to claim predicates, claim ordering, domain payload,
idempotency, tenant behavior, or lineage behavior); one new permanent test
in each of the two existing K.1 test files; and this ADR section. No
schema/migration change, no dependency change, no HTTP route, no UI, no
change to `CSV_ONLY_LIMITS`/global parser row limits. The narrow
parent-`READY` TOCTOU, duplicate-CSV-header-retains-last-occurrence
behavior, and the duplicated CSV/workbook limit-constant debt — all
previously classified informational/non-blocking — are explicitly
untouched by this remediation.

## 24. CSV-only live Data Hub vertical slice — worksheet inspection + illegal-dumping confirmation HTTP exposure (5A.2K.2)

The first live end-to-end Data Hub import workflow, strictly for CSV
illegal-dumping imports: `initiate` → direct upload → `finalize` → CSV-only
inspect → `AWAITING_CONFIRMATION` worksheet → confirm illegal dumping →
`IMPORTED`. Both new steps are thin HTTP wrappers around dark services;
`confirmWorksheet.ts` (Section 22) is unchanged and gains its first
runtime caller. `inspectWorksheets.ts` (Section 18, the XLS/XLSX-capable
inspection service) remains completely dark.

**Why a new inspection service, not a format-gated wrapper around
`inspectWorksheets.ts`.** `inspectWorksheets.ts` imports
`workbookParser.ts`, which does `import * as XLSX from "xlsx"`
unconditionally at module scope. Even though `workbookParser.ts`'s own CSV
branch never calls into SheetJS at runtime, merely importing that module
into a live route's dependency graph still loads `xlsx` into the server
process — a runtime content-type check placed in front of that import
cannot undo the module-scope load. This is the exact reasoning that
motivated `csvOnlyDecoder.ts` (Section 22) to be an independent sibling of
`workbookParser.ts`'s own CSV decode path rather than a wrapper around it.
`lib/data-hub/importBatch/inspectCsvWorksheet.ts` extends the identical
discipline to structural inspection: it imports only
`node:crypto`/`@prisma/client`/`../../prisma`/`../storage/rawFileStore`/
`./compositionRoot`/`../limits`/`../csvOnlyDecoder`/`./failureTaxonomy` —
zero xlsx/`workbookParser.ts`/`inspectWorksheets.ts` reachability, direct
or transitive, statically enforced by
`tests/containment/inspectCsvWorksheet.test.ts`'s own allowlist test.

**Persistence-semantics duplication, not extraction.** The existing-set
Case A–E idempotency/conflict policy (first-persist / exact-repeat-
idempotent / divergence-hard-fails-`PERSISTENCE_CONFLICT` / never-topped-
up-or-overwritten) is structurally mirrored from `inspectWorksheets.ts`'s
own implementation rather than extracted into a shared module or imported
directly — extracting it would have required modifying
`inspectWorksheets.ts`, which this phase's own scope explicitly excluded
("do not materially modify inspectWorksheets.ts"). The two
implementations must be kept behaviourally equivalent by inspection/test,
the same caveat `csvOnlyDecoder.ts` already carries for its own duplicated
row/column/cell limit constants.

**CSV structural semantics.** A CSV batch always yields exactly one
worksheet: `worksheetIndex: 0`, `worksheetName: "CSV"`,
`worksheetVisibility: "visible"` — matching `workbookParser.ts`'s own
`inspectCsvWorksheet` hardcoded values exactly. Emptiness matches that
same function's semantic precisely: a totally empty file (zero parsed
rows including the header row) is empty; a header-only CSV (headers
present, zero data rows) is non-empty. `decodeCsvOnly` (Section 22) is
reused directly rather than re-implementing a second CSV parser call,
so `PARSER_REJECTED`/`LIMIT_EXCEEDED` handling stays byte-identical to
K.1's own.

**Route design.** `POST /api/data-hub/import-batches/[id]/inspect` and
`POST /api/data-hub/worksheets/[id]/confirm-illegal-dumping` — both
`manager+`, both derive tenant exclusively from
`requireRole("manager")`'s resolved `session.organisationId`, both read
no request body at all (no `req.json()` call anywhere in either file),
both supply only `{organisationId, path-id}` to their wrapped service and
let it resolve all other authority (storage locator, format, worksheet
identity) itself. The confirm route's path segment
(`.../confirm-illegal-dumping`, not a generic `.../confirm` with a
body-supplied domain) is deliberately the sole importer-selection
boundary: `confirmDataHubWorksheet` is hardcoded to the illegal-dumping
importer with no dispatch table, so there is no caller choice to secure
because there is no caller choice at all — a request body carrying
`importer`/`domain`/`schemaType` fields has zero effect, proven both
statically (no such field is ever read) and behaviourally (a real request
carrying them still imports into `illegal_dumping`, never anywhere else).

**Error mapping derived from current taxonomy, not invented.** Both
routes reuse existing `failureTaxonomy.ts` codes verbatim — no new code
was added, since every reachable condition (`BATCH_NOT_FOUND`,
`BATCH_NOT_READY`, `UNSUPPORTED_FORMAT`, `STORAGE_NOT_FOUND`,
`PROVIDER_FAILURE`, `STORAGE_INTEGRITY_MISMATCH`, `PARSER_REJECTED`,
`PERSISTENCE_CONFLICT`, `WORKSHEET_NOT_FOUND`, `WORKSHEET_NOT_ELIGIBLE`)
already existed from Sections 18/22. The confirm route's HTTP status
mapping is exhaustive against the full `FailureCode` union (a TypeScript
`Record`), not just the codes `confirmDataHubWorksheet` can currently
return, so a future change to that service's return surface fails
compilation here rather than silently falling through to a generic 500.

**A genuine, previously-undocumented behavior surfaced during
falsification.** Re-inspecting a worksheet that has since been confirmed
(`IMPORTED`) correctly returns `PERSISTENCE_CONFLICT`, not a silent
idempotent success — because the freshly re-derived expectation is always
content-only (`AWAITING_CONFIRMATION`/`INELIGIBLE`, never `IMPORTED`),
while the persisted row has legitimately transitioned. This is inherited,
unmodified behavior from `inspectWorksheets.ts`'s own identical
`classifyExistingSet` design (Section 18), not a K.2 defect — a
worksheet's post-confirmation state is not supposed to be silently
re-derivable from a fresh structural read, and failing loud here is the
correct, conservative choice.

**Falsification.** 15 required mutations performed, tested, and restored
byte-for-byte (`git hash-object` verified against pre-mutation baselines):
removed auth on each route (caught, static); caller-supplied tenant on
each route (caught, static — 3 redundant assertions each); xlsx-reachable
import added to the new service (caught, static — 3 redundant assertions);
caller-supplied importer field on the confirm route (caught, static — 2
redundant assertions); an unauthorized new caller of `confirmWorksheet.ts`
(caught by both the shared darkness exact-set test and
`confirmWorksheet.test.ts`'s own dedicated proof); CSV format gate
disabled (caught, real Postgres — 3 tests); existing-set conflict
detection disabled (caught, real Postgres — 2 tests); cross-tenant batch
predicate weakened in the new service (caught, real Postgres — genuine
`STORAGE_NOT_FOUND` existence-oracle leak surfaced via the storage-key
derivation's own tenant scoping, a real, if narrow, finding); cross-tenant
worksheet predicate weakened in `confirmWorksheet.ts` (real-DB behavior
unaffected by the Step 3 parent-batch lookup's own independent
tenant-scoped defense-in-depth — caught instead by K.1's existing
mocked-Prisma static assertion on the exact `where` predicate, mirroring
Section 22's own original review finding for the identical mutation);
raw unexpected-error leak on the inspect route (caught by the real-PG
behavioral test asserting actual response content — the static regex
proved fragile against a `(err as Error).message` cast and is noted as
minor test-quality debt, not fixed here); `INELIGIBLE`-state confirmation
allowed (real-DB outcome changed via the mapper's own required-header
validation defense-in-depth, still caught by the permanent test's status
assertion); hash verification disabled (caught, real Postgres); and
duplicate worksheet persistence on repeat inspection (the app-level
existing-set gate bypassed entirely — genuinely UNDETECTED by any
existing test, since a CSV batch structurally can only ever have zero or
one existing row and the real Postgres unique index on
`(import_batch_id, worksheet_index)` already backstops actual duplication
via `persistFirstTime`'s own P2002 recovery path; closed with a new
permanent structural test in `inspectCsvWorksheet.test.ts` proving the
`persistFirstTime` call site is reachable only from an `existing.length
=== 0` guard, falsified against the exact mutation before being
finalized).

**Scope discipline.** New files only:
`lib/data-hub/importBatch/inspectCsvWorksheet.ts`, the two new route
files, `scripts/tests/dataHubK2.integration.test.ts` +
`scripts/tests/verify-datahub-k2.sh`,
`tests/containment/inspectCsvWorksheet.test.ts`,
`tests/containment/dataHubK2Routes.test.ts`; plus narrow, expected
exact-set updates to `tests/containment/dataHubImportBatchDarkness.test.ts`
and `tests/containment/confirmWorksheet.test.ts` (both files' own
darkness-exact-set proofs, updated to reflect `confirmWorksheet.ts`
gaining its first authorized caller — the established pattern at every
dark→live transition in this project, not scope creep) and
`vitest.integration.config.ts` (one new `include` entry). No schema or
migration change, no dependency change, no XLS/XLSX exposure of any kind,
no canonical SKIP operation, no second domain importer or generic
importer dispatcher, no UI, and no modification to `inspectWorksheets.ts`,
`confirmWorksheet.ts`, `illegalDumpingMapper.ts`, `workbookParser.ts`, or
`services/upload.ts` (all mutation/falsification testing against these
already-reviewed files was temporary and fully restored — see the
falsification list above). The standing xlsx@0.18.5 dependency risk and
the four pre-existing legacy xlsx-parsing routes remain unchanged,
unaddressed, and explicitly out of scope — this slice adds zero new xlsx
reachability anywhere in the application.

## 25. Confirmation-actor auditability (5A.2L)

A narrow governance-hardening slice, recommended (not required) by the
5A.2-completion discovery: successful `confirmDataHubWorksheet` imports
previously recorded *that* a worksheet was confirmed but never *who*
confirmed it. `Upload` gains two additive, nullable columns —
`confirmed_by` (a `User.id` reference) and `confirmed_at` — set together,
once, only inside the same atomic conditional claim `UPDATE` that already
transitions a worksheet `AWAITING_CONFIRMATION` → `IMPORTED` (Section 22).
No second statement, no separate transaction: if `claim.count === 0`
(lost the race, or the worksheet was never eligible), this `UPDATE`
affects zero rows and neither field is ever written anywhere.

**Distinct from `uploaded_by`.** `ImportBatch.uploaded_by` records who
physically uploaded the raw file; `confirmed_by` records who performed
the *confirmation event* — a different actor, at a different time, and
in practice frequently a different person. The two are deliberately
independent columns with independent FK relations
(`User.confirmed_uploads` via the `"UploadConfirmedBy"` relation name,
disambiguated from the plain `user`/`user_id` uploader relation already
on `Upload`).

**FK semantics mirror `uploaded_by`'s own precedent exactly.**
`confirmed_by` is `ON DELETE SET NULL`, not the plain-default behaviour
`Upload.user_id` itself uses — deleting a user who once confirmed an
import must never be blocked by that historical confirmation. The domain
rows and the fact that *some* authenticated manager confirmed them remain
valid; only the specific actor identity is nulled out.

**Asymmetric coherence, not a naive pair check.** A `CHECK` requiring
"`confirmed_by`/`confirmed_at` both NULL or both set" would itself be
violated by the FK's own `ON DELETE SET NULL` action (which can only null
`confirmed_by`, never `confirmed_at`, in the same action) — making
deletion of *any* user who ever confirmed an import fail outright. The
constraint actually enforced (`uploads_confirmation_actor_coherence_check`)
instead permits `confirmed_at IS NOT NULL AND confirmed_by IS NULL`
(confirmed at a known time, by an actor no longer resolvable) while
forbidding the reverse (`confirmed_by` set implies `confirmed_at` must
also be set — a mismatch here would indicate an application bug, since
`confirmDataHubWorksheet`'s own claim `UPDATE` always sets both together).
Either field non-NULL on a `LEGACY`-lineage row is never legal.
Deliberately does **not** require `confirmed_by IS NOT NULL` whenever
`canonical_status = 'IMPORTED'` — pre-5A.2L `IMPORTED` rows, and any row
whose confirming user was later deleted, must remain legally
representable with `confirmed_by` NULL.

**Zero backfill, zero fabrication.** Every row `IMPORTED` before this
migration ran — and every `LEGACY`-lineage row, regardless of age —
keeps both fields NULL permanently. There is no mechanism, and none was
built, to retroactively attribute a historical confirmation to any actor.

**HTTP trust boundary unchanged in shape.** The confirm route still reads
no request body at all; `confirmedBy` is sourced exclusively from
`requireRole("manager")`'s own resolved `session.userId`, the same trust
discipline as `organisationId`. No new endpoint, no new request field, no
change to the route's public contract.

**`organiser_activity` considered, not integrated.** A generic-shaped
audit table (`entity_type`/`entity_id`/`actor`/`before`/`after`) exists
in this codebase, added between the 5A.2K.2 merge and this slice — but
it is currently written only by organiser board-item routes, with no
existing cross-module write path. Extending it to Data Hub would be real,
separately-scoped integration work (a new `entity_type`, an actor-identity
thread into `confirmDataHubWorksheet`'s trusted context, which already
exists here regardless) — not something this narrow slice performs.
`confirmed_by`/`confirmed_at` on `Upload` remain the durable source of
truth for this specific event; `organiser_activity` remains a plausible
future generic audit stream, not touched today.

**Read exposure.** `WorksheetSummaryDTO` gains `confirmedBy`/
`confirmedAt`, both nullable, raw user id (no profile join), consistent
with `ImportBatchDetailDTO.uploadedBy`'s own existing convention.
Tenant-scoped by the same compound predicate every other worksheet read
already uses — these two fields create no new tenant oracle.

**Scope discipline.** No new parser, importer, HTTP endpoint, or UI. No
XLS/XLSX work. No 5A.3 adoption. The confirm route's own previously-
carried, unrelated-to-this-slice test-coverage gap (no dedicated
unexpected-error-leakage test, unlike its sibling inspect route) was
closed in this slice specifically because this slice directly touches
that route's own trust boundary — no other carried debt (concurrent-
inspection test gap, duplicate-persistence proximity-test fragility,
duplicate CSV headers, K.1's structural boundary fragility, parent-READY
TOCTOU, deletion/retention, the xlsx dependency itself, the four legacy
parser routes) was touched.
