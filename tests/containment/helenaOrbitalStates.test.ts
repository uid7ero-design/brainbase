import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B (Hybrid Orbit) — HelenaOrbital must support exactly the five
// HelenaVisualState values the design spec settled on. Guards against a
// state silently being dropped or renamed as the component evolves.
describe('HelenaOrbital — visual state contract', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  it('declares the exact five-state HelenaVisualState union', () => {
    const match = source.match(/export type HelenaVisualState = ([^;]+);/);
    expect(match, 'HelenaVisualState type not found').not.toBeNull();
    const states = match![1].split('|').map((s) => s.trim().replace(/'/g, ''));
    expect(states).toEqual(['idle', 'listening', 'thinking', 'speaking', 'error']);
  });

  it('defines ring-speed, core-pulse and glow config for all five states', () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
    for (const table of ['RING_SPEED_S', 'CORE_PULSE_S', 'GLOW_BY_STATE', 'TRACE_OPACITY']) {
      const start = source.indexOf(`const ${table}`);
      expect(start, `${table} not found`).toBeGreaterThan(-1);
      const end = source.indexOf('};', start);
      const block = source.slice(start, end);
      for (const state of states) {
        expect(block, `${table} missing '${state}'`).toMatch(new RegExp(`\\b${state}:`));
      }
    }
  });

  it('exposes state and audioLevel as the component props', () => {
    expect(source).toMatch(/state\?:\s*HelenaVisualState/);
    expect(source).toMatch(/audioLevel\?:\s*number/);
    expect(source).toMatch(/size\?:\s*number/);
  });

  it('does not know about production Helena wiring', () => {
    for (const forbidden of ['/api/chat', '/api/speak', 'Anthropic', 'ElevenLabs', 'organisation', 'getUserMedia', 'SpeechRecognition']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
