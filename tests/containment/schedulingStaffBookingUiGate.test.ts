import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 2C.3c UI slice 1: the server-side visibility gate (lib/scheduling/staffBookingVisibility.ts) and the static rules that keep the slice READ ONLY and
// HIDDEN. The gate mirrors the API's own order (switch -> session -> capability -> scheduling.reserve) so a page never shows a control the API would
// refuse. Synthetic sessions only.

const state = vi.hoisted(() => ({
  session: null as null | { organisationId?: string; userId?: string; role: string },
  sessionThrows: false,
  entitled: new Set<string>(), // `${organisation}|${capability}`
  capabilityThrows: false,
  managed: null as null | { scheduling?: 'none' | 'view' | 'use' },
  managedThrows: false,
  calls: { session: 0, capability: [] as Array<[string, string]>, managed: 0 },
}));

vi.mock('@/lib/org', () => ({
  requireSession: vi.fn(async () => {
    state.calls.session += 1;
    if (state.sessionThrows) throw new Error('no session');
    return state.session;
  }),
}));
vi.mock('@/lib/capabilities/requireCapability', () => ({
  checkCapability: vi.fn(async (organisationId: string, key: string) => {
    state.calls.capability.push([organisationId, key]);
    if (state.capabilityThrows) throw new Error('db down');
    return state.entitled.has(`${organisationId}|${key}`) ? { allowed: true } : { allowed: false, reason: 'NOT_ENTITLED' };
  }),
}));
vi.mock('@/lib/organisationUsers/access', () => ({
  getUserPermissions: vi.fn(async () => {
    state.calls.managed += 1;
    if (state.managedThrows) throw new Error('db down');
    return state.managed;
  }),
}));

import { getStaffBookingVisibility } from '@/lib/scheduling/staffBookingVisibility';

const SB = 'scheduling.staff_booking';
const BASE = 'scheduling';
const entitle = (org: string, ...keys: string[]) => keys.forEach(k => state.entitled.add(`${org}|${k}`));

beforeEach(() => {
  process.env.SCHEDULING_STAFF_BOOKING = 'on';
  state.session = { organisationId: 'org-a', userId: 'u1', role: 'manager' };
  state.sessionThrows = false;
  state.entitled = new Set();
  entitle('org-a', SB, BASE);
  state.capabilityThrows = false;
  state.managed = null;
  state.managedThrows = false;
  state.calls = { session: 0, capability: [], managed: 0 };
});

describe('the environment switch comes first and must be exactly "on"', () => {
  it.each([undefined, '', 'off', 'ON', 'On', 'true', '1', 'yes', ' on', 'on '])('switch=%j: false, and the session, capability tables and managed access are never touched', async value => {
    if (value === undefined) delete process.env.SCHEDULING_STAFF_BOOKING;
    else process.env.SCHEDULING_STAFF_BOOKING = value;
    expect(await getStaffBookingVisibility()).toBe(false);
    expect(state.calls.session).toBe(0);
    expect(state.calls.capability).toEqual([]);
    expect(state.calls.managed).toBe(0);
  });

  it('switch=on with everything held: true', async () => {
    expect(await getStaffBookingVisibility()).toBe(true);
  });

  it('is read on every call, never cached', async () => {
    expect(await getStaffBookingVisibility()).toBe(true);
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    expect(await getStaffBookingVisibility()).toBe(false);
    process.env.SCHEDULING_STAFF_BOOKING = 'on';
    expect(await getStaffBookingVisibility()).toBe(true);
  });
});

describe('authorised and unauthorised synthetic sessions', () => {
  it.each([['manager'], ['admin'], ['super_admin']])('role %s (holds scheduling.reserve): true', async role => {
    state.session = { organisationId: 'org-a', userId: 'u1', role };
    expect(await getStaffBookingVisibility()).toBe(true);
  });

  it.each([['viewer'], ['analyst'], ['staff'], ['unknown-role'], ['']])('role %s (no scheduling.reserve): false', async role => {
    state.session = { organisationId: 'org-a', userId: 'u1', role };
    expect(await getStaffBookingVisibility()).toBe(false);
  });

  it('no session, a throwing session and a session missing its organisation or user: false', async () => {
    state.session = null;
    expect(await getStaffBookingVisibility()).toBe(false);
    state.session = { organisationId: '', userId: 'u1', role: 'manager' };
    expect(await getStaffBookingVisibility()).toBe(false);
    state.session = { organisationId: 'org-a', userId: '', role: 'manager' };
    expect(await getStaffBookingVisibility()).toBe(false);
    state.session = { userId: 'u1', role: 'manager' };
    expect(await getStaffBookingVisibility()).toBe(false);
    state.sessionThrows = true;
    expect(await getStaffBookingVisibility()).toBe(false);
  });

  it('needs BOTH capabilities: the staff-booking one and the base scheduling one', async () => {
    state.entitled = new Set();
    entitle('org-a', BASE);
    expect(await getStaffBookingVisibility()).toBe(false);
    state.entitled = new Set();
    entitle('org-a', SB);
    expect(await getStaffBookingVisibility()).toBe(false);
    state.entitled = new Set();
    expect(await getStaffBookingVisibility()).toBe(false);
  });

  it('a managed-access row decides: use is true; view and none are false; a missing level is false; a platform owner is decided by role alone', async () => {
    state.managed = { scheduling: 'use' };
    expect(await getStaffBookingVisibility()).toBe(true);
    for (const level of ['view', 'none', undefined] as const) {
      state.managed = { scheduling: level };
      expect(await getStaffBookingVisibility(), String(level)).toBe(false);
    }
    state.session = { organisationId: 'org-a', userId: 'root', role: 'super_admin' };
    state.managed = { scheduling: 'none' };
    const before = state.calls.managed;
    expect(await getStaffBookingVisibility()).toBe(true);
    expect(state.calls.managed).toBe(before); // never even asked for a platform owner
  });

  it('fails closed on any unreadable state', async () => {
    state.capabilityThrows = true;
    expect(await getStaffBookingVisibility()).toBe(false);
    state.capabilityThrows = false;
    state.managedThrows = true;
    expect(await getStaffBookingVisibility()).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('asks about the SESSION’s organisation only: another organisation holding the capability does not help', async () => {
    state.entitled = new Set();
    entitle('org-b', SB, BASE); // org-b is entitled; the session belongs to org-a
    expect(await getStaffBookingVisibility()).toBe(false);
    expect(state.calls.capability.every(([org]) => org === 'org-a')).toBe(true);
    expect(state.calls.capability.map(c => c[1]).sort()).toEqual([BASE, SB].sort());
  });

  it('and the mirror image: a session of org-b sees the controls only because org-b is entitled', async () => {
    state.session = { organisationId: 'org-b', userId: 'u9', role: 'manager' };
    state.entitled = new Set();
    entitle('org-b', SB, BASE);
    expect(await getStaffBookingVisibility()).toBe(true);
    expect(state.calls.capability.every(([org]) => org === 'org-b')).toBe(true);
  });

  it('takes no argument: there is no way for a caller to name an organisation', () => {
    expect(getStaffBookingVisibility.length).toBe(0);
  });
});

// ── static rules ──────────────────────────────────────────────────────────────
const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLIENT_FILES = ['app/scheduling/_components/StaffBookDialog.tsx', 'lib/scheduling/staffBooking/basisClient.ts', 'lib/scheduling/staffBooking/key.ts', 'lib/scheduling/staffBooking/view.ts'];

describe('slice 1 is read only and client-safe (static)', () => {
  it.each(CLIENT_FILES)('%s sends no write, stores nothing and imports nothing server-only', file => {
    const src = strip(read(file));
    expect(src).not.toMatch(/['"`](POST|PATCH|PUT|DELETE)['"`]/);
    expect(src).not.toMatch(/\bmethod\s*:/);
    expect(src).not.toMatch(/sessionStorage|localStorage|indexedDB|document\.cookie/);
    expect(src).not.toMatch(/\/cancel|Idempotency-Key|idempotencyKey/i);
    expect(src).not.toMatch(/server-only|@\/lib\/db|@\/lib\/org|@\/lib\/capabilities|requireSession|process\.env/);
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it('the dialog has no customer fields, no free time or duration input, and no submit', () => {
    const src = strip(read('app/scheduling/_components/StaffBookDialog.tsx'));
    expect(src).not.toMatch(/type="(text|email|tel|number|time|date|datetime-local|textarea|password)"/);
    expect(src).not.toMatch(/<textarea|<select|<form|type="submit"|onSubmit/);
    expect([...src.matchAll(/<input\b/g)].length).toBe(2); // the two radio groups (offering, start time) are the only inputs
    expect([...src.matchAll(/type="radio"/g)].length).toBe(2);
  });

  it('the dialog reads only through the basis client, and it only ever offers the response’s own starts', () => {
    const src = strip(read('app/scheduling/_components/StaffBookDialog.tsx'));
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).toMatch(/fetchBasis\(/);
    expect(src).toMatch(/day\.starts\.map/);
  });

  it('the basis client calls only GET reads', () => {
    const src = strip(read('lib/scheduling/staffBooking/basisClient.ts'));
    const methods = [...src.matchAll(/schedulingApi<[^>]*>\(\s*'([A-Z]+)'/g)].map(m => m[1]);
    expect(methods.length).toBeGreaterThanOrEqual(4);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('the key module generates keys only inside newBookingKey and has no rotate operation', () => {
    const src = strip(read('lib/scheduling/staffBooking/key.ts'));
    expect(src.match(/randomUUID/g)?.length).toBe(1);
    expect(src).not.toMatch(/rotate|regenerate|refresh/i);
  });
});

describe('the Book button exists only when the server says so (static)', () => {
  const calendar = strip(read('app/scheduling/_components/CalendarScreen.tsx'));

  it('canBook defaults to false and the button needs canBook, the resource calendar and an active resource', () => {
    expect(calendar).toMatch(/canBook = false/);
    expect(calendar).toMatch(/const showBook = canBook && kind === 'resource' && !bookGone && view\?\.resource\?\.active === true;/);
    expect(calendar).toMatch(/\{showBook && \(\s*<Button[\s\S]*?data-testid="book-button"/);
    expect(calendar).toMatch(/const bookDialog =\s*showBook && bookOpen/);
  });

  it('only the resource calendar page asks for the decision, and it asks on the server', () => {
    const resourcePage = read('app/scheduling/resources/[resourceId]/calendar/page.tsx');
    expect(resourcePage).toMatch(/getFacilityHireVisibility\(\)/);
    expect(resourcePage).not.toMatch(/getStaffBookingVisibility|staffBookingVisibility/); // the Coach gate can never show the Book button
    expect(resourcePage).toMatch(/canBook=\{canBook\}/);
    expect(resourcePage).not.toMatch(/'use client'/);
    expect(read('app/scheduling/offerings/[offeringId]/calendar/page.tsx')).not.toMatch(/canBook|StaffBook|getStaffBookingVisibility/);
  });

  it('the Coach visibility helper is server-only and is used only by the Coach pages; the facility-hire helper is used only by the resource calendar', () => {
    expect(read('lib/scheduling/staffBookingVisibility.ts')).toMatch(/^import 'server-only';/);
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && /staffBookingVisibility'/.test(read(rel))) importers.push(rel);
      }
    };
    for (const dir of ['app', 'lib', 'components']) walk(dir);
    expect(importers.sort()).toEqual(['app/coaching/page.tsx', 'app/coaching/roster/[id]/page.tsx']);
    expect(read('lib/scheduling/facilityHireVisibility.ts')).toMatch(/^import 'server-only';/);
    const hire: string[] = [];
    const walkHire = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walkHire(rel);
        else if (/.(ts|tsx)$/.test(entry.name) && /facilityHireVisibility'/.test(read(rel))) hire.push(rel);
      }
    };
    for (const dir of ['app', 'lib', 'components']) walkHire(dir);
    expect(hire.sort()).toEqual(['app/scheduling/resources/[resourceId]/calendar/page.tsx']);
    // the two helpers share nothing: neither reads the other's switch or capability
    expect(strip(read('lib/scheduling/facilityHireVisibility.ts'))).not.toMatch(/STAFF_BOOKING|staffBooking|staff_booking/);
    expect(strip(read('lib/scheduling/staffBookingVisibility.ts'))).not.toMatch(/FACILITY_HIRE|facilityHire|facility_hire/);
    const roster = read('app/coaching/roster/[id]/page.tsx');
    expect(roster).toContain('await getStaffBookingVisibility()');
    expect(roster).toContain('staffBooking && date.open && date.enrolled < date.capacity');
  }, 60_000); // walks every source file; under the full parallel suite it exceeded the 5 s default (found in the final release review)

  it('the visibility gate checks the switch before it reads a session', () => {
    const src = strip(read('lib/scheduling/staffBookingVisibility.ts'));
    expect(src.indexOf('staffBookingKillSwitchOn()')).toBeGreaterThan(-1);
    expect(src.indexOf('staffBookingKillSwitchOn()')).toBeLessThan(src.indexOf('requireSession()'));
    expect(src).toMatch(/scheduling\.reserve/);
    expect(src).toMatch(/SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY/);
  });
});
