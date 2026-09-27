import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Authenticated visual-completion pass (P4) — the shared Clients surfaces
// (/clients, /clients/[id] banner, ClientWorkspace). Confirmed P0 light-mode
// defect: containers followed the theme background while every foreground
// was a fixed dark-theme literal (near-white names, white-alpha meta/labels/
// empty states, pale -400 status hues, a fixed dark editor slab, a blurred
// violet banner) — invisible in light. Source-text guard, comments stripped.

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FILES = [
  'components/clients/ClientWorkspace.tsx',
  'components/clients/ClientWorkspace.module.css',
  'app/clients/page.tsx',
  'app/clients/[id]/page.tsx',
  'app/clients/Clients.module.css',
];

const WHITE_ALPHA = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/;
const NEAR_WHITE_TEXT = /#(F5F7FA|F3EEE6|FAFAFA|F4F4F5|E4E4E7|FFF|FFFFFF)\b/i;
// Pale Tailwind -300/-400 hues used as status text (fail 4.5:1 on white).
const PALE_STATUS = /#(4ade80|34d399|fbbf24|f59e0b|60a5fa|f87171|a1a1aa|c7d2fe)\b/i;
const OLD_VIOLET =
  /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|A5B4FC|818CF8|6366F1|4F46E5)\b|rgba\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|129\s*,\s*140\s*,\s*248)\b/i;
const DARK_SLAB = /rgba\(\s*[0-9]{1,2}\s*,\s*[0-9]{1,2}\s*,\s*[0-9]{1,2}\s*,\s*(1|0?\.[5-9]\d*)\s*\)|#(0[0-9a-f]){3}\b|#1[0-9a-f]1[0-9a-f]1[0-9a-f]\b/i;
const BLUR = /backdrop-?filter|backdropFilter|blur\(/i;
const GRADIENT = /(linear|radial|conic)-gradient/;
const GLOW = /box-?[sS]hadow:\s*['"`]?0 0 /;
const LEGACY_FONT = /var\(--font-inter\)|-apple-system|BlinkMacSystemFont|'Segoe UI'/;
const FORCED_DARK = /colorScheme:\s*['"]dark|color-scheme:\s*dark/;
const OUTLINE_NONE = /outline:\s*['"]?(none|0)\b/;
const TENANT_NAMES = /ld-tennis|LD Tennis|\bschool\b/i;

describe('Clients surfaces read in light and dark', () => {
  for (const file of FILES) {
    describe(file, () => {
      const src = stripComments(read(file));

      it('has no white-alpha neutrals or near-white text literals', () => {
        expect(src).not.toMatch(WHITE_ALPHA);
        expect(src).not.toMatch(NEAR_WHITE_TEXT);
      });

      it('has no pale -400 status literals (status comes from semantic tokens)', () => {
        expect(src).not.toMatch(PALE_STATUS);
      });

      it('has no old violet/indigo chrome', () => {
        expect(src).not.toMatch(OLD_VIOLET);
      });

      it('has no dark slabs, blur, gradients, glows, forced dark scheme or outline suppression', () => {
        expect(src).not.toMatch(DARK_SLAB);
        expect(src).not.toMatch(BLUR);
        expect(src).not.toMatch(GRADIENT);
        expect(src).not.toMatch(GLOW);
        expect(src).not.toMatch(FORCED_DARK);
        expect(src).not.toMatch(OUTLINE_NONE);
      });

      it('uses no legacy font stack', () => {
        expect(src).not.toMatch(LEGACY_FONT);
      });

      it('carries no tenant-name conditionals or literals', () => {
        expect(src).not.toMatch(TENANT_NAMES);
      });
    });
  }
});

describe('Clients surfaces use the shared primitives and semantic status', () => {
  const ws = read('components/clients/ClientWorkspace.tsx');
  const list = read('app/clients/page.tsx');
  const detail = read('app/clients/[id]/page.tsx');

  it('ClientWorkspace styles through its CSS module and the app type stack', () => {
    expect(ws).toContain("import styles from './ClientWorkspace.module.css'");
    expect(read('components/clients/ClientWorkspace.module.css')).toContain('font-family: var(--bb-font-sans)');
  });

  it('the contact editor is the shared SlidePanel dialog with Field-labelled controls', () => {
    expect(ws).toContain('<SlidePanel open onClose={onClose} title={contact.name}>');
    expect(ws).toContain('fieldControlClassName');
    expect(ws).toContain('<Field label="Name">');
    expect(ws).not.toMatch(/function fieldLabel\(/);
  });

  it('tabs are a real tablist with selected state and a tabpanel', () => {
    expect(ws).toContain('role="tablist"');
    expect(ws).toContain("role: 'tab' as const");
    expect(ws).toContain("'aria-selected': tab === t");
    expect(ws).toContain('role="tabpanel"');
  });

  it('rows are real buttons: contacts open the dialog, leads expose expanded state', () => {
    expect(ws).toContain('aria-haspopup="dialog"');
    expect(ws).toContain('aria-expanded={isExpanded}');
    expect(ws).not.toMatch(/<div[^>]*onClick=/);
  });

  it('statuses keep their meaning via the semantic Badge / StatusDot', () => {
    expect(ws).toMatch(/lead:\s+'info'/);
    expect(ws).toMatch(/inactive:\s+'inactive'/);
    expect(ws).toMatch(/booked:\s+\{ state: 'success'/);
    expect(ws).toMatch(/closed:\s+\{ state: 'inactive'/);
    expect(ws).toMatch(/blocked:\s+\{ label: 'Blocked',\s+state: 'error' \}/);
    expect(ws).toContain('<Badge state={state}');
    expect(ws).toContain('<StatusDot state={health.state}');
  });

  it('organisation status: Unknown stays neutral (inactive), never success', () => {
    for (const src of [list, detail]) {
      const line = src.slice(src.indexOf('const UNKNOWN_STATUS'), src.indexOf('\n', src.indexOf('const UNKNOWN_STATUS')));
      expect(line).toContain("state: 'inactive'");
      expect(line).not.toContain("'success'");
      expect(src).toMatch(/ACTIVE:\s+\{ label: 'Active',\s+state: 'success' \}/);
      expect(src).toContain('<Badge state={st.state}>{st.label}</Badge>');
    }
  });

  it('the list page uses PageHeader/StateMessage; the banner has the org as its h1 and no blur', () => {
    expect(list).toContain('<PageHeader');
    expect(list).toContain('<StateMessage kind="empty"');
    expect(detail).toContain('<h1 className={styles.orgName}>{orgName}</h1>');
  });

  it('ClientWorkspace is deliberately responsive (stacked overview, scrolling tab strip, wrapping rows)', () => {
    const css = read('components/clients/ClientWorkspace.module.css');
    expect(css).toMatch(/\.tabStrip \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.overview \{\s*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.row \{\s*flex-wrap: wrap/);
  });
});
