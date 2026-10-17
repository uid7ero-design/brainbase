import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// The standalone product may consume the shared ticketing core and its own
// files only. It must never reach into the other application's shell,
// services, database client or auth, and must never carry a second
// ticketing engine (no SQL, no Stripe, no Resend client in this app).

const APP_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'config', 'content', 'lib'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap(d => walk(path.join(APP_ROOT, d)));

describe('standalone product boundary', () => {
  it('scans a non-trivial source tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = path.relative(APP_ROOT, file).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');

    it(`${rel} imports only from this app, the shared core, Next or React`, () => {
      const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const spec of specs) {
        const ok =
          spec.startsWith('@/') ||
          spec.startsWith('@ticketing/core') ||
          spec === 'next' || spec.startsWith('next/') ||
          spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' ||
          spec === 'lucide-react' ||
          spec.startsWith('./') || spec.startsWith('../');
        expect(ok, `${rel} imports ${spec}`).toBe(true);
        expect(spec).not.toMatch(/^\.\.\/\.\.\/(lib|app|components)\b|^\.\.\/\.\.\/\.\.\//);
      }
    });

    it(`${rel} has no engine code and no other product's shell`, () => {
      expect(src).not.toMatch(/from ['"](stripe|resend|@neondatabase\/serverless|@prisma\/client|pg|jose|bcryptjs)['"]/);
      expect(src).not.toMatch(/\bsql`|INSERT INTO|SELECT .* FROM event_|FOR UPDATE/);
      expect(src).not.toMatch(/DATABASE_URL|STRIPE_SECRET|RESEND_API_KEY|SESSION_SECRET/);
      expect(src).not.toMatch(/BrainBase|Brainbase|brainbase/);
    });
  }

  it('has no middleware and no server actions', () => {
    expect(() => statSync(path.join(APP_ROOT, 'middleware.ts'))).toThrow();
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/['"]use server['"]/);
  });

  const rel = (f: string) => path.relative(APP_ROOT, f).replace(/\\/g, '/');
  const routeFiles = files.filter(f => /app\/api\/.*route\.ts$/.test(rel(f)));

  it('exposes only the auth, buyer-relay and check-in-relay API routes', () => {
    expect(routeFiles.map(rel).sort()).toEqual([
      'app/api/auth/login/route.ts',
      'app/api/auth/logout/route.ts',
      'app/api/auth/organisation/route.ts',
      'app/api/auth/session/route.ts',
      'app/api/buyer/[organisationSlug]/[eventSlug]/[action]/route.ts',
      'app/api/organiser/check-in/[id]/[action]/route.ts',
    ]);
  });

  it('every state-changing route enforces the same-origin check before doing anything', () => {
    for (const f of routeFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b[\s\S]*?\n\}/g)) {
        expect(m[0], `${rel(f)} ${m[1]}`).toMatch(/sameOriginRequest\(req\)/);
      }
    }
  });

  it('no route emits CORS headers', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/Access-Control-|access-control-/);
  });

  it('client components never import server-only modules at runtime', () => {
    const forbidden = /from ['"]@\/lib\/(session|organiserAuth|organiserData|ticketing\/serverConfig|requestGuards)['"]/;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/^['"]use client['"]/.test(src.trim())) continue;
      expect(src, rel(f)).not.toMatch(forbidden);
      // The gateway may be referenced for TYPES only.
      for (const m of src.matchAll(/import\s+(type\s+)?[^;]*?from\s+['"]@\/lib\/ticketing\/gateway['"]/g)) {
        expect(m[0], rel(f)).toMatch(/^import\s+type\s/);
      }
    }
  });

  it('the API credential is read in exactly one place and is never public or in a client file', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (rel(f) !== 'lib/ticketing/serverConfig.ts') expect(src, rel(f)).not.toMatch(/TICKETING_API_SECRET|TICKETING_API_BASE_URL|TICKETING_API_PROTECTION_BYPASS/);
      expect(src, rel(f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|API_KEY|TICKETING_API|SESSION)/);
    }
  });

  it('the session cookie is addressed only through the shared constant (never the other product\'s "session" cookie)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, rel(f)).not.toMatch(/\.(get|set|delete)\(\s*['"](session|org_override)['"]/);
    }
    expect(readFileSync(path.join(APP_ROOT, 'lib/session.ts'), 'utf8')).toMatch(/TICKETING_SESSION_COOKIE/);
  });

  it('carries no sample or invented live data', () => {
    for (const f of files) {
      if (rel(f).startsWith('content/')) continue;
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/lorem ipsum|sample event|dummy|Jane Doe|John Smith|example\.com/i);
    }
  });

  it('the Vercel config refuses production deployments for this phase', () => {
    const vercel = JSON.parse(readFileSync(path.join(APP_ROOT, 'vercel.json'), 'utf8'));
    expect(vercel.ignoreCommand).toMatch(/VERCEL_ENV.*production.*exit 0/);
  });
});
