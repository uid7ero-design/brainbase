// Shared operational types across all modules

export interface WeeklyKpi {
  week_start: string;
  total_issues: number;
  open_issues: number;
  in_progress: number;
  resolved_issues: number;
  repeat_issue_count: number;
  complaint_count: number;
  avg_response_hours: number;
}

export interface ZoneBreakdown {
  zone: string;
  count: number;
  pct_of_total: number;
  trend: "up" | "down" | "stable";
  prev_count?: number;
}

export interface SuburbHotspot {
  suburb: string;
  count: number;
  repeat_count: number;
  complaint_count: number;
  severity_score: number;
}

export interface ModuleKpiSummary {
  module: string;
  period_label: string;
  headline_metric: number;
  headline_label: string;
  vs_prior_period: number | null;
  vs_prior_pct: number | null;
  supporting_metrics: SupportingMetric[];
}

export interface SupportingMetric {
  label: string;
  value: number | string;
  unit?: string;
  direction?: "up" | "down" | "neutral";
  is_positive?: boolean;
}

// Missed collections
export interface MissedCollectionKpi {
  total_missed: number;
  open: number;
  rescheduled: number;
  completed: number;
  complaint_rate: number;
  top_routes: ZoneBreakdown[];
  top_suburbs: SuburbHotspot[];
  miss_rate_by_service_type: Record<string, number>;
}

// Illegal dumping
export interface DumpingKpi {
  total_incidents: number;
  open: number;
  resolved: number;
  avg_resolution_days: number;
  by_waste_type: Record<string, number>;
  by_zone: ZoneBreakdown[];
  hotspot_suburbs: SuburbHotspot[];
  repeat_location_rate: number;
}

// Debtors
export interface DebtorKpi {
  total_outstanding: number;
  accounts_count: number;
  avg_days_overdue: number;
  by_aging_bucket: Record<string, { count: number; amount: number }>;
  recovery_rate: number;
  at_risk_amount: number;
}

// Service requests / operations
export interface OpsKpi {
  total_issues: number;
  open: number;
  resolved: number;
  repeat_rate: number;
  avg_response_hours: number;
  complaint_count: number;
  resolution_rate: number;
  top_hotspots: SuburbHotspot[];
}

// Forecasting
export interface ForecastPoint {
  period: string;
  actual: number | null;
  forecast: number;
  lower_bound?: number;
  upper_bound?: number;
}

export interface ForecastSummary {
  method: string;
  horizon_weeks: number;
  accuracy_mape?: number;
  trend_direction: "increasing" | "decreasing" | "stable";
  trend_pct_per_week: number;
  points: ForecastPoint[];
}
