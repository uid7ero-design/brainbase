import { appendFileSync } from 'node:fs';
import { Client } from 'pg';
import { TEST_URL } from './pgHarness';

// Measurement helpers for the contention suite. TEST-ONLY. They record what happened (latency
// distribution, outcome counts, database errors, lock waiters); they do not turn a measurement
// into a performance promise. Assertions in the suite are about CORRECTNESS under load.

export interface Sample {
  ms: number;
  outcome: string;
}

/** ok | <business reason> | error:<SchedulingError code> | raw:<sqlstate or error name>. */
export function classify(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'ok' in value) {
    const v = value as { ok: boolean; reason?: string };
    return v.ok ? 'ok' : (v.reason ?? 'refused');
  }
  return 'value';
}

export function classifyError(err: unknown): string {
  const e = err as { name?: string; code?: string };
  if (e?.name === 'SchedulingError') return `error:${e.code}`;
  return `raw:${e?.code ?? e?.name ?? 'unknown'}`;
}

/** Runs `fn`, timing it from just before the call to settlement, whatever the outcome. */
export async function timed(fn: () => Promise<unknown>): Promise<Sample> {
  const start = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - start, outcome: classify(value) };
  } catch (err) {
    return { ms: performance.now() - start, outcome: classifyError(err) };
  }
}

/** Starts every task at once (they are already-started promises, not queued) and times each. */
export async function race(tasks: Array<() => Promise<unknown>>): Promise<{ samples: Sample[]; wallMs: number }> {
  const start = performance.now();
  const samples = await Promise.all(tasks.map(t => timed(t)));
  return { samples, wallMs: performance.now() - start };
}

const percentile = (sorted: number[], p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface Summary {
  scenario: string;
  requests: number;
  outcomes: Record<string, number>;
  /** Latency in ms, measured by the client around each call (includes any client-side pool queueing). */
  latencyMs: { min: number; p50: number; p90: number; p95: number; p99: number; max: number; mean: number };
  wallMs: number;
  /** Successful bookings per second of wall time for this scenario (a measurement, not a capacity claim). */
  okPerSecond: number;
  /** Peak sessions seen waiting on any database lock while the scenario ran (0 when not sampled). */
  peakLockWaiters: number;
  note?: string;
}

export function summarise(scenario: string, samples: Sample[], wallMs: number, peakLockWaiters = 0, note?: string): Summary {
  const sorted = samples.map(s => s.ms).sort((a, b) => a - b);
  const outcomes: Record<string, number> = {};
  for (const s of samples) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
  const mean = sorted.length === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    scenario,
    requests: samples.length,
    outcomes,
    latencyMs: { min: r1(sorted[0] ?? 0), p50: r1(percentile(sorted, 50)), p90: r1(percentile(sorted, 90)), p95: r1(percentile(sorted, 95)), p99: r1(percentile(sorted, 99)), max: r1(sorted[sorted.length - 1] ?? 0), mean: r1(mean) },
    wallMs: Math.round(wallMs),
    okPerSecond: wallMs > 0 ? r1(((outcomes.ok ?? 0) / wallMs) * 1000) : 0,
    peakLockWaiters,
    note,
  };
}

/** Prints the summary and appends it as a JSON line when SCHEDULING_CONTENTION_REPORT names a file. */
export function record(summary: Summary): void {
  const l = summary.latencyMs;
  console.log(
    `CONTENTION ${summary.scenario} | n=${summary.requests} | ${JSON.stringify(summary.outcomes)} | ms p50=${l.p50} p95=${l.p95} p99=${l.p99} max=${l.max} | wall=${summary.wallMs}ms ok/s=${summary.okPerSecond} | peak lock waiters=${summary.peakLockWaiters}`,
  );
  const file = process.env.SCHEDULING_CONTENTION_REPORT;
  if (file) {
    try {
      appendFileSync(file, JSON.stringify({ ...summary, target: process.env.SCHEDULING_CONTENTION_TARGET ?? 'unlabelled', at: new Date().toISOString() }) + '\n');
    } catch {
      /* the report is a convenience; never fail a test over it */
    }
  }
}

/**
 * Samples pg_stat_activity every few milliseconds for sessions waiting on a database lock
 * (advisory locks, row/transaction locks) in this database, and reports the peak.
 */
export async function watchLockWaiters(): Promise<{ stop(): Promise<number> }> {
  const client = new Client({ connectionString: TEST_URL, ssl: /neon\.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  let peak = 0;
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const r = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        peak = Math.max(peak, r.rows[0].n as number);
      } catch {
        /* sampling only */
      }
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await client.end();
      return peak;
    },
  };
}
