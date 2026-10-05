// Data Hub 6.2D4B remediation — single authoritative source for the
// staging lease duration, per-request time budget, and batch-size target.
// Every runtime module and the SQL layer (datahub_stage_raw_batch's own
// p_lease_seconds parameter) derive from THIS lease duration rather than
// each hard-coding their own copy — the SQL function takes it as a
// parameter specifically so this file remains the one place that can
// drift.
//
// Test-only overrides are gated on NODE_ENV === "test" (vitest's own
// default) so a route-level integration test can force an early yield
// (tiny maxDurationMs) or a tiny batch size without any client-facing or
// production-reachable override — these env vars are never read from
// request input and never exposed in any response.

export const DEFAULT_LEASE_SECONDS = 120;
export const DEFAULT_MAX_DURATION_MS = 8000;
export const DEFAULT_TARGET_CELLS_PER_BATCH = 8000;

function resolveTestOverrideNumber(envVar: string): number | undefined {
  if (process.env.NODE_ENV !== "test") return undefined;
  const raw = process.env[envVar];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveLeaseSeconds(): number {
  return resolveTestOverrideNumber("DATAHUB_STAGE_LEASE_SECONDS_TEST_OVERRIDE") ?? DEFAULT_LEASE_SECONDS;
}

export function resolveMaxDurationMs(): number {
  return resolveTestOverrideNumber("DATAHUB_STAGE_MAX_DURATION_MS_TEST_OVERRIDE") ?? DEFAULT_MAX_DURATION_MS;
}

export function resolveTargetCellsPerBatch(): number {
  return resolveTestOverrideNumber("DATAHUB_STAGE_TARGET_CELLS_PER_BATCH_TEST_OVERRIDE") ?? DEFAULT_TARGET_CELLS_PER_BATCH;
}
