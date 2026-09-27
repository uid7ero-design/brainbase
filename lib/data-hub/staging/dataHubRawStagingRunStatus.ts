import { prisma } from "../../prisma";

// Data Hub 6.2D4B — read-only status projection for the GET side of the
// staging route. Never a write path.

export async function dataHubRawStagingRunStatus(context: { organisationId: string; uploadId: string }) {
  const run = await prisma.dataHubRawStagingRun.findFirst({
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
