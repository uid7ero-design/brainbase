# Runs pilot readiness bundle

Updated 24 October 2026. **Engineering implementation for review; no Production migration, release or pilot configuration activation has been performed by this bundle.** The Production metadata observation in PR #480 is dated 23 October, not a fresh database audit. No real worksheet cells were inspected.

## Owner guidance and explicit decisions

The owner says weight is usually tonnes, time is usually days, and truck working time is hours, and requested confirmation at use. These are suggestions, not confirmed source formats. All 21 field choices start unconfirmed. Editing a choice clears its confirmation. Saving a changed approved mapping requires all 21 confirmations again.

The standalone manager screen `/data-hub/sources/runs-review` remains a draft collector. Its closed download retains `activationAllowed: false` and template references, never governed IDs or source values. The download is rejected by the executable profile parser. It grants no configuration authority.

The new authenticated screen `/data-hub/prepare/[uploadId]/mapping`, linked from worksheet preparation, resolves identities on the server. Only an ACTIVE same-organisation administrator may explicitly **Save and activate reviewed mapping**. This appends an immutable profile version, approval receipt and audit record, and moves the active pointer atomically. The draft's `activationAllowed: false` does not authorize this action; the authenticated administrator action and server validation do.

A manager or administrator must separately confirm that each fresh workbook uses the displayed saved units and formats. Saving a mapping never confirms a workbook automatically. The confirmation binds the upload, source SHA, profile and exact version. Changed versions require a new confirmation. This gate applies only to the fixed pilot Runs worksheet. Other worksheets retain their existing preparation rules and remain separately unready where their documents are v1.

## All 21 fields

Existing governed identities, sensitivity and header row 3 remain fixed. The server checks the exact complete inventory before compiling rules.

| Field | Suggestion | Explicit decision |
| --- | --- | --- |
| Id | Text identifier | Confirm raw text and leading zeros; numeric identifiers remain blocked. |
| Date | Calendar date | Confirm strict AU text, ISO text or genuine Excel date. Bare serial numbers remain unsupported. |
| Run | Text identifier | Confirm identifier semantics and source text. |
| Vehicles | Text/list together | Confirm text/list versus whole-number count; no splitting. |
| Service Type | Text | Confirm source text. |
| Drivers | Text/list together | Confirm text/list versus count; retain PERSONALLY_IDENTIFIABLE sensitivity. |
| Loads | Whole-number count | Confirm signed versus nonnegative and missing policy. |
| Collections Booked | Whole-number count | Same separate decisions. |
| Collections Performed | Whole-number count | Same separate decisions. |
| Not Presented | Whole-number count | Same separate decisions. |
| Contaminated | Whole-number count | Same separate decisions. |
| Total Weight | Tonnes suggested | Confirm tonnes versus kilograms. |
| Ave Bin Weight | Unresolved | Confirm kilograms versus tonnes separately. |
| Bins Per Hour | Bins/hour | Confirm rate meaning, retained as `bins/h`. |
| Weight Per Hour | Tonnes/hour suggested | Confirm `t/h` versus `kg/h`. |
| Travel Time Hrs | Hours suggested | Confirm numeric hours or numeric days; clock text remains blocked. |
| Collection Time Hrs | Hours suggested | Confirm separately. |
| Duration | Days suggested | Confirm numeric days or hours; a day is exactly 24 hours. |
| Travel Distance Kms | Unresolved | Confirm kilometres versus metres. |
| Collection Distance Kms | Unresolved | Confirm separately. |
| Total Distance | Unresolved | Confirm separately; no implicit summation or reconciliation. |

The first saved Runs mapping uses identical source and target units. No unit is inferred from a heading. The general exact conversion engine supports day/hour and mass-rate conversion, but this editor preserves the confirmed source scale.

## Implemented transformation rules

- Closed units now include `d`, `kg/h`, `t/h` and `bins/h`. Duration, mass rate, bin rate and plain mass remain different families. Big-integer arithmetic performs exact conversions; non-terminating results produce findings, never rounded values.
- INTEGER optionally accepts the literal policy `minimum: "0"`. Negative counts then produce `NUMERIC_VALUE_BELOW_MINIMUM`; omitted minimum preserves historical signed-integer behavior. Zero and negative zero remain valid zero; null remains missing.
- Native numbers and strict numeric text are supported. Empty numeric text, grouping separators, additional missing markers and clock duration text such as `01:30:00` are not silently converted. An Excel day fraction must use explicit day units. Time-formatted Excel cells may decode as date-shaped text; those are blocked, not treated as numeric durations.
- DATE retains existing strict calendar policies. A genuine Excel date may decode to the accepted exact UTC-midnight ISO text. Arbitrary datetimes and bare numeric serial dates are unsupported. Identifiers remain raw text, preserving leading zeros.
- New normalization runs use normalizer `v2`. Already pinned `v1` runs may resume only with a legacy-compatible plan: original units and no new minimum policy. New semantics cannot be labelled as a v1 resume. No historical run is repinned or rewritten.

## Saved configuration and first-use enforcement

The API is `/api/data-hub/worksheets/[id]/mapping-setup` (GET metadata; explicit POST SAVE or CONFIRM). It uses fresh session/database role checks, same-tenant scope, a bounded JSON body, a closed request contract, a same-origin write check, private/no-store responses and sanitized failures. Callers cannot submit schema/profile/column IDs. The server binds the closed review to the authoritative fixed schema after structural and sensitivity checks.

Writes lock the active schema, profile and upload, recheck the source/version fingerprint and reject stale state. Equal already-saved choices reconcile without adding a version. Approvals and use confirmations are immutable and record actual actors; both writes append audit records. An uncertain client result requires a metadata refresh, never automatic POST replay. Role loss removes approval controls.

Fresh staging checks approval/confirmation **before reading source bytes**. A SQL INSERT trigger independently checks the exact current profile/version, source SHA, actor and active schema at durable run creation, closing the eligibility-to-insert race. Requests sent directly to preparation are also blocked. Existing raw attempts resume using their original pins; started uploads cannot edit or confirm a replacement mapping and need a fresh upload.

## Migration and release order

`scripts/create-datahub-mapping-confirmations.sql` is additive and manually applied. It extends stored unit/finding constraints, creates approval and confirmation tables, and installs immutable-record and first-use guards. It does not activate profiles, backfill decisions, reset uploads or alter historical pins. No automatic migration or configuration activation is attached to application startup or deployment.

For a separately approved target:

1. Inspect the exact target schema, migration state and active profile pointers; review the concrete migration and release artifact.
2. Apply the existing Data Hub migration chain, including analysis review persistence and governed schema immutability, before this new migration. Apply this unit extension last; older vocabulary migrations must not subsequently narrow the constraints. Reapply this extension only without changing stored history.
3. Release the reviewed application revision only after its checks pass. The new API requires the new tables; a missing migration fails closed as unavailable.
4. An authorized administrator reviews actual source conventions and saves the complete Runs mapping using a fresh workbook. Reuse saved choices later, with explicit confirmation on every new workbook.
5. Complete fresh hosted acceptance before marking the pilot operational.

Do not remove the extension while stored day/rate/minimum findings exist. If a mapping is wrong, stop new preparation and restore only a separately approved prior active pointer with an audit record. Retain every immutable version, receipt, run and review. Restoring v1 again makes normalization ineligible; it does not restore processing.

## Validation and limits

Behavioral/component tests cover exact units, count minima, legacy compatibility, all 21 confirmations, closed contracts, field edit invalidation, stale state, role loss, uncertain-write reconciliation and automated accessibility.

`node scripts/tests/verify-datahub-mapping-setup.mjs` owns a disposable loopback Postgres container and applies the real migration chain, including this migration twice. It exercises real authenticated routes/services and database constraints using synthetic XLSX fixtures with the fixed pilot's complete structural inventory (14 worksheets, 295 columns), real schema matching/selection and all 21 Runs rules. It covers staging, normalization, profiling, quality holds, reviewed counts/history, tenant/role denials, concurrent edits, immutable receipts, direct-SQL confirmation bypass denial and retained historical pins. Setup stores synthetic workbook bytes in memory; this is not hosted Blob upload proof.

The `--browser` option first builds Next and then runs a real Chromium login against the built local application. It verifies all 21 edited confirmations, explicit save and separate workbook confirmation through real API/database writes, desktop and 390px layouts, live role loss and no automatic write replay. Only the Neon HTTP transport is adapted to the owned local database; external browser/fetch requests are blocked. Evidence is written under ignored `test-results/runs-pilot-review/real-browser/`. This is authenticated local proof, not Production or hosted pilot acceptance.

The existing standalone Vite browser proof remains a separate draft-screen check and must not be cited as authenticated Next proof.

## Remaining pilot work

The engineering bundle is ready for review after its checks pass. Production still needs separately approved migration/release, confirmation of real source formats in the application, and one fresh approved pilot-shaped hosted acceptance through schema selection, staging, normalization, profile, review/counts and history. The 272-field proposal remains unconfirmed; nine other DATA worksheets still need their own complete mapping reviews. No customer cells, Production credentials, live pilot configuration, Production migrations or hosted execution were used in this bundle.
