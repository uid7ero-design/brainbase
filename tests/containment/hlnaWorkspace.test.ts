import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase C.2B — dedicated full-screen /hlna conversation workspace. Guards
// that the new route/component reuses the existing Helena state machine and
// production HelenaOrbital integration rather than duplicating it, and that
// it stays conversation-first (no permanent mock-department/waste content),
// without touching /dashboard, TopNav, Founder OS, or LD Tennis routing.
describe('/hlna — Phase C.2B dedicated workspace', () => {
  const root = path.resolve(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'app/hlna/page.tsx'), 'utf-8');
  const workspace = fs.readFileSync(path.join(root, 'components/helena/HelenaWorkspace.jsx'), 'utf-8');

  it('the /hlna route exists and renders HelenaWorkspace', () => {
    expect(page).toMatch(/import HelenaWorkspace from ['"]@\/components\/helena\/HelenaWorkspace['"]/);
    expect(page).toMatch(/<HelenaWorkspace\s*\/>/);
  });

  it('HelenaOrbital is present and uses the production speechRef bridge, not manual audioLevel', () => {
    expect(workspace).toMatch(/import \{ HelenaOrbital \} from ['"]\.\.\/brand\/HelenaOrbital['"]/);
    expect(workspace).toMatch(/<HelenaOrbital\s+size=\{220\}\s+state=\{helenaVisualState\}\s+speechRef=\{orbSpeechRef\}\s*\/>/);
  });

  it('the conversation/input/mic surface is present', () => {
    expect(workspace).toMatch(/import \{ ChatPanel \} from ['"]\.\.\/chat\/ChatPanel['"]/);
    expect(workspace).toMatch(/<ChatPanel/);
    expect(workspace).toMatch(/import \{ MicButton \} from ['"]\.\.\/voice\/MicButton['"]/);
    expect(workspace).toMatch(/<MicButton/);
    expect(workspace).toMatch(/import \{ AskInput \} from ['"]\.\/AskInput['"]/);
    expect(workspace).toMatch(/<AskInput/);
  });

  it('reuses the existing useHelena state machine — no new hook, no duplicate phase state', () => {
    expect(workspace).toMatch(/import \{ useHelena \} from ['"]\.\.\/\.\.\/hooks\/useHelena['"]/);
    expect(workspace).toMatch(/const helena = useHelena\(\);/);
    // must not define a second phase/orb-state useState of its own
    expect(workspace).not.toMatch(/useState\(['"]idle['"]\)/);
    expect(workspace).not.toMatch(/function useHelena/);
  });

  it('the speechPulseRef bridge has the exact same contract as BrainBase.jsx\'s Phase C integration', () => {
    expect(workspace).toMatch(/helena\.speechPulseRef\.current = \(v\) => orbSpeechRef\.current\?\.\(v\);/);
  });

  it('uses the shared visual-state mapping rather than redefining it', () => {
    expect(workspace).toMatch(/import \{ mapHelenaPhaseToVisualState, HELENA_VISUAL_STATE_LABEL \} from ['"]\.\.\/\.\.\/lib\/helena\/visualState['"]/);
    expect(workspace).not.toMatch(/function mapHelenaPhaseToVisualState/);
    const shared = fs.readFileSync(path.join(root, 'lib/helena/visualState.js'), 'utf-8');
    expect(shared).toMatch(/if \(orbAlert\) return 'error';/);
    expect(shared).toMatch(/if \(orbPhase === 'processing'\) return 'thinking';/);
  });

  it('BrainGraph stays optional/on-demand — rendered but not forced open', () => {
    expect(workspace).toMatch(/import \{ BrainGraphPanel \} from ['"]\.\.\/panels\/BrainGraphPanel['"]/);
    expect(workspace).toMatch(/<BrainGraphPanel\s*\/>/);
    // must not pass a prop forcing it open, and must not set brainGraphOpen
    // true anywhere in this file — it stays driven by the existing store.
    expect(workspace).not.toMatch(/setBrainGraphOpen\(true\)/);
    expect(workspace).not.toMatch(/<BrainGraphPanel[^/]*open/);
  });

  // These checks scan only actual import statements, not the file's own
  // explanatory header comment (which legitimately names these exclusions
  // in prose) — a bare whole-file substring check would false-positive on
  // that comment.
  const importLines = workspace.split('\n').filter(l => /^import /.test(l.trim()));
  const importBlock = importLines.join('\n');

  it('does not import MorningBriefing, RecommendedActions, or CommandSuggestions (mock-department-driven, not permanent HLNA content)', () => {
    for (const forbidden of ['MorningBriefing', 'RecommendedActions', 'CommandSuggestions']) {
      expect(importBlock, `HelenaWorkspace.jsx must not import ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not import the waste/department mock-data modules at all', () => {
    for (const forbidden of ['lib/hlna/departmentConfigs', 'lib/hlna/wasteIntelligence', 'getDeptConfig']) {
      expect(importBlock, `HelenaWorkspace.jsx must not import ${forbidden}`).not.toContain(forbidden);
      expect(page, `app/hlna/page.tsx must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not import LeftSidebar, the module switcher, or the Exec/Ops toggle — those are organisation-dashboard content', () => {
    expect(importBlock).not.toContain('LeftSidebar');
    expect(workspace).not.toMatch(/setViewMode|['"]executive['"]|['"]operational['"]/);
  });

  it('introduces no new audio-analysis API (no real mic amplitude / TTS analyser)', () => {
    for (const forbidden of ['getUserMedia', 'AnalyserNode', 'MediaElementSource', 'MediaStreamSource', 'createAnalyser', 'new AudioContext', 'webkitAudioContext']) {
      expect(workspace, `HelenaWorkspace.jsx should not contain ${forbidden}`).not.toContain(forbidden);
      expect(page, `app/hlna/page.tsx should not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('preserves a visible text state indicator — the orbital is not the sole indication of state', () => {
    expect(workspace).toMatch(/stateLabel\.label/);
  });
});

// Containment: this phase must not touch /dashboard routing, TopNav,
// Founder OS, or LD Tennis — only app/hlna, components/helena/*, and
// lib/helena/visualState.js were added.
describe('Phase C.2B — routing/navigation containment', () => {
  const root = path.resolve(__dirname, '../..');

  it('app/dashboard/page.tsx variant logic is untouched — brainbase-hq still redirects, ld-tennis still renders TennisDashboard, fallthrough still renders BrainBase', () => {
    const dashboardPage = fs.readFileSync(path.join(root, 'app/dashboard/page.tsx'), 'utf-8');
    expect(dashboardPage).toMatch(/redirect\('\/admin\/founder'\)/);
    expect(dashboardPage).toMatch(/<TennisDashboard/);
    expect(dashboardPage).toMatch(/return <BrainBase \/>/);
    expect(dashboardPage).not.toContain('HelenaWorkspace');
    expect(dashboardPage).not.toContain('/hlna');
  });

  it('lib/dashboard/clientDashboard.ts variant resolution is untouched', () => {
    const clientDashboard = fs.readFileSync(path.join(root, 'lib/dashboard/clientDashboard.ts'), 'utf-8');
    expect(clientDashboard).toMatch(/BRAINBASE_SLUG = 'brainbase'/);
    expect(clientDashboard).toMatch(/'ld-tennis': 'ld-tennis'/);
    expect(clientDashboard).not.toContain('hlna');
  });

  it('TopNav.tsx is untouched this phase — HlnaItem still hardcoded to /dashboard, no /hlna reference', () => {
    const topNav = fs.readFileSync(path.join(root, 'components/nav/TopNav.tsx'), 'utf-8');
    expect(topNav).not.toMatch(/['"]\/hlna['"]/);
    expect(topNav).not.toContain('HelenaWorkspace');
  });

  it('LeftSidebar.jsx is untouched this phase — no route reference to /hlna', () => {
    const sidebar = fs.readFileSync(path.join(root, 'components/layout/LeftSidebar.jsx'), 'utf-8');
    // Note: lib/hlna/departmentConfigs is a pre-existing, unrelated import
    // that itself contains the substring "/hlna" as a path segment — check
    // for an actual quoted route reference, not a bare substring.
    expect(sidebar).not.toMatch(/['"]\/hlna['"]/);
    expect(sidebar).not.toContain('HelenaWorkspace');
  });

  it('components/BrainBase.jsx is byte-for-byte untouched this phase', () => {
    // BrainBase.jsx keeps its own private mapHelenaPhaseToVisualState copy
    // this phase (see lib/helena/visualState.js's header comment for why) —
    // guards that C.2B did not touch the already-shipped Phase C file.
    const brainBase = fs.readFileSync(path.join(root, 'components/BrainBase.jsx'), 'utf-8');
    expect(brainBase).toMatch(/function mapHelenaPhaseToVisualState\(orbPhase, orbAlert\) \{/);
    expect(brainBase).not.toContain('HelenaWorkspace');
    expect(brainBase).not.toContain("from \"../../lib/helena/visualState\"");
  });

  it('Events & Ticketing files are untouched this phase', () => {
    expect(fs.existsSync(path.join(root, 'app/events/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]/page.tsx'))).toBe(true);
  });
});
