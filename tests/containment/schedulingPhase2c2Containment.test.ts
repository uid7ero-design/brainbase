import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

vi.setConfig({ testTimeout: 60_000 });

// Phase 2C.2 adds the READ side of bookings: one GET route behind scheduling.view, one handler, one read-only repository, one pure core module. This file pins what they
// may be. They create no reservation, occurrence, hold or series, write no audit entry, take no organisation from the request, never call the availability computation
// (the calendar's two layers stay apart), and send no customer data to anyone.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
const code = (rel: string) => noTsComments(read(rel));

const ROUTE = 'app/api/scheduling/calendar-overlay/route.ts';
const HANDLER = 'lib/scheduling/config/bookingOverlay.ts';
const REPO = 'packages/scheduling-postgres/src/bookingReadRepository.ts';
const CORE = 'packages/scheduling/src/bookingOverlay.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

describe('the route is GET only, behind scheduling.view, through the central guard, with the calendar’s deadline', () => {
  const src = code(ROUTE);
  it('exports exactly GET and the dynamic flag', () => {
    expect([...src.matchAll(/export const (\w+)\b/g)].map(m => m[1]).sort()).toEqual(['GET', 'dynamic']);
    expect(src).toMatch(/export const GET = schedulingRoute\('scheduling\.view', bookingOverlay, \{ deadlineMs: calendarDeadlineMs \}\);/);
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(src).not.toMatch(/scheduling\.manage|scheduling\.reserve|scheduling\.attendance/);
    expect(src).not.toMatch(/requireSession|@\/lib\/db|@\/lib\/org|@scheduling\/postgres|NextResponse|cookies\(|headers\(/);
  });
});

describe('the handler reads and writes nothing, and trusts nothing from the request but its filters', () => {
  const src = code(HANDLER);
  it('uses exactly one repository method and no write method, audit or availability computation', () => {
    expect([...src.matchAll(/context\.(\w+)\.(\w+)\(/g)].map(m => `${m[1]}.${m[2]}`)).toEqual(['bookingReads.readBookingOverlay']);
    expect(src).not.toMatch(/\.(create|update|delete|remove|archive|link|unlink|save|set|insert|upsert|cancel|release|pin|add)[A-Z]?\w*\(/);
    expect(src).not.toMatch(/\baudit\(|recordSchedulingAudit|@\/lib\/scheduling\/audit/);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
    expect(src).not.toMatch(/computeAvailability|buildOfferingCalendar|buildResourceCalendar|expandOwnerAvailability|generateSlots|availability\./);
  });
  it('reads no body and no cookie, accepts a closed list of query parameters and never an organisation', () => {
    expect(src).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\(|readBody/);
    expect(src).not.toMatch(/organi[sz]ation_?id|organi[sz]ationS/i);
    expect(src).toMatch(/const ALLOWED = \['from', 'to', 'offeringId', 'resourceIds', 'includeCancelled', 'limit'\] as const;/);
    expect(src).toMatch(/CALENDAR_MAX_DAYS/);
  });
  it('checks the finished body for identity-bearing properties before sending it, by structure', () => {
    expect(src).toMatch(/findIdentityKeyLeaks\(body\)\.length > 0/);
    expect(src).toMatch(/Internal error\./);
  });
});

describe('the repository only reads', () => {
  const src = code(REPO);
  it('sends only SELECT statements and no locking, advisory or write construct', () => {
    const statements = [...src.matchAll(/`(SELECT[\s\S]*?)`/g)].map(m => m[1]);
    expect(statements.length).toBe(4);
    for (const s of statements) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b|FOR\s+(UPDATE|SHARE|NO\s+KEY)|pg_advisory|nextval|set_config|scheduling_cancel_occurrence/i);
    expect(src).not.toMatch(/\.query<[^>]*>\(\s*'(INSERT|UPDATE|DELETE)/);
  });
  it('every statement is scoped by the tenant first', () => {
    for (const m of src.matchAll(/`(SELECT[\s\S]*?)`/g)) expect(m[1]).toMatch(/WHERE (o|r|h)\.organisation_id = \$1/);
  });
  it('the viewer read never names a customer column, and no import brings in the availability engine or a write port', () => {
    const viewer = src.slice(src.indexOf('async listReservationsInRange'), src.indexOf('async listReservationDetailsInRange'));
    for (const column of ['customer_name', 'customer_email', 'customer_phone', 'customer_id', 'notes', 'payment_status', 'attendance', 'series_id', 'created_by', 'idempotency_key', 'cancel_reason', 'price_cents', 'party_size']) {
      expect(viewer, column).not.toContain(column);
    }
    expect(src).not.toMatch(/computeAvailability|availability|ReservationRepository|SchedulingConfigRepository/);
  });
  it('the full detail read is refused to anyone without scheduling.reserve before any SQL runs', () => {
    const detail = src.slice(src.indexOf('async listReservationDetailsInRange'), src.indexOf('async listLiveHoldsInRange'));
    expect(detail.indexOf("tenant.can('scheduling.reserve')")).toBeGreaterThan(-1);
    expect(detail.indexOf("tenant.can('scheduling.reserve')")).toBeLessThan(detail.indexOf('this.sql.query'));
  });
});

describe('the two calendar layers stay apart', () => {
  it('no availability module reads a booking, an overlay or a booking repository, and the overlay module reads no availability', () => {
    for (const f of ['availability.ts', 'availabilityRules.ts', 'availabilityCalendar.ts', 'availabilityPersistence.ts']) {
      expect(code(`packages/scheduling/src/${f}`), f).not.toMatch(/bookingOverlay|BookingOverlay|bookingReads|PostgresBookingReadRepository|OccurrenceWithHeadcount/);
    }
    expect(code(CORE)).not.toMatch(/from '\.\/availability|computeAvailability|generateSlots/);
    for (const f of ['lib/scheduling/config/calendar.ts', 'lib/scheduling/dashboard/calendar.ts']) expect(code(f), f).not.toMatch(/bookingOverlay|bookingReads|readBookingOverlay/);
  });
});

describe('nothing else was added', () => {
  it('no page, screen or navigation entry reaches the overlay yet', () => {
    const users = [...walk('app'), ...walk('components'), ...walk('lib')]
      .filter(f => /\.(ts|tsx)$/.test(f) && ![ROUTE, HANDLER, 'lib/scheduling/runtime.ts'].includes(f))
      .filter(f => /calendar-overlay|readBookingOverlay|bookingReads|PostgresBookingReadRepository/.test(noTsComments(read(f))));
    expect(users).toEqual([]);
  });
  it('the runtime builds the read repository over the same executor (deadline and statement recorder) and nothing else changed there', () => {
    const src = code('lib/scheduling/runtime.ts');
    expect(src).toMatch(/const bookingReads = new PostgresBookingReadRepository\(\{ sql: executor \}\);/);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
  it('still no migration beyond 036 and no booking-writing route (the 2C.1 pins hold)', () => {
    const names = readdirSync(path.join(ROOT, 'packages/scheduling/sql'));
    expect(names.filter(n => /^0(3[7-9]|[4-8]\d)_/.test(n))).toEqual([]);
    const routes = walk('app/api/scheduling').filter(f => /route\.ts$/.test(f));
    expect(routes.filter(f => /reservation|occurrence|series|booking|enrol|attendance/i.test(f)).filter(f => /export const (POST|PUT|PATCH|DELETE)\b/.test(code(f)))).toEqual([]);
  });
  it('nothing in the application writes a reservation, occurrence or series (no repository write is reachable from a route)', () => {
    const routes = walk('app/api/scheduling').filter(f => /route\.ts$/.test(f));
    const handlers = walk('lib/scheduling/config');
    const offenders = [...routes, ...handlers].filter(f => /\.(createOccurrence|cancelOccurrence|createSeries|addSeriesPause|setAttendance)\(|reservations\.(create|createAssigned|cancel)\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});
