import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B.3 — B.2 fixed state distinction but visual review said the
// orbital still read as "rings rotating + glow changing" rather than "a
// living system reacting internally." This guards the concrete
// core→ring→sphere energy-propagation contract B.3 introduced, without
// pinning exact cosmetic pixel/percentage values.
describe('HelenaOrbital — Phase B.3 energy response', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  it('geometry is still exactly 3 primary rings and 3 primary spheres, one per ring', () => {
    const rings = source.match(/data-hlo-ring="(outer|middle|inner)"/g) ?? [];
    const spheres = source.match(/data-hlo-sphere="(outer|middle|inner)"/g) ?? [];
    expect(rings).toHaveLength(3);
    expect(spheres).toHaveLength(3);
  });

  it('a dedicated per-ring energy wrapper exists, distinct from rotation/wobble', () => {
    expect(source).toMatch(/hlo-ring-energy/);
    // must be a *different* CSS property from rotation (transform: rotate
    // via keyframe) and wobble (individual `rotate`) — this wrapper uses
    // the individual `scale` property so all three compose.
    const wrapperRule = source.match(/\.hlo-ring-energy\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(wrapperRule).not.toMatch(/animation/);
  });

  it('speaking drives a staggered core→inner→middle→outer ring energy-wave via transition-delay, not a keyframe loop', () => {
    expect(source).toMatch(/ringEnergyStyle/);
    expect(source).toMatch(/PROPAGATION_DELAY_MS/);
    const start = source.indexOf('const PROPAGATION_DELAY_MS');
    const line = source.slice(start, source.indexOf(';', start));
    const inner = Number(line.match(/inner:\s*(\d+)/)?.[1]);
    const middle = Number(line.match(/middle:\s*(\d+)/)?.[1]);
    const outer = Number(line.match(/outer:\s*(\d+)/)?.[1]);
    // core fires first (implicit 0ms — no delay applied to the core
    // itself), then propagation should be strictly increasing outward.
    expect(inner).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(inner);
    expect(outer).toBeGreaterThan(middle);
  });

  it('the speaking ring energy-wave amplitude increases outward (2-3% range) and is audioLevel-driven', () => {
    const start = source.indexOf('const RING_WAVE_MAX_SCALE');
    const line = source.slice(start, source.indexOf(';', start));
    const inner = Number(line.match(/inner:\s*([\d.]+)/)?.[1]);
    const middle = Number(line.match(/middle:\s*([\d.]+)/)?.[1]);
    const outer = Number(line.match(/outer:\s*([\d.]+)/)?.[1]);
    expect(inner).toBeGreaterThanOrEqual(0.01);
    expect(middle).toBeGreaterThanOrEqual(inner);
    expect(outer).toBeGreaterThan(middle);
    expect(outer).toBeLessThanOrEqual(0.03);
    expect(source).toMatch(/speakingBoost \* RING_WAVE_MAX_SCALE/);
  });

  it('ring rotation speed itself is never derived from audioLevel/speakingBoost (rotation stays state-driven)', () => {
    // RING_SPEED_S must be a static per-state table, not a function of
    // audioLevel — guards against B.3 accidentally reintroducing
    // per-frame rotation-speed mapping, which the brief explicitly forbids.
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    expect(block).not.toMatch(/audioLevel|speakingBoost|level/);
  });

  it('spheres carry their own scale response (speaking pulse + thinking spike + ignition burst), separate from the ring energy wrapper', () => {
    expect(source).toMatch(/sphereStyle/);
    expect(source).toMatch(/SPHERE_PROPAGATION_DELAY_MS/);
    expect(source).toMatch(/hloThinkSphereSpike/);
    expect(source).toMatch(/hloIgnitionSphereBurst/);
  });

  it('thinking bursts drive a coordinated core/ring/sphere response: shudder, per-ring squeeze (amplitude decreasing outward), and sphere spike', () => {
    expect(source).toMatch(/hloThinkShudder/);
    expect(source).toMatch(/hloThinkSqueezeInner/);
    expect(source).toMatch(/hloThinkSqueezeMiddle/);
    expect(source).toMatch(/hloThinkSqueezeOuter/);

    const extractPeak = (name: string) => {
      const kf = source.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n {2}\\}`))?.[0] ?? '';
      const values = [...kf.matchAll(/scale:\s*([\d.]+)/g)].map((m) => Math.abs(1 - Number(m[1])));
      return Math.max(...values);
    };
    const innerAmp = extractPeak('hloThinkSqueezeInner');
    const middleAmp = extractPeak('hloThinkSqueezeMiddle');
    const outerAmp = extractPeak('hloThinkSqueezeOuter');
    expect(innerAmp).toBeGreaterThan(middleAmp);
    expect(middleAmp).toBeGreaterThan(outerAmp);
  });

  it('the thinking shudder amplitude was trimmed in B.3 (activity shifted into coordinated ring/sphere response)', () => {
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    const magnitudes = [...kf.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
      ([, x, y]) => Math.hypot(Number(x), Number(y)),
    );
    expect(Math.max(...magnitudes)).toBeLessThan(2.4); // B.2's peak was 2.4px
  });

  it('every longhand animation-name rule not driven by inline style also declares animation-duration', () => {
    // Regression guard for a real bug found during B.3 live QA:
    // .hlo-shudder-active set animation-name/timing-function/iteration-
    // count but never animation-duration, and had no inline style either
    // — so it silently defaulted to animation-duration: 0s and the
    // thinking shudder never actually ran (getAnimations() returned zero
    // CSSAnimation instances even though the computed animation-name
    // looked correct). Rotation (.hlo-spin-cw/.hlo-spin-ccw) and the core
    // pulse (.hlo-core-pulse) are legitimately exempt — their duration is
    // supplied per-instance via inline style since it varies by state.
    const rules = [...source.matchAll(/(\.[a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g)]
      .map((m) => ({ selector: m[1], body: m[2] }))
      .filter((r) => /animation-name:/.test(r.body) && !/animation:\s*\S/.test(r.body));
    const exempt = new Set(['.hlo-spin-cw', '.hlo-spin-ccw']);
    for (const rule of rules) {
      if (exempt.has(rule.selector)) continue;
      expect(rule.body, `${rule.selector} sets animation-name but no animation-duration`).toMatch(/animation-duration:/);
    }
    // .hlo-core-pulse itself gets duration via inline style (corePulseAnim),
    // confirmed separately — not exempted from the scan above because it
    // has no `animation-name:` longhand in its own CSS rule body at all.
  });

  it('listening drives an inward-focus response: outer contracts before middle, middle before inner', () => {
    expect(source).toMatch(/hloListenContractOuter/);
    expect(source).toMatch(/hloListenContractMiddle/);
    expect(source).toMatch(/hloListenContractInner/);
    const outerDelay = Number(source.match(/\.hlo-listen-contract-outer-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? 0);
    const middleDelay = Number(source.match(/\.hlo-listen-contract-middle-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? -1);
    const innerDelay = Number(source.match(/\.hlo-listen-contract-inner-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? -1);
    expect(middleDelay).toBeGreaterThan(outerDelay);
    expect(innerDelay).toBeGreaterThan(middleDelay);
  });

  it('the ignition sequence propagates core → rings → spheres using the same delay table as the steady-state speaking wave', () => {
    expect(source).toMatch(/hloIgnitionRingWave/);
    expect(source).toMatch(/hloIgnitionSphereBurst/);
    expect(source).toMatch(/hlo-ignition-wave-inner/);
    expect(source).toMatch(/hlo-ignition-wave-middle/);
    expect(source).toMatch(/hlo-ignition-wave-outer/);
    // Reuses PROPAGATION_DELAY_MS / SPHERE_PROPAGATION_DELAY_MS (checked
    // above) rather than a second, independent set of numbers — keeps the
    // one-shot event and the ongoing motion it hands off to consistent.
    const igniteBlock = source.slice(source.indexOf('.hlo-ignition-wave-inner'), source.indexOf('.hlo-ignition-sphere-outer'));
    expect(igniteBlock).toMatch(/PROPAGATION_DELAY_MS/);
  });

  it('idle and error ring speeds/config were not touched by the energy-response work', () => {
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    expect(block).toMatch(/idle:\s*\{\s*outer:\s*78,\s*middle:\s*60,\s*inner:\s*40\s*\}/);
    expect(block).toMatch(/error:\s*\{\s*outer:\s*150,\s*middle:\s*120,\s*inner:\s*90\s*\}/);
  });

  it('error state does not gain any new energy-wave/propagation behaviour', () => {
    // ringEnergyClass/sphereClass/ringEnergyStyle/sphereStyle must not
    // branch on state === 'error' — error stays subdued, no new motion.
    for (const fn of ['ringEnergyStyle', 'ringEnergyClass', 'sphereStyle', 'sphereClass']) {
      const start = source.indexOf(`function ${fn}(`);
      const body = source.slice(start, source.indexOf('\n  }', start));
      expect(body, `${fn} should not special-case error`).not.toMatch(/'error'/);
    }
  });

  it('still uses no animation library, canvas, WebGL, or requestAnimationFrame', () => {
    for (const forbidden of ['framer-motion', 'gsap', 'react-spring', "from 'three'", '<canvas', 'requestAnimationFrame']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
