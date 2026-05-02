export interface AgentInput {
  organisationId: string;
  userId: string;
  department?: string;
  query?: string;
  dataContext?: unknown;
}

export interface Evidence {
  sourceDataset: string[];    // tables queried, e.g. ["waste_records", "fleet_metrics"]
  sourceColumns: string[];    // columns used, e.g. ["suburb", "contamination_rate"]
  evidenceSummary: string;    // plain-English: what data was examined and how many rows
  calculationUsed: string;    // key aggregations / comparisons performed
  confidenceReason: string;   // why confidence is at this level — cite row counts
  sampleRows: unknown[];      // 3–5 representative rows from the source data
}

export interface AgentOutput {
  agentName: string;
  summary: string;
  findings: string[];
  confidence: number; // 0–1
  recommendedActions: string[];
  sourceRows: unknown[];
  warnings: string[];
  evidence?: Evidence;
}
