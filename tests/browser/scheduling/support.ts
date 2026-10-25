import { expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';
import { type Account, origin, storageStatePath } from './accounts';

let pool: Pool | null = null;
/** Direct read access to the DISPOSABLE database, to prove what the server did (or did not) write. */
export const db = () => (pool ??= new Pool({ connectionString: process.env.SCHED_BROWSER_DATABASE_URL, max: 4 }));
export const query = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db().query(text, values)).rows as T[];

/** A browser context signed in as `account` through the real login form (state saved by globalSetup). */
export const contextFor = (browser: Browser, account: Account): Promise<BrowserContext> => browser.newContext({ storageState: storageStatePath(account), ignoreHTTPSErrors: true });
export const anonymousContext = (browser: Browser): Promise<BrowserContext> => browser.newContext({ ignoreHTTPSErrors: true });

export const api = (path: string) => `${origin}/api/scheduling${path}`;
export const json = { 'Content-Type': 'application/json' };

export async function createSchedule(request: APIRequestContext, name: string, presetKey = 'classes_coaching') {
  const res = await request.post(api('/schedules'), { data: { name, presetKey }, headers: json });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).schedule as { id: string; name: string; updatedAt: string };
}
export async function createOffering(request: APIRequestContext, scheduleId: string, name: string, body: Record<string, unknown> = { durationMinutes: 60, capacity: 12, priceCents: 2500 }) {
  const res = await request.post(api(`/schedules/${scheduleId}/offerings`), { data: { name, ...body }, headers: json });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).offering as { id: string; name: string; updatedAt: string };
}
export async function createResource(request: APIRequestContext, name: string, kind = 'court', capacity = 4) {
  const res = await request.post(api('/resources'), { data: { kind, name, capacity }, headers: json });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).resource as { id: string; name: string; updatedAt: string };
}

const SCHEDULING_TABLES = ['scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_reservations', 'scheduling_occurrences', 'scheduling_resource_holds', 'scheduling_availability_rules', 'scheduling_availability_exceptions'];
/** A fingerprint of every Scheduling row an organisation owns, to prove a refused request changed nothing. Audit rows are included by default. */
export async function snapshot(organisationId: string, withAudit = true): Promise<string> {
  const tables = withAudit ? [...SCHEDULING_TABLES, 'audit_logs'] : SCHEDULING_TABLES;
  const parts: string[] = [];
  for (const t of tables) {
    const rows = await query<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t WHERE t.organisation_id = $1`, [organisationId]);
    parts.push(rows[0].h);
  }
  return parts.join(':');
}
