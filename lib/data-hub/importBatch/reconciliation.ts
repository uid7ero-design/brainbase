// Data Hub 6.1B — pure, deterministic reconciliation helpers.
//
// STRUCTURAL RULE (mirrors illegalDumpingMapper.ts's own purity contract
// exactly): this module is pure and DB-free — no Prisma import, no I/O,
// safe to call any number of times with the same input and get the
// identical output. The actual database orchestration (identity
// resolution, observation persistence, domain writes) lives in
// confirmWorksheet.ts's own Step 8 transaction; this module supplies only
// the deterministic computations that must be independently, synchronously
// testable outside any transaction.

import { createHash } from "node:crypto";
import type { MappedIllegalDumpingRow } from "./illegalDumpingMapper";

// Explicit, ordered, source-controlled field list — never Object.keys(row)
// or a spread of an uncontrolled object. Deliberately excludes the
// identity field (source_external_id, carried as a sibling value on
// MappedIllegalDumpingRecord, never a property of MappedIllegalDumpingRow
// itself) — it is the identity key, not a change-detection field; hashing
// it would be redundant (the identity a hash is compared FOR never
// changes within one SourceRecordIdentity's own history).
//
// Every one of these 12 fields is governed/source-controlled (Phase 6.1B
// architecture review, Decision 2/5) and forms BOTH the canonical-hash
// input AND the CHANGED update allowlist in confirmWorksheet.ts — one
// explicit ownership model per field: a field must never participate in
// one list without the other.
export const CANONICAL_HASH_FIELDS = [
  "report_date",
  "location",
  "suburb",
  "zone",
  "waste_type",
  "volume_estimate",
  "severity",
  "status",
  "crew_assigned",
  "resolution_date",
  "cost_estimate",
  "notes",
] as const satisfies readonly (keyof MappedIllegalDumpingRow)[];

type CanonicalHashPrimitive = string | number | null;

/**
 * Normalizes one MappedIllegalDumpingRow field's value into a stable,
 * serializable primitive:
 *   - Date -> the ISO string of the already-UTC-constructed Date. The
 *     mapper's own parseDate() already normalizes every accepted input
 *     format (ISO date-only, AU D/M/YYYY, ISO datetime) into the identical
 *     UTC Date object, so this step is format-independent by construction.
 *   - null/undefined -> JS null. Matches how the mapper already represents
 *     "no value" after its own nullStr() normalization has already
 *     collapsed "" and whitespace-only input into null — this function
 *     never re-trims or re-introduces a distinction the mapper has already
 *     resolved.
 *   - number/string -> passed through completely unchanged. No rounding,
 *     no case-folding — inventing a stricter or looser equivalence here
 *     than the mapper's own existing normalization would silently collapse
 *     (or fail to collapse) values the mapper itself treats differently.
 */
function normalizeHashValue(value: MappedIllegalDumpingRow[(typeof CANONICAL_HASH_FIELDS)[number]]): CanonicalHashPrimitive {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Computes a deterministic SHA-256 hex digest over exactly the 12
 * CANONICAL_HASH_FIELDS, in the fixed order declared above, from an
 * already-normalized MappedIllegalDumpingRow. Two rows with identical
 * governed field values always produce the identical hash, independent of
 * unrelated object construction order — the serialization is a
 * fixed-order ARRAY of normalized primitive values (never an object, which
 * sidesteps any doubt about key-ordering entirely), JSON.stringify'd, then
 * hashed via Node's built-in `crypto` module (the same primitive
 * confirmWorksheet.ts already uses for its own Step 6 file-integrity
 * check — no new dependency).
 */
export function computeCanonicalHash(row: MappedIllegalDumpingRow): string {
  const values = CANONICAL_HASH_FIELDS.map((field) => normalizeHashValue(row[field]));
  const serialized = JSON.stringify(values);
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Returns the first source_external_id value that appears more than once
 * in the given list (in encounter order), or null if every value is
 * unique. Pure, synchronous, no DB access — callers (confirmWorksheet.ts)
 * must run this BEFORE opening any transaction, over one worksheet's own
 * mapped rows only.
 *
 * Two rows sharing a source_external_id within one worksheet belong to the
 * SAME source snapshot/import, not a longitudinal NEW/UNCHANGED/CHANGED
 * sequence — treating them as sequential reconciliation events would let
 * input row order decide the final canonical IllegalDumping state and
 * would create two historical observations for what is actually one
 * source snapshot. This is therefore a blocking validation error
 * (DUPLICATE_SOURCE_EXTERNAL_ID_IN_WORKSHEET in failureTaxonomy.ts), never
 * resolved by row order or silently deduplicated.
 */
export function findDuplicateSourceExternalId(sourceExternalIds: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const id of sourceExternalIds) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}
