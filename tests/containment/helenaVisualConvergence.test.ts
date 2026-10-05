import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Authenticated visual-completion pass — P3 Helena / HLNA convergence.
//
// Guards the live Helena chain (the /hlna workspace, the docked/floating
// conversation panel, both voice controls, the assistant state visuals, the
// HLNA hero/wordmark, the shared state-label table, and the /dashboard
// no-session fallback shell that also renders Helena) against drifting back
// to the old dark-only, violet, glow-heavy treatment: white-alpha neutrals,
// near-black slabs, legacy violet literals, backdrop blur, decorative
// gradients / glow shadows, outline suppression and legacy font stacks.
// Source-text checks with comments stripped first.
//
// Narrow allow-lists (documented state/data palettes only):
//   - HelenaOrbital.tsx / HlnaOrb.jsx keep ONE state-tinted radial glow layer
//     and small drop-shadow sphere halos — they are functional state visuals
//     (B in the A/B/C classification) — but every colour is a token.
//   - BrainBase.jsx's MODULE_COLORS block is a per-module category encoding
//     used for small dots only (label text is --text-primary).

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export const HELENA_CHAIN = {
  workspace: 'components/helena/HelenaWorkspace.jsx',
  mic: 'components/helena/HelenaMic.jsx',
  chat: 'components/chat/ChatPanel.jsx',
  micButton: 'components/voice/MicButton.jsx',
  orbital: 'components/brand/HelenaOrbital.tsx',
  orb: 'components/brand/HlnaOrb.jsx',
  hero: 'components/brand/CommandCentreHero.jsx',
  wordmark: 'components/brand/HlnaWordmark.jsx',
  visualState: 'lib/helena/visualState.js',
  brainBase: 'components/BrainBase.jsx',
  sidebar: 'components/layout/LeftSidebar.jsx',
  workspaceCss: 'components/helena/HelenaWorkspace.module.css',
  chatCss: 'components/helena/HelenaChat.module.css',
  voiceCss: 'components/helena/HelenaVoice.module.css',
} as const;

const STATE_VISUALS = new Set<string>([HELENA_CHAIN.orbital, HELENA_CHAIN.orb]);

function code(file: string): string {
  let src = stripComments(read(file));
  if (file === HELENA_CHAIN.brainBase) {
    // Allow-listed category encoding (dots only).
    src = src.replace(/const MODULE_COLORS = \{[\s\S]*?\n\};/, '');
  }
  return src;
}

const WHITE_ALPHA = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/;
const OLD_VIOLET =
  /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1|DDD6FE|B4A0E8)\b|rgba\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|109\s*,\s*40\s*,\s*217|180\s*,\s*130\s*,\s*255|196\s*,\s*181\s*,\s*253)\b/i;
const DARK_SLAB_HEX = /#0[0-9A-Fa-f]0[0-9A-Fa-f]{3}\b|#0[0-9A-Fa-f]{2}0[0-9A-Fa-f]{2}\b/;
const DARK_SLAB_RGBA = /rgba\(\s*[0-2]?[0-9]\s*,\s*[0-2]?[0-9]\s*,\s*[0-2]?[0-9]\s*,/;
const DARK_SCHEME = /colorScheme:\s*['"]dark|color-scheme:\s*dark/;
const OUTLINE_NONE = /outline:\s*['"]?(none|0)\b/;
const BACKDROP = /backdropFilter|backdrop-filter/;
const GRADIENT = /(linear|radial|conic)-gradient\(/;
const GLOW_SHADOW = /(boxShadow|box-shadow)\s*:\s*[^;\n]*\b0 0 [1-9]\d*(\.\d+)?px/;
const DROP_SHADOW = /drop-shadow\(/;
const LEGACY_FONT = /--font-inter|-apple-system|BlinkMacSystemFont|["']Segoe UI["']|fontFamily:\s*["']monospace["']|\bconst FONT = /;
const HEX_COLOUR = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f-])/;

describe('P3 Helena chain — no dark-only / violet / glow chrome', () => {
  for (const file of Object.values(HELENA_CHAIN)) {
    it(`${file} has no white-alpha neutrals, legacy violet, dark slabs or forced dark scheme`, () => {
      const src = code(file);
      expect(src).not.toMatch(WHITE_ALPHA);
      expect(src).not.toMatch(OLD_VIOLET);
      expect(src).not.toMatch(DARK_SLAB_HEX);
      expect(src).not.toMatch(DARK_SLAB_RGBA);
      expect(src).not.toMatch(DARK_SCHEME);
    });

    it(`${file} has no outline suppression, backdrop blur or legacy font stacks`, () => {
      const src = code(file);
      expect(src).not.toMatch(OUTLINE_NONE);
      expect(src).not.toMatch(BACKDROP);
      expect(src).not.toMatch(LEGACY_FONT);
    });

    it(`${file} has no raw hex colours outside allow-listed encodings`, () => {
      expect(code(file)).not.toMatch(HEX_COLOUR);
    });

    if (!STATE_VISUALS.has(file)) {
      it(`${file} has no decorative gradients, glow shadows or drop-shadow halos`, () => {
        const src = code(file);
        expect(src).not.toMatch(GRADIENT);
        expect(src).not.toMatch(GLOW_SHADOW);
        expect(src).not.toMatch(DROP_SHADOW);
      });
    }
  }
});

describe('P3 Helena chain — the state visuals keep their state, lose the neon', () => {
  it('HelenaOrbital: every palette colour is a theme token, one state-tint glow layer, no rgba literals', () => {
    const src = code(HELENA_CHAIN.orbital);
    expect(src).not.toMatch(/rgba\(/);
    expect(src).toContain("const PURPLE = 'var(--hlo-outer)';");
    expect(src).toContain("const CYAN = 'var(--hlo-inner)';");
    expect(src).toContain("const AMBER = 'var(--hlo-warn)';");
    expect(src).toMatch(/--hlo-outer: var\(--brand-brainbase-accent\);/);
    expect(src).toMatch(/--hlo-inner: var\(--status-info\);/);
    expect(src).toMatch(/--hlo-warn: var\(--status-warning\);/);
    // exactly one radial gradient: the state-tinted ambient glow layer
    expect(src.match(/radial-gradient\(/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/linear-gradient\(/);
    // state tables still cover every state, reduced motion still honoured
    for (const state of ['idle', 'listening', 'thinking', 'speaking', 'error']) {
      const glow = src.slice(src.indexOf('const GLOW_BY_STATE'), src.indexOf('};', src.indexOf('const GLOW_BY_STATE')));
      expect(glow).toMatch(new RegExp(`\\b${state}: \\{ color: 'color-mix\\(in srgb, var\\(--hlo-`));
    }
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('HelenaOrbital glow stays restrained (every state opacity <= 0.6)', () => {
    const src = code(HELENA_CHAIN.orbital);
    const block = src.slice(src.indexOf('const GLOW_BY_STATE'), src.indexOf('};', src.indexOf('const GLOW_BY_STATE')));
    const opacities = [...block.matchAll(/opacity: ([\d.]+)/g)].map(m => Number(m[1]));
    expect(opacities).toHaveLength(5);
    for (const o of opacities) expect(o).toBeLessThanOrEqual(0.6);
  });

  // Decision (authenticated visual-completion pass): keep a VERY faint,
  // theme-aware ambient glow behind the functional orbital — restrained
  // atmospheric depth, never a dominating vignette, neon or heavy bloom.
  it('HelenaOrbital ambient glow is faint, bounded, theme-aware and never the only state signal', () => {
    const src = code(HELENA_CHAIN.orbital);
    const block = src.slice(src.indexOf('const GLOW_BY_STATE'), src.indexOf('};', src.indexOf('const GLOW_BY_STATE')));
    const tints = [...block.matchAll(/var\(--hlo-[a-z]+\) (\d+)%, transparent/g)].map(m => Number(m[1]));
    expect(tints).toHaveLength(5);
    for (const t of tints) expect(t).toBeLessThanOrEqual(30);
    // Extent and blur scale with the orbital and stay small.
    expect(src).toContain('const glowExt = Math.round(size * 0.25);');
    expect(src).toContain('const blurPx = Math.max(4, Math.round(size * 0.1));');
    expect(src).toContain('background: `radial-gradient(circle at 50% 50%, ${glow.color} 0%, transparent 70%)`');
    // Glow motion stops under reduced motion.
    const rm = src.slice(src.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['.hlo-glow-spike-active', '.hlo-listen-glow-pulse-active']) expect(rm).toContain(cls);
    // State is always also written as text on /hlna (aria-live label).
    const ws = code(HELENA_CHAIN.workspace);
    expect(ws).toMatch(/<div className=\{styles\.stateLabel\}[^>]*aria-live="polite">\s*\{stateLabel\.label\}/);
  });

  it('HlnaOrb: token colours, flat satellites, one radial glow layer, loops disabled under reduced motion; props API unchanged', () => {
    const src = code(HELENA_CHAIN.orb);
    expect(src).not.toMatch(/rgba\(/);
    expect(src).not.toMatch(/\bwhite\b/);
    expect(src.match(/radial-gradient\(/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hlna-orb-motion \{ animation: none !important; \}/);
    expect(src).toContain("export function HlnaOrb({ size = 80, state = 'idle', speechRef = null, style = {} })");
    for (const state of ['idle', 'listening', 'thinking', 'responding', 'alert']) {
      expect(src).toMatch(new RegExp(`\\n  ${state}: \\{`));
    }
    expect(src).toContain("'/hlna-orb-only.webp'");
  });

  it('the shared state-label table uses AA status tokens (labels and mapping untouched)', () => {
    const src = code(HELENA_CHAIN.visualState);
    expect(src).toContain("idle:      { label: 'Ready',         color: 'var(--text-secondary)' }");
    expect(src).toContain("listening: { label: 'Listening…',    color: 'var(--status-info)' }");
    expect(src).toContain("thinking:  { label: 'Thinking…',     color: 'var(--status-warning)' }");
    expect(src).toContain("speaking:  { label: 'Speaking…',     color: 'var(--brand-brainbase-accent)' }");
    expect(src).toContain("error:     { label: 'Needs attention', color: 'var(--status-danger)' }");
  });

  it('voice and chat animations are switched off under prefers-reduced-motion', () => {
    for (const css of [HELENA_CHAIN.voiceCss, HELENA_CHAIN.chatCss]) {
      const src = code(css);
      const block = src.slice(src.indexOf('@media (prefers-reduced-motion: reduce)'));
      expect(block.length, css).toBeGreaterThan(30);
      expect(block, css).toMatch(/animation: none/);
    }
  });
});

describe('P3 Helena chain — surfaces, composer and identity', () => {
  it('/hlna page sits on --bg-base with a --bg-surface header and no decorative atmosphere', () => {
    const css = code(HELENA_CHAIN.workspaceCss);
    expect(css).toMatch(/\.page \{[^}]*background: var\(--bg-base\);/);
    expect(css).toMatch(/\.header \{[^}]*background: var\(--bg-surface\);[^}]*/);
    expect(css).toMatch(/\.header \{[^}]*border-bottom: 1px solid var\(--border\);/);
    const ws = code(HELENA_CHAIN.workspace);
    expect(ws).not.toMatch(/Vignette|Ambient glow/);
    expect(ws).toContain("{...buttonProps('secondary', 'sm')}");
  });

  it('ChatPanel: token panels (floating = --bg-overlay + --shadow-popover), a labelled composer and a primary Send', () => {
    const src = code(HELENA_CHAIN.chat);
    expect(src).toContain('background: "var(--bg-surface)"');
    expect(src).toContain('background: "var(--bg-overlay)"');
    expect(src).toContain('boxShadow: "var(--shadow-popover)"');
    expect(src).toMatch(/<label htmlFor=\{inputId\} className=\{styles\.srOnly\}>Message HLNA<\/label>/);
    expect(src).toMatch(/<input\s+id=\{inputId\}/);
    const submitAt = src.indexOf('onClick={submit}');
    expect(submitAt).toBeGreaterThan(-1);
    const send = src.slice(submitAt, src.indexOf('Send', submitAt));
    expect(send).toContain("{...buttonProps('primary', 'sm')}");
    expect(src).toContain('aria-label="Close chat"');
    const css = code(HELENA_CHAIN.chatCss);
    expect(css).toMatch(/font-family: var\(--bb-font-sans\)/);
    expect(css).toMatch(/\.input:focus \{\s*border-color: var\(--border-focus\);/);
  });

  it('the idle HLNA hero uses the approved broken-orbit identity mark, not the stateful orb', () => {
    const src = code(HELENA_CHAIN.hero);
    expect(src).toContain("import { BrokenOrbitMark } from './BrokenOrbitMark';");
    expect(src).toContain('<BrokenOrbitMark size={72} context="hlna" />');
    expect(src).not.toContain('HlnaOrb');
  });

  it('the /dashboard fallback shell keeps its Helena wiring while its chrome is tokenised', () => {
    const src = read(HELENA_CHAIN.brainBase);
    expect(src).toContain('const USE_HELENA_ORBITAL = true;');
    expect(src).toMatch(/if \(orbPhase === 'processing'\) return 'thinking';/);
    expect(src).toContain('background: "var(--bg-base)"');
    expect(code(HELENA_CHAIN.brainBase)).toMatch(/MicButton helena=\{helena\}/);
  });
});

// Decision (authenticated visual-completion pass): inside authenticated
// Brainbase/Helena UI the HLNΛ wordmark's Λ is Brainbase purple, not the HLNA
// Labs orange (which stays available as --brand-hlna-accent for its own
// parent-brand/public contexts).
describe('HLNΛ wordmark identity', () => {
  it('colours the Λ with the Brainbase product accent', () => {
    const src = code(HELENA_CHAIN.wordmark);
    expect(src).toContain("<span style={{ color: 'var(--brand-brainbase-accent)' }}>Λ</span>");
    expect(src).not.toContain('--brand-hlna-accent');
  });
});
