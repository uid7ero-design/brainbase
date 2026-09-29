import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// PR #297 real-auth Preview finding: in dark mode the description line under
// the CURRENT menu item (e.g. CRM while on /crm) measured 4.11:1 — the
// active fill (--brand-brainbase-accent-muted over --bg-overlay) darkens the
// surface under --text-muted. The consolidated Work menu gives every module a
// description, so the current item now always hits this. This pins the fix
// (current-item description uses --text-secondary) and proves the ratio from
// the real token values in app/globals.css for BOTH themes.

const ROOT = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'components/nav/AppChrome.module.css'), 'utf8').replace(/\r\n/g, '\n');
const globals = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8').replace(/\r\n/g, '\n');

// Dark tokens live in the first `:root {` block, light in `:root[data-theme='light'] {`.
const lightStart = globals.indexOf(":root[data-theme='light'] {");
const darkBlock = globals.slice(globals.indexOf(':root {'), lightStart);
const lightBlock = globals.slice(lightStart);

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].trim();
}

type RGBA = { r: number; g: number; b: number; a: number };

function parseColor(v: string): RGBA {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map(s => s.trim());
    return { r: +r, g: +g, b: +b, a: +a };
  }
  throw new Error(`unparsed colour ${v}`);
}

function over(fg: RGBA, bg: RGBA): RGBA {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance(c: RGBA): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function activeSurface(block: string): RGBA {
  return over(parseColor(token(block, 'brand-brainbase-accent-muted')), parseColor(token(block, 'bg-overlay')));
}

describe('active menu item description contrast (PR #297 real-auth finding)', () => {
  it('the current item\'s description uses --text-secondary', () => {
    const rule = css.match(/\.menuItem\[aria-current='page'\]\s+\.menuDescription\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it('the base description colour is unchanged (--text-muted) — only the current item is lifted', () => {
    const base = css.match(/\n\.menuDescription\s*\{([^}]*)\}/);
    expect(base![1]).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it('the active state hierarchy is unchanged (accent label, muted accent fill)', () => {
    expect(css).toMatch(/\.menuItem\[aria-current='page'\]\s*\{[^}]*background:\s*var\(--brand-brainbase-accent-muted\)/);
    expect(css).toMatch(/\.menuItem\[aria-current='page'\]\s+\.menuLabel\s*\{[^}]*color:\s*var\(--brand-brainbase-accent\)/);
  });

  it.each([
    ['dark', darkBlock],
    ['light', lightBlock],
  ])('meets WCAG AA 4.5:1 on the active fill (%s)', (_theme, block) => {
    const ratio = contrast(parseColor(token(block, 'text-secondary')), activeSurface(block));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('documents why: --text-muted fails on the dark active fill', () => {
    const ratio = contrast(parseColor(token(darkBlock, 'text-muted')), activeSurface(darkBlock));
    expect(ratio).toBeLessThan(4.5);
  });
});
