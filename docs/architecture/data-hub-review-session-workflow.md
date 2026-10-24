# Worksheet review sessions and workbook navigation

The next [saved-review history bundle](data-hub-review-history.md) adds bounded,
read-only revision summaries and comparison against the current saved review.

The existing manager review/count screen now bounds discovery, quality preview,
save/reload and count requests. Each request has a 15-second deadline and a
one-MiB streamed UTF-8/JSON limit. **Stop review request** stops the browser wait.
It does not cancel a server transaction. There is no polling or automatic retry.
Abort, component identity and request identity prevent late replies from filling
a replacement worksheet or restoring a cancelled result. Each worksheet starts
with an explicit **Load current review**.

## Decisions and uncertain saves

Field meanings and quality decisions remain explicit. Opaque column IDs are Map
keys, including `__proto__`, `constructor` and `toString`. Changing a choice clears
the prior review/count/planning state. A saved review restores only clarified
roles still offered by the same current profile; quality preview restores only
matching, supported saved decisions.

A save marks its outcome uncertain before sending. Only a positive safe revision
acknowledgement followed by a validated saved review at that revision or later
clears the lock. Timeout, cancellation, bad acknowledgement or failed reload keeps
saving and workbook switching disabled until a successful explicit reload. A
failed reload preserves the lock. The server may have committed while the browser
stopped waiting. This is not an idempotency or exactly-once promise across tabs.

Discovery and saved-review replies are projected into owned UI metadata before
rendering. The decoder checks supported versions, positive safe revision,
distinct bounded field/quality identities, offered role/reason enums, matching
ordered labels, quality decisions/state and all eight schema/quality lineage
fields. Saved review upload/profile must match the requested worksheet/current
plan. Outer success envelopes are closed; unused nested rich metadata is omitted.
This is a client display check; authorization and current capability decisions
remain server-owned.

Interactive rendering accepts at most 1,000 fields, IDs up to 512 characters and
labels up to 4,096 characters. Larger metadata is unavailable with a safe recovery
message, not truncated into a misleading complete review. This is a UI ceiling;
the server still computes its existing full profile/review, and this bundle does
not establish large-schema database performance or pagination.

Count replies retain their actual server revision/profile. A different returned
lineage disables further counts/planning until explicit reload. Scope loss from
review, counts, planning or navigation clears the session's review/choices/results.

## Workbook hints are navigation only

Import history, workbook preparation and saved-review status link to
`/data-hub/analysis/[uploadId]?workbook=[batchId]`. The single nonblank bounded
query value is optional; repeated or invalid values are ignored. The review,
save, planning and count APIs still use the worksheet path and current session
only. No query value supplies tenant, review context or permission.

**Load workbook navigation** explicitly reads the existing authorized inventory.
The decoder checks its batch and worksheet identities, 50-worksheet ceiling and
physical order. The current worksheet must occur among eligible rows before any
workbook or previous/next link appears. Hidden, empty, ineligible and skipped
worksheets are excluded. Duplicate names retain physical worksheet numbers.
Wrong-batch/missing-member hints suppress navigation while the independently
authorized worksheet review remains usable. Inventory 401/403 clears the session;
a 404 for the optional hint does not assert loss of worksheet access.

Navigation is cancellable, has a 15-second deadline and uses the existing one-MiB
transport bound. Opening review does not fetch the inventory automatically.
Links do not load or save a destination review. Unsaved choices, an uncertain
save or an active sibling request disable these in-screen navigation links.
Browser back, closing the tab and other application links are not intercepted.

## Validation and release boundary

Unit/component checks cover invalid metadata, lineage/profile mismatch, opaque
IDs, cancellation/deadlines, late replies, replacement, uncertain-save recovery,
membership/ordering/exclusions, and labelled accessible navigation states.
The built disposable PostgreSQL/browser package verifies genuine single-sheet
membership, explicit reads, review/count cancellation, a discovery deadline,
rejection of a deliberately altered saved profile, and a genuine committed save
whose delayed reply is cancelled. Explicit reload recovers that single revision
without another save. Live planning role loss clears the entire session. Mobile
proof is captured in `review-session-mobile.png`, hashed in the acceptance receipt.
Multi-sheet previous/next ordering is component-tested with synthetic metadata;
the built browser fixtures establish the genuine single-sheet route journey.

No endpoint, schema, migration, analytical executor, AI or Production configuration
change is introduced. Main merges deploy automatically; merge and Production
release require the separate owner request after the exact candidate is green.
