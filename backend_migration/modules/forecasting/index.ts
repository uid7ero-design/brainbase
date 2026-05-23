/**
 * Forecasting module — thin wrapper that routes metric_key requests
 * to the forecast service and exposes module-specific defaults.
 */

import { runForecast, getForecastHistory } from "@/services/forecast";
import { Module, ForecastMethod } from "@prisma/client";

export const FORECASTABLE_METRICS: Record<Module, string[]> = {
  WASTE:              ["total_issues", "complaint_count", "avg_response_hours"],
  MISSED_COLLECTIONS: ["total_missed", "complaint_rate"],
  DUMPING:            ["total_incidents"],
  DEBTORS:            ["total_outstanding", "accounts_count"],
  BIN_MAINTENANCE:    ["total_inspections", "miss_rate"],
  CONTRACTS:          [],
  OPERATIONS:         ["total_issues"],
  FORECASTING:        [],
};

export async function forecastModule(params: {
  organisation_id: string;
  module: Module;
  metric_key: string;
  method?: ForecastMethod;
  horizon_weeks?: number;
}) {
  const metric_key = params.metric_key;
  const allowed    = FORECASTABLE_METRICS[params.module] ?? [];

  if (!allowed.includes(metric_key)) {
    throw new Error(`'${metric_key}' is not a forecastable metric for module ${params.module}. Choose from: ${allowed.join(", ")}`);
  }

  return runForecast({
    organisation_id: params.organisation_id,
    module:          params.module,
    name:            `${params.module} — ${metric_key}`,
    method:          params.method ?? ForecastMethod.LINEAR,
    horizon_weeks:   params.horizon_weeks ?? 12,
    metric_key,
  });
}

export { getForecastHistory };
