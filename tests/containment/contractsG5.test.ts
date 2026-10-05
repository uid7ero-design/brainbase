import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// G5 source-level contracts (companion to tests/components/app/ContractsG5.test.tsx).
// Every expected value here was derived from the BASE commit ecb5b03
// (`git show ecb5b03:<file>`), not from the working tree:
//   - the BrainGraph engine: buildScene hashed with comment-only lines and the
//     single `div.style.cssText` label-style line excluded. Expected hash was
//     computed from ecb5b03:components/panels/BrainGraphPanel.jsx;
//   - the four CSS2D label state colour lines, verbatim from base;
//   - the per-file inventory of fetch() URL literals, verbatim from base;
//   - the Escape ownership set (which files have their own Escape handler);
//   - BrainBase's own Escape handler (closes the chat only);
//   - useOverlayFocus must not handle Escape or swallow non-Tab keys.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n').replace(/^﻿/, '')
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const BRAIN = 'components/panels/BrainGraphPanel.jsx'

function buildSceneRegion(src: string) {
  const start = src.indexOf('function buildScene(')
  const end = src.indexOf('\n}\n', start) + 3
  return src.slice(start, end)
}

// sha256 of buildScene at ecb5b03 with comment-only lines and the
// `div.style.cssText` line removed (independently computed from base).
const BASE_ENGINE_HASH = 'caa570ee476699ab6c2f85ae4583eccc7b6e8590f293dbf3b1b7baba0a6fc7be'
const BASE_ENGINE_LINES = 468

describe('BrainGraph engine integrity (base ecb5b03)', () => {
  const region = buildSceneRegion(read(BRAIN))

  it('buildScene is byte-identical to base apart from the one label cssText line', () => {
    const lines = region.split('\n').filter(l => !/^\s*\/\//.test(l) && !l.includes('div.style.cssText'))
    expect(lines.length).toBe(BASE_ENGINE_LINES)
    expect(crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')).toBe(BASE_ENGINE_HASH)
  })

  it('exactly one label cssText line exists and it keeps the base colour / transition / layout parts', () => {
    const css = region.split('\n').filter(l => l.includes('div.style.cssText'))
    expect(css).toHaveLength(1)
    const line = css[0]
    for (const part of [
      'color:rgba(210,170,255,0);', 'letter-spacing:.04em;', 'transition:color .25s;',
      'pointer-events:none;', 'white-space:nowrap;', 'padding:2px 0 0 6px;', 'font:500 9px/1 ',
    ]) expect(line, part).toContain(part)
  })

  it('pins the four CSS2D label state colour lines verbatim from base', () => {
    const code = region
    for (const l of [
      "if (state === 'hidden')   div.style.color = 'rgba(210,170,255,0)';",
      "if (state === 'dim')      div.style.color = 'rgba(210,170,255,0.22)';",
      "if (state === 'bright')   div.style.color = 'rgba(210,170,255,0.78)';",
      "if (state === 'selected') div.style.color = 'rgba(220,160,255,1)';",
    ]) expect(code, l).toContain(l)
  })

  it('the renderer still clears to transparent (the dark well is CSS, not the engine)', () => {
    expect(region).toContain('new THREE.WebGLRenderer({ antialias: true, alpha: true })')
    expect(region).toContain('renderer.setClearColor(0x000000, 0)')
  })
})

describe('fetch() URL inventory per file equals base', () => {
  const BASE: Record<string, string[]> = {
    'components/panels/ActivityPanel.jsx': [],
    'components/panels/ContactsPanel.jsx': [],
    'components/panels/InboxPanel.jsx': [
      "'/api/integrations/gmail/send'", "'/api/integrations/gmail/status'", "'/api/integrations/gmail/messages'",
      '`/api/integrations/gmail/message?id=${msg.id}`', "'/api/integrations/gmail/send'",
    ],
    'components/panels/IntegrationsPanel.jsx': [
      "'/api/integrations/gmail/status'", "'/api/integrations/gmail/messages'", "'/api/integrations/gmail/login'",
      "'/api/integrations/gmail/status'", "'/api/spotify/now-playing'",
    ],
    'components/panels/MemoryPanel.jsx': [],
    'components/panels/NewsPanel.jsx': [],
    'components/panels/BrainGraphPanel.jsx': ["'/api/brain/graph'", "'/api/brain/graph'"],
    'components/hlna/MorningBriefing.tsx': ["'/api/hlna/briefing'", "'/api/hlna/whatchanged'"],
    'components/hlna/CommandSuggestions.tsx': [],
    'components/hlna/RecommendedActions.tsx': [],
  }
  for (const [file, urls] of Object.entries(BASE)) {
    it(file, () => {
      const code = strip(read(file))
      const found = [...code.matchAll(/fetch\(\s*(['"`][^'"`]*['"`])/g)].map(m => m[1])
      expect(found).toEqual(urls)
    })
  }

  it('Integrations disconnect is still the only non-GET call there: { method: \'DELETE\' }', () => {
    const code = strip(read('components/panels/IntegrationsPanel.jsx'))
    expect(code).toContain("await fetch('/api/integrations/gmail/status', { method: 'DELETE' });")
    expect(code.match(/method:/g)).toHaveLength(1)
  })

  it('MorningBriefing POSTs both endpoints with { method: \'POST\' } only', () => {
    const code = strip(read('components/hlna/MorningBriefing.tsx'))
    expect(code).toContain("fetch('/api/hlna/briefing',    { method: 'POST' })")
    expect(code).toContain("fetch('/api/hlna/whatchanged', { method: 'POST' })")
  })
})

describe('Escape ownership (base set)', () => {
  // true = the file has its own Escape handler at ecb5b03.
  const BASE_ESCAPE: Record<string, boolean> = {
    'components/panels/ActivityPanel.jsx': false,
    'components/panels/ContactsPanel.jsx': true,
    'components/panels/InboxPanel.jsx': true,
    'components/panels/IntegrationsPanel.jsx': true,
    'components/panels/MemoryPanel.jsx': true,
    'components/panels/NewsPanel.jsx': false,
    'components/panels/BrainGraphPanel.jsx': true,
  }
  for (const [file, owns] of Object.entries(BASE_ESCAPE)) {
    it(`${file} ${owns ? 'owns' : 'does not own'} Escape, as in base`, () => {
      expect(/['"]Escape['"]/.test(strip(read(file)))).toBe(owns)
    })
  }

  it('base Escape handlers are verbatim', () => {
    expect(strip(read('components/panels/ContactsPanel.jsx'))).toContain(
      "function onKey(e) { if (e.key === 'Escape') { if (editing) { setEditing(null); } else if (detail) { setDetail(null); } else setContactsOpen(false); } }")
    expect(strip(read('components/panels/InboxPanel.jsx'))).toContain(
      "if (view === 'compose') { setView('list'); return; }")
    expect(strip(read('components/panels/IntegrationsPanel.jsx'))).toContain(
      "function onKey(e) { if (e.key === 'Escape') setIntegrationsOpen(false); }")
    expect(strip(read('components/panels/MemoryPanel.jsx'))).toContain(
      "function onKey(e) { if (e.key === 'Escape') setMemoryPanelOpen(false); }")
    expect(strip(read(BRAIN))).toContain(
      "const onKey = (e) => { if (e.key === 'Escape') { if (selected) setSelected(null); else setOpen(false); } };")
  })

  it('BrainBase keeps its own Escape: closes the chat only', () => {
    const code = strip(read('components/BrainBase.jsx'))
    expect(code).toContain("if (e.key === 'Escape') { setChatOpen(false); }")
    expect(code.match(/['"]Escape['"]/g)).toHaveLength(1)
  })

  it('useOverlayFocus does not handle Escape and lets every non-Tab key through', () => {
    const code = strip(read('components/panels/useOverlayFocus.js'))
    expect(code).not.toMatch(/Escape|stopPropagation|onClose/)
    expect(code).toContain("if (e.key !== 'Tab' || !panel) return;")
    // Focus return to the opener on close, as the shared useDialogFocus.
    expect(code).toContain('if (opener && opener.isConnected) opener.focus();')
  })

  it('the shared useDialogFocus is the one that owns Escape (the overlays deliberately do not use it)', () => {
    expect(strip(read('components/ui/app/useDialogFocus.ts'))).toContain("if (e.key === 'Escape') {")
    for (const f of ['Contacts', 'Inbox', 'Integrations', 'Memory', 'News', 'BrainGraph']) {
      const code = strip(read(`components/panels/${f}Panel.jsx`))
      expect(code, f).not.toContain('useDialogFocus')
      expect(code, f).toContain('useOverlayFocus(')
    }
  })
})

describe('BrainBase / globals.css one-line changes', () => {
  it('BrainBase has exactly one h1, visually hidden', () => {
    const code = strip(read('components/BrainBase.jsx'))
    expect(code.match(/<h1\b/g)).toHaveLength(1)
    expect(code).toContain('<h1 className="bb-visually-hidden">Dashboard</h1>')
  })

  it('globals.css no longer defines lockIn and still defines shimmer (neighbour untouched)', () => {
    const css = read('app/globals.css')
    expect(css).not.toMatch(/lockIn/)
    expect(css).toMatch(/@keyframes shimmer\s*\{/)
  })
})
