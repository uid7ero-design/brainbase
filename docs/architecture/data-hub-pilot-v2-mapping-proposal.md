# Onkaparinga pilot: v2 mapping proposal

Status: **DRAFT FOR OWNER REVIEW — NOT APPROVED FOR ACTIVATION**. Prepared 23 October 2026 from governed schema/profile metadata only. No customer cell values were read. This proposal changes no database records, active pilot pointers, stored reviews or execution permissions.

## Observed gap

Production schema `dhcfg-onk-mwco-sv1` is ACTIVE with an activation record. All fourteen currently active worksheet profile documents are version 1. Those documents describe the header row but contain no column transformation rules. The current normalizer deliberately returns `NORMALIZATION_INELIGIBLE_V1` for them. A successful application deployment therefore does not make this pilot ready for normalization, profiling or review/count workflows.

Ten DATA worksheets need explicit v2 rules. Overview, Trends and Service Exception Totals remain SUMMARY; Definitions remains METADATA. Their existing dispositions must not be converted into staging datasets merely to complete a test.

Update 24 October: the [Runs readiness bundle](data-hub-runs-pilot-readiness-bundle.md) records all 21 decisions and the owner's provisional tonnes/days/working-hours guidance. PR #480 now includes day/rate units, optional nonnegative counts, a server-resolved administrator mapping editor, immutable saved versions and manager confirmation before each fresh workbook's first preparation. Its additive migration and application changes are for review; they have not been applied to Production. The standalone draft download remains non-activating. The full 272-field matrix remains unconfirmed. Real source formats, separately approved Production migration/release/configuration and fresh hosted pilot acceptance remain required. The following Production inventory is the 23 October observation, not a current audit.

## Recommended first activation

Start with **Runs**, with all 21 governed columns explicitly covered. This is a bounded operational slice before expanding to the other nine DATA worksheets. Keep schema v1, governed column IDs, header row 3 and the existing profile identity. Append a new immutable mapping-profile version containing a validated `documentVersion: 2` document. Retain profile version 1 for structural schema matching, which deliberately reads that version. Do not rewrite either historical version or the schema's structural metadata.

The table below is a review proposal inferred from labels, not established source-data semantics. Every field remains **unconfirmed**. Candidate kinds cannot be copied into an executable profile until the owner confirms the listed decisions. The complete [review matrix](data-hub-pilot-v2-review-matrix.json) covers all 272 fields across the ten DATA worksheets and is deliberately not a runnable ProfileDocument.

| Position | Governed field | Candidate kind | Required owner confirmation |
| --- | --- | --- | --- |
| 1 | Id | IDENTIFIER | Confirm identifier semantics and leading-zero preservation; do not coerce to a number. |
| 2 | Date | DATE | Confirm AU_DD_MM_YYYY versus ISO_8601 and source representation. Genuine Excel date cells may decode to exact ISO UTC-midnight text; bare numeric serials are unsupported. DATE has no timezone policy. |
| 3 | Run | IDENTIFIER | Confirm identifier semantics and leading-zero preservation; do not coerce to a number. |
| 4 | Vehicles | STRING | Confirm whether a list of identifiers, descriptive text or a count; do not split/coerce automatically. |
| 5 | Service Type | STRING | Preserve text unless the owner confirms a narrower supported value kind; retain sensitivity classification. |
| 6 | Drivers | STRING | Confirm whether a list of identifiers, descriptive text or a count; do not split/coerce automatically. |
| 7 | Loads | INTEGER | Confirm this is a whole-number count, how blanks differ from zero, and whether negatives are valid. |
| 8 | Collections Booked | INTEGER | Confirm this is a whole-number count, how blanks differ from zero, and whether negatives are valid. |
| 9 | Collections Performed | INTEGER | Confirm this is a whole-number count, how blanks differ from zero, and whether negatives are valid. |
| 10 | Not Presented | INTEGER | Confirm this is a whole-number count, how blanks differ from zero, and whether negatives are valid. |
| 11 | Contaminated | INTEGER | Confirm this is a whole-number count, how blanks differ from zero, and whether negatives are valid. |
| 12 | Total Weight | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 13 | Ave Bin Weight | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 14 | Bins Per Hour | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 15 | Weight Per Hour | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 16 | Travel Time Hrs | DURATION | Confirm source representation and explicit source/target units. Do not infer units from the header. |
| 17 | Collection Time Hrs | DURATION | Confirm source representation and explicit source/target units. Do not infer units from the header. |
| 18 | Duration | DURATION | Confirm source representation and explicit source/target units. Do not infer units from the header. |
| 19 | Travel Distance Kms | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 20 | Collection Distance Kms | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |
| 21 | Total Distance | DECIMAL | Confirm numeric representation and explicit units. Rates need their own meaning; no inferred conversion or unsupported rate-unit token. |

## Decisions required before profile generation

1. **Scope:** approve Runs as the first worksheet, or nominate another worksheet from the inventory. All columns of each admitted worksheet need rules, including columns not intended for analysis.
2. **Dates:** confirm `AU_DD_MM_YYYY` or `ISO_8601`, and whether source cells contain text or Excel serial dates. Do not assume serial-date support or silently reinterpret invalid dates. Date-only values are calendar days. DATETIME requires an explicit timezone policy; a duration is never a clock or instant.
3. **Identifiers and lists:** preserve leading zeros where approved. Confirm whether Vehicles and Drivers contain lists, descriptive text or counts. No splitting, numeric coercion or identity derivation is proposed.
4. **Counts and missing values:** confirm integer count fields, negative-value rules and blank markers. Zero remains a value; blank, unknown and Not applicable must not become zero or approval. Invalid values must retain a blocking finding rather than fall back to a fabricated value.
5. **Quantities and units:** confirm source and intended normalized units explicitly. Header text is only a review prompt, never authority to infer units. The first Runs editor uses identical source and target units. Unknown units remain unresolved. This PR adds explicit `d`, `kg/h`, `t/h` and `bins/h` tokens with separate duration/mass-rate/bin-rate families; it does not silently change their scale.
6. **Elapsed times:** confirm the representation and units for Travel Time Hrs, Collection Time Hrs and Duration. An Excel day fraction, decimal hours and HH:MM:SS are different inputs. No timezone or elapsed-time convention is assumed.
7. **Sensitivity:** retain existing governed sensitivity classifications. Text, names, phone numbers and addresses in other worksheets remain restricted; this proposal grants no raw-value display or broader access.

## Remaining DATA worksheets

| Worksheet | Columns requiring rules | Header row | Current active document |
| --- | --- | --- | --- |
| Runs | 21 | 3 | v1; no normalization rules |
| Driver Run | 33 | 3 | v1; no normalization rules |
| Loads | 49 | 3 | v1; no normalization rules |
| Jobs | 45 | 3 | v1; no normalization rules |
| Tickets | 37 | 3 | v1; no normalization rules |
| Ticket Tasks | 33 | 3 | v1; no normalization rules |
| Vouchers | 10 | 3 | v1; no normalization rules |
| Prestart Checks | 6 | 3 | v1; no normalization rules |
| Contamination Inspections | 13 | 3 | v1; no normalization rules |
| Service Exceptions | 25 | 3 | v1; no normalization rules |

The JSON matrix assigns provisional candidates and an explicit confirmation requirement to each exact governed column ID. It has `activationAllowed: false` and no production-ready transformation document. STRING candidates are proposals for explicit owner review, not a runtime fallback for unknown or invalid values.

## Reviewable implementation after approval

- Re-read the target schema, profile IDs, active pointers and profile-version numbers; reject drift. Generate closed v2 documents only from the confirmed matrix, with exactly one rule per governed column and explicit supported policies. No executable expressions or inferred units.
- Validate with `parseProfileDocument` and `buildNormalizationPlan`. Exercise representative sanitized source representations, leading zeros, numeric zero/null, invalid dates/numbers, time and unit boundaries, scoped lineage and quality holds in an isolated environment. No live customer-cell inspection is part of this proposal.
- The implemented editor performs an append-only, transaction-scoped configuration change that verifies the expected old active pointer, inserts the new profile version and moves only the approved profile's pointer. Its manual additive migration and application release need separate Production approval. Saving requires explicit administrator action; confirming a workbook is a separate manager action. No broad backfill or automatic activation is proposed.
- Run one explicitly approved fresh synthetic workbook through real schema selection, staging, normalization, profiling, review/history and counts using the pilot's confirmed v2 mapping. Verify tenant/role denials, lineage and source-value non-disclosure. Only then call the actual pilot operational.

## Historical work and rollback

Fresh raw-staging attempts may resolve the newly active version. Existing attempts and completed uploads remain pinned to their original version; changing an active pointer must not reinterpret them. Do not repin old raw/normalization/profile runs, rewrite stored decisions or delete immutable evidence. Use a fresh approved test upload for acceptance. Historical reprocessing needs its own explicit supported workflow rather than a hidden pointer reset.

If a newly activated mapping is wrong, stop new preparation and restore only the approved active profile pointer to the prior version under a separately reviewed recovery action. Keep both immutable versions and all run/review history. Returning to v1 restores the historical configuration; it does **not** restore normalization capability.

## Completion boundary

PR #458's application release is separate from this configuration approval. Hosted checks with a separately owned synthetic v2 fixture establish application/transport behavior only. They do not approve the pilot matrix or certify its real formats, units, larger workloads or all fourteen worksheets. The pilot remains blocked for normalization until confirmed v2 mappings are installed and the fresh pilot acceptance passes.
