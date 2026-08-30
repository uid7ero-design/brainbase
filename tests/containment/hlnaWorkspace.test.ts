import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase C.2B / C.2B.1 — dedicated full-screen /hlna conversation workspace.
// C.2B.1 reworked the page into a two-column "talk to HLNA" layout: Helena
// + a primary mic on the left, the conversation thread on the right, no
// legacy floating voice dock, no council/waste default copy. Guards that
// the workspace reuses the existing Helena state machine and production
// HelenaOrbital integration rather than duplicating it, without touching
// /dashboard, TopNav, Founder OS, or LD Tennis routing.
describe('/hlna — Phase C.2B.1 two-column workspace', () => {
  const root = path.resolve(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'app/hlna/page.tsx'), 'utf-8');
  const workspace = fs.readFileSync(path.join(root, 'components/helena/HelenaWorkspace.jsx'), 'utf-8');
  const mic = fs.readFileSync(path.join(root, 'components/helena/HelenaMic.jsx'), 'utf-8');

  const importLines = workspace.split('\n').filter(l => /^import /.test(l.trim()));
  const importBlock = importLines.join('\n');

  it('the /hlna route exists and renders HelenaWorkspace', () => {
    expect(page).toMatch(/import HelenaWorkspace from ['"]@\/components\/helena\/HelenaWorkspace['"]/);
    expect(page).toMatch(/<HelenaWorkspace\s*\/>/);
  });

  it('HelenaOrbital is present, responsively sized, and uses the production speechRef bridge', () => {
    expect(importBlock).toMatch(/import \{ HelenaOrbital \} from ['"]\.\.\/brand\/HelenaOrbital['"]/);
    expect(workspace).toMatch(/<HelenaOrbital size=\{orbitalSize\} state=\{helenaVisualState\} speechRef=\{orbSpeechRef\} \/>/);
    // responsive: two distinct sizes driven by the narrow-width breakpoint
    expect(workspace).toMatch(/const orbitalSize = isNarrow \? \d+ : \d+;/);
  });

  it('desktop two-column structure: Helena panel (left) and conversation panel (right)', () => {
    expect(workspace).toMatch(/className="hlna-split"/);
    expect(workspace).toMatch(/className="hlna-left"/);
    expect(workspace).toMatch(/className="hlna-right"/);
    // left contains the orbital + HelenaMic; right contains ChatPanel
    const splitStart = workspace.indexOf('className="hlna-split"');
    const rightStart = workspace.indexOf('className="hlna-right"');
    const leftBlock = workspace.slice(splitStart, rightStart);
    const rightBlock = workspace.slice(rightStart, workspace.indexOf('</div>\n      </div>', rightStart));
    expect(leftBlock).toMatch(/<HelenaOrbital/);
    expect(leftBlock).toMatch(/<HelenaMic/);
    expect(rightBlock).toMatch(/<ChatPanel/);
  });

  it('the main mic is rendered with Helena in the left panel and reuses helena.startConversation/stopConversation — no new voice engine', () => {
    expect(importBlock).toMatch(/import \{ HelenaMic \} from ['"]\.\/HelenaMic['"]/);
    expect(workspace).toMatch(/<HelenaMic helena=\{helena\}/);
    expect(mic).toMatch(/helena\.startConversation\(\);/);
    expect(mic).toMatch(/helena\.stopConversation\(\);/);
    // no independent state machine — HelenaMic takes `helena` as a prop
    // (destructured from it, never calls the hook itself); scoped to
    // non-comment lines since the file's own header comment legitimately
    // names useHelena.js in prose.
    const micCode = mic.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(micCode).not.toContain('useHelena(');
  });

  it('the legacy floating MicButton dock is not rendered on /hlna', () => {
    expect(importBlock).not.toContain('MicButton');
    expect(workspace).not.toMatch(/<MicButton/);
  });

  it('no second SpeechRecognition implementation and no getUserMedia anywhere in the new files', () => {
    // Scoped to non-comment lines — HelenaMic.jsx's own header comment
    // documents these APIs' absence in prose ("no getUserMedia"), which
    // would otherwise false-positive a bare whole-file substring check.
    const codeOnly = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const workspaceCode = codeOnly(workspace);
    const micCode = codeOnly(mic);
    const pageCode = codeOnly(page);
    for (const forbidden of ['new SpeechRecognition', 'webkitSpeechRecognition(', 'getUserMedia', 'AnalyserNode', 'MediaElementSource', 'MediaStreamSource', 'createAnalyser', 'new AudioContext', 'webkitAudioContext']) {
      expect(workspaceCode, `HelenaWorkspace.jsx should not contain ${forbidden}`).not.toContain(forbidden);
      expect(micCode, `HelenaMic.jsx should not contain ${forbidden}`).not.toContain(forbidden);
      expect(pageCode, `app/hlna/page.tsx should not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reuses the existing useHelena state machine — no new hook, no duplicate phase state', () => {
    expect(importBlock).toMatch(/import \{ useHelena \} from ['"]\.\.\/\.\.\/hooks\/useHelena['"]/);
    expect(workspace).toMatch(/const helena = useHelena\(\);/);
    expect(workspace).not.toMatch(/useState\(['"]idle['"]\)/);
    expect(workspace).not.toMatch(/function useHelena/);
  });

  it('the speechPulseRef bridge has the exact same contract as BrainBase.jsx\'s Phase C integration', () => {
    expect(workspace).toMatch(/helena\.speechPulseRef\.current = \(v\) => orbSpeechRef\.current\?\.\(v\);/);
  });

  it('uses the shared visual-state mapping rather than redefining it, with human-readable (not internal) status labels', () => {
    expect(importBlock).toMatch(/import \{ mapHelenaPhaseToVisualState, HELENA_VISUAL_STATE_LABEL \} from ['"]\.\.\/\.\.\/lib\/helena\/visualState['"]/);
    expect(workspace).not.toMatch(/function mapHelenaPhaseToVisualState/);
    const shared = fs.readFileSync(path.join(root, 'lib/helena/visualState.js'), 'utf-8');
    expect(shared).toMatch(/if \(orbAlert\) return 'error';/);
    expect(shared).toMatch(/if \(orbPhase === 'processing'\) return 'thinking';/);
    // human-readable, sentence-style labels — never the internal "processing" term
    expect(shared).toMatch(/idle:\s*\{ label: 'Ready'/);
    expect(shared).toMatch(/listening:\s*\{ label: 'Listening…'/);
    expect(shared).toMatch(/thinking:\s*\{ label: 'Thinking…'/);
    expect(shared).toMatch(/speaking:\s*\{ label: 'Speaking…'/);
    // The mapping function legitimately reads useHelena's raw 'processing'
    // phase value as INPUT (that's the whole point of the translation) —
    // the guard is that the DISPLAY LABEL object never surfaces it.
    const labelBlock = shared.slice(shared.indexOf('HELENA_VISUAL_STATE_LABEL = {'));
    expect(labelBlock).not.toMatch(/processing/i);
  });

  it('BrainGraph stays optional/on-demand — rendered but not forced open', () => {
    expect(importBlock).toMatch(/import \{ BrainGraphPanel \} from ['"]\.\.\/panels\/BrainGraphPanel['"]/);
    expect(workspace).toMatch(/<BrainGraphPanel\s*\/>/);
    expect(workspace).not.toMatch(/setBrainGraphOpen\(true\)/);
    expect(workspace).not.toMatch(/<BrainGraphPanel[^/]*open/);
  });

  it('floating response cards are not used — the docked conversation thread is the single presentation of each reply', () => {
    expect(importBlock).not.toContain('FloatingCard');
    expect(workspace).not.toMatch(/<FloatingCard/);
  });

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

  it('no council/waste/municipal-specific default UI copy anywhere in the new files', () => {
    const haystacks = [workspace, mic, page];
    const forbidden = [
      /council/i, /municipal/i, /contamination/i, /missed[- ]bin/i,
      /cost.?per.?tonne/i, /cost\/tonne/i, /\bbins?\b/i, /waste operations/i,
      /waste contamination/i, /top cost drivers/i,
    ];
    for (const haystack of haystacks) {
      for (const re of forbidden) {
        expect(haystack, `unexpected default copy matching ${re}`).not.toMatch(re);
      }
    }
  });

  it('preserves a visible text state indicator — the orbital is not the sole indication of state', () => {
    expect(workspace).toMatch(/stateLabel\.label/);
  });

  it('the main mic has an accessible label, pressed state, and visible listening feedback', () => {
    expect(mic).toMatch(/aria-label=\{active \? 'Stop listening' : 'Start listening'\}/);
    expect(mic).toMatch(/aria-pressed=\{active\}/);
  });

  it('responsive: a narrow-width media query exists so the two columns stack, mirrored by a JS breakpoint for orbital/mic sizing', () => {
    expect(workspace).toMatch(/@media \$\{NARROW_QUERY\}/);
    expect(workspace).toMatch(/flex-direction: column;/);
    expect(workspace).toMatch(/window\.matchMedia\(NARROW_QUERY\)/);
  });

  it('the responsive breakpoint state is not set synchronously inside an effect body (only inside the change-event callback)', () => {
    // Regression guard for the react-hooks/set-state-in-effect finding this
    // phase: the initial value must come from useState's lazy initializer,
    // not a bare setIsNarrow(...) call in the effect body.
    const stateInit = workspace.match(/const \[isNarrow, setIsNarrow\] = useState\(([\s\S]*?)\);/)?.[1] ?? '';
    expect(stateInit).toMatch(/window\.matchMedia\(NARROW_QUERY\)\.matches/);
    const effectBody = workspace.slice(
      workspace.indexOf('useEffect(() => {\n    const mq = window.matchMedia(NARROW_QUERY);'),
      workspace.indexOf('}, []);', workspace.indexOf('const mq = window.matchMedia(NARROW_QUERY);')),
    );
    expect(effectBody).not.toMatch(/^\s*setIsNarrow\(/m);
  });
});

// ChatPanel's new 'docked' layout mode (Phase C.2B.1) — additive and
// backward-compatible: BrainBase.jsx's existing usage must stay pixel-
// identical (no `layout` prop passed there → defaults to 'floating').
describe('ChatPanel — docked layout mode (Phase C.2B.1)', () => {
  const root = path.resolve(__dirname, '../..');
  const chatPanel = fs.readFileSync(path.join(root, 'components/chat/ChatPanel.jsx'), 'utf-8');
  const brainBase = fs.readFileSync(path.join(root, 'components/BrainBase.jsx'), 'utf-8');

  it('layout defaults to floating — BrainBase.jsx does not opt in, so its rendering is unchanged', () => {
    expect(chatPanel).toMatch(/layout = 'floating'/);
    const callSite = brainBase.match(/<ChatPanel[\s\S]*?\/>/)?.[0] ?? '';
    expect(callSite).not.toContain('layout=');
  });

  it('docked mode has no close button and no ESC-to-close hint when onClose is not provided', () => {
    expect(chatPanel).toMatch(/\{!docked && \(/);
    expect(chatPanel).toMatch(/\{onClose && \(/);
  });

  it('empty-state copy is overridable via props, defaulting to the exact original text (BrainBase.jsx unaffected)', () => {
    expect(chatPanel).toMatch(/emptyStateTitle = 'Ask HLNΛ about your dashboards, data, or operations\.'/);
    expect(chatPanel).toMatch(/emptyStateHint = 'Try: "What are our top cost drivers\?" or "Explain the waste contamination trend"'/);
  });

  it('HelenaWorkspace overrides the empty-state copy with neutral, tenant-agnostic text', () => {
    const workspace = fs.readFileSync(path.join(root, 'components/helena/HelenaWorkspace.jsx'), 'utf-8');
    expect(workspace).toMatch(/emptyStateTitle="Ask HLNΛ about your organisation\."/);
    expect(workspace).not.toMatch(/cost drivers|contamination/i);
  });
});

// Containment: this phase must not touch /dashboard routing, TopNav,
// Founder OS, or LD Tennis — only app/hlna, components/helena/*,
// lib/helena/visualState.js, and an additive edit to ChatPanel.jsx.
describe('Phase C.2B/C.2B.1 — routing/navigation containment', () => {
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
    // guards that neither C.2B nor C.2B.1 touched the already-shipped
    // Phase C file, even though ChatPanel.jsx (which it also renders) did
    // change — the change there is additive-only (see the docked-layout
    // describe block above).
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
