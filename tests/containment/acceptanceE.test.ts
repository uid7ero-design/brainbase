import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Phase E — final authenticated acceptance. Guards the acceptance defects
// fixed in E: surfaces that were still forced dark (unreadable once light
// mode is selected) and clickable non-button rows with no keyboard path.
// Source-text checks, comments stripped first.

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WHITE_ALPHA = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/;
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9)\b|rgba\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|109\s*,\s*40\s*,\s*217)\b/i;
const OUTLINE_NONE = /outline:\s*['"]?(none|0)\b/;
const FORCED_DARK_SCHEME = /colorScheme:\s*['"]dark/;

const BIN = 'app/dashboard/bin-maintenance/page.tsx';

function binWithoutKeptBlocks() {
  const src = stripComments(read(BIN));
  // Kept: the operational status / stream encodings (D1 decision) and the
  // Leaflet control rules, which sit on the always-dark map tiles.
  return src
    .replace(/const ST: Record<MaintenanceStatus[\s\S]*?\n};/, '')
    .replace(/const STREAM: Record<string[\s\S]*?\n};/, '')
    .split('\n')
    .filter(l => !/leaflet|bm-map-tip/.test(l))
    .join('\n');
}

describe('Phase E — Bin Maintenance page reads in both themes', () => {
  const src = binWithoutKeptBlocks();

  it('has no white-alpha neutrals or old violet literals outside the kept encodings / map rules', () => {
    expect(src).not.toMatch(WHITE_ALPHA);
    expect(src).not.toMatch(OLD_VIOLET);
  });

  it('has no forced dark scheme, outline suppression, blur or glow', () => {
    expect(src).not.toMatch(FORCED_DARK_SCHEME);
    expect(src).not.toMatch(OUTLINE_NONE);
    expect(src).not.toMatch(/backdropFilter/);
    expect(src).not.toMatch(/boxShadow:\s*`0 0 /);
  });

  it('paints its bands on surface tokens instead of fixed dark slabs', () => {
    expect(src).not.toMatch(/rgba\(\s*[0-9]\s*,\s*[0-9]{1,2}\s*,\s*1?[0-9]\s*,/);
    expect(src).toContain("background:'var(--bg-surface)'");
  });

  it('job rows are keyboard operable and status text does not rely on the encoding hue', () => {
    expect(src).toMatch(/className="bm-row" role="button" tabIndex=\{0\}/);
    expect(src).toMatch(/onKeyDown=\{e=>\{ if \(e\.key==='Enter' \|\| e\.key===' '\)/);
    expect(src).toContain("color:'var(--text-primary)',letterSpacing:'.05em',whiteSpace:'nowrap' }}>{st.label}");
  });

  it('search and sort controls are named', () => {
    expect(src).toContain('aria-label="Search jobs"');
    expect(src).toContain('aria-label="Sort jobs"');
  });
});

describe('Phase E — profile pages follow the theme', () => {
  for (const file of ['app/account/profile/ProfileClient.tsx', 'app/profile/ProfileClient.tsx']) {
    it(`${file} has no forced-dark palette`, () => {
      const src = stripComments(read(file));
      expect(src).not.toMatch(/#(0D0D15|07080B|0e1014|1a1d24|111318|1a1a2e)\b/i);
      expect(src).not.toMatch(WHITE_ALPHA);
      expect(src).not.toMatch(OLD_VIOLET);
      expect(src).not.toMatch(OUTLINE_NONE);
      expect(src).not.toMatch(/linear-gradient/);
    });

    it(`${file} labels its fields through the shared Field`, () => {
      const src = read(file);
      expect(src).toMatch(/from '@\/components\/ui\/app'/);
      expect(src).toContain('fieldControlClassName');
    });
  }

  it('the Secure Mode toggle is exposed as a switch with state', () => {
    const src = read('app/profile/ProfileClient.tsx');
    expect(src).toContain('role="switch"');
    expect(src).toContain('aria-checked={activeSecure}');
  });
});

describe('Phase E — Organiser capability-denied screen and Admin keyboard paths', () => {
  it('the Organiser denied screen uses theme tokens', () => {
    const src = stripComments(read('app/organiser/layout.tsx'));
    expect(src).not.toMatch(/#07080B|#f9fafb|#6b7280/i);
    expect(src).toContain("background: 'var(--bg-base)'");
  });

  it('Admin Sessions has no forced dark time input and its session cards are keyboard operable', () => {
    const src = stripComments(read('app/admin/sessions/page.tsx'));
    expect(src).not.toMatch(FORCED_DARK_SCHEME);
    expect(src).toMatch(/<div role="button" tabIndex=\{0\} aria-pressed=\{selected\} onClick=\{onClick\}/);
  });

  it('Admin Pipeline summary rows expose expanded state to the keyboard', () => {
    const src = read('app/admin/pipeline/page.tsx');
    expect(src).toMatch(/role="button" tabIndex=\{0\} aria-expanded=\{expanded\}/);
  });

  it('the Events list row actions wrap instead of widening the page at phone width', () => {
    const src = read('app/events/EventsListClient.tsx');
    expect(src).toContain("gap: 10, flex: '0 1 auto', flexWrap: 'wrap', minWidth: 0 }}>");
    expect(src).not.toMatch(/gap: 10, flex: 'none' \}\}>/);
  });

  it('Admin Implementations rows have a real link as their keyboard path', () => {
    const src = read('app/admin/implementations/page.tsx');
    expect(src).toMatch(/<Link href=\{`\/admin\/implementations\/\$\{impl\.id\}`\}/);
  });
});
