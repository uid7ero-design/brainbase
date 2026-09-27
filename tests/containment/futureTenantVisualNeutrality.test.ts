import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Authenticated visual-completion pass (P9) — future-tenant regression guard.
// The surfaces every organisation shares must present every tenant through
// one visual system. Tenant-specific experiences are selected by routing
// (app/dashboard/page.tsx's dashboardVariant), never by tenant-identity
// branches inside shared presentation code — otherwise the next tenant
// silently inherits whichever tenant's styling was the fallback.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?|css)$/.test(name)) out.push(rel);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// Shared, tenant-agnostic presentation: client workspace, client list and
// banner, the shared dashboard shell + its kit, app primitives, theme.
const SHARED_DIRS = ['components/clients', 'app/clients', 'components/dashboard/ui', 'components/ui/app', 'components/theme'];
const SHARED_FILES = ['components/dashboard/DashboardShell.tsx', 'components/dashboard/DashboardShell.module.css'];
const SHARED = [...SHARED_DIRS.flatMap(d => walk(d)), ...SHARED_FILES];

// Tenant identity: known tenant names/slugs, and any comparison against an
// org slug/name/id literal (the shape a tenant-conditional style takes).
const TENANT_IDENTITY: [string, RegExp][] = [
  ['tenant name or slug', /ld[\s_-]?tennis|school[\s_-]?test|onkaparinga|brainbase-hq/i],
  ['slug/name/id literal comparison', /\b(?:slug|orgSlug|organisationSlug|organizationSlug|orgName|organisationName|orgId|organisation_id|organisationId)\s*[!=]==?\s*['"`]/],
  ['literal compared to slug/name/id', /['"`]\s*[!=]==?\s*(?:[\w.]*\.)?(?:slug|orgSlug|organisationSlug|orgName|organisationName|orgId|organisation_id|organisationId)\b/],
  ['dashboard variant branch', /dashboardVariant|variant\s*===\s*['"]ld-/],
];

describe('future-tenant visual neutrality', () => {
  it('discovers the shared surface set', () => {
    for (const f of SHARED_FILES) expect(existsSync(join(ROOT, f)), f).toBe(true);
    expect(SHARED).toContain('components/clients/ClientWorkspace.tsx');
    expect(SHARED).toContain('app/clients/[id]/page.tsx');
    expect(SHARED).toContain('app/clients/page.tsx');
    expect(SHARED.length).toBeGreaterThan(30);
  });

  it.each(SHARED)('%s carries no tenant-identity branch', file => {
    const src = stripComments(read(file));
    const hits = TENANT_IDENTITY.filter(([, re]) => re.test(src)).map(([label]) => label);
    expect(hits).toEqual([]);
  });

  // Decision (authenticated visual-completion pass): example copy in shared
  // forms must fit any organisation — no coaching/sport-specific examples
  // leaking from one tenant into every tenant's editor.
  it.each(SHARED.filter(f => /\.(tsx|jsx)$/.test(f)))('%s has tenant-neutral placeholder examples', file => {
    const src = stripComments(read(file));
    const placeholders = [...src.matchAll(/placeholder=(?:"([^"]*)"|\{'([^']*)'\}|\{"([^"]*)"\})/g)].map(m => m[1] ?? m[2] ?? m[3]);
    for (const p of placeholders) {
      expect(p, `${file}: ${p}`).not.toMatch(/squad|beginner|coach|lesson|court|tennis|junior|racquet|pupil|student|ratepayer/i);
    }
  });

  it('the shared client editor uses the generic examples', () => {
    const cw = read('components/clients/ClientWorkspace.tsx');
    expect(cw).toContain('placeholder="e.g. Service or programme name"');
    expect(cw).toContain('placeholder="e.g. Tuesday 6:00 pm"');
  });

  it('every organisation reaches the same ClientWorkspace from /clients/[id]', () => {
    const page = stripComments(read('app/clients/[id]/page.tsx'));
    expect(page).toMatch(/import ClientWorkspace\b[^;]*?from '@\/components\/clients\/ClientWorkspace'/);
    expect((page.match(/<ClientWorkspace\b/g) ?? []).length).toBe(1);
    // No alternate per-tenant workspace component under components/clients.
    const workspaces = walk('components/clients').filter(f => /Workspace\.(tsx|jsx)$/.test(f));
    expect(workspaces).toEqual(['components/clients/ClientWorkspace.tsx']);
  });

  it('tenant-specific dashboards stay selected by routing only', () => {
    const dash = stripComments(read('app/dashboard/page.tsx'));
    expect(dash).toMatch(/variant === 'ld-tennis'/);
    // The tenant dashboard itself must not reintroduce a fixed dark frame.
    const tennis = stripComments(read('components/dashboard/TennisDashboard.tsx'));
    expect(tennis).not.toMatch(/#0[0-9a-f]0[0-9a-f]0[0-9a-f]|#08090c|colorScheme\s*:\s*['"]dark/i);
    expect(tennis).not.toMatch(/<style[\s>]/);
  });
});
