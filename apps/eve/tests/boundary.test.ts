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

  it('the app has no middleware, no API routes and no server actions in Phase 1', () => {
    expect(() => statSync(path.join(APP_ROOT, 'middleware.ts'))).toThrow();
    expect(() => statSync(path.join(APP_ROOT, 'app', 'api'))).toThrow();
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/['"]use server['"]/);
  });

  it('the Vercel config refuses production deployments for this phase', () => {
    const vercel = JSON.parse(readFileSync(path.join(APP_ROOT, 'vercel.json'), 'utf8'));
    expect(vercel.ignoreCommand).toMatch(/VERCEL_ENV.*production.*exit 0/);
  });
});
