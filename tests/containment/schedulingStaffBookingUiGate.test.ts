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

const READ_ONLY_FILES = ['lib/scheduling/staffBooking/basisClient.ts', 'lib/scheduling/staffBooking/view.ts', 'lib/scheduling/staffBooking/key.ts'];
const CLIENT_FILES = ['app/scheduling/_components/StaffBookDialog.tsx', 'lib/scheduling/staffBooking/submitClient.ts', 'lib/scheduling/staffBooking/machine.ts', ...READ_ONLY_FILES];
const DIALOG = 'app/scheduling/_components/StaffBookDialog.tsx';
const SUBMIT = 'lib/scheduling/staffBooking/submitClient.ts';
const MACHINE = 'lib/scheduling/staffBooking/machine.ts';

describe('the staff booking UI is client-safe and writes in exactly one place (static)', () => {
  it.each(CLIENT_FILES)('%s stores nothing, logs nothing and imports nothing server-only', file => {
    const src = strip(read(file));
    expect(src).not.toMatch(/sessionStorage|localStorage|indexedDB|document\.cookie|navigator\.sendBeacon/);
    expect(src).not.toMatch(/server-only|@\/lib\/db|@\/lib\/org|@\/lib\/capabilities|requireSession|process\.env/);
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(src).not.toMatch(/\/cancel/);
  });

  it.each([...READ_ONLY_FILES, DIALOG, MACHINE])('%s sends no write itself', file => {
    const src = strip(read(file));
    expect(src).not.toMatch(/['"`](POST|PATCH|PUT|DELETE)['"`]/);
    expect(src).not.toMatch(/\bmethod\s*:/);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it('the basis client calls only GET reads', () => {
    const src = strip(read('lib/scheduling/staffBooking/basisClient.ts'));
    const methods = [...src.matchAll(/schedulingApi<[^>]*>\(\s*'([A-Z]+)'/g)].map(m => m[1]);
    expect(methods.length).toBeGreaterThanOrEqual(4);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('the ONE write is a single POST to /api/scheduling/reservations with the Idempotency-Key header; everything else it sends is a GET', () => {
    const src = strip(read(SUBMIT));
    expect([...src.matchAll(/method:\s*'([A-Z]+)'/g)].map(m => m[1]).sort()).toEqual(['GET', 'POST']);
    expect(src.match(/'Idempotency-Key': key/g)?.length).toBe(1);
    expect(src.match(/'\/api\/scheduling\/reservations'/g)?.length).toBe(1);
    expect(src).not.toMatch(/\b(PATCH|PUT|DELETE)\b/);
    expect(src).not.toMatch(/\bnew Request\b|XMLHttpRequest|WebSocket|EventSource/);
    // the lookup puts only the key in the query string
    expect(src).toMatch(/\/api\/scheduling\/reservations\?idempotencyKey=\$\{encodeURIComponent\(key\)\}/);
  });

  it('only the dialog imports the submit client functions; no other module can write a booking', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && /staffBooking\/submitClient/.test(read(rel))) importers.push(rel);
      }
    };
    walk('app');
    walk('lib');
    expect(importers).toEqual([DIALOG]);
    expect(read(MACHINE)).toMatch(/import type \{[^}]*\} from '\.\/submitClient';/); // the machine takes the response TYPES only, never the functions
  }, 60_000);

  it('the state machine is pure: no I/O, clock, timer or randomness, and the key holder is touched in exactly two places', () => {
    const src = strip(read(MACHINE));
    expect(src).not.toMatch(/\bfetch\b|Date\.now|new Date|Math\.random|crypto|setTimeout|setInterval|\bawait\b|\basync\b/);
    expect(src).not.toMatch(/from 'react'/);
    expect(src.match(/holder\.keyFor\(/g)?.length).toBe(1); // REVIEW: the only place a key is asked for
    expect(src.match(/holder\.discard\(/g)?.length).toBe(1); // NEW_ATTEMPT, reachable only from the conflict state
    expect(src).toMatch(/case 'NEW_ATTEMPT': \{\s*if \(state\.step !== 'conflict'\) return state;/);
    expect(src).toMatch(/case 'RETRY': \{\s*if \(\(state\.step !== 'retry' && state\.step !== 'unsure'\) \|\| !state\.attempt\) return state;/);
  });

  it('the key module generates keys only inside newBookingKey and has no rotate operation', () => {
    const src = strip(read('lib/scheduling/staffBooking/key.ts'));
    expect(src.match(/randomUUID/g)?.length).toBe(1);
    expect(src).not.toMatch(/rotate|regenerate|refresh/i);
  });

  it('the dialog never creates a key or a payload of its own, offers no payment control and has no free time, duration or step input', () => {
    const src = strip(read(DIALOG));
    expect(src).not.toMatch(/newBookingKey|randomUUID|bk_/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).toMatch(/fetchBasis\(/);
    expect(src).toMatch(/day\.starts\.map/);
    expect(src).not.toMatch(/type="(time|date|datetime-local|number|password|checkbox|file)"/);
    expect(src).not.toMatch(/<select|stripe|card number|cardNumber|payment method|Pay now|paymentIntent|checkout/i);
    expect([...src.matchAll(/type="radio"/g)].length).toBe(2); // the offering and start-time groups
  });

  it('every customer field turns browser autocomplete off, so the staff member’s own details are never inserted', () => {
    const src = strip(read(DIALOG));
    const fields = [...src.matchAll(/<(input|textarea)\b[^>]*?(?:\/>|>)/g)].map(m => m[0]).filter(tag => !/type="radio"/.test(tag) && !/readOnly/.test(tag));
    expect(fields.length).toBe(5); // name, email, phone, party size, notes
    for (const tag of fields) expect(tag).toMatch(/autoComplete="off"/);
    expect(src).toMatch(/<form[\s\S]*?autoComplete="off"/);
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
    expect(resourcePage).toMatch(/getStaffBookingVisibility\(\)/);
    expect(resourcePage).toMatch(/canBook=\{canBook\}/);
    expect(resourcePage).not.toMatch(/'use client'/);
    expect(read('app/scheduling/offerings/[offeringId]/calendar/page.tsx')).not.toMatch(/canBook|StaffBook|getStaffBookingVisibility/);
  });

  it('the visibility helper is server-only and is used only by the Coach roster and resource calendar', () => {
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
    expect(importers.sort()).toEqual(['app/coaching/page.tsx', 'app/coaching/roster/[id]/page.tsx', 'app/scheduling/resources/[resourceId]/calendar/page.tsx']);
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
