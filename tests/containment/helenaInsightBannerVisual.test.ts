import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Authenticated visual-completion pass (P3 follow-up) — Helena's insight
// banner, rendered inside the converged Fleet, Waste and Service Requests
// dashboards. It must follow the theme like its host shell.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const TSX = strip(read('components/hlna/InsightBanner.tsx'));
const CSS = strip(read('components/hlna/InsightBanner.module.css'));

describe('HlnaInsightBanner visual convergence', () => {
  it('has no fixed dark-theme colour, glass, gradient or legacy violet', () => {
    for (const src of [TSX, CSS]) {
      expect(src).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
      expect(src).not.toMatch(/linear-gradient|radial-gradient|backdrop/i);
      expect(src).not.toMatch(/onMouseEnter|onMouseLeave/);
    }
    for (const decl of CSS.match(/(?:^|;|\{)\s*(?:color|background|border(?:-left)?|box-shadow)\s*:[^;]+/g) ?? []) {
      const value = decl.split(':').slice(1).join(':');
      if (/transparent|^\s*0\s*$/.test(value)) continue;
      expect(value, decl).toMatch(/var\(--/);
    }
    expect(CSS).toMatch(/border-left:\s*3px solid var\(--brand-brainbase-accent\)/);
    expect(CSS).toMatch(/\.recLabel[^}]*color:\s*var\(--status-info\)/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('keeps the request, store and prompt contract', () => {
    expect(TSX).toContain("fetch('/api/hlna/insight', {");
    expect(TSX).toContain('body: JSON.stringify({ dashboardType }),');
    expect(TSX).toContain('if (data.anomaly) setOrbAlert(true);');
    expect(TSX).toContain("const good  = trendDir === 'flat' ? true : trendPositive === (trendDir === 'down');");
    expect(TSX).toContain('useAppStore.getState().setChatOpen(true);');
    expect(TSX).toContain("onClick={() => askAbout(`Based on the current ${labelMap[dashboardType] ?? dashboardType} data, ${insight.headline.toLowerCase()} ${insight.anomaly ? `The main anomaly is: ${insight.anomaly}.` : ''} Give me a detailed analysis and recommended actions.`)}");
    expect(TSX).toContain('const t = setInterval(update, 15_000);');
    expect(TSX).toMatch(/aria-label="Refresh insight"/);
  });
});
