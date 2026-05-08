import { SchemaType } from "@prisma/client";

interface DetectionResult {
  schema_type: SchemaType;
  confidence: number;
}

// Canonical column signatures per schema type
const SIGNATURES: Record<SchemaType, string[]> = {
  MISSED_COLLECTIONS: ["address", "scheduled_date", "service_type", "route", "status", "suburb"],
  ILLEGAL_DUMPING:    ["location", "report_date", "waste_type", "severity", "zone", "suburb"],
  DEBTORS:            ["account_number", "outstanding_amount", "days_overdue", "aging_bucket", "account_name"],
  SERVICE_REQUESTS:   ["request_date", "request_type", "service_type", "priority", "status"],
  BIN_MAINTENANCE:    ["property_id", "collection_date", "bin_type", "status"],
  WASTE_METRICS:      ["period_start", "metric_key", "metric_value", "module", "zone"],
  FINANCIAL:          ["amount", "category", "date", "account", "transaction_type"],
  GENERIC:            [],
  UNKNOWN:            [],
};

// Fuzzy column name matching — lowercase, strip spaces/underscores
function normalise(col: string): string {
  return col.toLowerCase().replace(/[\s_\-]/g, "");
}

export function detectSchema(columns: string[]): DetectionResult {
  const normCols = columns.map(normalise);

  let bestType: SchemaType = "UNKNOWN";
  let bestScore = 0;

  for (const [type, sigs] of Object.entries(SIGNATURES) as [SchemaType, string[]][]) {
    if (sigs.length === 0) continue;
    const matched = sigs.filter(s => normCols.includes(normalise(s))).length;
    const score   = matched / sigs.length;
    if (score > bestScore) {
      bestScore = score;
      bestType  = type;
    }
  }

  // Require at least 30% signature match to claim a type
  if (bestScore < 0.3) {
    return { schema_type: "GENERIC", confidence: 0.4 };
  }

  return { schema_type: bestType, confidence: Math.min(0.5 + bestScore * 0.5, 1.0) };
}
