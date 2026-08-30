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
      // B.3 energy-propagation additions — all repeating, all must stop.
      '.hlo-think-squeeze-inner-active',
      '.hlo-think-squeeze-middle-active',
      '.hlo-think-squeeze-outer-active',
      '.hlo-listen-contract-outer-active',
      '.hlo-listen-contract-middle-active',
      '.hlo-listen-contract-inner-active',
      '.hlo-think-sphere-spike-inner',
      '.hlo-think-sphere-spike-middle',
      '.hlo-think-sphere-spike-outer',
    ]) {
      expect(block, `${cls} not disabled under reduced motion`).toContain(cls);
    }
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it('also clears the thinking/listening individual transform properties (translate/scale/rotate) under reduced motion', () => {
    // B.3 shares these reset rules across many selectors in one comma
    // list (e.g. ".hlo-think-pulse-active, .hlo-think-squeeze-inner-active,
    // ... { scale: none !important; }"), so check that each class appears
    // in the selector list of *some* rule whose body resets the expected
    // property — not that it owns a standalone rule.
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map((m) => ({ selector: m[1], body: m[2] }));

    const expectClassResets = (cls: string, prop: string) => {
      const match = rules.find((r) => r.selector.includes(cls) && new RegExp(`${prop}:\\s*none\\s*!important`).test(r.body));
      expect(match, `${cls} does not have a rule resetting ${prop} to none !important`).toBeDefined();
    };

    expectClassResets('.hlo-shudder-active', 'translate');
    expectClassResets('.hlo-think-pulse-active', 'scale');
    expectClassResets('.hlo-ring-wobble-active', 'rotate');
    // B.3 additions: thinking ring-squeeze/sphere-spike and listening
    // inward-contraction must also reset scale under reduced motion.
    for (const cls of [
      '.hlo-think-squeeze-inner-active',
      '.hlo-think-squeeze-middle-active',
      '.hlo-think-squeeze-outer-active',
      '.hlo-listen-contract-outer-active',
      '.hlo-listen-contract-middle-active',
      '.hlo-listen-contract-inner-active',
      '.hlo-think-sphere-spike-inner',
      '.hlo-think-sphere-spike-middle',
      '.hlo-think-sphere-spike-outer',
    ]) {
      expectClassResets(cls, 'scale');
    }
  });

  it('does not suppress the bounded, non-repeating one-shot transition flashes', () => {
    // Ignition/focus/burst are single ≤500ms cues, not continuous motion —
    // reduced-motion guidance explicitly permits "a minimal non-repeating
    // state transition", so these are deliberately left out of the
    // animation:none block rather than disabled.
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    for (const cls of [
      '.hlo-ignition-active',
      '.hlo-ignition-halo-active',
      '.hlo-focus-pulse-active',
      '.hlo-energy-burst-active',
      // B.3: the ring-wave/sphere-burst that ride along with ignition are
      // just as bounded/one-shot as the rest of the sequence.
      '.hlo-ignition-wave-inner',
      '.hlo-ignition-wave-middle',
      '.hlo-ignition-wave-outer',
      '.hlo-ignition-sphere-inner',
      '.hlo-ignition-sphere-middle',
      '.hlo-ignition-sphere-outer',
    ]) {
      expect(block, `${cls} should not appear in the reduced-motion suppression block`).not.toContain(cls);
    }
  });

  it('keeps a non-repeating opacity/filter transition available for state changes under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    expect(block).toMatch(/transition:\s*opacity/);
  });
});
