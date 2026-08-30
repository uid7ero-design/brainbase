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

  it('stops all continuous ring, trace, core, breathing, wobble and shudder animations under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    for (const cls of [
      '.hlo-spin-cw',
      '.hlo-spin-ccw',
      '.hlo-core-pulse',
      '.hlo-attention',
      '.hlo-system',
      '.hlo-ring-wobble-active',
      '.hlo-think-pulse-active',
      '.hlo-shudder-active',
      '.hlo-glow-spike-active',
      '.hlo-trace-flicker-active',
    ]) {
      expect(block, `${cls} not disabled under reduced motion`).toContain(cls);
    }
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it('also clears the thinking shudder/compression/wobble individual transform properties under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    expect(block).toMatch(/\.hlo-shudder-active\s*\{\s*translate:\s*none\s*!important;?\s*\}/);
    expect(block).toMatch(/\.hlo-think-pulse-active\s*\{\s*scale:\s*none\s*!important;?\s*\}/);
    expect(block).toMatch(/\.hlo-ring-wobble-active\s*\{\s*rotate:\s*none\s*!important;?\s*\}/);
  });

  it('does not suppress the bounded, non-repeating one-shot transition flashes', () => {
    // Ignition/focus/burst are single ≤500ms cues, not continuous motion —
    // reduced-motion guidance explicitly permits "a minimal non-repeating
    // state transition", so these are deliberately left out of the
    // animation:none block rather than disabled.
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    for (const cls of ['.hlo-ignition-active', '.hlo-ignition-halo-active', '.hlo-focus-pulse-active', '.hlo-energy-burst-active']) {
      expect(block, `${cls} should not appear in the reduced-motion suppression block`).not.toContain(cls);
    }
  });

  it('keeps a non-repeating opacity/filter transition available for state changes under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    expect(block).toMatch(/transition:\s*opacity/);
  });
});
