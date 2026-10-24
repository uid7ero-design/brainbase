# Runs pilot readiness bundle

Reviewed 24 October 2026. **Draft review and implementation plan; activation is not approved.** No real worksheet cells were inspected. The Production mapping observation in PR #480 is dated 23 October, not a fresh database audit.

## Owner guidance and confirmation

The owner says weight is **usually tonnes**, time is **usually days**, and truck working time is **hours**. The owner proposed asking for confirmation at the point of use. These are useful suggestions, not confirmation of every column, storage format or conversion.

The manager-only draft screen at `/data-hub/sources/runs-review`, linked from source configuration, collects the 21 decisions together. No field starts confirmed. Changing a field's unit or representation clears its confirmation. A downloaded `runs-field-review.json` uses a closed, versioned review contract, retains `activationAllowed: false`, and includes no report values. It is deliberately rejected by the executable profile parser. Downloads can preserve an incomplete review; nothing is saved to the database or restored automatically.

This first screen is a **standalone draft collector**, not yet a just-in-time preparation gate or a durable mapping editor. It does not create a mapping version, activate a pointer, read customer values, or start staging. Its manager page guard protects navigation; there is no new API or configuration-write permission. A browser checkbox or downloaded JSON is never authenticated authorization to change Production.

## Review of all 21 fields

Every row still needs explicit confirmation. Headings establish identity, not meaning. Existing ordinals, IDs and header row 3 stay fixed.

| Field | Proposal / suggestion | Decision still required |
| --- | --- | --- |
| Id | Text identifier; keep leading zeros | Confirm stored as text. Numeric identifiers must not be silently stringified or zero-padded. |
| Date | Calendar date; format undecided | AU text, ISO text, or genuine Excel date cell. No local timezone default. |
| Run | Text identifier; keep leading zeros | Confirm identifier versus label and source representation. |
| Vehicles | Keep text/list together | Confirm text/list versus a whole-number count. No splitting. |
| Service Type | Preserve text | Confirm existing text representation. |
| Drivers | Keep text/list together | Confirm text/list versus count; retain PERSONALLY_IDENTIFIABLE sensitivity. |
| Loads | Whole-number count | Confirm signed versus nonnegative count and missing convention. |
| Collections Booked | Whole-number count | Same explicit count decisions. |
| Collections Performed | Whole-number count | Same explicit count decisions. |
| Not Presented | Whole-number count | Same explicit count decisions. |
| Contaminated | Whole-number count | Same explicit count decisions. |
| Total Weight | Tonnes suggested | Confirm tonnes versus kilograms; numeric representation. No initial conversion. |
| Ave Bin Weight | Unit left blank | Confirm kilograms versus tonnes separately from Total Weight. |
| Bins Per Hour | Bins/hour proposed | Confirm the stored value is this rate, not a count or percentage. |
| Weight Per Hour | Tonnes/hour suggested | Confirm tonnes/hour versus kilograms/hour. Must retain rate dimensionality. |
| Travel Time Hrs | Hours suggested | Confirm numeric hours versus numeric day fraction or elapsed clock text. |
| Collection Time Hrs | Hours suggested | Same representation decision, separately confirmed. |
| Duration | Days suggested | Confirm elapsed days versus hours and the storage representation. A day means 24 hours, not a workday. |
| Travel Distance Kms | Unit left blank | Confirm kilometres versus metres. Do not infer from the heading. |
| Collection Distance Kms | Unit left blank | Confirm kilometres versus metres. |
| Total Distance | Unit left blank | Confirm separately; no implicit reconciliation or summation. |

## Findings verified against the actual application code

- The workbook parser preserves text, zero, empty strings and absent cells. Absent governed cells become explicit null; an empty string is still present text. It converts genuine Excel date cells to an ISO UTC timestamp. The DATE transformer accepts ISO calendar text and the exact UTC-midnight suffix `T00:00:00.000Z`; it does not accept arbitrary datetimes or bare numeric serial dates. AU policy accepts strict `DD/MM/YYYY` text. The draft date selection is only a suggestion until checked against a sanitized source fixture.
- IDENTIFIER accepts only raw text, preserving leading zeros. STRING likewise does not stringify numeric cells. Choosing text for Vehicles/Drivers therefore needs source-format confirmation.
- INTEGER currently accepts negative values. A requirement to reject negative counts needs a governed validation rule; it must not be represented as already enforced.
- DECIMAL/DURATION accept native numbers or strict numeric text. `01:30:00`, grouping separators, `N/A` and empty numeric text are not silently converted. NULL stays null and numeric zero stays zero.
- DURATION currently supports `s`, `min`, `h`, not `d`. Declaring hours on a raw day fraction `0.5` yields `0.5 h`, not `12 h`. A numeric day fraction needs explicit day units and exact conversion support. Excel cells formatted as times may instead arrive as date-shaped strings; test the actual representation before selecting an adapter.
- The unit vocabulary has no `bins/h`, `t/h` or `kg/h`. Rate semantics cannot be represented by labelling a rate as plain mass or silently dropping its unit. The draft collector records those choices and flags the missing support.
- The original v1 profile remains ineligible for normalization. Review completion, a green deployment and prior synthetic acceptance do not remove that gate.

## Remaining work, grouped into one delivery bundle

| Work package | Concrete deliverable | Acceptance condition |
| --- | --- | --- |
| 1. Confirm the source | Completed 21-field review plus sanitized representative workbook with the original cell types/styles | Explicit dates, units, duration representation, count sign rules and missing markers; all fields accounted for. Retain existing sensitivity. No real driver names needed. |
| 2. Add the required transformation support | Closed day/rate unit vocabulary, exact conversions and any approved elapsed-time/missing-marker/nonnegative-count policies | Day/hour distinctions, mass rates versus bin rates, zero/null, invalid values, large durations and format boundaries covered by behavioral tests. No inferred units, floating-point rounding or generic executable expressions. Version changed normalizer semantics deliberately; verify existing running attempts before release. |
| 3. Put confirmation in preparation | Authenticated server-resolved schema/profile identity, manager review and admin configuration approval; immutable v2 version with actor/audit metadata and stale-version protection | Before a **fresh** attempt begins, unresolved choices block it. Only an explicitly confirmed, activated version may be selected. Reuse that version for identical later exports; ask again if schema/format/unit assumptions change. UI confirmation alone never grants admin rights or updates a pointer. |
| 4. Prove the exact change in isolation | Disposable database configuration test and full browser-to-storage-to-review acceptance using synthetic data with the confirmed formats | Actual fixed-pilot schema matching/selection, all 21 rules, pinned lineage, zero versus missing counts, quality holds, review/history and tenant/role denials pass. A separate synthetic schema with manually injected lineage is insufficient. |
| 5. Review the release and pilot configuration | Exact PR head, CI receipt, exact append-only configuration transaction and rollback receipt | Release/merge/deploy approval and Production configuration approval apply to their concrete artifacts. No automatic migration, pilot activation or backfill from this review screen. |
| 6. Complete pilot acceptance | One explicitly approved fresh pilot-shaped synthetic upload against the activated mapping | Correct fixed schema selection, staging, normalization, profile, review, counts/history and access denials; inspect actual pins and retained evidence before marking Runs operational. Other nine DATA worksheets remain separately unready. |

The engineering pieces can be delivered together after source decisions; avoid a separate PR for each field. The new draft collector, closed review validation and compatibility tests are included in PR #480. Transformation extensions, durable API/editor, preparation gating, configuration writes and fresh hosted pilot acceptance are **remaining work**, not features claimed by this PR.

## Exact configuration and recovery requirements

Prepare the configuration artifact only from confirmed decisions and a fresh scoped metadata read. Record the target organisation/schema/worksheet/profile, complete governed column set, expected old active pointer/document, current version sequence, approved actor, proposed new version ID/document and document hash. Validate the entire document with `parseProfileDocument` and `buildNormalizationPlan`, not just each individual rule.

The future transaction must lock/recheck the target profile, reject stale state, validate an active same-tenant actor with the required permission, append one immutable profile version, update only that profile's pointer, append the audit record and assert exact postconditions before commit. Existing version 1 remains intact because structural matching reads it. Concurrent proposals must not overwrite each other; a retry after an uncertain result must reconcile by identity and content before writing again. The draft collector does not implement this transaction.

Do not repin, reset, delete or reinterpret any historical staging/normalization/profile run or review. New acceptance uses a fresh upload and attempt. If recovery is needed, stop new preparation, restore only the separately approved previous active pointer with an audit record, retain both immutable versions/history, and verify that newly started attempts select the restored version. Restoring v1 means normalization becomes ineligible again; do not claim that rollback restores pilot processing.

## Validation and evidence boundary

`dataHubRunsPilotReview.test.ts` checks the exact inventory/sensitivity, closed review contract, unconfirmed suggestions, explicit counts/missing policy, unsupported choices and genuine XLSX header-row-3 decoding through the existing normalization plan/row transformer. All cell values in these tests are synthetic. The rate fields in the synthetic transformation fixture are explicitly unitless test scalars; this exercises transport/types, **not** dimensional correctness of real pilot rates. Separate assertions prove those rate-unit tokens are rejected today.

`DataHubRunsPilotReview.test.tsx` covers all 21 controls, confirmation invalidation, count decisions, downloaded draft contents, no preparation requests and automated accessibility. These component checks do not prove a deployed authenticated browser session, real customer formats, Production configuration or end-to-end pilot readiness.

`node scripts/tests/verify-datahub-runs-review-ui.mjs` renders the actual client component in an owned loopback Vite harness. It uses a plain-anchor Next Link stub and a representative test theme, not the authenticated Next application. Real Chromium checks cover desktop, 390px mobile overflow, all 21 explicit confirmations, edit invalidation, a genuine downloaded draft, no API requests and no page exceptions. Screenshots and a receipt are written under ignored `test-results/runs-pilot-review/`; they contain synthetic choices only. The page guard is separately tested for manager, unauthorized and forbidden outcomes.
