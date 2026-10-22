import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The scheduling core must run unchanged inside a larger platform and inside
// a standalone deployment. These checks read the package source text so a
// stray `import sql from '@/lib/db'`, a Next.js import or a product name can
// never slip in through a refactor: any of them would break the standalone
// build and tie the domain to one host.

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '../src');
const files = readdirSync(SRC).filter(f => f.endsWith('.ts'));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('@scheduling/core package boundary', () => {
  it('ships the documented modules', () => {
    for (const m of ['index', 'types', 'presets', 'contracts', 'validation']) {
      expect(files, m).toContain(`${m}.ts`);
    }
  });

  for (const file of files) {
    const src = stripComments(readFileSync(path.join(SRC, file), 'utf8'));

    it(`${file} imports nothing from any application, framework or provider`, () => {
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
      expect(src).not.toMatch(/require\(/);
      expect(src).not.toMatch(/\bimport\(/);
    });

    it(`${file} never reads process.env, the DOM, cookies or a database`, () => {
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/\bdocument\.|\bwindow\.|\blocalStorage\b|\bcookies\(/);
      expect(src).not.toMatch(/\bsql`|INSERT INTO|UPDATE\s+\w+\s+SET|SELECT\s+.+\s+FROM\s/i);
    });

    it(`${file} knows neither the host product nor the first customer`, () => {
      // Host identity enters only through the ports; customer-specific
      // vocabulary enters only through terminology overrides.
      expect(src).not.toMatch(/\bBrainBase\b|\bBrainbase\b/);
      expect(src).not.toMatch(/tennis/i);
      expect(src).not.toMatch(/\bEve\b|Stripe|Resend/);
    });

    it(`${file} has no timers, randomness or ambient clock`, () => {
      // Time and identity come in through the Clock port and the caller.
      expect(src).not.toMatch(/\bnew Date\(\)|Date\.now\(|Math\.random\(|crypto\.randomUUID|setTimeout|setInterval/);
    });
  }

  it('the package manifest exposes TypeScript source directly and has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.name).toBe('@scheduling/core');
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.exports['.']).toBe('./src/index.ts');
    expect(pkg.exports['./*']).toBe('./src/*.ts');
  });

  it('the package typechecks with no ambient types (no DOM, no Node, no framework)', () => {
    const tsconfig = JSON.parse(readFileSync(path.resolve(__dirname, '../tsconfig.json'), 'utf8'));
    expect(tsconfig.compilerOptions.types).toEqual([]);
    expect(tsconfig.compilerOptions.lib).not.toContain('dom');
  });

  it('the root tsconfig and vitest config resolve the package by the same alias', () => {
    const tsconfig = readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"@scheduling\/core": \["\.\/packages\/scheduling\/src\/index\.ts"\]/);
    expect(tsconfig).toMatch(/"@scheduling\/core\/\*": \["\.\/packages\/scheduling\/src\/\*"\]/);
    const vitest = readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(vitest).toMatch(/'@scheduling\/core\/': path\.resolve\(__dirname, 'packages\/scheduling\/src'\)/);
  });
});

describe('BrainBase-side scheduling files depend on the core, never the reverse', () => {
  const brainbaseFiles = [
    'lib/scheduling/adapters/brainbase/index.ts',
    'lib/scheduling/compatibility/tennis/index.ts',
  ];

  for (const rel of brainbaseFiles) {
    const src = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

    it(`${rel} imports only the core package`, () => {
      const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      expect(imports.length).toBeGreaterThan(0);
      for (const spec of imports) expect(spec, `${rel} imports ${spec}`).toBe('@scheduling/core');
    });

    it(`${rel} touches no database, session, framework or live tennis module`, () => {
      expect(src).not.toMatch(/['"]server-only['"]/);
      expect(src).not.toMatch(/@\/lib\/db|@neondatabase|\bsql`/);
      expect(src).not.toMatch(/from ['"](next|react)(\/|['"])/);
      expect(src).not.toMatch(/@\/lib\/tennis|@\/lib\/org|@\/lib\/session/);
    });
  }
});
