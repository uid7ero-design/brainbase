import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Remaining visual islands — residue follow-up. Pins the residue decisions:
//   A (legacy authenticated chrome, fixed): SessionProvider's WelcomeBackBanner
//     and the /admin layout chrome.
//   B (data/category identity, kept): BrainBase MODULE_COLORS and
//     lib/data/activities PANEL_SECTIONS. They colour aria-hidden dots only;
//     labels stay on text tokens. If either starts colouring text, borders,
//     surfaces or controls, this guard fails.
//   C (dead, removed): the lockIn keyframes in app/globals.css.
//   D (engine-owned, deferred): the BrainGraph CSS2D label state colours. They
//     live inside buildScene (pinned by dashboardFallbackPanelsVisual) and are
//     pinned here too, so a future change is deliberate.
//   E (public, excluded): /connect. It is not checked here.
// It also pins the one visually hidden h1 on the BrainBase /dashboard fallback.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const WHITE_ALPHA = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/i
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241|109\s*,\s*40\s*,\s*217)\b/i
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|rgba?\(/i
const LOCAL_FONT = /font-inter|font-geist|['"]?Inter['"]?\s*,/

describe('A — WelcomeBackBanner is on tokens with its behaviour unchanged', () => {
  const src = read('components/session/SessionProvider.tsx')
  const banner = src.slice(src.indexOf('function WelcomeBackBanner('))
  const css = strip(read('components/session/WelcomeBackBanner.module.css'))

  it('renders from the CSS module: no inline colour, blur, glow or local font', () => {
    const code = strip(banner)
    expect(code).not.toMatch(/style=\{\{/)
    expect(code).not.toMatch(RAW_COLOUR)
    expect(code).not.toMatch(/backdrop|blur|boxShadow|fontFamily/)
    expect(code).toContain('<span aria-hidden="true" className={bannerStyles.dot} />')
  })

  it('the module is tokens only, keeps placement and pointer-events, and honours reduced motion', () => {
    expect(css).not.toMatch(RAW_COLOUR)
    expect(css).not.toMatch(/backdrop-filter|blur\(|gradient|text-shadow/)
    expect(css).not.toMatch(LOCAL_FONT)
    for (const decl of ['position: fixed;', 'bottom: 24px;', 'right: 24px;', 'z-index: 9998;', 'pointer-events: none;',
      'background: var(--bg-overlay);', 'box-shadow: var(--shadow-popover);', 'font-family: var(--bb-font-sans);',
      'color: var(--text-primary);', 'animation: welcomeBackIn 0.3s ease;']) expect(css).toContain(decl)
    expect(css).toMatch(/@keyframes welcomeBackIn \{\s*from \{ opacity: 0; transform: translateY\(8px\); \}\s*to\s+\{ opacity: 1; transform: translateY\(0\); \}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.banner \{\s*animation: none;/)
  })

  it('keeps the copy and when it appears', () => {
    expect(banner).toContain("const firstName = name.split(' ')[0];")
    expect(banner).toMatch(/Welcome back,\{' '\}\s*<span className=\{bannerStyles\.name\}>\{firstName\}<\/span>/)
    expect(src).toContain('{hasSession && welcomeBack && !locked && <WelcomeBackBanner name={name} />}')
  })

  it('everything before the banner (timers, lock, heartbeat, visibility, context) is byte-identical to the pre-pass provider', () => {
    const region = src.slice(0, src.indexOf('// ─── Welcome back banner'))
      .split('\n').filter(l => !l.includes('WelcomeBackBanner.module.css')).join('\n')
    expect(crypto.createHash('sha256').update(region).digest('hex'))
      .toBe('b70f50b8e97cc16072e8c3fb08cf4dab5020674124bafbaa9f0aa1b20aaab0f0')
  })
})

describe('A — admin layout chrome', () => {
  const layout = read('app/admin/layout.tsx')
  const css = strip(read('app/admin/AdminLayout.module.css'))
  const rule = (sel: string, from = css) => from.slice(from.indexOf(sel + ' {'), from.indexOf('}', from.indexOf(sel + ' {')) + 1)

  it('keeps the super_admin gate, the aside and the main landmark', () => {
    expect(layout).toContain("if (!session || session.role !== 'super_admin') redirect('/');")
    expect(layout).toContain('<AdminAside name={session.name} />')
    expect(layout).toContain('<div className={styles.shell}>')
    expect(layout).toContain('<main className={styles.main}>')
    expect(strip(layout)).not.toMatch(/style=\{\{|fontFamily|Inter/)
  })

  it('shell and main are tokens only with the shared font', () => {
    expect(css).not.toMatch(RAW_COLOUR)
    expect(css).not.toMatch(LOCAL_FONT)
    expect(rule('.shell')).toMatch(/display: flex;[\s\S]*min-height: 100vh;[\s\S]*background: var\(--bg-base\);[\s\S]*font-family: var\(--bb-font-sans\);[\s\S]*color: var\(--text-primary\);/)
    // flex-direction is left to the shared ModuleNav narrow-screen rule.
    expect(rule('.shell')).not.toMatch(/flex-direction/)
  })

  it('desktop keeps 40px padding and overflow; below 768px the content uses the phone gutter', () => {
    expect(rule('.main')).toMatch(/flex: 1;\s*padding: 40px;\s*overflow: auto;/)
    const mq = css.slice(css.indexOf('@media (max-width: 767px)'))
    expect(mq).toMatch(/\.main \{\s*padding: 24px 16px;\s*\}/)
    // 767px matches the ModuleSidebar breakpoint that stacks the aside above the content.
    expect(read('components/ui/app/ModuleNav.module.css')).toContain('@media (max-width: 767px) {')
  })
})

describe('B — identity colour maps are kept as dot-only data encodings', () => {
  it('BrainBase MODULE_COLORS is unchanged and colours only aria-hidden 6px dots', () => {
    const src = read('components/BrainBase.jsx')
    expect(src).toMatch(/const MODULE_COLORS = \{\n  waste_recycling:   '#34D399',\n  fleet_management:  '#38BDF8',\n  service_requests:  '#FBBF24',\n  logistics_freight: '#F97316',\n  utilities:         '#818CF8',\n  construction:      '#FB7185',\n\};/)
    const code = strip(src)
    // Exactly three occurrences: the declaration and two aria-hidden 6px dot backgrounds.
    expect(code.match(/activeModColor/g)).toHaveLength(3)
    expect(code).toContain('const activeModColor = activeModule ? (MODULE_COLORS[activeModule] ??')
    expect(code.match(/<div aria-hidden="true" style=\{\{ width: 6, height: 6, borderRadius: "50%", background: activeModColor \}\} \/>/g)).toHaveLength(2)
    expect(code.match(/MODULE_COLORS\[/g)).toHaveLength(1)
  })

  it('PANEL_SECTIONS values are unchanged and colour only the aria-hidden type dot', () => {
    const lib = read('lib/data/activities.js')
    expect(lib).toContain('{ label: "INBOX REPLIES",   type: "reply",     color: "#FBBF24" }')
    expect(lib).toContain('{ label: "DATA SCAN",       type: "data_scan", color: "#00CFEA" }')
    expect(lib).toContain('{ label: "WEEKLY DIGEST",   type: "digest",    color: "#A78BFA" }')
    expect(lib).toContain('{ label: "QUEUE",           type: "queue",     color: "#34D399" }')
    const code = strip(read('components/panels/ActivityPanel.jsx'))
    const uses = code.match(/[^\n]*sec\.color[^\n]*/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/<span className=\{`?\$?\{?styles\.typeDot[^\n]*style=\{\{ background: sec\.color \}\} aria-hidden="true" \/>/)
  })
})

describe('C — the dead lockIn keyframes are gone and nothing referenced them', () => {
  it('globals.css no longer defines lockIn and no live source uses it', () => {
    expect(read('app/globals.css')).not.toMatch(/lockIn/)
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) { if (!/_legacy|node_modules/.test(e.name)) walk(rel); continue }
        if (/\.(tsx?|jsx?|css)$/.test(e.name) && /lockIn\b/.test(read(rel))) hits.push(rel)
      }
    }
    for (const d of ['app', 'components', 'lib', 'styles']) walk(d)
    expect(hits).toEqual([])
  })

  it('the global fadeIn keyframes (still used by other surfaces) are kept', () => {
    expect(read('app/globals.css')).toMatch(/@keyframes fadeIn \{/)
  })
})

describe('D — BrainGraph CSS2D label states stay engine-owned (deferred)', () => {
  it('the four label state colours inside buildScene are unchanged', () => {
    const src = read('components/panels/BrainGraphPanel.jsx')
    for (const l of [
      "if (state === 'hidden')   div.style.color = 'rgba(210,170,255,0)';",
      "if (state === 'dim')      div.style.color = 'rgba(210,170,255,0.22)';",
      "if (state === 'bright')   div.style.color = 'rgba(210,170,255,0.78)';",
      "if (state === 'selected') div.style.color = 'rgba(220,160,255,1)';",
    ]) expect(src).toContain(l)
  })
})

describe('BrainBase /dashboard fallback heading', () => {
  it('has exactly one h1, visually hidden, as the first child of the shell', () => {
    const code = strip(read('components/BrainBase.jsx'))
    expect(code.match(/<h1\b/g)).toHaveLength(1)
    expect(code).toContain('<h1 className="bb-visually-hidden">Dashboard</h1>')
    expect(code).toMatch(/flexDirection: "column",\n    \}\}>\s*<h1 className="bb-visually-hidden">Dashboard<\/h1>\s*<header/)
  })
})

describe('residue guard hygiene', () => {
  it('no white-alpha or old-violet chrome in the fixed residue', () => {
    for (const f of ['components/session/WelcomeBackBanner.module.css', 'app/admin/AdminLayout.module.css', 'app/admin/layout.tsx']) {
      const s = strip(read(f))
      expect(s, f).not.toMatch(WHITE_ALPHA)
      expect(s, f).not.toMatch(OLD_VIOLET)
    }
    const banner = strip(read('components/session/SessionProvider.tsx'))
    expect(banner.slice(banner.indexOf('function WelcomeBackBanner('))).not.toMatch(OLD_VIOLET)
  })
})

describe('review follow-ups: ARIA references resolve', () => {
  it('Deployments renders its tabpanel even while loading (tabs aria-controls always resolves)', () => {
    const src = strip(read('app/admin/deployments/page.tsx'))
    expect(src).toMatch(/<div id=\{`\$\{tabsId\}-panel`\} role="tabpanel" aria-labelledby=\{`\$\{tabsId\}-tab-\$\{tab\}`\}>\s*\{loading \? \(\s*<StateMessage kind="loading"/)
    expect(src.match(/role="tabpanel"/g)).toHaveLength(1)
  })

  it('WSTE tabs and the Integrations add toggle only reference rendered elements', () => {
    expect(read('app/dashboard/wste/WSTEClient.tsx')).toContain('aria-controls={tab === t ? `${baseId}-panel-${t}` : undefined}')
    expect(read('app/dashboard/integrations/IntegrationsClient.tsx')).toContain("aria-controls={showAdd ? 'integration-add-form' : undefined}")
  })
})

describe('review follow-ups: disclosures reference their region only while it is rendered', () => {
  it('ServiceTimeline events and Social insights/comments', () => {
    expect(read('app/dashboard/wste/components/ServiceTimeline.tsx')).toContain('aria-controls={expanded ? detailsId : undefined}')
    const social = read('app/dashboard/social/SocialClient.tsx')
    expect(social).toContain('aria-controls={open ? bodyId : undefined}')
    expect(social).toContain('aria-controls={expanded ? commentsId : undefined}')
  })
})

describe('onboarding dropzones: the parsing state lives in the button, with no nested live region', () => {
  for (const f of ['app/onboarding/_components/steps/Step3WasteMapping.tsx', 'app/onboarding/_components/steps/Step4FleetMapping.tsx']) {
    it(f, () => {
      const src = strip(read(f))
      const start = src.indexOf('className={styles.dropzone}')
      expect(start).toBeGreaterThan(-1)
      const button = src.slice(src.lastIndexOf('<button', start), src.indexOf('</button>', start) + '</button>'.length)
      expect(button).toContain('aria-busy={uploading || undefined}')
      expect(button).toContain('<span className={styles.dropzoneBusy}>Parsing file…</span>')
      expect(button).not.toMatch(/role=["']status["']/)
    })
  }
})
