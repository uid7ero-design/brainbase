import { expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { origin } from './accounts';
import { api, contextFor, createOffering, createResource, createSchedule, db, json, query } from './support';

// Fixtures and helpers for the availability SCREEN specs (Phase 2B.3c). Fixtures are found by name, and created through the real API as the
// manager when missing, so a spec can run in each viewport project against the one disposable database. Between tests an owner's hours and
// closures are cleared with direct SQL on that DISPOSABLE database: that is test setup only, never something the application does.

export const ORG_A = 'sched-org-a';
export type OwnerKind = 'offering' | 'resource';
export interface Owner {
  kind: OwnerKind;
  id: string;
  name: string;
}

const SCHEDULE = 'ZZ Hours schedule';

async function asManager<T>(browser: Browser, fn: (request: APIRequestContext) => Promise<T>): Promise<T> {
  const context = await contextFor(browser, 'manager');
  try {
    return await fn(context.request);
  } finally {
    await context.close();
  }
}

export async function ensureResource(browser: Browser, name: string, over: { active?: boolean } = {}): Promise<Owner> {
  const found = await query<{ id: string }>('SELECT id FROM scheduling_resources WHERE organisation_id = $1 AND name = $2 LIMIT 1', [ORG_A, name]);
  const id = found[0]?.id ?? (await asManager(browser, request => createResource(request, name))).id;
  if (over.active === false) await query('UPDATE scheduling_resources SET active = false WHERE id = $1', [id]);
  if (over.active !== false) await query('UPDATE scheduling_resources SET active = true WHERE id = $1', [id]);
  return { kind: 'resource', id, name };
}

export async function ensureOffering(browser: Browser, name: string): Promise<Owner & { scheduleId: string }> {
  const found = await query<{ id: string; schedule_id: string }>('SELECT id, schedule_id FROM scheduling_offerings WHERE organisation_id = $1 AND name = $2 LIMIT 1', [ORG_A, name]);
  if (found[0]) return { kind: 'offering', id: found[0].id, name, scheduleId: found[0].schedule_id };
  return asManager(browser, async request => {
    const existing = await query<{ id: string }>('SELECT id FROM scheduling_schedules WHERE organisation_id = $1 AND name = $2 AND archived_at IS NULL LIMIT 1', [ORG_A, SCHEDULE]);
    const scheduleId = existing[0]?.id ?? (await createSchedule(request, SCHEDULE, 'resource_hire')).id;
    const offering = await createOffering(request, scheduleId, name, { durationMinutes: 60 });
    return { kind: 'offering' as const, id: offering.id, name, scheduleId };
  });
}

/** Clears an owner's weekly hours and closures (test setup on the disposable database). */
export async function clearHours(owner: Owner): Promise<void> {
  const column = owner.kind === 'resource' ? 'resource_id' : 'offering_id';
  await query(`DELETE FROM scheduling_availability_rules WHERE ${column} = $1`, [owner.id]);
  await query(`DELETE FROM scheduling_availability_exceptions WHERE ${column} = $1`, [owner.id]);
  // The owner's zone pin (migration 036) is immutable and is removed only with its owner, so a test that wants an UNPINNED owner again
  // removes it here, with its immutability trigger switched off for this one statement list (test setup on the disposable database only).
  const client = await db().connect();
  try {
    await client.query(
      `ALTER TABLE scheduling_availability_zones DISABLE TRIGGER scheduling_availability_zones_immutable;
       DELETE FROM scheduling_availability_zones WHERE owner_id = '${owner.id.replace(/[^A-Za-z0-9_.-]/g, '')}';
       ALTER TABLE scheduling_availability_zones ENABLE TRIGGER scheduling_availability_zones_immutable;`,
    );
  } finally {
    client.release();
  }
}

/** The pinned zone of an owner (migration 036), or null. */
export const zoneOf = async (owner: Owner) =>
  (await query<{ timezone: string; source: string }>('SELECT timezone, source FROM scheduling_availability_zones WHERE owner_id = $1', [owner.id]))[0] ?? null;

export const rulesOf = (owner: Owner) =>
  query<{ id: string; day_of_week: number; start_time: string; end_time: string; label: string | null }>(
    `SELECT id, day_of_week, to_char(start_time, 'HH24:MI') AS start_time, CASE WHEN end_time = '24:00:00'::time THEN '24:00' ELSE to_char(end_time, 'HH24:MI') END AS end_time, label
       FROM scheduling_availability_rules WHERE ${owner.kind === 'resource' ? 'resource_id' : 'offering_id'} = $1 ORDER BY day_of_week, start_time`,
    [owner.id],
  );
export const closuresOf = (owner: Owner) =>
  query<{ id: string; from_date: string; to_date: string; start_time: string | null; end_time: string | null; reason: string | null }>(
    `SELECT id, from_date::text, to_date::text, to_char(start_time, 'HH24:MI') AS start_time, CASE WHEN end_time = '24:00:00'::time THEN '24:00' ELSE to_char(end_time, 'HH24:MI') END AS end_time, reason
       FROM scheduling_availability_exceptions WHERE ${owner.kind === 'resource' ? 'resource_id' : 'offering_id'} = $1 ORDER BY from_date, start_time NULLS FIRST`,
    [owner.id],
  );
export const availabilityAuditCount = async () => Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.availability_%'", [ORG_A]))[0].n);

const base = (owner: Owner) => api(`/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}`);
export async function seedRules(request: APIRequestContext, owner: Owner, body: Record<string, unknown>) {
  const res = await request.post(`${base(owner)}/availability-rules`, { data: body, headers: json });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).rules as Array<{ id: string; updatedAt: string; dayOfWeek: number }>;
}
export async function seedClosure(request: APIRequestContext, owner: Owner, body: Record<string, unknown>) {
  const res = await request.post(`${base(owner)}/availability-exceptions`, { data: body, headers: json });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).exception as { id: string; updatedAt: string };
}

export const hoursUrl = (owner: Owner) => `${origin}/scheduling/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}/availability`;

/** Opens an owner's hours page and waits until it has loaded (heading present, no loading message). */
export async function openHours(page: Page, owner: Owner): Promise<void> {
  await page.goto(hoursUrl(owner));
  await expect(page.getByRole('heading', { name: `Hours: ${owner.name}`, exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Loading/)).toHaveCount(0, { timeout: 60_000 });
}

/** The two time inputs and the other fields of an open dialog, by type: robust against the "Required" suffix on a field's label. */
export const timeInputs = (dialog: Locator) => ({ first: dialog.locator('input[type=time]').nth(0), second: dialog.locator('input[type=time]').nth(1) });
export const dateInputs = (dialog: Locator) => ({ first: dialog.locator('input[type=date]').nth(0), second: dialog.locator('input[type=date]').nth(1) });

/** Runs SQL on the disposable database in the simple-query protocol, so a migration script (several statements) runs as written. */
export async function runMigrationScript(file: string): Promise<void> {
  const text = readFileSync(path.join(process.cwd(), 'packages/scheduling/sql', file), 'utf8').replace(/\r/g, '');
  const client = await db().connect();
  try {
    await client.query(text);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
