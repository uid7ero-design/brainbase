# Workbook preparation overview

The manager-only `/data-hub/import/[batchId]/preparation` page brings persisted
worksheets together before their individual governed reviews. Import history
and the workbook inventory link to it. This bundle introduces no API, database
schema, preparation executor, aggregate executor, AI call or background worker.

## Read and navigation contract

Opening the page reads the existing authorized worksheet inventory only. An
explicit **Check preparation** reads staging, normalization and profile status
for each eligible worksheet. At most two worksheets (six GET requests) are
active, with a 15-second per-worksheet deadline and 120-second overall deadline.
There is no polling, execution or retry. A complete 50-worksheet inventory is
accepted; larger inventories and duplicate IDs/positions fail as a whole.
Every projected worksheet must belong to the requested batch. Additive legacy
DTO fields are ignored rather than copied into state or rendered.

Hidden, very-hidden, empty, ineligible and skipped worksheets remain visible
but are excluded from checks. This display policy does not grant eligibility.
The existing preparation services and routes remain authoritative. Two sheets
with identical names retain distinct physical worksheet positions and IDs.

The summary separates unchecked, ready, in-progress, attention and preparation
states. It counts worksheets, not source rows or successful domain imports.
Filters retain all observations and make no extra request. Only three observed
SUCCEEDED statuses offer a review link. Impossible step ordering is attention,
never readiness. The separate GETs are not an atomic workbook snapshot; the
page records when the scan finished and each destination rechecks its own state.
Preparation readiness does not mean a saved review exists, quality holds have
been cleared, or analytical operations are authorized.

## Recovery and transport

A new scan or inventory refresh clears previous readiness immediately. Stop,
overall timeout, navigation and workbook replacement abort work. Request
identity guards discard late completions, even if a transport ignores abort.
Per-worksheet failure or timeout marks that worksheet unconfirmed/attention;
other successfully checked worksheets can remain visible. Any 401, 403 or 404
invalidates the entire inventory and all completed observations. Explicit
inventory refresh is then required. No server diagnostics enter visible copy.

Inventory and preparation transports send same-origin credentials and no-store
requests. Preparation responses now require JSON content type, valid UTF-8/JSON
and at most one MiB of actual streamed bytes, independent of Content-Length.
Abort releases the waiting caller across headers and body consumption. These
bounds also apply to the previously released single-worksheet preparation page.
Existing endpoint authorization, server-owned tenant/actor identity, private
responses, profile lineage admission and explicit POST behavior are unchanged.
The consistent profile-status transaction has explicit five-second acquisition
and execution bounds. This allows a cold client to start its read alongside
other status requests without relying on Prisma's two-second acquisition default;
failed reads still remain unconfirmed rather than being retried or marked ready.

## Verification and release

Pure/component tests cover metadata projection and mismatch rejection, the
50-sheet bound, exclusion, concurrency, per-sheet timeout, cancellation,
late replies, scope invalidation, filtering, empty inventories and duplicate
clicks. Transport probes cover HTML, invalid UTF-8/JSON, oversized streamed
responses and stalled fetch/body cancellation. Automated accessibility checks
cover initial and checked states.

The existing disposable PostgreSQL/built-browser harness adds genuine inventory
and status reads, keyboard selection, a 390px screenshot, unchanged run/review
history and live role/foreign-batch denials. A delayed genuine profile response
and deliberately mismatched inventory are explicit transport probes followed by
fresh genuine recovery. The existing upload-to-analysis regressions still run.
Loopback Neon HTTP is adapted to the owned PostgreSQL wire protocol; these are
local synthetic checks, not hosted or authenticated Production acceptance.

The acceptance build now uses the same default Next.js build mode as
`package.json` and Vercel. Its historical Webpack override generated a different
Next.js 16 route validator that rejects an existing HR route's defaulted request
parameter; that unrelated route remains unchanged. Type validation stays enabled.

No migration is required. Larger tenant performance, formal screen-reader/color
contrast checks and Production release remain separate decisions. The prior
guided preparation release is already deployed; this new bundle is developed
on its own branch and does not inherit release authority from that earlier PR.
