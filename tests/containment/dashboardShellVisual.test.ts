import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DARK_TOKENS, LIGHT_TOKENS, DASHBOARD_TOKENS, getTheme, TONE, COLORS, PRIORITY_COLORS } from '@/components/dashboard/ui/tokens';

// Authenticated visual-completion pass — P1 shared foundation.
//
// The municipal DashboardShell family (components/dashboard/DashboardShell +
// components/dashboard/ui/**), every module page that renders it, the Bin
// Maintenance insights surface that reuses its KpiCard (+ the ops Widget
// frame used only there) and /dashboard/overview used to force a dark
// palette (theme="dark" call sites, DARK_TOKENS hex surfaces, white-alpha
// text, colorScheme dark). They now follow <html data-theme> through tokens,
// and charts read the theme-aware chart palette.
//
// Source-text guard, comments stripped first. The ONLY colour literals
// allowed are the module identity props on the <DashboardShell> call
// (`headerColor="#…"` / `accentColor="#…"`), which the shell now renders as
// a small identity swatch only.

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SHELL_FILES = [
  'components/dashboard/DashboardShell.tsx',
  'components/dashboard/DashboardShell.module.css',
  'components/dashboard/ui/KpiCard.tsx',
  'components/dashboard/ui/InsightCard.tsx',
  'components/dashboard/ui/OpportunityCard.tsx',
  'components/dashboard/ui/ExecutivePanel.tsx',
  'components/dashboard/ui/ExecutiveSummary.tsx',
  'components/dashboard/ui/Section.tsx',
  'components/dashboard/ui/DashboardGrid.tsx',
  'components/dashboard/ui/tokens.ts',
  'components/dashboard/ui/chartTheme.ts',
  'components/dashboard/ui/index.ts',
];

// Every <DashboardShell> consumer (verified by the discovery test below).
const SHELL_CONSUMERS = [
  'app/dashboard/construction/page.tsx',
  'app/dashboard/depot/page.tsx',
  'app/dashboard/environment/page.tsx',
  'app/dashboard/facilities/page.tsx',
  'app/dashboard/labour/page.tsx',
  'app/dashboard/logistics/page.tsx',
  'app/dashboard/parks/page.tsx',
  'app/dashboard/roads/page.tsx',
  'app/dashboard/supply/page.tsx',
  'app/dashboard/water/page.tsx',
  'app/dashboard/fleet/FleetClient.tsx',
  'app/dashboard/waste/WasteClient.tsx',
];

// Bin Maintenance insights: the other consumer of components/dashboard/ui.
const INSIGHTS_FILES = [
  'app/dashboard/bin-maintenance/insights/page.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/constants.ts',
  'app/dashboard/bin-maintenance/insights/tabs/AdditionalCancelTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/CategoriesTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/ComplianceTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/DamagedTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/MissedCollectionsTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/PatternsTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/ProjectionsTab.tsx',
  'app/dashboard/bin-maintenance/insights/tabs/StreamsTab.tsx',
  // Used only by the insights surface (not by /command).
  'components/ops/widgets/Widget.tsx',
];

const OVERVIEW_FILES = ['app/dashboard/overview/OverviewClient.tsx', 'app/dashboard/overview/OverviewClient.module.css'];

const ALL = [...SHELL_FILES, ...SHELL_CONSUMERS, ...INSIGHTS_FILES, ...OVERVIEW_FILES];

const FORCED_DARK = /theme\s*=\s*\{?\s*["'`]dark|colorScheme\s*:\s*["'`]dark|color-scheme\s*:\s*dark/i;
const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/;
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|DDD6FE|a5b4fc|818CF8|6366F1|4F46E5)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|155\s*,\s*123\s*,\s*255)\b|var\(--purple-\d/i;
const GLASS = /backdrop-?[fF]ilter|\bblur\(|feGaussianBlur/;
const GRADIENT = /(linear|radial|conic)-?[gG]radient/;
const GLOW = /drop-shadow|text-?[sS]hadow|(box-shadow|boxShadow)\s*:\s*[`'"]?\s*0 0 \d/;
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/;
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/;
const LEGACY_FONT = /var\(--font-inter\)|-apple-system|system-ui|['"]Inter['"]|['"]monospace['"]|fontFamily\s*:(?!\s*['"`]?(var\(--bb-font-(sans|mono)\)|inherit))|font-family\s*:(?!\s*(var\(--bb-font-(sans|mono)\)|inherit))/;

/** Remove the one allow-listed colour usage: identity props on <DashboardShell>. */
function withoutIdentityProps(src: string) {
  return src.replace(/\b(headerColor|accentColor)="#[0-9a-fA-F]{3,8}"/g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(rel, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('DashboardShell family — consumer map is complete', () => {
  it('every importer of DashboardShell / components/dashboard/ui is covered by this guard', () => {
    const covered = new Set(ALL);
    const importers = [...walk('app'), ...walk('components')].filter(f => {
      if (covered.has(f)) return false;
      const src = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      return /['"]@\/components\/dashboard\/(DashboardShell|ui)(\/[^'"]*)?['"]/.test(src)
        || (f.startsWith('components/dashboard/') && /from\s+['"]\.\/(DashboardShell|ui)(\/[^'"]*)?['"]/.test(src));
    });
    expect(importers).toEqual([]);
  });

  it('the insights-only Widget frame is still used only by the insights surface', () => {
    const users = [...walk('app'), ...walk('components')].filter(f =>
      /from\s+['"]@\/components\/ops\/widgets\/Widget['"]|from\s+['"]\.\/Widget['"]/.test(fs.readFileSync(path.join(ROOT, f), 'utf-8')),
    );
    for (const f of users) expect(f).toMatch(/^app\/dashboard\/bin-maintenance\/insights\//);
  });
});

describe('DashboardShell family — theme-following, no forced dark', () => {
  for (const file of ALL) {
    it(file, () => {
      const code = stripComments(read(file));
      expect(code, 'forced dark').not.toMatch(FORCED_DARK);
      expect(code, 'white-alpha neutral').not.toMatch(WHITE_ALPHA);
      expect(code, 'retired violet chrome').not.toMatch(OLD_VIOLET);
      expect(code, 'glass / blur').not.toMatch(GLASS);
      expect(code, 'decorative gradient').not.toMatch(GRADIENT);
      expect(code, 'glow').not.toMatch(GLOW);
      expect(code, 'outline suppression').not.toMatch(OUTLINE_SUPPRESSION);
      expect(code, 'legacy font stack').not.toMatch(LEGACY_FONT);
      expect(withoutIdentityProps(code), 'raw colour literal (use tokens or the chart palette)').not.toMatch(COLOUR_LITERAL);
    });
  }
});

describe('DashboardShell — theme prop no longer forces a palette', () => {
  const shell = stripComments(read('components/dashboard/DashboardShell.tsx'));

  it('keeps the theme prop on the public API (compatibility) but never branches on it', () => {
    expect(read('components/dashboard/DashboardShell.tsx')).toMatch(/theme\?: 'light' \| 'dark';/);
    expect(shell).not.toMatch(/theme\s*===\s*['"](light|dark)['"]/);
    expect(shell).not.toMatch(/\bconst L\b/);
  });

  it('dashboard tokens are one theme-following set of CSS custom properties', () => {
    expect(DARK_TOKENS).toBe(DASHBOARD_TOKENS);
    expect(LIGHT_TOKENS).toBe(DASHBOARD_TOKENS);
    expect(getTheme('dark')).toBe(DASHBOARD_TOKENS);
    expect(getTheme('light')).toBe(DASHBOARD_TOKENS);
    const values: string[] = [];
    for (const v of Object.values(DASHBOARD_TOKENS)) {
      if (typeof v === 'string') values.push(v);
      else for (const x of Object.values(v as Record<string, unknown>)) if (typeof x === 'string') values.push(x);
    }
    for (const v of values) expect(v, v).toMatch(/^(1px solid )?var\(--[a-z-]+\)$/);
    for (const t of Object.values(TONE)) for (const v of Object.values(t)) expect(v).toMatch(/^var\(--/);
    for (const v of [...Object.values(COLORS), ...Object.values(PRIORITY_COLORS)]) expect(v).toMatch(/^var\(--/);
  });

  it('charts read the theme-aware palette (no forced-dark tooltip)', () => {
    expect(shell).toContain('const chart = useDashboardChart();');
    expect(shell).toMatch(/<Tooltip \{\.\.\.chart\.tooltip\} \/>/);
    expect(shell).not.toMatch(/contentStyle=\{th\./);
  });

  it('every consumer with a recharts chart reads the theme-aware palette', () => {
    for (const file of [...SHELL_CONSUMERS, ...INSIGHTS_FILES, ...OVERVIEW_FILES]) {
      const src = stripComments(read(file));
      if (!/from ['"]recharts['"]/.test(src)) continue;
      expect(src, file).toMatch(/useDashboardChart\(|useChartPalette\(|chart[A-Za-z]*\s*:\s*DashboardChart|DashboardChart\b/);
    }
  });

  it('no consumer passes theme="dark" any more', () => {
    for (const file of [...SHELL_CONSUMERS, ...INSIGHTS_FILES]) {
      expect(stripComments(read(file)), file).not.toMatch(/theme=/);
    }
  });
});

describe('DashboardShell — behaviour and information architecture preserved', () => {
  const shell = read('components/dashboard/DashboardShell.tsx');

  it('keeps every tab, in order', () => {
    expect(shell).toContain("const GLOBAL_TABS    = ['Overview', ...industryLabels, 'Data Upload', 'Financial Year', 'Cost Breakdown', 'Trends', 'Compliance', 'AI Report', 'Actions', 'Export'];");
  });

  it('keeps the upload, AI report and export paths', () => {
    expect(shell).toContain("fetch('/api/upload', { method: 'POST', body: form })");
    expect(shell).toContain(".then(() => router.refresh())");
    expect(shell).toContain("fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) })");
    expect(shell).toContain("document.getElementById('shell-content')");
    expect(shell).toContain('id="shell-content"');
    expect(shell).toContain('const storageKey = `bb_${title.replace(/\\W+/g, \'_\').toLowerCase()}`;');
    expect(shell).toContain("useAppStore.getState().setDashboardAiContext(aiContext);");
    expect(shell).toContain('Ask HLNA to explain');
    expect(shell).toContain('<a href="/dashboard/overview">Overview</a>');
  });

  it('keeps the derived calculations', () => {
    expect(shell).toContain('const eofyForecast = Math.round(avgMonthly * 12);');
    expect(shell).toContain("'Prior FY':   m.prevYear ?? Math.round(m.actual * 0.93),");
    expect(shell).toContain("'Budget':     m.budget   ?? Math.round(m.actual * 1.04),");
    expect(shell).toContain("const pct = Math.round(effectiveSLA.filter(s => s.status === 'Met').length / effectiveSLA.length * 100);");
  });

  it('tabs are a real tablist and header controls are labelled', () => {
    expect(shell).toContain('role="tablist"');
    expect(shell).toContain('role="tab"');
    expect(shell).toContain('aria-selected={activeTab === t}');
    expect(shell).toContain('role="tabpanel"');
    // Header selects: the label sits on the <select> itself.
    for (const name of ['Switch dashboard', 'Financial year', 'Dataset']) {
      expect(shell.replace(/\s+/g, ' ')).toContain(`<select aria-label="${name}" className={styles.select}`);
    }
    for (const name of ['Action title', 'Assigned to', 'Due date', 'Priority']) {
      expect(shell).toContain(`aria-label="${name}"`);
    }
  });
});

describe('DashboardShell — chart legend labels read as text', () => {
  // Recharts paints legend labels inline in the series hue; several data hues
  // fall below 4.5:1 as text on the light surface (measured in the harness).
  it('overrides legend label colour inside the shell, leaving the swatch hue', () => {
    const css = read('components/dashboard/DashboardShell.module.css');
    expect(css).toMatch(/\.shell :global\(\.recharts-legend-item-text\) \{\s*color: var\(--text-secondary\) !important;\s*\}/);
    expect(css).not.toMatch(/recharts-legend-icon|recharts-surface[^{]*\{[^}]*fill/);
  });
});

describe('DashboardShell — Fleet and Water identity swatches', () => {
  // Decision: Fleet and Water carry distinct module identity swatches (small
  // accent beside the title only — never chrome, nav, actions or selection),
  // mid-tone so the swatch reads at >= 3:1 on the light AND dark surfaces.
  const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const swatchOf = (f: string) => read(f).match(/accentColor="(#[0-9a-fA-F]{6})"/)?.[1] ?? '';
  const fleet = swatchOf('app/dashboard/fleet/FleetClient.tsx');
  const water = swatchOf('app/dashboard/water/page.tsx');

  it('are unique among the module swatches', () => {
    const others = SHELL_CONSUMERS.filter(f => !/fleet\/FleetClient|water\/page/.test(f)).map(swatchOf).filter(Boolean).map(c => c.toLowerCase());
    expect(fleet).toMatch(/^#/);
    expect(water).toMatch(/^#/);
    expect(fleet.toLowerCase()).not.toBe(water.toLowerCase());
    expect(others).not.toContain(fleet.toLowerCase());
    expect(others).not.toContain(water.toLowerCase());
  });

  it('reach 3:1 against the light (#FFFFFF) and dark (#111113) surfaces', () => {
    for (const c of [fleet, water]) {
      expect(ratio(c, '#FFFFFF'), c).toBeGreaterThanOrEqual(3);
      expect(ratio(c, '#111113'), c).toBeGreaterThanOrEqual(3);
    }
  });
});
