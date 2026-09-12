// 6.0C1 — narrow, disposable, real-Postgres concurrency proof (T13).
//
// RETIRED as of 6.1B. This file used to prove the 6.0C1 coarse
// SourceSystem-wide "first import" guard's own race safety: two
// independent, eligible worksheets for the SAME organisation+SourceSystem,
// confirmed CONCURRENTLY, had to yield EXACTLY ONE successful domain
// import and EXACTLY ONE SOURCE_ALREADY_IMPORTED failure.
//
// That coarse guard no longer exists — 6.1B superseded it with per-record
// reconciliation (see confirmWorksheet.ts's own header comment), so BOTH
// worksheets in the old T13 scenario now succeed (one NEW, one UNCHANGED
// or CHANGED depending on content), never one succeeding and one blocked.
// The old assertions are no longer a meaningful safety property to prove.
//
// The equivalent-or-stronger concurrency-safety concern (two independent
// real Prisma connections racing to be the first to observe the same
// organisation+SourceSystem+source_external_id) is now covered by
// tests/postgres-proof/confirmWorksheetReconciliation.postgres-proof.test.ts's
// own "P6. Concurrent first sighting" test, which reuses this file's own
// two-independent-PrismaClient/AsyncLocalStorage technique and asserts
// exactly one SourceRecordIdentity is ever created under real concurrent
// load. Retired outright rather than patched in place, per this repo's
// own established convention for retiring a check whose premise a later,
// authorized change has legitimately outgrown (see
// tests/containment/dataHubReconciliationSchemaFoundation.test.ts's own
// "Removed (post-merge cleanup)" precedent for the identical pattern).

import { describe, it, expect } from "vitest";

describe("6.0C1 confirmWorksheetFirstImportGuard — real disposable Postgres concurrency proof (retired)", () => {
  it("T13 (retired, superseded by 6.1B P6) — see file header for the retirement rationale and pointer to the new coverage", () => {
    expect(true).toBe(true);
  });
});
