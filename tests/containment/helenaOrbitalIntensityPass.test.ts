import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B.2 — Phase B.1 was technically correct but failed visual review:
// state changes were still too subtle to read at a glance. This guards the
// concrete "made it obviously stronger" contract (faster speaking, a bigger
// shudder, one-shot transition choreography) without pinning exact
// cosmetic values that would make the test brittle.
describe('HelenaOrbital — Phase B.2 intensity pass', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  const extractRingSpeeds = (state: string) => {
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    const m = block.match(new RegExp(`${state}:\\s*\\{\\s*outer:\\s*([\\d.]+),\\s*middle:\\s*([\\d.]+),\\s*inner:\\s*([\\d.]+)`));
    if (!m) throw new Error(`could not find ring speeds for ${state}`);
    return { outer: Number(m[1]), middle: Number(m[2]), inner: Number(m[3]) };
  };

  it('speaking ring speeds are within the B.2 target ranges (outer 10-14s, middle 6-9s, inner 3.5-5.5s)', () => {
    const s = extractRingSpeeds('speaking');
    expect(s.outer).toBeGreaterThanOrEqual(10);
    expect(s.outer).toBeLessThanOrEqual(14);
    expect(s.middle).toBeGreaterThanOrEqual(6);
    expect(s.middle).toBeLessThanOrEqual(9);
    expect(s.inner).toBeGreaterThanOrEqual(3.5);
    expect(s.inner).toBeLessThanOrEqual(5.5);
  });

  it('thinking ring speeds are within the B.2 target ranges (outer 12-18s, middle 8-12s, inner 5-8s)', () => {
    const s = extractRingSpeeds('thinking');
    expect(s.outer).toBeGreaterThanOrEqual(12);
    expect(s.outer).toBeLessThanOrEqual(18);
    expect(s.middle).toBeGreaterThanOrEqual(8);
    expect(s.middle).toBeLessThanOrEqual(12);
    expect(s.inner).toBeGreaterThanOrEqual(5);
    expect(s.inner).toBeLessThanOrEqual(8);
  });

  it('listening ring speeds are within the B.2 target ranges (outer 22-30s, middle 15-22s, inner 10-16s)', () => {
    const s = extractRingSpeeds('listening');
    expect(s.outer).toBeGreaterThanOrEqual(22);
    expect(s.outer).toBeLessThanOrEqual(30);
    expect(s.middle).toBeGreaterThanOrEqual(15);
    expect(s.middle).toBeLessThanOrEqual(22);
    expect(s.inner).toBeGreaterThanOrEqual(10);
    expect(s.inner).toBeLessThanOrEqual(16);
  });

  it('idle motion was not increased (still the calm baseline the other states contrast against)', () => {
    const s = extractRingSpeeds('idle');
    expect(s.outer).toBeGreaterThanOrEqual(70);
    expect(s.middle).toBeGreaterThanOrEqual(50);
    expect(s.inner).toBeGreaterThanOrEqual(35);
  });

  it('audioLevel 1 pushes core scale into the 1.14-1.18 target band', () => {
    const m = source.match(/coreExtraScale\s*=\s*1\s*\+\s*speakingBoost\s*\*\s*([\d.]+)/);
    expect(m, 'coreExtraScale audio-driven coefficient not found').not.toBeNull();
    const maxScale = 1 + Number(m![1]);
    expect(maxScale).toBeGreaterThanOrEqual(1.14);
    expect(maxScale).toBeLessThanOrEqual(1.18);
  });

  it('the thinking shudder amplitude is roughly 2-3px at large size', () => {
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    const magnitudes = [...kf.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
      ([, x, y]) => Math.hypot(Number(x), Number(y)),
    );
    expect(magnitudes.length).toBeGreaterThan(0);
    expect(Math.max(...magnitudes)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...magnitudes)).toBeLessThanOrEqual(3.2);
  });

  it('a distinct core-compression pulse and ring-wobble exist for thinking, separate from the shudder', () => {
    expect(source).toMatch(/hloThinkCompress/);
    expect(source).toMatch(/hlo-think-pulse-active/);
    expect(source).toMatch(/hloRingWobble/);
    expect(source).toMatch(/hlo-ring-wobble-active/);
  });

  it('sphere glow is present and increases with audioLevel in speaking', () => {
    expect(source).toMatch(/SPHERE_GLOW_PX/);
    expect(source).toMatch(/sphereGlowPx/);
    expect(source).toMatch(/speakingBoost \* 3/);
  });

  it('one-shot transition keyframes exist for the three required/preferred pairs', () => {
    expect(source).toMatch(/@keyframes hloIgnition\b/);
    expect(source).toMatch(/@keyframes hloIgnitionHalo/);
    expect(source).toMatch(/@keyframes hloFocusPulse/);
    expect(source).toMatch(/@keyframes hloEnergyBurst/);
  });

  it('every one-shot transition animation is explicitly bounded to a single iteration, never infinite', () => {
    // .hlo-ignition-active is intentionally not in this list — the core
    // ignition flash is driven directly on .hlo-core-pulse via a combined
    // animation-name list (see the dedicated bug-class test below), not a
    // separate wrapper class.
    for (const cls of ['.hlo-ignition-halo-active', '.hlo-focus-pulse-active', '.hlo-energy-burst-active']) {
      const rule = source.match(new RegExp(`${cls.replace('.', '\\.')}\\s*\\{[\\s\\S]*?\\}`));
      expect(rule, `${cls} rule not found`).not.toBeNull();
      const body = rule![0];
      expect(body, `${cls} must not default to an infinite iteration count`).not.toMatch(/iteration-count:\s*infinite/);
    }
  });

  it('transition choreography is driven by lightweight, self-cleaning state (a ref + one timeout), not global state', () => {
    expect(source).toMatch(/const prevStateRef = useRef/);
    expect(source).toMatch(/useState<TransitionFx>\(null\)/);
    expect(source).toMatch(/clearTimeout\(t\)/);
    // no external store / context / window-level state introduced
    for (const forbidden of ['useContext', 'zustand', 'window.__', 'globalThis.']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('combined animation-name lists always carry an explicit matching iteration-count (guards the "infinite leaks onto one-shot" bug class)', () => {
    // Anywhere animationName is built as a comma-joined list (continuous +
    // one-shot together), the same code path must also set an explicit
    // animationIterationCount — otherwise the CSS animation shorthand-list
    // rule repeats the class's single `infinite` across every item in the
    // list, and the one-shot keyframe silently loops forever.
    const combinedNameSites = source.match(/animationName:\s*[`'][^`']*,\s*hlo(Ignition|FocusPulse|EnergyBurst)/g) ?? [];
    expect(combinedNameSites.length).toBeGreaterThan(0);
    expect(source).toMatch(/animationIterationCount:\s*['"]infinite,\s*1['"]/);
  });
});
