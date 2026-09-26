import sql from "../../db";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";

// Data Hub 6.2D4B — completion gate + atomic completion transaction.
//
// CORRECTION 3: `completedByUserId` is the AUTHENTICATED ACTOR COMPLETING
// THE RUN (from the route's own session), NEVER the run's own created_by.
// This is what lets completion succeed even after the original run
// creator has been deleted (DataHubRawStagingRun.created_by -> NULL via
// ON DELETE SET NULL does not block completion).
//
// The SHA-256 re-verification against ImportBatch.sha256 (a network fetch)
// happens HERE, in application code, immediately before calling the SQL
// completion function — the function itself cannot perform this check.

export type CompleteStagingRunFailureCode = "INVALID_STATE" | "WORKBOOK_INTEGRITY_CHANGED" | "STORAGE_NOT_FOUND" | "PROVIDER_FAILURE";

export type CompleteStagingRunResult =
  | { ok: true; rowCount: number; cellCount: number }
  | { ok: false; code: CompleteStagingRunFailureCode };

export async function completeStagingRun(context: {
  organisationId: string;
  runId: string;
  completedByUserId: string;
}): Promise<CompleteStagingRunResult> {
  const { organisationId, runId, completedByUserId } = context;

  const run = await prisma.dataHubRawStagingRun.findFirst({
    where: { id: runId, organisation_id: organisationId },
    select: { status: true, import_batch_id: true },
  });
  if (!run || run.status !== "RUNNING") return { ok: false, code: "INVALID_STATE" };

  const batch = await prisma.importBatch.findFirst({
    where: { id: run.import_batch_id, organisation_id: organisationId },
    select: { sha256: true },
  });
  if (!batch?.sha256) return { ok: false, code: "INVALID_STATE" };

  const storage = createImportBatchStorage();
  let stored;
  try {
    stored = await storage.get(buildImportBatchKey(organisationId, run.import_batch_id), { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") return { ok: false, code: "STORAGE_NOT_FOUND" };
    return { ok: false, code: "PROVIDER_FAILURE" };
  }
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(stored.body).digest("hex") !== batch.sha256) {
    return { ok: false, code: "WORKBOOK_INTEGRITY_CHANGED" };
  }

  try {
    const rows = (await sql`
      SELECT * FROM datahub_complete_raw_staging_run(${runId}, ${organisationId}, ${completedByUserId})
    `) as unknown as { row_count: number; cell_count: number }[];
    return { ok: true, rowCount: rows[0].row_count, cellCount: rows[0].cell_count };
  } catch {
    return { ok: false, code: "INVALID_STATE" };
  }
}
