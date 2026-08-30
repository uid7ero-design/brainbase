import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B — reduced-motion support is mandatory from the first
// implementation (not bolted on later). This guards that HelenaOrbital ships
// a `prefers-reduced-motion: reduce` branch that stops every continuous
// orbital/particle/core animation, matching the pattern already established
// in app/connect/page.tsx (`.bb-connect-glow { animation: none !important; }`).
describe('HelenaOrbital — reduced-motion behaviour', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  it('declares a prefers-reduced-motion: reduce media query', () => {
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('stops all continuous ring, trace and core animations under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    for (const cls of ['.hlo-spin-cw', '.hlo-spin-ccw', '.hlo-core-pulse', '.hlo-attention', '.hlo-breathe']) {
      expect(block, `${cls} not disabled under reduced motion`).toContain(cls);
    }
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it('keeps a non-repeating opacity/filter transition available for state changes under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    expect(block).toMatch(/transition:\s*opacity/);
  });
});
