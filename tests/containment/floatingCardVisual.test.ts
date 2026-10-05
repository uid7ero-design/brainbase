import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Authenticated visual-completion pass (P3 follow-up) — Helena's live
// action-feedback card (HlnaAssistantWrapper, /dashboard/** + /organiser).
// components/cards_legacy/** is an orphan and deliberately not covered.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const JSX = strip(read('components/cards/FloatingCard.jsx'));
const CSS = strip(read('components/cards/FloatingCard.module.css'));

describe('FloatingCard visual convergence', () => {
  it('drops glass, gradient and fixed dark-theme colours', () => {
    for (const src of [JSX, CSS]) {
      expect(src).not.toMatch(/GLASS|CYAN|backdrop-?filter|backdropFilter/i);
      expect(src).not.toMatch(/linear-gradient|radial-gradient/);
      expect(src).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
      expect(src).not.toMatch(/cardFloat|infinite/);
    }
  });

  it('paints only through theme tokens', () => {
    for (const decl of CSS.match(/(?:^|;|\{)\s*(?:color|background|border(?:-top)?|box-shadow)\s*:[^;]+/g) ?? []) {
      const value = decl.split(':').slice(1).join(':');
      if (/transparent|^\s*0\s*$/.test(value)) continue;
      expect(value, decl).toMatch(/var\(--/);
    }
    expect(CSS).toMatch(/background:\s*var\(--bg-overlay\)/);
    expect(CSS).toMatch(/color:\s*var\(--status-info\)/);
    expect(CSS).toMatch(/var\(--bb-font-sans\)/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });

  it('keeps the timing, dismiss and width contract', () => {
    expect(JSX).toContain('setTimeout(() => setFading(true),  5500)');
    expect(JSX).toContain('setTimeout(() => { setVisible(false); onDismiss?.(); }, 6200)');
    expect(JSX).toContain('onClick={() => { setFading(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 400); }}');
    expect(JSX).toContain('card.variant === "revenue" ? 290 : 240');
    expect(JSX).toContain('opacity: fading ? 0 : 1');
    expect(JSX).toContain('{card.sub || card.content}');
    expect(JSX).toMatch(/<button\s+type="button"\s+aria-label="Dismiss"/);
  });
});
