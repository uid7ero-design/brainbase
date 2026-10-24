import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The shared ticketing core must stay pure and application-agnostic. These
// checks read the package source text so that a stray `import sql from
// '@/lib/db'` or a `'server-only'` marker can never slip in through a
// refactor — either would break the standalone product's build and drag
// an application's runtime into the package.

const SRC = path.resolve(__dirname, '../src');
const files = readdirSync(SRC).filter(f => f.endsWith('.ts'));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('@ticketing/core package boundary', () => {
  it('ships at least the documented modules', () => {
    for (const m of ['index', 'domain', 'productConfig', 'feeCalculation', 'ticketValidity', 'saleWindow', 'orderGrouping', 'receipt', 'ticketEmailEligibility', 'validation', 'artworkConstants']) {
      expect(files, m).toContain(`${m}.ts`);
    }
  });

  for (const file of files) {
    const src = stripComments(readFileSync(path.join(SRC, file), 'utf8'));

    it(`${file} imports nothing from any application or framework`, () => {
      const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const spec of imports) {
        // Only relative, in-package imports are allowed.
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\.?\//);
        expect(spec).not.toMatch(/^\.\.\/\.\./);
      }
      expect(src).not.toMatch(/['"]server-only['"]/);
      expect(src).not.toMatch(/from ['"](next|react|react-dom|stripe|resend|@neondatabase|@prisma|pg|jose)(\/|['"])/);
      expect(src).not.toMatch(/@\/(lib|app|components)\//);
      expect(src).not.toMatch(/from ['"]\.\.\/\.\.\/(lib|app|components|apps)\//);
    });

    it(`${file} never reads process.env, the DOM, cookies or a database`, () => {
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/\bdocument\.|\bwindow\.|\blocalStorage\b|\bcookies\(/);
      expect(src).not.toMatch(/\bsql`|SELECT\s+.*\s+FROM\s+event_|INSERT INTO|UPDATE event_/);
    });

    it(`${file} carries no product name in domain code`, () => {
      // The shared core must not know which product it serves; product
      // identity enters only through defineProductConfig().
      expect(src).not.toMatch(/\bBrainBase\b|\bBrainbase\b/);
    });
  }

  it('the package manifest exposes TypeScript source directly and has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.name).toBe('@ticketing/core');
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.exports['.']).toBe('./src/index.ts');
    expect(pkg.exports['./*']).toBe('./src/*.ts');
  });

  it('the root tsconfig and vitest config resolve the package by the same alias', () => {
    const root = path.resolve(__dirname, '../../..');
    const tsconfig = readFileSync(path.join(root, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"@ticketing\/core": \["\.\/packages\/ticketing\/src\/index\.ts"\]/);
    expect(tsconfig).toMatch(/"@ticketing\/core\/\*": \["\.\/packages\/ticketing\/src\/\*"\]/);
    const vitest = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
    expect(vitest).toMatch(/'@ticketing\/core\/': path\.resolve\(__dirname, 'packages\/ticketing\/src'\)/);
  });

  it('BrainBase keeps a one-line re-export at every former lib/events path', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const m of ['feeCalculation', 'ticketValidity', 'saleWindow', 'orderGrouping', 'receipt', 'ticketEmailEligibility', 'validation', 'artworkConstants']) {
      const shim = stripComments(readFileSync(path.join(root, 'lib/events', `${m}.ts`), 'utf8')).trim();
      expect(shim, m).toBe(`export * from '@ticketing/core/${m}';`);
    }
  });
});
