import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CHART_PALETTE } from '@/components/ui/app/chartPalette';

// Authenticated visual-completion pass — Waste & Recycling module frame and
// sub-pages.
//
// The /dashboard/waste layout (fixed #08090C frame, white-alpha header,
// text-white / text-blue-400, legacy 'var(--font-inter)' stack), its NavTabs
// (dark slate/white Tailwind) and the shared "_dark" token module used by the
// ten sub-pages were dark-only islands. They now follow <html data-theme>
// through tokens; SVG chart chrome reads useWasteChart() (the shared chart
// palette, components/ui/app/chartPalette).
//
// Source-text guard, comments stripped first. Chart series / category hues on
// bars, lines, pies, dots and KPI left rules are data encodings and are
// allowed ONLY from the narrow DATA_HUES list below.

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const W = 'app/dashboard/waste';
const SUB_PAGES = [
  'bin-lifts', 'budgeting', 'commodities', 'community', 'complaints', 'compliance',
  'cost-per-household', 'diversion', 'fleet', 'green-waste',
].map(p => `${W}/${p}/page.tsx`);
const FILES = [`${W}/layout.tsx`, `${W}/NavTabs.tsx`, `${W}/WasteModuleTitle.tsx`, `${W}/_dark.tsx`, `${W}/WasteModule.module.css`, ...SUB_PAGES];

// Data/category hues (chart series, category dots, KPI rules). Nothing else.
const DATA_HUES = new Set([
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b', '#22c55e',
]);

const src = (f: string) => stripComments(read(f));

// ── Theme-aware series shades (follow-up: light-mode chart accessibility) ──
const SERIES_BLOCK = /export const SERIES[^=]*=\s*\{[\s\S]*?\n\};/;
const hexLum = (hex: string) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [hexLum(a), hexLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Panels the series are painted on: light --bg-surface and --bg-sunken
// (meter tracks); dark --bg-surface.
const LIGHT_BGS = ['#FFFFFF', '#EFEBE4'];
const DARK_BG = '#111113';
type Shade = { light: string; dark: string };
function parseSeries(): Record<string, Shade> {
  const block = stripComments(read(`${W}/_dark.tsx`)).match(SERIES_BLOCK)?.[0] ?? '';
  const resolve = (v: string) => {
    const pal = v.match(/^CHART_PALETTE\.(light|dark)\.(\w+)$/);
    if (pal) return (CHART_PALETTE[pal[1] as 'light' | 'dark'] as Record<string, string>)[pal[2]];
    return v.replace(/"/g, '');
  };
  const out: Record<string, Shade> = {};
  for (const m of block.matchAll(/"(#[0-9a-fA-F]{6})":\s*\{\s*light:\s*([^,]+?),\s*dark:\s*([^}]+?)\s*\}/g)) {
    out[m[1].toLowerCase()] = { light: resolve(m[2].trim()), dark: resolve(m[3].trim()) };
  }
  return out;
}

describe('Waste module — theme-following visual contract', () => {
  it('guards every file in the surface (and all of them exist)', () => {
    for (const f of FILES) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it.each(FILES)('%s: no white/black-alpha neutrals or dark slabs', f => {
    const s = src(f);
    expect(s).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255/);
    expect(s).not.toMatch(/rgba?\(\s*(230\s*,\s*237\s*,\s*243|0\s*,\s*0\s*,\s*0)\s*,/);
    expect(s).not.toMatch(/#(08090C|07080B|0d0f14|F5F7FA)\b/i);
    expect(s).not.toMatch(/(["'])#fff(fff)?\1/i);
  });

  it.each(FILES)('%s: no dark-only Tailwind, legacy fonts, blur, glow, gradients, colorScheme', f => {
    const s = src(f);
    expect(s).not.toMatch(/\b(text-white|bg-white\/|border-white\/|hover:bg-white|text-slate-|bg-slate-|text-blue-400)/);
    expect(s).not.toMatch(/font-inter|system-ui|fontFamily:\s*["']monospace/);
    expect(s).not.toMatch(/backdrop(Filter|-filter)|blur\(/i);
    expect(s).not.toMatch(/(linear|radial|conic)-gradient/);
    expect(s).not.toMatch(/colorScheme|color-scheme/);
    expect(s).not.toMatch(/outline:\s*['"]?none|outline:\s*0\b/);
    expect(s).not.toMatch(/boxShadow:\s*["'`][^"'`]*(rgba|#)/);
    expect(s).not.toMatch(/drop-shadow|textShadow|text-shadow/);
  });

  it.each(FILES)('%s: no old violet chrome; only allow-listed data hues', f => {
    const s = src(f);
    expect(s).not.toMatch(/#(A78BFA|C4B5FD|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b/i);
    expect(s).not.toMatch(/rgba\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241)/);
    // #8b5cf6 is only allowed as a chart/category data colour, never as KPI chrome.
    expect(s).not.toMatch(/accent="#8b5cf6"/i);
    // _dark.tsx's SERIES map holds the accessible shades (checked separately below).
    const body = f.endsWith('_dark.tsx') ? s.replace(SERIES_BLOCK, '') : s;
    const hexes = body.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [];
    for (const h of hexes) expect(DATA_HUES.has(h.toLowerCase()), `${f}: ${h}`).toBe(true);
    // No rgba tints at all (area tints use the resolved series + fillOpacity).
    expect(s.match(/rgba?\([^)]*\)/g) ?? [], f).toEqual([]);
  });

  it.each(SUB_PAGES)('%s: status TEXT uses status tokens (no low-contrast raw hues as text)', f => {
    const s = src(f);
    expect(s).not.toMatch(/#(4ade80|f87171|60a5fa|fbbf24|34d399)\b/i);
    // A raw data hue may never be the CSS text colour.
    expect(s).not.toMatch(/\bcolor:\s*[^,}\n]*["']#[0-9a-fA-F]{3,6}["'][^}\n]*\}\}/);
    // SVG chart chrome reads the theme-aware palette, not CSS-var strings.
    expect(s).not.toMatch(/stroke=\{GRID\}|fill:\s*TICK\b|contentStyle=\{DTT\}/);
    if (/<CartesianGrid/.test(s)) {
      expect(s).toContain('useWasteChart()');
      expect(s).toMatch(/stroke=\{chart\.grid\}/);
      expect(s).toMatch(/fill: chart\.tick\.fill/);
    }
    if (/<Legend/.test(s)) expect(s).toMatch(/formatter=\{legendText\}/);
    // Every data hue is painted through chart.series() (theme-aware shade):
    // once series() calls are removed, raw hues may only remain in data
    // definitions (a record's `color:` field or the STREAM/PIE colour maps).
    const unwrapped = s.replace(/chart\.series\([^()]*\)/g, 'SERIES()');
    for (const line of unwrapped.split('\n')) {
      if (!/#[0-9a-fA-F]{6}/.test(line)) continue;
      expect(
        /^\s*\{ \w+: .*color: "#[0-9a-fA-F]{6}" \},?\s*$|^const (STREAM_COLORS|PIE_COLORS) = /.test(line),
        `${f}: raw hue painted directly: ${line.trim()}`,
      ).toBe(true);
    }
    // …and colour references from those definitions are painted through it too.
    expect(unwrapped).not.toMatch(/(fill|stroke|accent)=\{\s*(\w+\.color|PIE_COLORS\[|STREAM_COLORS\.)/);
    expect(unwrapped).not.toMatch(/background:\s*(\w+\.color|PIE_COLORS\[|STREAM_COLORS\.)/);
    if (/chart\.series\(/.test(s)) expect(s).toContain('useWasteChart()');
    // No fixed multi-column inline grids (they overflow at phone width).
    expect(s).not.toMatch(/gridTemplateColumns:\s*"repeat\(\d/);
    expect(s).not.toMatch(/borderRadius:\s*999,\s*background:\s*(ok|r\.|row\.)/);
  });

  it('_dark.tsx keeps every export name and maps the tokens to theme variables', () => {
    const s = src(`${W}/_dark.tsx`);
    for (const name of ['T1', 'T2', 'T3', 'BORDER', 'ROW_BDR', 'ROW_HEAD', 'GRID', 'TICK', 'BG', 'DTT', 'DC', 'PAGE']) {
      expect(s, name).toMatch(new RegExp(`export const ${name}\\b`));
    }
    for (const fn of ['KpiCard', 'Insight', 'SectionHeader', 'StatusBadge', 'DarkTable', 'Tr', 'Td']) {
      expect(s, fn).toMatch(new RegExp(`export function ${fn}\\(`));
    }
    expect(s).toMatch(/export const T1\s*=\s*"var\(--text-primary\)"/);
    expect(s).toMatch(/export const T2\s*=\s*"var\(--text-secondary\)"/);
    expect(s).toMatch(/export const T3\s*=\s*"var\(--text-muted\)"/);
    expect(s).toMatch(/export const BG\s*=\s*"var\(--bg-base\)"/);
    expect(s).toMatch(/background: "var\(--bg-overlay\)"/);
    expect(s).toMatch(/var\(--status-\$\{t\}-muted\)/);
    // KpiCard keeps its data accent as the left rule only.
    expect(s).toMatch(/borderLeft: `4px solid \$\{accent\}`/);
    expect(s).toMatch(/export function useWasteChart\(/);
    expect(s).toMatch(/CHART_PALETTE\[theme\]/);
    expect(s).toMatch(/series: \(hex: string\) => seriesColor\(hex, theme\)/);
  });

  describe('SERIES: accessible, identity-preserving series shades', () => {
    const SERIES = parseSeries();

    it('covers every allow-listed data hue', () => {
      expect(Object.keys(SERIES).sort()).toEqual([...DATA_HUES].sort());
    });

    it.each([...DATA_HUES])('%s: light shade ≥3:1 on light panels, dark shade ≥3:1 on #111113', hue => {
      const shade = SERIES[hue];
      expect(shade, hue).toBeDefined();
      for (const bg of LIGHT_BGS) {
        expect(contrast(shade.light, bg), `${hue} light ${shade.light} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(shade.dark, DARK_BG), `${hue} dark ${shade.dark}`).toBeGreaterThanOrEqual(3);
    });

    it('semantic hues keep their meaning (chart palette semantic colours)', () => {
      for (const t of ['light', 'dark'] as const) {
        expect(SERIES['#f59e0b'][t]).toBe(CHART_PALETTE[t].warning);
        expect(SERIES['#ef4444'][t]).toBe(CHART_PALETTE[t].danger);
      }
    });

    it('shades stay distinct within each theme and never use old-violet chrome', () => {
      for (const t of ['light', 'dark'] as const) {
        const vals = Object.values(SERIES).map(v => v[t].toLowerCase());
        expect(new Set(vals).size, t).toBe(vals.length);
        for (const v of vals) expect(v).not.toMatch(/#(a78bfa|c4b5fd|7c3aed|6d28d9|a5b4fc|818cf8|6366f1)/);
      }
    });
  });

  it('layout keeps copy + one page-level h1 and follows the theme', () => {
    const s = src(`${W}/layout.tsx`);
    expect(s).toContain('Executive Operations Report');
    // Visual-convergence update (authenticated visual-completion pass): the
    // module title moved into WasteModuleTitle so each route has exactly one
    // page-level h1 (user decision 7): the h1 on sub-pages, a same-styled <p>
    // on the Overview where DashboardShell renders the page h1. Copy unchanged.
    expect(s).toMatch(/<WasteModuleTitle>Waste &amp; Recycling Intelligence<\/WasteModuleTitle>/);
    expect(s).toMatch(/import WasteModuleTitle from "\.\/WasteModuleTitle";/);
    const t = src(`${W}/WasteModuleTitle.tsx`);
    expect(t).toMatch(/WASTE_OVERVIEW_PATH = "\/dashboard\/waste";/);
    expect(t).toMatch(/if \(pathname === WASTE_OVERVIEW_PATH\) \{\s*return <p className=\{styles\.title\}>\{children\}<\/p>;\s*\}\s*return <h1 className=\{styles\.title\}>\{children\}<\/h1>;/);
    expect((t.match(/<h1\b/g) ?? []).length).toBe(1);
    expect((t.match(/<p\b/g) ?? []).length).toBe(1);
    expect(s).toContain('<NavTabs />');
    expect(s).not.toMatch(/style=\{\{/);
    const css = src(`${W}/WasteModule.module.css`);
    expect(css).toMatch(/\.frame\s*\{[^}]*background:\s*var\(--bg-base\)/);
    expect(css).toMatch(/\.frame\s*\{[^}]*font-family:\s*var\(--bb-font-sans\)/);
    expect(css).toMatch(/\.header\s*\{[^}]*background:\s*var\(--bg-surface\)/);
  });

  it('NavTabs keeps hrefs, labels, order and active logic; marks the active tab', () => {
    const s = src(`${W}/NavTabs.tsx`);
    const tabs = [...s.matchAll(/\{ label: "([^"]+)",\s*href: "([^"]+)" \}/g)].map(m => `${m[1]}=${m[2]}`);
    expect(tabs).toEqual([
      'Overview=/dashboard/waste',
      'Bin Lifts=/dashboard/waste/bin-lifts',
      'Cost / HH=/dashboard/waste/cost-per-household',
      'Budgeting=/dashboard/waste/budgeting',
      'Diversion=/dashboard/waste/diversion',
      'Fleet=/dashboard/waste/fleet',
      'Complaints=/dashboard/waste/complaints',
      'Commodities=/dashboard/waste/commodities',
      'Community=/dashboard/waste/community',
      'Green Waste=/dashboard/waste/green-waste',
      'Compliance=/dashboard/waste/compliance',
    ]);
    expect(s).toMatch(/const active = pathname === tab\.href;/);
    expect(s).toMatch(/aria-current=\{active \? "page" : undefined\}/);
    expect(s).toMatch(/<nav [^>]*aria-label=/);
    const css = src(`${W}/WasteModule.module.css`);
    // Purple accent only on the active tab; the tab row scrolls, not the page.
    expect(css).toMatch(/\.tab\[aria-current='page'\]\s*\{[^}]*var\(--brand-brainbase-accent\)/);
    expect((css.match(/--brand-brainbase-accent/g) ?? []).length).toBe(1);
    expect(css).toMatch(/\.tabsNav\s*\{[^}]*overflow-x:\s*auto/);
  });
});
