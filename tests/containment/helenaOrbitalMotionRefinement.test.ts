import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B.1 — the showcase was too restrained: state changes needed to be
// much more emotionally expressive (speaking especially), while thinking
// needed a distinct "computational" character rather than just faster
// rotation. This guards the concrete motion contract that refinement
// introduced, without pinning exact cosmetic durations.
describe('HelenaOrbital — Phase B.1 motion refinement', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  it('speaking ring speeds are the fastest of any state (inner < middle < outer, all faster than idle)', () => {
    const start = source.indexOf('const RING_SPEED_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    const extract = (state: string) => {
      const m = block.match(new RegExp(`${state}:\\s*\\{\\s*outer:\\s*([\\d.]+),\\s*middle:\\s*([\\d.]+),\\s*inner:\\s*([\\d.]+)`));
      if (!m) throw new Error(`could not find ring speeds for ${state}`);
      return { outer: Number(m[1]), middle: Number(m[2]), inner: Number(m[3]) };
    };
    const idle = extract('idle');
    const speaking = extract('speaking');
    expect(speaking.inner).toBeLessThan(speaking.middle);
    expect(speaking.middle).toBeLessThan(speaking.outer);
    expect(speaking.outer).toBeLessThan(idle.outer);
    expect(speaking.middle).toBeLessThan(idle.middle);
    expect(speaking.inner).toBeLessThan(idle.inner);
  });

  it('speaking core pulse is faster than idle (more obviously alive)', () => {
    const start = source.indexOf('const CORE_PULSE_S');
    const end = source.indexOf('};', start);
    const block = source.slice(start, end);
    const idle = Number(block.match(/idle:\s*([\d.]+)/)?.[1]);
    const speaking = Number(block.match(/speaking:\s*([\d.]+)/)?.[1]);
    expect(speaking).toBeLessThan(idle);
  });

  it('audioLevel drives core scale via a dedicated, non-animated wrapper (not fighting the breathing keyframe)', () => {
    expect(source).toMatch(/hlo-audio-scale/);
    expect(source).toMatch(/coreExtraScale/);
    // the audio-scale wrapper must not itself carry the looping core-pulse animation class
    const audioScaleBlock = source.match(/className="hlo-audio-scale"[\s\S]{0,120}/)?.[0] ?? '';
    expect(audioScaleBlock).not.toMatch(/hlo-core-pulse/);
  });

  it('a thinking-only computational shudder exists and is distinct from ring rotation', () => {
    expect(source).toMatch(/hloThinkShudder/);
    expect(source).toMatch(/hlo-shudder-active/);
    // driven by the `translate` property, not the `transform` shorthand, so
    // it composes with the core's other scale/rotation layers instead of
    // overriding them.
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    expect(kf).toMatch(/translate:/);
    expect(kf).not.toMatch(/transform:/);
  });

  it('the shudder is intermittent (long calm stretch, not continuous motion)', () => {
    const kf = source.match(/@keyframes hloThinkShudder \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    // calm at both the start and a mid-cycle stretch — i.e. more than one
    // burst separated by held neutral positions, not a smooth sweep.
    const neutralHits = kf.match(/translate:\s*0px 0px/g) ?? [];
    expect(neutralHits.length).toBeGreaterThanOrEqual(3);
  });

  it('a whole-system breathing loop exists for speaking and listening, independent of audioLevel', () => {
    expect(source).toMatch(/hloSystemBreatheOut/);
    expect(source).toMatch(/hloSystemBreatheIn/);
    expect(source).toMatch(/className="hlo-system"/);
  });

  it('thinking energy traces flicker intermittently rather than sitting at one constant opacity', () => {
    expect(source).toMatch(/hloThinkTraceFlicker/);
    expect(source).toMatch(/hlo-trace-flicker-active/);
  });

  it('still uses no animation library beyond plain CSS keyframes', () => {
    for (const forbidden of ['framer-motion', 'gsap', 'react-spring', "from 'three'", '<canvas', 'WebGL', 'requestAnimationFrame']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
