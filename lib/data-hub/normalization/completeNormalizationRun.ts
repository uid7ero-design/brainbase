import { prisma } from "../../prisma";
import sql from "../../db";

// Data Hub 6.2D4B2A -- completion gate. Exact structural analogue of
// lib/data-hub/staging/completionGate.ts's completeStagingRun, applied to
// normalization instead of raw staging. Unlike raw staging, there is no
// workbook/blob SHA-256 re-verification step here (this phase never reads
// the workbook) -- the DB function datahub_complete_normalization_run
// remains the SOLE authority for every reconciliation invariant: lease/
// token, actor tenant, raw run still SUCCEEDED, zero blocking findings,
// actual row/cell counts vs expected vs persisted, atomic RUNNING ->
// SUCCEEDED, Upload normalized metadata. Nothing here duplicates any of
// that logic in TypeScript.

export type CompleteNormalizationRunFailureCode = "INVALID_STATE" | "LEASE_LOST" | "COMPLETION_REJECTED";

export type CompleteNormalizationRunResult = { ok: true; rowCount: number; cellCount: number } | { ok: false; code: CompleteNormalizationRunFailureCode };

export async function completeNormalizationRun(context: { organisationId: string; runId: string; executionToken: string; completedByUserId: string }): Promise<CompleteNormalizationRunResult> {
  const { organisationId, runId, executionToken, completedByUserId } = context;

  // Cheap TS-level pre-check (mirrors completionGate.ts): a caller whose
  // lease already lapsed gets a fast, unambiguous LEASE_LOST rather than a
  // raw DB exception. Not authoritative -- the SQL function re-checks this
  // itself, non-bypassably, inside the same call below.
  const run = await prisma.dataHubNormalizationRun.findFirst({
    where: { id: runId, organisation_id: organisationId },
    select: { status: true, execution_token: true, lease_expires_at: true },
  });
  if (!run) return { ok: false, code: "INVALID_STATE" };
  if (run.status !== "RUNNING" || run.execution_token !== executionToken || run.lease_expires_at.getTime() <= Date.now()) {
    return { ok: false, code: "LEASE_LOST" };
  }

  try {
    const rows = (await sql`
      SELECT * FROM datahub_complete_normalization_run(${runId}, ${organisationId}, ${completedByUserId}, ${executionToken})
    `) as unknown as { row_count: number; cell_count: number }[];
    return { ok: true, rowCount: rows[0].row_count, cellCount: rows[0].cell_count };
  } catch {
    // Never leak the raw DB error text -- the TS-level pre-check above
    // already screened out ordinary lease loss, so an exception reaching
    // here is either a genuine data-shape/count-mismatch problem or a
    // last-instant lease loss between the pre-check and this call; either
    // way, COMPLETION_REJECTED is the safe, stable, non-leaking code.
    return { ok: false, code: "COMPLETION_REJECTED" };
  }
}
