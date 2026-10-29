import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ESSIO_STATUS_CATEGORIES, normaliseOrganiserStatus } from '@/lib/essioIntegration/status';

// Essio integration B3 — pure/static coverage of the status read. Real-Postgres
// behaviour is proven by scripts/tests/verify-essio-integration-b3.sh.

const ROOT = path.resolve(__dirname, '../..');
// Normalise line endings: Windows checkouts (core.autocrlf=true) are CRLF.
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('Organiser status normalisation', () => {
  it('maps the four Organiser statuses deterministically', () => {
    expect(normaliseOrganiserStatus('Not Started')).toBe('not_started');
    expect(normaliseOrganiserStatus('Working on it')).toBe('in_progress');
    expect(normaliseOrganiserStatus('Stuck')).toBe('blocked');
    expect(normaliseOrganiserStatus('Done')).toBe('done');
  });

  it('ignores case and surrounding whitespace only', () => {
    expect(normaliseOrganiserStatus('  done ')).toBe('done');
    expect(normaliseOrganiserStatus('WORKING ON IT')).toBe('in_progress');
    expect(normaliseOrganiserStatus('Working on  it')).toBe('other');
  });

  it('maps anything else to other', () => {
    for (const raw of ['', 'In review', 'Blocked', 'Completed', 'Waiting on client ✋', 'not_started']) {
      expect(normaliseOrganiserStatus(raw)).toBe('other');
    }
  });

  it('has exactly the documented categories', () => {
    expect(ESSIO_STATUS_CATEGORIES).toEqual(['not_started', 'in_progress', 'blocked', 'done', 'other']);
  });
});

describe('static guarantees', () => {
  const route = read('app/api/integrations/essio/v1/work/[idempotencyKey]/route.ts');
  const service = read('lib/essioIntegration/status.ts');

  it('the route requires work:read and exports only GET', () => {
    expect(route).toContain("authenticateEssioRequest(req, 'work:read')");
    expect(route.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g)).toEqual(['export async function GET']);
    expect(route).not.toMatch(/requireSession|requireRole|getSession|cookies\(/);
  });

  it('the lookup is constrained to the credential organisation and Essio links', () => {
    expect(service).toContain('FROM organiser_item_external_links l');
    expect(service).toContain('l.organisation_id = ${principal.organisationId}::text');
    expect(service).toContain("l.source_system = 'essio'");
    expect(service).toContain('l.idempotency_key = ${idempotencyKey}::text');
    expect(service).toContain('i.organisation_id = l.organisation_id');
  });

  it('selects only the minimal item fields', () => {
    const select = service.slice(service.indexOf('SELECT l.organiser_item_id'), service.indexOf('FROM organiser_item_external_links'));
    expect(select).not.toMatch(/notes|owner|assignee|priority|due_date|snapshot|fingerprint|credential|name/);
  });

  it('is read only and never logs', () => {
    expect(service).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(route + service).not.toMatch(/console\./);
  });
});
