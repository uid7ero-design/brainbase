import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B.4 — final dev-showcase polish before Phase C: (1) a speaking
// pulse envelope that reads as speech cadence (fast attack, softer decay)
// rather than a symmetrical bloom, (2) a stronger listening inward-focus
// contraction (previously the least distinct active state), and (3)
// thinking impulses shortened into discrete, well-spaced events rather
// than a longer "shake." This guards the concrete contract without
// pinning exact cosmetic values.
describe('HelenaOrbital — Phase B.4 motion polish', () => {
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

  it('speaking uses an asymmetric attack/decay pulse envelope, not one fixed duration', () => {
    expect(source).toMatch(/const ATTACK_MS = 1[0-4]\d;/); // 80-140ms band
    expect(source).toMatch(/const DECAY_MS = \d{3};/);
    const attack = Number(source.match(/const ATTACK_MS = (\d+);/)?.[1]);
    const decay = Number(source.match(/const DECAY_MS = (\d+);/)?.[1]);
    expect(attack).toBeGreaterThanOrEqual(80);
    expect(attack).toBeLessThanOrEqual(140);
    expect(decay).toBeGreaterThanOrEqual(220);
    expect(decay).toBeLessThanOrEqual(380);
    expect(decay).toBeGreaterThan(attack); // decay must be the longer phase
    // driven by a rising/falling comparison, not a fixed value — the whole
    // point is that attack and decay use different timing. The comparison
    // must be React's sanctioned "adjust state during render" pattern
    // (setState guarded by a prop-change check), not a ref read during
    // render — this codebase's React Compiler lint rules reject the latter
    // as a purity violation (the exact bug class this test guards).
    expect(source).toMatch(/if \(speakingBoost !== prevSpeakingBoost\) \{/);
    expect(source).toMatch(/setRising\(speakingBoost >= prevSpeakingBoost\)/);
    expect(source).toMatch(/pulseDurationMs = isSpeaking \? \(rising \? ATTACK_MS : DECAY_MS\)/);
    expect(source).not.toMatch(/prevSpeakingBoostRef/);
  });

  it('the attack/decay envelope is applied to core, halo, ring energy and spheres — not just the core', () => {
    for (const site of [
      'transform ${pulseDurationMs}ms ${pulseEase}',
      'opacity ${pulseDurationMs}ms ${pulseEase} 15ms, transform ${pulseDurationMs}ms ${pulseEase} 15ms',
      'scale ${pulseDurationMs}ms ${pulseEase} ${PROPAGATION_DELAY_MS[ring]}ms',
      'scale ${pulseDurationMs}ms ${pulseEase} ${SPHERE_PROPAGATION_DELAY_MS[ring]}ms',
    ]) {
      expect(source, `expected to find: ${site}`).toContain(site);
    }
  });

  it('the pulse-envelope comparison uses React state, not a timer, rAF loop, or a ref read during render', () => {
    expect(source).not.toContain('requestAnimationFrame');
    expect(source).not.toMatch(/setInterval/);
    expect(source).toMatch(/const \[prevSpeakingBoost, setPrevSpeakingBoost\] = useState\(speakingBoost\);/);
    expect(source).toMatch(/const \[rising, setRising\] = useState/);
  });

  it('speaking response uses sqrt(level) so low-mid audioLevel is not underwhelming, while the max ceiling is unchanged', () => {
    expect(source).toMatch(/Math\.sqrt\(level\)/);
    // ceiling unchanged from B.3: core scale coefficient still 0.16 (max ~1.16)
    expect(source).toMatch(/coreExtraScale = 1 \+ speakingBoost \* 0\.16/);
  });

  it('listening contraction amplitude is stronger than the B.3 values (outer 1.3%/middle 1.0%/inner 0.7%)', () => {
    // These keyframes are written on a single line with nested braces
    // (e.g. "@keyframes X { 0%, 100% { scale: 1; } 45% { scale: 0.982; } }"),
    // so match the whole line rather than trying to balance braces, then
    // take the scale value that isn't the resting "1".
    const extractPeak = (name: string) => {
      const line = source.match(new RegExp(`@keyframes ${name}[^\\n]*`))?.[0] ?? '';
      const values = [...line.matchAll(/scale:\s*([\d.]+)/g)].map((m) => Number(m[1]));
      const peak = values.find((v) => v !== 1) ?? 1;
      return Math.abs(1 - peak);
    };
    const outer = extractPeak('hloListenContractOuter');
    const middle = extractPeak('hloListenContractMiddle');
    const inner = extractPeak('hloListenContractInner');
    // B.3 values: outer .013, middle .010, inner .007
    expect(outer).toBeGreaterThan(0.013);
    expect(middle).toBeGreaterThan(0.010);
    expect(inner).toBeGreaterThan(0.007);
    // ordering preserved: outer contracts most, inner least (gathering toward the core)
    expect(outer).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(inner);
  });

  it('listening still contracts outer-first, then middle, then inner (via animation-delay ordering)', () => {
    const outerDelay = Number(source.match(/\.hlo-listen-contract-outer-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? 0);
    const middleDelay = Number(source.match(/\.hlo-listen-contract-middle-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? -1);
    const innerDelay = Number(source.match(/\.hlo-listen-contract-inner-active\s*\{[^}]*\}/)?.[0].match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? -1);
    expect(middleDelay).toBeGreaterThan(outerDelay);
    expect(innerDelay).toBeGreaterThan(middleDelay);
  });

  it('listening gains a periodic core/glow brighten synced to the inward-focus peak, independent of audioLevel', () => {
    expect(source).toMatch(/@keyframes hloListenGlowPulse/);
    expect(source).toMatch(/hlo-listen-glow-pulse-active/);
    const kf = source.match(/@keyframes hloListenGlowPulse\s*\{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    expect(kf).toMatch(/opacity:/);
  });

  it('thinking impulses are now short clusters with meaningful quiet gaps (not one long shake)', () => {
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    // Neutral (0px 0px) must appear at the cycle boundaries and between
    // the two impulse clusters — i.e. at least 2 distinct calm stretches.
    const neutralBreakpoints = kf.match(/\d+(\.\d+)?%(,\s*\d+(\.\d+)?%)?\s*\{\s*translate:\s*0px 0px/g) ?? [];
    expect(neutralBreakpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('each thinking impulse cluster is brief (roughly 100-250ms) at the current 2.6s cycle duration', () => {
    const cycleMatch = source.match(/\.hlo-shudder-active\s*\{[^}]*animation-duration:\s*([\d.]+)s/);
    const cycleS = Number(cycleMatch?.[1]);
    expect(cycleS).toBeGreaterThan(0);
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    // First cluster: from its opening 0% breakpoint to the next non-zero
    // percentage where it returns to neutral.
    const percents = [...kf.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    const uniqueSorted = [...new Set(percents)].sort((a, b) => a - b);
    // cluster A spans uniqueSorted[0] (0%) to uniqueSorted[2] (its return-to-neutral point)
    const clusterAWidthPct = uniqueSorted[2] - uniqueSorted[0];
    const clusterAWidthMs = (clusterAWidthPct / 100) * cycleS * 1000;
    expect(clusterAWidthMs).toBeGreaterThanOrEqual(60);
    expect(clusterAWidthMs).toBeLessThanOrEqual(260);
  });

  it('the quiet gap between thinking impulse clusters is within the suggested 700-1400ms range', () => {
    const cycleMatch = source.match(/\.hlo-shudder-active\s*\{[^}]*animation-duration:\s*([\d.]+)s/);
    const cycleS = Number(cycleMatch?.[1]);
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    const percents = [...new Set([...kf.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    // gap between end of cluster A (percents[2]) and start of cluster B (percents[3])
    const gapPct = percents[3] - percents[2];
    const gapMs = (gapPct / 100) * cycleS * 1000;
    expect(gapMs).toBeGreaterThanOrEqual(700);
    expect(gapMs).toBeLessThanOrEqual(1450);
  });

  it('thinking ring-squeeze amplitude still decreases outward (inner most, outer least) and stays small', () => {
    const extractPeak = (name: string) => {
      const kf = source.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n {2}\\}`))?.[0] ?? '';
      const values = [...kf.matchAll(/scale:\s*([\d.]+)/g)].map((m) => Math.abs(1 - Number(m[1])));
      return Math.max(...values);
    };
    const inner = extractPeak('hloThinkSqueezeInner');
    const middle = extractPeak('hloThinkSqueezeMiddle');
    const outer = extractPeak('hloThinkSqueezeOuter');
    expect(inner).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(outer);
    expect(inner).toBeLessThan(0.03); // stays small — "processing impulse", not rubber rings
  });

  it('thinking cluster A and cluster B use different magnitudes (deterministic irregularity, no Math.random in render)', () => {
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    const values = [...kf.matchAll(/translate:\s*(-?[\d.]+)px (-?[\d.]+)px/g)].filter(([, x, y]) => x !== '0' || y !== '0');
    expect(values.length).toBeGreaterThanOrEqual(2);
    const [a, b] = values;
    expect(a[0] === b[0] && a[1] === b[1]).toBe(false); // clusters are not identical
    expect(source).not.toMatch(/Math\.random\(\)/);
  });

  it('idle and error ring speeds/config remain untouched by B.4', () => {
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    expect(block).toMatch(/idle:\s*\{\s*outer:\s*78,\s*middle:\s*60,\s*inner:\s*40\s*\}/);
    expect(block).toMatch(/error:\s*\{\s*outer:\s*150,\s*middle:\s*120,\s*inner:\s*90\s*\}/);
  });

  it('ring rotation speeds were not increased for speaking/thinking/listening in B.4', () => {
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    // Same values as B.3 — B.4's brief was pulse shape/impulse character, not more speed.
    expect(block).toMatch(/listening:\s*\{\s*outer:\s*26,\s*middle:\s*18,\s*inner:\s*13\s*\}/);
    expect(block).toMatch(/thinking:\s*\{\s*outer:\s*15,\s*middle:\s*10,\s*inner:\s*6\.5\s*\}/);
    expect(block).toMatch(/speaking:\s*\{\s*outer:\s*12,\s*middle:\s*7\.5,\s*inner:\s*4\.5\s*\}/);
  });

  it('the new listening glow-pulse is suppressed under reduced motion', () => {
    const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = source.slice(start, source.indexOf('`;', start));
    expect(block).toContain('.hlo-listen-glow-pulse-active');
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it('still uses no animation library, canvas, WebGL, or requestAnimationFrame', () => {
    for (const forbidden of ['framer-motion', 'gsap', 'react-spring', "from 'three'", '<canvas', 'requestAnimationFrame']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

// Regression guard for a real bug found during B.4 live QA: the component's
// real @media (prefers-reduced-motion: reduce) block was correctly updated
// for the new .hlo-listen-glow-pulse-active class, but the dev showcase's
// separate, manually-toggleable ".hlo-force-reduced" preview mirror (used
// by the "Preview prefers-reduced-motion" checkbox, since a real OS media
// query can't be toggled from the page) was not — so the showcase's
// reduced-motion preview silently failed to suppress it, even though the
// real media query worked correctly. Caught live via getAnimations()
// showing the glow-pulse still running while the preview toggle was on.
describe('HelenaOrbital showcase — reduced-motion preview mirror stays in sync with the component', () => {
  const componentSource = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );
  const showcaseSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/dev/helena-orbital/HelenaOrbitalShowcase.tsx'),
    'utf-8',
  );

  it('every class suppressed under the real reduced-motion media query is also suppressed by the showcase preview toggle', () => {
    const start = componentSource.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = componentSource.slice(start, componentSource.indexOf('`;', start));
    // Extract every ".hlo-xxx" class name that appears in a selector list
    // immediately preceding "animation: none !important" (i.e. the classes
    // actually being suppressed, not incidental mentions in comments).
    const suppressionRules = [...block.matchAll(/([^{}]+)\{\s*animation:\s*none\s*!important;\s*\}/g)];
    const suppressedClasses = new Set(
      suppressionRules.flatMap(([, selectors]) => [...selectors.matchAll(/\.[a-zA-Z0-9_-]+/g)].map((m) => m[0])),
    );
    expect(suppressedClasses.size).toBeGreaterThan(0);
    for (const cls of suppressedClasses) {
      expect(showcaseSource, `${cls} is suppressed by the real media query but missing from .hlo-force-reduced in the showcase`).toContain(
        `.hlo-force-reduced ${cls}`,
      );
    }
  });
});
