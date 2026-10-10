const catalogKeys = ["textAttributes", "identifiers", "dimensions", "flags",
  "measures", "temporals", "geoCoordinates"] as const;

// Structural metadata only. Matching identities establish neither provenance
// nor authorization. Keep original identities; never silently deduplicate them.
export function hasValidAnalysisFieldCatalog(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const { fieldCount, catalog } = input as Record<string, unknown>;
  if (typeof fieldCount !== "number" || !Number.isSafeInteger(fieldCount) || fieldCount < 0 ||
      !catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false;
  const record = catalog as Record<string, unknown>;
  if (Object.keys(record).length !== catalogKeys.length ||
      !catalogKeys.every(key => Object.hasOwn(record, key))) return false;
  const identities = new Set<string>();
  let count = 0;
  for (const key of catalogKeys) {
    const values = record[key];
    if (!Array.isArray(values)) return false;
    for (const value of values) {
      if (typeof value !== "string" || !value.trim() || identities.has(value)) return false;
      identities.add(value); count++;
    }
  }
  return count === fieldCount;
}
