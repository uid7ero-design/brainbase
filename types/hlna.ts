import { InsightType, Priority, InsightStatus, ActionStatus } from "@prisma/client";

export interface HlnaInsightRecord {
  id: string;
  organisation_id: string;
  upload_id: string | null;
  module: string | null;
  insight_type: InsightType;
  title: string;
  body: string;
  evidence: InsightEvidence;
  confidence: number;
  priority: Priority;
  status: InsightStatus;
  created_at: Date;
}

export interface InsightEvidence {
  current_value?: number | string;
  previous_value?: number | string;
  change_pct?: number;
  affected_entity?: string;
  sample_size?: number;
  comparison_period?: string;
  evidence_columns?: string[];
}

export interface HlnaBriefingRequest {
  organisation_id: string;
  module?: string;
  period_start?: string;
  period_end?: string;
  context?: Record<string, unknown>;
}

export interface HlnaBriefingResponse {
  id: string;
  summary: string;
  opportunities: string[];
  risks: string[];
  recommended_actions: string[];
  confidence: number;
  created_at: string;
}

export interface HlnaActionRecord {
  id: string;
  insight_id: string | null;
  action_type: string;
  title: string;
  description: string;
  priority: Priority;
  status: ActionStatus;
  assigned_to: string | null;
  due_date: Date | null;
  completed_at: Date | null;
}
