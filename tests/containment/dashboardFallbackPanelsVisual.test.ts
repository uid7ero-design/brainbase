import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Remaining visual islands pass — Phase 6A/6B guard.
//
// Live consumers (verified by import graph): components/panels/{Activity,
// Contacts,Inbox,Integrations,Memory,News}Panel.jsx and components/hlna/
// {MorningBriefing,CommandSuggestions,RecommendedActions}.tsx render only in
// components/BrainBase.jsx (the /dashboard no-session fallback);
// components/panels/BrainGraphPanel.jsx also renders on /hlna
// (HelenaWorkspace "Performance") and, as InlineBrainGraph, in
// components/layout/LeftSidebar.jsx. These were dark-only islands: glass +
// backdrop blur, white-alpha neutrals, neon glow dots, old violet chrome,
// gradients, local Inter stacks, clickable <div>s and unlabelled overlays.
//
// Allowed, narrowly: the Spotify brand mark fill (#1DB954, once), the
// BrainGraphPanel canvas WELL fill (#06070b — the THREE visualisation uses
// additive blending and needs a theme-invariant dark well; see the CSS
// header note), the per-type PANEL_SECTIONS dot colour (data, from lib) and
// the BrainGraphPanel link-strength dot ramp (data). The THREE engine
// (buildScene) is excluded from the colour checks and pinned byte-for-byte
// instead (only its CSS2D label style line may differ).

const root = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')

function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const P = 'components/panels/'
const H = 'components/hlna/'
const JSX = [
  `${P}ActivityPanel.jsx`, `${P}ContactsPanel.jsx`, `${P}InboxPanel.jsx`, `${P}IntegrationsPanel.jsx`,
  `${P}MemoryPanel.jsx`, `${P}NewsPanel.jsx`, `${P}BrainGraphPanel.jsx`, `${P}useOverlayFocus.js`,
  `${H}MorningBriefing.tsx`, `${H}CommandSuggestions.tsx`, `${H}RecommendedActions.tsx`,
]
const CSS = [
  `${P}PanelOverlay.module.css`, `${P}ActivityPanel.module.css`, `${P}ContactsPanel.module.css`,
  `${P}InboxPanel.module.css`, `${P}IntegrationsPanel.module.css`, `${P}MemoryPanel.module.css`,
  `${P}NewsPanel.module.css`, `${P}BrainGraphPanel.module.css`,
  `${H}MorningBriefing.module.css`, `${H}CommandSuggestions.module.css`, `${H}RecommendedActions.module.css`,
]
const FILES = [...JSX, ...CSS]

const GRAPH = `${P}BrainGraphPanel.jsx`
const ENGINE_START = 'function buildScene('
const ENGINE_END = '// ── Inline variant'
const STRENGTH_RAMP = /`rgba\(\$\{Math\.round\(140 \+ nb\.strength \* 60\)\},\$\{Math\.round\(60 \+ nb\.strength \* 40\)\},255,0\.[78]\)`/g
const SPOTIFY = 'fill="#1DB954"'
const WELL = 'background: #06070b;'

/** Comment-free source with the documented encodings removed. */
function surface(rel: string): string {
  let src = stripComments(read(rel))
  if (rel === GRAPH) {
    const a = src.indexOf(ENGINE_START)
    const b = src.indexOf('export function InlineBrainGraph')
    src = src.slice(0, a) + src.slice(b)
    src = src.replace(STRENGTH_RAMP, '')
  }
  if (rel.endsWith('IntegrationsPanel.jsx')) src = src.replace(SPOTIFY, '')
  if (rel.endsWith('BrainGraphPanel.module.css')) src = src.split(WELL).join('')
  return src
}

const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|168\s*,\s*85\s*,\s*247|180\s*,\s*130\s*,\s*255)/i
const WHITE_ALPHA = /rgba?\(\s*255\s*,\s*255\s*,\s*255/i
const ANY_RGBA = /rgba?\(/i
const ANY_HEX = /#[0-9a-f]{3,8}\b/i
const DARK_SLABS = /#(07080B|08090C|0a0a0f|0e1014|13131a|1a1d24|020408|05070A)\b|rgba\(\s*(2|6|7|8|12)\s*,\s*(4|5|8|9|11|16)\s*,/i

describe('dashboard fallback panels — documented encodings are pinned', () => {
  it('the Spotify brand fill appears exactly once', () => {
    expect(stripComments(read(`${P}IntegrationsPanel.jsx`)).split(SPOTIFY)).toHaveLength(2)
  })
  it('the dark canvas well fill appears exactly twice (full panel + inline widget)', () => {
    expect(stripComments(read(`${P}BrainGraphPanel.module.css`)).split(WELL)).toHaveLength(3)
  })
  it('the link-strength dot ramp appears exactly twice', () => {
    expect(stripComments(read(GRAPH)).match(STRENGTH_RAMP)).toHaveLength(2)
  })
})

describe('dashboard fallback panels — no dark-only chrome', () => {
  for (const rel of FILES) {
    it(`${rel}: no hex or rgba colour literal outside the documented encodings`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(ANY_HEX)
      expect(src).not.toMatch(ANY_RGBA)
    })
    it(`${rel}: no old violet chrome, white-alpha neutrals or dark slabs`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(OLD_VIOLET)
      expect(src).not.toMatch(WHITE_ALPHA)
      expect(src).not.toMatch(DARK_SLABS)
    })
    it(`${rel}: no colorScheme, glass, glow, gradient or outline suppression`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(/colorScheme\s*:|color-scheme\s*:/)
      expect(src).not.toMatch(/backdropFilter|backdrop-filter|WebkitBackdropFilter|blur\(/)
      expect(src).not.toMatch(/(boxShadow|box-shadow|text-shadow|textShadow)[^;\n]*\b0 0 \d+px/)
      expect(src).not.toMatch(/gradient\(/)
      expect(src).not.toMatch(/outline\s*:\s*['"]?(none|0)\b/)
    })
    it(`${rel}: no local font stacks or Tailwind dark-only classes`, () => {
      const src = surface(rel)
      expect(src).not.toContain('var(--font-inter)')
      expect(src).not.toMatch(/fontFamily\s*:\s*['"][^'"]*(Inter|Geist|monospace)/)
      expect(src).not.toMatch(/font-family\s*:\s*[^;]*(Inter|Geist|monospace)/)
      expect(src).not.toMatch(/\bconst FONT\b|GLASS|\bCYAN\b/)
      expect(src).not.toMatch(/\b(text-white|bg-black|bg-\[#)/)
    })
  }

  it('the CSS2D node labels use the app font and a legibility halo, not a purple glow', () => {
    const src = stripComments(read(GRAPH))
    const line = src.split('\n').find(l => l.includes('div.style.cssText'))!
    expect(line).toContain('font:500 9px/1 var(--bb-font-sans),sans-serif;')
    expect(line).toContain('text-shadow:0 1px 2px rgba(0,0,0,.85);')
    expect(line).not.toMatch(/Inter|0 0 8px/)
  })

  it('selected / pressed states use border + background, never outline or box-shadow', () => {
    const checks: Array<[string, string]> = [
      [`${P}PanelOverlay.module.css`, ".listRow[aria-current='true']"],
      [`${P}InboxPanel.module.css`, ".toggle[aria-pressed='true']"],
      [`${P}MemoryPanel.module.css`, ".tab[aria-selected='true']"],
      [`${P}NewsPanel.module.css`, ".filter[aria-pressed='true']"],
      [`${H}CommandSuggestions.module.css`, ".chip[data-active='true']"],
      [`${H}RecommendedActions.module.css`, ".card[data-selected='true']"],
    ]
    for (const [rel, sel] of checks) {
      const css = stripComments(read(rel))
      const i = css.indexOf(sel + ' {')
      expect(i, `${rel} ${sel}`).toBeGreaterThan(-1)
      const rule = css.slice(i, css.indexOf('}', i))
      expect(rule).toMatch(/border(-[a-z-]+)?-color\s*:\s*var\(--brand-brainbase-accent(-border)?\)/)
      expect(rule).not.toMatch(/outline|box-shadow/)
    }
  })

  it('kept animations are switched off under prefers-reduced-motion', () => {
    for (const rel of CSS) {
      const css = stripComments(read(rel))
      if (!/animation\s*:\s*(?!none)/.test(css)) continue
      expect(css, rel).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/)
    }
  })
})

describe('BrainGraphPanel — the THREE engine is untouched (Phase 6B)', () => {
  it('buildScene is byte-identical to the pre-pass engine (label style line excepted)', () => {
    const src = read(GRAPH)
    const region = src.slice(src.indexOf(ENGINE_START), src.indexOf(ENGINE_END))
      .split('\n').filter(l => !l.trimStart().startsWith('//') && !l.includes('div.style.cssText')).join('\n')
    expect(crypto.createHash('sha256').update(region).digest('hex'))
      .toBe('9f052958fad58da13369618051c2f323ac61d9f1b2ae986c73c0e0afcf2e0ad2')
  })

  it('scene, controls, labels, selection and data wiring are still in place', () => {
    const src = stripComments(read(GRAPH))
    for (const s of [
      "import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';",
      "import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';",
      'controls.autoRotate      = true;',
      'controls.autoRotate = idx < 0;',
      "renderer.domElement.addEventListener('click', onClick);",
      "const r    = await fetch('/api/brain/graph');",
      'const nodes = data.nodes.length > 0 ? data.nodes : DEMO_NODES;',
      'sceneRef.current = buildScene(mountRef.current, nodes, links, setSelected);',
      "const onKey = (e) => { if (e.key === 'Escape') { if (selected) setSelected(null); else setOpen(false); } };",
      'export function InlineBrainGraph()',
      'export function BrainGraphPanel()',
      'const open    = useAppStore(s => s.brainGraphOpen);',
    ]) expect(src, s).toContain(s)
    expect(src).not.toContain('HelenaOrbital')
    expect(src).not.toContain('HlnaOrb')
  })

  it('the canvas mount is the dark well; the chrome around it is themed', () => {
    const src = stripComments(read(GRAPH))
    expect(src).toContain('<div ref={mountRef} className={styles.well}>')
    expect(src).toContain('<div ref={mountRef} className={styles.mount} />')
    const css = stripComments(read(`${P}BrainGraphPanel.module.css`))
    const rule = (sel: string) => css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')))
    expect(rule('.bar')).toMatch(/background:\s*var\(--bg-surface\)/)
    for (const sel of ['.selection', '.selectionInline', '.notice', '.hint']) expect(rule(sel), sel).toMatch(/background:\s*var\(--bg-overlay\)/)
  })
})

describe('dashboard fallback panels — accessibility semantics', () => {
  const OVERLAYS = ['ContactsPanel', 'InboxPanel', 'IntegrationsPanel', 'MemoryPanel', 'NewsPanel', 'BrainGraphPanel']
  for (const name of OVERLAYS) {
    it(`${name}: dialog semantics + focus containment/return`, () => {
      const src = stripComments(read(`${P}${name}.jsx`))
      expect(src).toContain('role="dialog"')
      expect(src).toContain('aria-modal="true"')
      expect(src).toMatch(/aria-labelledby=\{/)
      expect(src).toMatch(/useOverlayFocus\((integrationsOpen|inboxOpen|contactsOpen|memoryPanelOpen|open), panelRef\)/)
    })
  }

  it('useOverlayFocus never owns Escape (each overlay keeps its existing handler)', () => {
    const src = stripComments(read(`${P}useOverlayFocus.js`))
    expect(src).not.toContain('Escape')
    expect(src).toContain("if (opener && opener.isConnected) opener.focus();")
  })

  it('no clickable <div> remains; every <button> declares its type', () => {
    for (const rel of JSX) {
      const src = stripComments(read(rel))
      expect(src, rel).not.toMatch(/<div[^>]*\bonClick=\{(?!e => \{ if \(e\.target === e\.currentTarget\))/)
      const buttons = src.match(/<button\b[^>]*>/g) ?? []
      for (const b of buttons) expect(b, `${rel}: ${b}`).toMatch(/type="button"|type=\{/)
    }
  })

  it('RecommendedActions cards are real buttons', () => {
    const src = stripComments(read(`${H}RecommendedActions.tsx`))
    expect(src).toMatch(/<button\s+type="button"\s+onClick=\{onSelect\}/)
  })
})

describe('dashboard fallback panels — preserved behaviour', () => {
  const has = (rel: string, ...needles: string[]) => {
    const src = stripComments(read(rel))
    for (const n of needles) expect(src, `${rel}: ${n}`).toContain(n)
  }

  it('Inbox keeps its Gmail endpoints, payloads and staged Escape', () => {
    has(`${P}InboxPanel.jsx`,
      "fetch('/api/integrations/gmail/status')",
      "await fetch('/api/integrations/gmail/messages')",
      'await fetch(`/api/integrations/gmail/message?id=${msg.id}`)',
      "JSON.stringify({ to: to.trim(), subject: subject.trim() || '(no subject)', body })",
      'inReplyTo: selected.id,',
      "if (view === 'compose') { setView('list'); return; }",
      "onSent={() => { setView('sent'); setTimeout(() => setView('list'), 2000); }}",
      "onClick={() => { setContactsOpen(true); }}",
    )
  })

  it('Integrations keeps connect / disconnect / Spotify probing', () => {
    has(`${P}IntegrationsPanel.jsx`,
      "await fetch('/api/integrations/gmail/login')",
      'window.location.href = url;',
      "await fetch('/api/integrations/gmail/status', { method: 'DELETE' });",
      "fetch('/api/spotify/now-playing')",
      "function onKey(e) { if (e.key === 'Escape') setIntegrationsOpen(false); }",
    )
  })

  it('Contacts keeps localStorage persistence and its staged Escape', () => {
    has(`${P}ContactsPanel.jsx`,
      "const STORAGE_KEY = 'brainbase:contacts';",
      'localStorage.setItem(STORAGE_KEY, JSON.stringify(list));',
      "function onKey(e) { if (e.key === 'Escape') { if (editing) { setEditing(null); } else if (detail) { setDetail(null); } else setContactsOpen(false); } }",
      'export function useContacts()',
      'onClick={() => deleteContact(detail.id)}',
    )
  })

  it('Memory keeps every memoryManager call', () => {
    has(`${P}MemoryPanel.jsx`,
      'memoryManager.clearAll(); refresh();', 'memoryManager.forgetLongTerm(ts);', 'memoryManager.forgetShortTerm(ts);',
      'memoryManager.clearLongTerm();', 'memoryManager.clearShortTerm();', 'memoryManager.removePreference(key);',
      'memoryManager.clearPreferences();', 'memoryManager.getRecentHistory(20)',
    )
  })

  it('News keeps useNews, the category filter and the close control', () => {
    has(`${P}NewsPanel.jsx`,
      'const { articles, loading, fetchedAt, refresh } = useNews();',
      "const filtered = tab === 'all' ? articles : articles.filter(a => a.category === tab);",
      'onClick={() => setOpen(false)}', 'onClick={refresh}',
    )
  })

  it('Activity / Briefing / Suggestions / Actions keep their Helena wiring', () => {
    has(`${P}ActivityPanel.jsx`, 'onClick={() => { fireHelena(alert.command); setChatOpen(true); }}', 'onClick={onToggle}', '<BrainWidget />')
    has(`${H}MorningBriefing.tsx`,
      "fetch('/api/hlna/briefing',    { method: 'POST' })",
      "fetch('/api/hlna/whatchanged', { method: 'POST' })",
      'function askHlna(q: string) { fireHelena(q); setChatOpen(true); }',
      'onClick={loadBriefing}',
    )
    has(`${H}CommandSuggestions.tsx`, 'fireHelena(command);', 'setTimeout(() => setActive(null), 2000);', 'const MAX_PANEL = 4;')
    has(`${H}RecommendedActions.tsx`, 'fireHelena(action.command);', 'setChatOpen(true);')
  })
})
