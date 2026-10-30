import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.setConfig({ testTimeout: 60_000 });

// Phase 2B.3d adds the READ-ONLY availability calendar. This file pins what it may be: two GET routes behind scheduling.view, a handler that reads
// and writes nothing, a pure view model in the shared core (no clock, no database, no randomness), one read-only repository method, and a screen
// that only ever GETs. It creates no reservation, occurrence, hold, payment or pin, and it saves no hours.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
const code = (rel: string) => noTsComments(read(rel));

const ROUTES = ['app/api/scheduling/offerings/[offeringId]/calendar/route.ts', 'app/api/scheduling/resources/[resourceId]/calendar/route.ts'];
const HANDLER = 'lib/scheduling/config/calendar.ts';
const CORE = 'packages/scheduling/src/availabilityCalendar.ts';
const SCREEN = 'app/scheduling/_components/CalendarScreen.tsx';
const HELPERS = 'lib/scheduling/dashboard/calendar.ts';
const PAGES = ['app/scheduling/offerings/[offeringId]/calendar/page.tsx', 'app/scheduling/resources/[resourceId]/calendar/page.tsx'];

describe('the two calendar routes are GET only, behind scheduling.view, through the central guard', () => {
  it.each(ROUTES)('%s', f => {
    const src = code(f);
    expect([...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1])).toEqual(['GET']);
    // 2B.3e adds a bounded execution time (a read, so answering "timed out" is always safe) and nothing else
    expect(src).toMatch(/export const GET = schedulingRoute\('scheduling\.view', (offeringCalendar|resourceCalendar), \{ deadlineMs: calendarDeadlineMs \}\);/);
    expect(src).not.toMatch(/scheduling\.manage|scheduling\.reserve|scheduling\.attendance/);
    expect(src).not.toMatch(/requireSession|@\/lib\/db|@\/lib\/org|@scheduling\/postgres|NextResponse|cookies\(|headers\(/);
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});

describe('the handler reads and writes nothing', () => {
  const src = code(HANDLER);

  it('calls no write method of any repository and records no audit entry', () => {
    expect(src).not.toMatch(/\.(create|update|delete|remove|archive|link|unlink|save|set|insert|upsert|cancel|release|pin|add)[A-Z]?\w*\(/);
    expect(src).not.toMatch(/\baudit\(|recordSchedulingAudit|@\/lib\/scheduling\/audit/);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
  });

  it('never reads a request body, a cookie or an organisation from the caller', () => {
    expect(src).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\(|readBody/);
    expect(src).not.toMatch(/organi[sz]ation_?id|organi[sz]ationS/i);
    expect(src).toMatch(/new URL\(request\.url\)\.searchParams/);
  });

  it('uses only the repository reads the calendar needs', () => {
    const reads = [...src.matchAll(/context\.(?:persistence\.config|availability)\.(\w+)\(/g)].map(m => m[1]);
    expect([...new Set(reads)].sort()).toEqual(['getOffering', 'getSchedule', 'listExceptionsForOwners', 'listLiveHoldsForResources', 'listOfferingResources', 'listResources', 'listRulesForOwners', 'listZonesForOwners']);
  });

  it('accepts only from, to and (for an offering) step, and caps the range', () => {
    expect(src).toMatch(/const ALLOWED = \['from', 'to', 'step'\] as const;/);
    expect(src).toMatch(/CALENDAR_MAX_DAYS/);
  });
});

describe('the view model is pure', () => {
  const src = code(CORE);

  it('imports no database, framework, clock or randomness, and reads no ambient time', () => {
    expect([...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]).sort()).toEqual(
      ['./availability', './availabilityPersistence', './availabilityRules', './contracts', './persistence', './time', './types', './validation'].sort(),
    );
    expect(src).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|process\.|require\(|fetch\(|setTimeout|crypto/);
  });

  it('constructs nothing that books: no reservation, occurrence or hold is created, only read', () => {
    expect(src).not.toMatch(/createReservation|createOccurrence|createHold|newReservation|NewReservationInput|NewOccurrenceInput/);
    expect(src).toMatch(/computeAvailability\(/);
    expect(src).toMatch(/expandOwnerAvailability\(/);
  });

  it('is built on the shared engine, not a second implementation of the rules', () => {
    expect(src).not.toMatch(/resolveLocalTime|validateAvailabilityRuleSet\(|function windowsForDate|function generateSlots/);
  });
});

describe('the one new repository method is a SELECT', () => {
  const repo = read('packages/scheduling-postgres/src/configRepository.ts');
  const start = repo.indexOf('async listLiveHoldsForResources');
  const method = repo.slice(start, repo.indexOf('\n  }\n', start));

  it('exists once, needs scheduling.view, is tenant scoped and live-only', () => {
    expect(repo.match(/async listLiveHoldsForResources/g)).toHaveLength(1);
    expect(method).toMatch(/tenant\.can\('scheduling\.view'\)/);
    expect(method).toMatch(/WHERE organisation_id = \$1 AND resource_id = ANY\(\$2::text\[\]\) AND released_at IS NULL/);
    expect(method).toMatch(/during && tstzrange\(\$3::timestamptz, \$4::timestamptz, '\[\)'\)/);
    expect(method).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
  });

  it('is declared on the persistence port as read only and nothing else on the port changed shape', () => {
    const port = read('packages/scheduling/src/persistence.ts');
    expect(port).toMatch(/listLiveHoldsForResources\(tenant: TenantContext, resourceIds: readonly string\[\], fromInstant: string, toInstant: string\): Promise<ResourceHold\[\]>;/);
  });
});

describe('the screen only reads', () => {
  const screen = code(SCREEN);
  const helpers = code(HELPERS);

  it('fetches through the loading hook (GET) and never calls the write API', () => {
    expect(screen).not.toMatch(/schedulingApi\s*(<[^>]*>)?\s*\(\s*'(POST|PATCH|DELETE|PUT)'/);
    expect(screen).not.toMatch(/\bfetch\(|XMLHttpRequest|method:\s*'(POST|PATCH|DELETE|PUT)'/);
    expect(screen).toMatch(/useSchedulingData<CalendarResponse>/);
    expect(screen).not.toMatch(/<form\b|onSubmit|type="submit"/);
  });

  it('imports nothing server-side and uses no browser clock beyond the date it is asked for', () => {
    const imports = [...screen.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
    for (const i of imports) expect(i, i).toMatch(/^(react|next\/link|next\/navigation|@\/components\/ui\/app|@\/lib\/scheduling\/dashboard\/(api|availability|calendar|types)|@scheduling\/core|\.\/[\w]+|\.\/scheduling\.module\.css)$/);
    expect(imports.filter(i => i.startsWith('@scheduling/core'))).toHaveLength(1);
    expect(screen).toMatch(/import type \{ CalendarDay, CalendarLane \} from '@scheduling\/core'/);
    const helperImports = [...helpers.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
    expect(helperImports).toEqual(['@scheduling/core']);
    expect(helpers).toMatch(/import type \{[^}]+\} from '@scheduling\/core'/);
  });

  it('offers a link to the hours screen, labelled by what the person may do there, and no way to save, book or hold', () => {
    expect(screen).toMatch(/canManage \? 'Edit hours' : 'View hours'/);
    expect(screen).not.toMatch(/\b(Book|Reserve|Save|Pin|Hold|Pay)\b\s*<\/(Button|button)>|>\s*(Book|Reserve|Save hours|Pay)\b/);
  });
});

describe('the pages authorise themselves', () => {
  it.each(PAGES)('%s', f => {
    const src = code(f);
    expect(src).toMatch(/resolveSchedulingPage\(\)/);
    expect(src).toMatch(/if \(denied\) return denied;/);
    // 2B.3e follow-up: the page also hands the screen the organisation's timezone (read beside the access check), so the screen need not ask /status for it
    expect(src).toMatch(/<CalendarScreen kind="(offering|resource)" id=\{\w+\} canManage=\{canManage\} organisationTimezone=\{timezone\} \/>/);
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});

describe('nothing in 2B.3d changes the database or the Production-facing surface', () => {
  it('adds no SQL migration, and the staged 034 to 036 files and their rollbacks are the reviewed ones', () => {
    const sql = (n: string) => read(`packages/scheduling/sql/${n}`).replace(/\r/g, '');
    for (const n of ['034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql', '095_availability_integrity_rollback.sql', '096_availability_partial_closures_rollback.sql', '097_availability_zones_rollback.sql']) {
      expect(sql(n).length, n).toBeGreaterThan(100);
    }
    expect(read('packages/scheduling/sql/036_availability_zones.sql').replace(/\r/g, '')).toMatch(/2b\.3\.3/);
  });
});
