import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// These checks walk the source tree; on a loaded machine (the full parallel run) 5 s is not enough.
vi.setConfig({ testTimeout: 60_000 });

// Phase 2B.2c adds the Scheduling configuration DASHBOARD (app/scheduling). This file pins what it may be: pages that authorise
// themselves and fetch only the Scheduling API, client components that import nothing server-side (the 2026-09 client/server
// bundle leak is exactly this mistake), wording that names no sport or business, only the three initial presets, and no booking.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const dashboardFiles = () => walk(path.join(ROOT, 'app/scheduling'), /\.(ts|tsx|css)$/).map(rel).sort();
const importsOf = (src: string) => [...noTsComments(src).matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);

const PAGES = [
  'app/scheduling/page.tsx',
  'app/scheduling/schedules/page.tsx',
  'app/scheduling/schedules/[scheduleId]/page.tsx',
  'app/scheduling/resources/page.tsx',
];

// What a client component (or the pure libraries it uses) may import. Everything else is a server module until proven otherwise.
const CLIENT_ALLOWED = [
  /^react$/,
  /^next\/link$/,
  /^next\/navigation$/,
  /^@\/components\/ui\/app$/,
  /^@\/lib\/layout\/headerOffset$/,
  /^@\/lib\/scheduling\/dashboard\/(api|forms|types|wording)$/,
  /^@\/lib\/scheduling\/configurable$/,
  /^@scheduling\/core$/,
  /^\.\.?\/[\w./-]*$/, // siblings inside the dashboard / the pure libraries
  /\.module\.css$/,
];

describe('the dashboard is exactly the configuration screens', () => {
  it('pins the page set and the shell files', () => {
    expect(dashboardFiles().filter(f => /page\.tsx$/.test(f))).toEqual([...PAGES].sort());
    expect(dashboardFiles().filter(f => /(layout|error|loading)\.tsx$/.test(f))).toEqual(['app/scheduling/error.tsx', 'app/scheduling/layout.tsx', 'app/scheduling/loading.tsx']);
    expect(dashboardFiles().filter(f => /\/api\/|route\.ts$/.test(f))).toEqual([]); // no routes in the page tree
  });

  it('the layout and every page authorise themselves; a page never relies on its layout', () => {
    expect(noTsComments(read('app/scheduling/layout.tsx'))).toMatch(/getSchedulingPageAccess\(\)/);
    for (const p of PAGES) {
      const src = noTsComments(read(p));
      expect(src, p).toMatch(/resolveSchedulingPage\(\)/);
      expect(src, p).toMatch(/if \(denied\) return denied/);
      expect(src, p).toMatch(/export const dynamic = 'force-dynamic'/);
    }
  });

  it('the page gate is UX only: it reads the session and the capability, never Scheduling data, and takes no organisation from anywhere', () => {
    const src = noTsComments(read('lib/scheduling/pageAccess.ts'));
    expect(src).toMatch(/import 'server-only'/);
    expect(src).toMatch(/checkCapability\(session\.organisationId, SCHEDULING_CAPABILITY_KEY\)/);
    expect(src).not.toMatch(/\bsql\b|from '@\/lib\/db'|@scheduling\/postgres|lib\/scheduling\/(runtime|access|route)/);
    expect(src).not.toMatch(/searchParams|params|headers\(|cookies\(/);
    expect(src).toMatch(/permissions\.includes\('scheduling\.manage'\)/);
  });
});

describe('nothing server-side reaches the browser', () => {
  const clientFiles = () => [...dashboardFiles(), ...walk(path.join(ROOT, 'lib/scheduling/dashboard'), /\.ts$/).map(rel), 'lib/scheduling/configurable.ts'].filter(f => /\.(ts|tsx)$/.test(f));

  it('every "use client" file, and the pure libraries they use, import only from the allow-list', () => {
    const checked: string[] = [];
    for (const f of clientFiles()) {
      const src = read(f);
      const isClient = /^\s*['"]use client['"]/.test(src);
      const isPureLib = f.startsWith('lib/scheduling/dashboard/') || f === 'lib/scheduling/configurable.ts';
      if (!isClient && !isPureLib) continue;
      checked.push(f);
      for (const spec of importsOf(src)) expect(CLIENT_ALLOWED.some(re => re.test(spec)), `${f} imports ${spec}`).toBe(true);
      expect(noTsComments(src), f).not.toMatch(/server-only/);
    }
    expect(checked.length).toBeGreaterThan(12);
  });

  it('no client file imports a server module by name (db, session, capability, guard, audit, runtime, repositories)', () => {
    const isBrowserSide = (f: string) => /^\s*['"]use client['"]/.test(read(f)) || f.startsWith('lib/scheduling/dashboard/') || f === 'lib/scheduling/configurable.ts';
    for (const f of clientFiles().filter(isBrowserSide)) {
      for (const spec of importsOf(read(f))) {
        expect(spec, f).not.toMatch(/@\/lib\/(db|org|session|capabilities)|lib\/scheduling\/(pageAccess|route|access|runtime|audit|crmLink|adapters|config)|@scheduling\/postgres|server-only|next\/headers/);
      }
    }
  });

  it('server-only files are only the page gates', () => {
    const serverOnly = walk(path.join(ROOT, 'app/scheduling'), /\.tsx?$/).concat([path.join(ROOT, 'lib/scheduling/pageAccess.ts')]).filter(f => /import 'server-only'/.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(serverOnly).toEqual(['app/scheduling/_components/pageAccess.tsx', 'lib/scheduling/pageAccess.ts']);
  });
});

describe('the dashboard talks only to the Scheduling API, and never books', () => {
  const sources = () => [...dashboardFiles(), ...walk(path.join(ROOT, 'lib/scheduling/dashboard'), /\.ts$/).map(rel)].filter(f => /\.(ts|tsx)$/.test(f));

  it('every request goes through schedulingApi() to /api/scheduling; no other fetch, no database, no payment', () => {
    for (const f of sources()) {
      const src = noTsComments(read(f));
      if (f !== 'lib/scheduling/dashboard/api.ts') expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/\bsql\b\s*[`(]|stripe|checkout|payment/i);
      expect(src, f).not.toMatch(/\/api\/(?!scheduling)/);
    }
    expect(noTsComments(read('lib/scheduling/dashboard/api.ts'))).toMatch(/fetch\(`\/api\/scheduling\$\{path\}`/);
  });

  it('only configuration endpoints are called: schedules, offerings, resources, status', () => {
    const paths = new Set<string>();
    for (const f of sources()) {
      for (const m of read(f).matchAll(/schedulingApi(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*'(?:GET|POST|PATCH|DELETE)',\s*[`']\/([a-z]+)/g)) paths.add(m[1]);
      for (const m of read(f).matchAll(/useSchedulingData<[^(]*\(\s*[`']\/([a-z]+)/g)) paths.add(m[1]);
    }
    expect([...paths].sort()).toEqual(['offerings', 'resources', 'schedules', 'status']);
  });

  it('exposes no booking, reservation, occurrence, customer, payment or public-slug control', () => {
    for (const f of sources().filter(x => x.startsWith('app/') && x.endsWith('.tsx'))) {
      const src = noTsComments(read(f));
      // copy may mention reservations (a live reservation blocks a change); no endpoint, control or identifier may reach them
      expect(src, f).not.toMatch(/\/(reservations|occurrences|attendance|payments|book)\b|publicSlug|public_slug|checkout|createReservation|createOccurrence/i);
    }
  });
});

describe('wording and scope', () => {
  it('names no sport or business: wording comes from the preset', () => {
    for (const f of [...dashboardFiles().filter(x => /\.(tsx?|css)$/.test(x)), ...walk(path.join(ROOT, 'lib/scheduling/dashboard'), /\.ts$/).map(rel), 'lib/scheduling/configurable.ts', 'lib/scheduling/pageAccess.ts']) {
      expect(noTsComments(read(f)), f).not.toMatch(/tennis|squad|\bplayer\b|\bcoach(es)?\b(?!ing)|racket|\bLD\b/i);
    }
  });

  it('offers only the three initial presets: the other presets are never named', () => {
    for (const f of [...dashboardFiles().filter(x => /\.tsx?$/.test(x)), ...walk(path.join(ROOT, 'lib/scheduling/dashboard'), /\.ts$/).map(rel)]) {
      expect(noTsComments(read(f)), f).not.toMatch(/restaurant_tables|accommodation|event_capacity/);
    }
    expect(noTsComments(read('lib/scheduling/configurable.ts'))).toMatch(/CONFIGURABLE_PRESETS: readonly PresetKey\[\] = \['classes_coaching', 'appointments', 'resource_hire'\]/);
  });

  it('management controls exist only behind canManage: every manager screen takes it, and the page gate derives it from scheduling.manage', () => {
    for (const f of ['SchedulesManager', 'ResourcesManager', 'ScheduleDetail', 'Overview']) {
      const src = noTsComments(read(`app/scheduling/_components/${f}.tsx`));
      expect(src, f).toMatch(/canManage/);
    }
    expect(noTsComments(read('app/scheduling/_components/SchedulesManager.tsx'))).toMatch(/canManage \? <Button variant="primary" onClick=\{\(\) => setMode\(\{ kind: 'create' \}\)\}>New schedule/);
  });

  it('the shared core stays independent of BrainBase: nothing under packages/ imports the app, its libraries or the dashboard', () => {
    for (const f of walk(path.join(ROOT, 'packages/scheduling/src'), /\.ts$/).concat(walk(path.join(ROOT, 'packages/scheduling-postgres/src'), /\.ts$/))) {
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/from\s+['"](@\/|\.\.\/\.\.\/|next|react|app\/|lib\/)/);
    }
  });
});

describe('the navigation entry', () => {
  it('is capability-gated, hidden for every organisation until Scheduling is deliberately enabled, and carries no sport wording', () => {
    const nav = read('components/nav/navModel.ts');
    const entry = nav.slice(nav.indexOf("id: 'scheduling'") - 20, nav.indexOf("id: 'data-hub'"));
    expect(entry).toMatch(/href: '\/scheduling'/);
    expect(entry).toMatch(/gate: \{ anyCapability: \['scheduling'\], minRole: 'viewer' \}/);
    expect(entry).not.toMatch(/variant:/);
    expect(noTsComments(read('lib/scheduling/adapters/brainbase/index.ts'))).toMatch(/permissionsForRole/);
  });
});
