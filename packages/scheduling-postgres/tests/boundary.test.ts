import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Standalone deployability is an acceptance criterion (docs/architecture/scheduling-phase2-schema-outline.md
// section 8). These static checks keep the Postgres adapter and the SHARED SQL free of any host
// dependency, so the same files can be dropped into a deployment with its own database.

const PKG = path.resolve(__dirname, '..');
const SRC = path.join(PKG, 'src');
const SQL = path.resolve(PKG, '../scheduling/sql');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripSql = (s: string) => s.replace(/--.*$/gm, '');

describe('@scheduling/postgres package boundary', () => {
  const files = readdirSync(SRC).filter(f => f.endsWith('.ts'));
  it('ships the documented modules', () => {
    for (const m of ['index', 'executor', 'errors', 'reservationRepository', 'configRepository', 'support']) expect(files).toContain(`${m}.ts`);
  });
  for (const file of files) {
    const src = strip(readFileSync(path.join(SRC, file), 'utf8'));
    it(`${file} imports only @scheduling/core and its own modules`, () => {
      const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const spec of imports) expect(spec, `${file} imports ${spec}`).toMatch(/^(\.\/|@scheduling\/core$)/);
    });
    it(`${file} touches no framework, driver, environment, clock or host vocabulary`, () => {
      expect(src).not.toMatch(/from ['"](next|react|stripe|resend|@neondatabase|@prisma|pg|jose)(\/|['"])/);
      expect(src).not.toMatch(/process\.env|\bnew Date\(\)|Date\.now\(|Math\.random\(/);
      expect(src).not.toMatch(/BrainBase|Brainbase|tennis|\bEve\b|Stripe|Resend|crm_contacts|\bcontacts\b|\bbookings\b|session_instances|organisations\b/i);
    });
  }
});

describe('shared SQL stays host-free (standalone checklist items 1-3)', () => {
  const shared = stripSql(readFileSync(path.join(SQL, '010_shared_schema.sql'), 'utf8'));
  it('references no BrainBase or LD Tennis table', () => {
    for (const host of ['organisations', 'users', 'contacts', 'crm_contacts', 'bookings', 'sessions', 'session_instances', 'client_pipeline', 'events', 'event_orders']) {
      expect(shared, host).not.toMatch(new RegExp(`\\b${host}\\b`, 'i'));
    }
  });
  it('declares no foreign key to a table outside the scheduling_* family', () => {
    const refs = [...shared.matchAll(/REFERENCES\s+([a-z_]+)/gi)].map(m => m[1]);
    expect(refs.length).toBeGreaterThanOrEqual(15);
    for (const r of refs) expect(r).toMatch(/^scheduling_/);
  });
  it('keeps organisation_id and customer_id as plain TEXT with no host foreign key', () => {
    expect(shared).not.toMatch(/customer_id\s+text\s+REFERENCES/i);
    expect(shared).not.toMatch(/organisation_id\s+text[^,]*REFERENCES/i);
    expect(shared).not.toMatch(/organisation_id\s+uuid/i);
  });
  it('is additive: it never alters, drops, truncates or deletes', () => {
    expect(shared).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(shared).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)\b/i);
    expect(shared).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    expect(shared).not.toMatch(/\bUPDATE\s+(?!scheduling_)[a-z_]+\s+SET\b/i);
    expect(shared).not.toMatch(/\bINSERT\s+INTO\s+(?!scheduling_)/i);
  });
  it('every object it creates is named scheduling_*', () => {
    const created = [...shared.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?(?:UNIQUE\s+)?(TABLE|FUNCTION|TRIGGER|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gi)].map(m => m[2]);
    expect(created.length).toBeGreaterThan(30);
    for (const name of created) expect(name, name).toMatch(/^scheduling_/);
  });
  it('the rollback drops only scheduling_* objects', () => {
    const rollback = stripSql(readFileSync(path.join(SQL, '090_rollback.sql'), 'utf8'));
    const dropped = [...rollback.matchAll(/DROP\s+(?:TABLE|FUNCTION|SCHEMA)\s+(?:IF\s+EXISTS\s+)?([a-z_]+)/gi)].map(m => m[1]);
    expect(dropped.length).toBeGreaterThanOrEqual(20);
    for (const d of dropped) expect(d, d).toMatch(/^scheduling_/);
  });
  it('the preflight and verification scripts are read-only', () => {
    for (const f of ['001_preflight.sql', '020_verify.sql']) {
      const text = stripSql(readFileSync(path.join(SQL, f), 'utf8'));
      expect(text, f).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COMMENT)\b/im);
    }
  });
});
