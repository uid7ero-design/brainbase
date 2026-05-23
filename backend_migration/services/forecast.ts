/**
 * Forecast Service — versioned operational forecasting.
 * Persists all forecast runs to DB. No localStorage.
 */

import { prisma } from "@/lib/prisma";
import { Module, ForecastMethod, ForecastStatus } from "@prisma/client";
import type { ForecastSummary, ForecastPoint } from "@/types/operational";

// ── Linear regression forecast ────────────────────────────────────────────────

function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };

  const xs = values.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  const ssxy = xs.reduce((sum, x, i) => sum + (x - xMean) * (values[i] - yMean), 0);
  const ssxx = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const ssyy = values.reduce((sum, y) => sum + (y - yMean) ** 2, 0);

  const slope     = ssxx !== 0 ? ssxy / ssxx : 0;
  const intercept = yMean - slope * xMean;
  const r2        = ssyy !== 0 ? (ssxy ** 2) / (ssxx * ssyy) : 0;

  return { slope, intercept, r2 };
}

function weightedMovingAverage(values: number[], window = 4): number[] {
  return values.map((_, i) => {
    if (i < window - 1) return values[i];
    const slice  = values.slice(i - window + 1, i + 1);
    const weights = slice.map((__, j) => j + 1);
    const wSum   = weights.reduce((a, b) => a + b, 0);
    return slice.reduce((sum, v, j) => sum + v * weights[j], 0) / wSum;
  });
}

function seasonalDecompose(values: number[], period = 4): { trend: number[]; seasonal: number[] } {
  const n = values.length;
  const trend = weightedMovingAverage(values, period);

  const seasonal = new Array(period).fill(0);
  const counts   = new Array(period).fill(0);
  for (let i = period; i < n; i++) {
    const s = i % period;
    seasonal[s] += values[i] - trend[i];
    counts[s]++;
  }
  const seasonalAdj = seasonal.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));

  return { trend, seasonal: seasonalAdj };
}

function computeMape(actual: number[], forecast: number[]): number {
  const pairs = actual
    .map((a, i) => [a, forecast[i]])
    .filter(([a]) => a !== 0 && !isNaN(a));
  if (pairs.length === 0) return 0;
  return pairs.reduce((sum, [a, f]) => sum + Math.abs((a - f) / a), 0) / pairs.length * 100;
}

// ── Run forecast ──────────────────────────────────────────────────────────────

export async function runForecast(params: {
  organisation_id: string;
  module: Module;
  name: string;
  method: ForecastMethod;
  horizon_weeks: number;
  metric_key: string;
  period_start?: Date;
  period_end?: Date;
}): Promise<ForecastSummary> {
  const { organisation_id, module, name, method, horizon_weeks, metric_key } = params;

  // Load historical metric data
  const metrics = await prisma.metric.findMany({
    where: {
      organisation_id,
      module,
      metric_key,
      ...(params.period_start ? { period_start: { gte: params.period_start } } : {}),
      ...(params.period_end   ? { period_end:   { lte: params.period_end   } } : {}),
    },
    orderBy: { period_start: "asc" },
  });

  const actual_values = metrics.map(m => m.metric_value);
  const period_labels = metrics.map(m =>
    m.period_start.toISOString().slice(0, 10)
  );

  let forecast_values: number[] = [];
  let accuracy_mape: number | undefined;

  if (method === ForecastMethod.LINEAR) {
    const { slope, intercept } = linearRegression(actual_values);
    const n = actual_values.length;
    forecast_values = Array.from({ length: horizon_weeks }, (_, i) =>
      Math.max(0, intercept + slope * (n + i))
    );
    // Holdout MAPE using last 20% of data
    const holdout_n   = Math.floor(actual_values.length * 0.2);
    const train       = actual_values.slice(0, -holdout_n);
    const holdout     = actual_values.slice(-holdout_n);
    const { slope: ts, intercept: ti } = linearRegression(train);
    const holdout_fc  = holdout.map((_, i) => ti + ts * (train.length + i));
    accuracy_mape     = computeMape(holdout, holdout_fc);
  } else if (method === ForecastMethod.WEIGHTED_MOVING_AVERAGE) {
    const smoothed = weightedMovingAverage(actual_values, 4);
    const last = smoothed[smoothed.length - 1] ?? 0;
    const delta = smoothed.length > 1
      ? (smoothed[smoothed.length - 1] - smoothed[smoothed.length - 2]) : 0;
    forecast_values = Array.from({ length: horizon_weeks }, (_, i) =>
      Math.max(0, last + delta * (i + 1))
    );
  } else if (method === ForecastMethod.SEASONAL) {
    const { trend, seasonal } = seasonalDecompose(actual_values, 4);
    const last_trend = trend[trend.length - 1] ?? 0;
    const trend_delta = trend.length > 1
      ? (trend[trend.length - 1] - trend[trend.length - 2]) : 0;
    forecast_values = Array.from({ length: horizon_weeks }, (_, i) => {
      const t = last_trend + trend_delta * (i + 1);
      const s = seasonal[(actual_values.length + i) % 4];
      return Math.max(0, t + s);
    });
  }

  // Build forecast points
  const lastDate = metrics.length > 0
    ? new Date(metrics[metrics.length - 1].period_start)
    : new Date();

  const points: ForecastPoint[] = [
    ...actual_values.map((v, i) => ({
      period:   period_labels[i],
      actual:   v,
      forecast: actual_values[i],
    })),
    ...forecast_values.map((v, i) => {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + (i + 1) * 7);
      return { period: d.toISOString().slice(0, 10), actual: null, forecast: Math.round(v * 100) / 100 };
    }),
  ];

  // Trend direction from first to last forecast value
  const trend_pct = forecast_values.length > 1 && forecast_values[0] !== 0
    ? ((forecast_values[forecast_values.length - 1] - forecast_values[0]) / forecast_values[0]) * 100
    : 0;
  const trend_direction: ForecastSummary["trend_direction"] =
    Math.abs(trend_pct) < 3 ? "stable" : trend_pct > 0 ? "increasing" : "decreasing";

  // Persist forecast + version
  const forecast = await prisma.forecast.create({
    data: {
      organisation_id,
      module,
      name,
      method,
      horizon_weeks,
      status: ForecastStatus.ACTIVE,
    },
  });

  const latestVersion = await prisma.forecastVersion.findFirst({
    where:   { forecast_id: forecast.id },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  await prisma.forecastVersion.create({
    data: {
      forecast_id:  forecast.id,
      version:      nextVersion,
      input_data:   { metric_key, actual_values, period_labels },
      output_data:  { forecast_values, points },
      assumptions:  { method, horizon_weeks },
      accuracy_mape: accuracy_mape ?? null,
    },
  });

  return {
    method,
    horizon_weeks,
    accuracy_mape,
    trend_direction,
    trend_pct_per_week: Math.round((trend_pct / horizon_weeks) * 100) / 100,
    points,
  };
}

export async function getForecastHistory(organisation_id: string, module: Module) {
  return prisma.forecast.findMany({
    where:   { organisation_id, module },
    orderBy: { created_at: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
}
