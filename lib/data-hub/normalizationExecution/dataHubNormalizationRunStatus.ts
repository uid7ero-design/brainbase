import { prisma } from "../../prisma";

// Data Hub 6.2D4B2B — read-only status projection for the GET side of the
// normalization route. Exact structural analogue of
// lib/data-hub/staging/dataHubRawStagingRunStatus.ts. Never a write path.
//
// Caller (the route) is responsible for first checking Upload.normalized_at
// and returning the SUCCEEDED projection directly from Upload's own B1
// fields in that case -- this helper is only consulted when normalization
// has not (yet) completed, exactly mirroring the D4B GET handler's own
// two-step shape.
//
// PRIVACY: only ever selects/returns status, attempt_number,
// persisted/expected row+cell counts, and failure_code -- never
// execution_token, lease_expires_at, raw_staging_run_id, any pinned
// profile/schema id, created_by, or failure_detail.

export async function dataHubNormalizationRunStatus(context: { organisationId: string; uploadId: string }) {
  const run = await prisma.dataHubNormalizationRun.findFirst({
    where: { organisation_id: context.organisationId, upload_id: context.uploadId },
    orderBy: { attempt_number: "desc" },
    select: {
      status: true,
      attempt_number: true,
      persisted_row_count: true,
      persisted_cell_count: true,
      expected_row_count: true,
      expected_cell_count: true,
      failure_code: true,
    },
  });
  if (!run) return { ok: true, status: "NOT_STARTED" as const };
  return {
    ok: true,
    status: run.status,
    attemptNumber: run.attempt_number,
    persistedRowCount: run.persisted_row_count,
    persistedCellCount: run.persisted_cell_count,
    expectedRowCount: run.expected_row_count,
    expectedCellCount: run.expected_cell_count,
    failureCode: run.failure_code,
  };
}
