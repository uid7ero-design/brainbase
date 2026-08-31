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
