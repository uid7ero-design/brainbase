import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  formatIntegrationToken,
  generateIntegrationSecret,
  hashIntegrationSecret,
  INTEGRATION_TOKEN_LENGTH,
  parseBearerAuthorization,
  parseIntegrationToken,
  verifyIntegrationSecret,
} from '@/lib/integrationCredentials/token';
import {
  GRANTABLE_INTEGRATION_SCOPES,
  INTEGRATION_CAPABILITY,
  normaliseIntegrationScopes,
  RESERVED_INTEGRATION_SCOPES,
} from '@/lib/integrationCredentials/scopes';
import {
  essioSystemActor,
  systemActorActivityFields,
  systemActorAuditFields,
} from '@/lib/organiser/systemActor';

// Essio integration B1 — pure/static coverage (no database). The real-Postgres
// behaviour is proven by scripts/tests/verify-essio-integration-b1.sh.

const ROOT = path.resolve(__dirname, '../..');
// Normalise line endings: Windows checkouts (core.autocrlf=true) are CRLF.
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const ID = '00000000-0000-4000-8000-00000000000a';

describe('integration token format', () => {
  it('round-trips and has the documented shape', () => {
    const secret = generateIntegrationSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const token = formatIntegrationToken(ID, secret);
    expect(token).toBe(`bbint_${ID.replace(/-/g, '')}_${secret}`);
    expect(token).toHaveLength(INTEGRATION_TOKEN_LENGTH);
    expect(parseIntegrationToken(token)).toEqual({ credentialId: ID, secret });
  });

  it('generates distinct secrets', () => {
    const secrets = new Set(Array.from({ length: 200 }, generateIntegrationSecret));
    expect(secrets.size).toBe(200);
  });

  it('parses strictly', () => {
    const token = formatIntegrationToken(ID, generateIntegrationSecret());
    for (const bad of [
      undefined, null, 7, '', token.toUpperCase(), ` ${token}`, `${token}\n`, token.slice(0, -1), `${token}A`,
      token.replace('bbint_', 'bbinT_'), token.replace(/^bbint_[0-9a-f]{32}/, 'bbint_' + 'z'.repeat(32)),
      token.slice(0, -1) + '=', token.slice(0, -1) + '+', `Bearer ${token}`,
    ]) {
      expect(parseIntegrationToken(bad)).toBeNull();
    }
  });

  it('refuses to format malformed ids or secrets', () => {
    expect(() => formatIntegrationToken('not-a-uuid', generateIntegrationSecret())).toThrow();
    expect(() => formatIntegrationToken(ID, 'short')).toThrow();
  });
});

describe('secret hashing', () => {
  it('is a deterministic sha256 bound to the credential id', () => {
    const secret = generateIntegrationSecret();
    const hash = hashIntegrationSecret(ID, secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIntegrationSecret(ID.toUpperCase(), secret)).toBe(hash);
    expect(hashIntegrationSecret('00000000-0000-4000-8000-00000000000b', secret)).not.toBe(hash);
    expect(hash).not.toContain(secret);
  });

  it('verifies only the right secret for the right id', () => {
    const secret = generateIntegrationSecret();
    const hash = hashIntegrationSecret(ID, secret);
    expect(verifyIntegrationSecret(ID, secret, hash)).toBe(true);
    expect(verifyIntegrationSecret(ID, generateIntegrationSecret(), hash)).toBe(false);
    expect(verifyIntegrationSecret('00000000-0000-4000-8000-00000000000b', secret, hash)).toBe(false);
    expect(verifyIntegrationSecret(ID, secret, hash.toUpperCase())).toBe(false);
    expect(verifyIntegrationSecret(ID, secret, 'not-a-hash')).toBe(false);
  });
});

describe('bearer parsing', () => {
  it('accepts exactly one bearer token', () => {
    expect(parseBearerAuthorization('Bearer abc')).toBe('abc');
    expect(parseBearerAuthorization('  Bearer abc  ')).toBe('abc');
    for (const bad of [null, undefined, '', 'Bearer', 'Bearer a b', 'Basic abc', 'bearer abc', `Bearer ${'x'.repeat(300)}`]) {
      expect(parseBearerAuthorization(bad)).toBeNull();
    }
  });
});

describe('scopes', () => {
  it('grants only work:create, work:read and targets:read; reserves work:append', () => {
    expect(GRANTABLE_INTEGRATION_SCOPES).toEqual(['work:create', 'work:read', 'targets:read']);
    expect(RESERVED_INTEGRATION_SCOPES).toEqual(['work:append']);
    expect(normaliseIntegrationScopes(['targets:read', 'work:create', 'targets:read'])).toEqual({
      ok: true,
      scopes: ['work:create', 'targets:read'],
    });
    expect(normaliseIntegrationScopes(['work:append'])).toEqual({ ok: false, code: 'scope_reserved' });
    expect(normaliseIntegrationScopes(['work:delete'])).toEqual({ ok: false, code: 'scope_unknown' });
    expect(normaliseIntegrationScopes([])).toEqual({ ok: false, code: 'invalid_scopes' });
    expect(normaliseIntegrationScopes('work:read')).toEqual({ ok: false, code: 'invalid_scopes' });
    expect(normaliseIntegrationScopes([1])).toEqual({ ok: false, code: 'invalid_scopes' });
  });

  it('maps the essio integration to the essio_integration capability', () => {
    expect(INTEGRATION_CAPABILITY).toEqual({ essio: 'essio_integration' });
  });

  it('the database CHECK matches the grantable list and excludes the reserved scope', () => {
    const migration = read('scripts/create-essio-integration-b1.sql');
    expect(migration).toContain("scopes <@ ARRAY['work:create', 'work:read', 'targets:read']::TEXT[]");
    expect(migration).not.toMatch(/ARRAY\[[^\]]*'work:append'/);
  });
});

describe('system actor', () => {
  const principal = { kind: 'integration' as const, integrationKey: 'essio' as const, credentialId: ID };

  it('has no user id and names Essio as the source', () => {
    const actor = essioSystemActor(principal);
    expect(actor).toEqual({ kind: 'system', actorUserId: null, actorName: 'Essio', source: 'essio', credentialId: ID });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(systemActorActivityFields(actor)).toEqual({
      actorUserId: null,
      actorName: 'Essio',
      metadata: { source: 'essio', credential_id: ID },
    });
    expect(systemActorAuditFields(actor)).toEqual({ userId: null, sourceState: { source: 'essio', credential_id: ID } });
  });

  it('cannot be built from a non-Essio principal', () => {
    expect(() => essioSystemActor({ ...principal, integrationKey: 'other' as never })).toThrow();
    expect(() => essioSystemActor({ ...principal, kind: 'user' as never })).toThrow();
  });
});

describe('static guarantees', () => {
  const sources = [
    'lib/integrationCredentials/token.ts',
    'lib/integrationCredentials/scopes.ts',
    'lib/integrationCredentials/service.ts',
    'lib/organiser/externalLinks.ts',
    'lib/organiser/systemActor.ts',
  ];

  it('never logs and never touches CRON_SECRET', () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, file).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(text, file).not.toContain('process.env.CRON_SECRET');
    }
  });

  it('authentication accepts no organisation input and stores no plaintext', () => {
    const service = read('lib/integrationCredentials/service.ts');
    const signature = service.slice(service.indexOf('export async function authenticateIntegrationCredential'));
    expect(signature.slice(0, signature.indexOf('{\n'))).not.toMatch(/organisation/i);
    expect(service).not.toMatch(/INSERT INTO integration_credentials[\s\S]{0,400}\$\{secret\}/);
  });

  it('the B1 migration is typed: no polymorphic entity_type/entity_id columns', () => {
    const migration = read('scripts/create-essio-integration-b1.sql');
    expect(migration).not.toMatch(/\bentity_type\b|\bentity_id\b/);
    expect(migration).toContain('ON DELETE SET NULL (organiser_item_id)');
    expect(migration).toContain('REFERENCES organiser_items (organisation_id, id)');
    expect(migration).toContain('REFERENCES integration_credentials (organisation_id, id)');
  });

  it('only the reviewed B2 routes use the B1 modules (no other route, no B3 route)', () => {
    const api = path.join(ROOT, 'app/api');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
      );
    const offenders = walk(api).filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return /integrationCredentials|externalLinks|systemActor/.test(text);
    });
    const rel = offenders.map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
    expect(rel).toEqual([
      'app/api/admin/integration-credentials/[credentialId]/route.ts',
      'app/api/admin/integration-credentials/route.ts',
    ]);
  });
});
