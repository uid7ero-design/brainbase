export interface AgentInput {
  organisationId: string;
  userId: string;
  department?: string;
  query?: string;
  dataContext?: unknown;
  /**
   * Phase D.4.6C.1 — a safe, non-DB, non-tenant-identifying signal that the
   * operator's currently-selected module (see app/api/chat/route.ts's own
   * moduleKey handling — the same field buildSystem() already uses to
   * inject module-specific system-prompt context) is Organiser. Only
   * agentRouter.ts's route() reads this, and only to prefer routing an
   * otherwise-briefing-shaped query back to 'chat' (where Helena's
   * Organiser tools actually live) — it never changes dataIntake/insight/
   * action/social routing, never queries a board/item name, and never
   * makes the router DB- or tenant-aware.
   */
  organiserContext?: boolean;
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
