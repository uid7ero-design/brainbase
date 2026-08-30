import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase C — production Helena state integration. Guards that the approved
// HelenaOrbital visual was wired into the real BrainBase.jsx Helena
// experience using only EXISTING state signals (useHelena.js's orbPhase)
// and the EXISTING synthetic speech pulse (speechPulseRef), with no second
// state machine, no real audio analysis, and no change to the voice/AI
// pipeline itself.
describe('HelenaOrbital — Phase C production integration', () => {
  const root = path.resolve(__dirname, '../..');
  const brainBase = fs.readFileSync(path.join(root, 'components/BrainBase.jsx'), 'utf-8');
  const orbital = fs.readFileSync(path.join(root, 'components/brand/HelenaOrbital.tsx'), 'utf-8');

  it('BrainBase.jsx imports HelenaOrbital and renders it at the main Helena orb site', () => {
    expect(brainBase).toContain('import { HelenaOrbital } from "./brand/HelenaOrbital"');
    expect(brainBase).toMatch(/<HelenaOrbital\s+size=\{120\}\s+state=\{helenaVisualState\}\s+speechRef=\{orbSpeechRef\}\s*\/>/);
  });

  it('a simple, easily-revertible fallback flag gates the new visual (legacy HlnaOrb stays reachable)', () => {
    expect(brainBase).toMatch(/const USE_HELENA_ORBITAL = (true|false);/);
    expect(brainBase).toMatch(/USE_HELENA_ORBITAL\s*\?[\s\S]{0,120}<HelenaOrbital/);
    expect(brainBase).toMatch(/<HlnaOrb size=\{120\} state=\{orbState\} speechRef=\{orbSpeechRef\} \/>/);
  });

  it('mapHelenaPhaseToVisualState maps every existing orbPhase value correctly, with orbAlert taking priority as \'error\'', () => {
    const start = brainBase.indexOf('function mapHelenaPhaseToVisualState');
    expect(start).toBeGreaterThan(-1);
    const end = brainBase.indexOf('\n}', start);
    const body = brainBase.slice(start, end);

    // orbAlert (existing dashboard-anomaly override) must be checked first.
    const alertLine = body.indexOf('orbAlert');
    const processingLine = body.indexOf("'processing'");
    expect(alertLine).toBeGreaterThan(-1);
    expect(alertLine).toBeLessThan(processingLine);

    expect(body).toMatch(/orbAlert\)\s*return\s*'error'/);
    expect(body).toMatch(/orbPhase === 'processing'\)\s*return\s*'thinking'/);
    expect(body).toMatch(/orbPhase === 'speaking'\)\s*return\s*'speaking'/);
    expect(body).toMatch(/orbPhase === 'listening'\)\s*return\s*'listening'/);
    expect(body).toMatch(/return\s*'idle'/);
  });

  it('does not create a second state machine — the mapping function is a pure relabel with no local state/effects/timers', () => {
    const start = brainBase.indexOf('function mapHelenaPhaseToVisualState');
    const end = brainBase.indexOf('\n}', start);
    const body = brainBase.slice(start, end);
    for (const forbidden of ['useState', 'useEffect', 'useRef', 'setTimeout', 'setInterval']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('the existing speechPulseRef → orbSpeechRef bridge effect is unchanged and still reused for HelenaOrbital', () => {
    expect(brainBase).toContain('const orbSpeechRef = useRef(null);');
    expect(brainBase).toMatch(/useEffect\(\(\) => \{\s*helena\.speechPulseRef\.current = \(v\) => orbSpeechRef\.current\?\.\(v\);\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[\]\);/);
  });

  it('no getUserMedia, AnalyserNode, or other real Web Audio amplitude analysis was introduced', () => {
    for (const forbidden of ['getUserMedia', 'AnalyserNode', 'MediaElementSource', 'MediaStreamSource', 'createAnalyser', 'new AudioContext', 'webkitAudioContext']) {
      expect(brainBase, `BrainBase.jsx should not contain ${forbidden}`).not.toContain(forbidden);
      expect(orbital, `HelenaOrbital.tsx should not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('BrainGraphPanel is still rendered, untouched by the orb integration', () => {
    expect(brainBase).toMatch(/<BrainGraphPanel\s*\/>/);
  });

  it('voice input/output call sites are not touched by this integration (no changes to recognition/TTS wiring in BrainBase.jsx)', () => {
    // Phase C only reads existing signals (orbPhase, speechPulseRef); it must
    // not add new calls into the speech recognition or TTS surfaces.
    expect(brainBase).not.toMatch(/new SpeechRecognition|webkitSpeechRecognition\(\)/);
    expect(brainBase).not.toContain('/api/speak');
  });
});

// The production speechRef bridge added to HelenaOrbital.tsx itself for
// Phase C. Manual audioLevel (dev showcase) and speechRef (production) are
// two independent input paths — this guards that production mode stays a
// contained, ref-based imperative bridge and never causes a 60fps React
// state update.
describe('HelenaOrbital — Phase C speechRef bridge', () => {
  const root = path.resolve(__dirname, '../..');
  const orbital = fs.readFileSync(path.join(root, 'components/brand/HelenaOrbital.tsx'), 'utf-8');
  const showcase = fs.readFileSync(
    path.join(root, 'app/dev/helena-orbital/HelenaOrbitalShowcase.tsx'),
    'utf-8',
  );

  it('exposes an optional speechRef prop with the same ref-callback contract as HlnaOrb', () => {
    expect(orbital).toMatch(/export type HelenaOrbitalSpeechRef = React\.MutableRefObject<\(\(level: number\) => void\) \| null>;/);
    expect(orbital).toMatch(/speechRef\?:\s*HelenaOrbitalSpeechRef;/);
  });

  it('the bridge only drives the visual while state === \'speaking\'', () => {
    const start = orbital.indexOf("speechRef.current = (rawLevel");
    const end = orbital.indexOf('}, [state, speechRef]);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = orbital.slice(start, end);
    expect(body).toMatch(/if \(state !== 'speaking'\) return;/);
  });

  it('the bridge writes directly to the DOM via refs and never calls a React state setter (no 60fps re-renders)', () => {
    const start = orbital.indexOf("speechRef.current = (rawLevel");
    const end = orbital.indexOf('}, [state, speechRef]);');
    const body = orbital.slice(start, end);
    expect(body).not.toMatch(/\bset[A-Z]\w*\(/);
    expect(body).toMatch(/audioScaleElRef\.current/);
  });

  it('the bridge is cleaned up on unmount/state change, matching HlnaOrb\'s existing contract', () => {
    const start = orbital.indexOf("speechRef.current = (rawLevel");
    const end = orbital.indexOf('}, [state, speechRef]);');
    const body = orbital.slice(start, end);
    expect(body).toMatch(/if \(speechRef\.current\) speechRef\.current = null;/);
  });

  it('the dev showcase stays on manual audioLevel only and is not coupled to speechRef/production APIs', () => {
    expect(showcase).not.toContain('speechRef');
    expect(showcase).not.toMatch(/from ['"].*useHelena['"]|from ['"].*BrainBase['"]|\/api\/chat|\/api\/speak/);
  });
});
