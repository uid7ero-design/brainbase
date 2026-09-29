import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase B regression guard — authenticated application chrome only.
//
// Scoped to the files converted in Phase B (TopNav's AppNav + its menus,
// the OrgSwitcher bar, and their CSS modules). It blocks the specific
// failure classes the audit found in this chrome — dark-only white-alpha
// text, the retired violet palette, glass/blur, gradient/glow branding and
// outline suppression — while leaving every semantic token (var(--…))
// free to use. Module sidebars and page content are deliberately NOT in
// scope here; see docs/design/AUTHENTICATED_UI_AUDIT.md for that debt.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
/** Top-level function body: from its declaration to the closing brace at column 0. */
function fnBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration)
  expect(start, `${declaration} not found`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}\n', start))
}

const CHROME_TSX = ['components/nav/TopNav.tsx', 'components/admin/OrgSwitcher.tsx']
const CHROME_CSS = ['components/nav/AppChrome.module.css', 'components/admin/OrgSwitcher.module.css']
const CHROME_FILES = [...CHROME_TSX, ...CHROME_CSS]

const source = Object.fromEntries(CHROME_FILES.map(f => [f, stripComments(read(f))]))

// The retired violet ramp the audit found hard-coded across the chrome.
const OLD_VIOLET_HEX = /#(7C3AED|8B5CF6|A78BFA|C4B5FD|DDD6FE|6D28D9|5B21B6|9333EA|A855F7)\b/i
const OLD_VIOLET_RGBA = /rgba?\(\s*(124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|155\s*,\s*123\s*,\s*255)\b/
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/

describe('Authenticated chrome — no dark-only or retired colour treatments', () => {
  for (const file of CHROME_FILES) {
    it(`${file}: no white-alpha neutrals (invisible or illegible in light mode)`, () => {
      expect(source[file]).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255/)
      expect(source[file]).not.toMatch(/rgba?\(\s*226\s*,\s*232\s*,\s*240/)
    })

    it(`${file}: no retired violet palette values or --purple-* ramp references`, () => {
      expect(source[file]).not.toMatch(OLD_VIOLET_HEX)
      expect(source[file]).not.toMatch(OLD_VIOLET_RGBA)
      expect(source[file]).not.toMatch(/var\(--purple-\d/)
    })

    it(`${file}: no glass, blur, gradient or glow treatments`, () => {
      expect(source[file]).not.toMatch(/backdrop-?filter/i)
      expect(source[file]).not.toMatch(/\bblur\(/)
      expect(source[file]).not.toMatch(/(linear|radial|conic)-gradient/)
      expect(source[file]).not.toMatch(/text-?shadow|drop-shadow/i)
    })

    it(`${file}: never suppresses the focus outline`, () => {
      expect(source[file]).not.toMatch(/outline\s*:\s*['"]?\s*(none|0)\b/)
    })
  }

  for (const file of CHROME_CSS) {
    it(`${file}: colours come only from semantic tokens (no raw hex/rgb/hsl literals)`, () => {
      expect(source[file]).not.toMatch(COLOUR_LITERAL)
    })
  }

  for (const file of CHROME_TSX) {
    it(`${file}: no raw colour literals in inline styles — visual treatment lives in the chrome CSS module`, () => {
      const stringLiterals = source[file].match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
      const offenders = stringLiterals.filter(s => COLOUR_LITERAL.test(s))
      expect(offenders).toEqual([])
    })
  }
})

describe('Authenticated chrome — one active-state language, not colour alone', () => {
  const css = source['components/nav/AppChrome.module.css']

  it('the active nav item uses the product accent token plus weight and a flat baseline', () => {
    const start = css.indexOf(".item[aria-current='page'],")
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('color: var(--brand-brainbase-accent);')
    expect(rule).toContain('font-weight: 600;')
    expect(rule).toMatch(/box-shadow: inset 0 -2px 0 var\(--brand-brainbase-accent\);/)
  })

  it('nav items expose aria-current rather than a colour-only active style', () => {
    const topNav = source['components/nav/TopNav.tsx']
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // NavItem/HlnaItem/SquadItem were replaced by NavPill (top-level Home,
    // HLNA, Requests) and MenuLink (every menu destination, incl. the Tennis
    // Squad link). Same contract on both; menu triggers additionally carry a
    // non-colour "(current section)" text cue.
    const itemFns = ['function NavPill(', 'function MenuLink(']
    for (const fn of itemFns) {
      const body = fnBody(topNav, fn)
      expect(body, fn).toContain("aria-current={active ? 'page' : undefined}")
      expect(body, fn).toContain('className=')
      expect(body, fn).not.toMatch(/onMouseEnter|onMouseLeave/)
    }
    expect(topNav).not.toMatch(/function (NavItem|HlnaItem|SquadItem)\(/)
    const navMenu = fnBody(topNav, 'function NavMenu(')
    expect(navMenu).toContain("data-active={active ? 'true' : undefined}")
    expect(navMenu).toContain('{active && <span className={styles.srOnly}> (current section)</span>}')
  })
})

describe('Authenticated chrome — menus are keyboard-operable', () => {
  const topNav = source['components/nav/TopNav.tsx']

  // Nav consolidation update (feat/authenticated-nav-consolidation):
  // OpsDropdown and AdminDropdown were replaced by ONE generic NavMenu that
  // renders every desktop menu (Work, Manage, Brainbase, Account); the
  // ≤767px MobileMenu is the second menu implementation. Each is pinned.
  it('NavMenu: the trigger is a real button with aria-expanded, click and keyboard handlers', () => {
    const start = topNav.indexOf('function NavMenu(')
    expect(start).toBeGreaterThan(-1)
    const body = topNav.slice(start, topNav.indexOf('\nfunction ', start + 1))
    const trigger = body.slice(body.indexOf('<button'), body.indexOf('</button>'))
    expect(trigger).toContain('type="button"')
    expect(trigger).toContain('aria-expanded={open}')
    expect(trigger).toContain('aria-controls={open ? panelId : undefined}')
    expect(trigger).toContain('onClick={handleTriggerClick}')
    expect(trigger).toContain('onKeyDown={handleTriggerKeyDown}')
    expect(body).toContain('useMenuDismissal(')
    expect(body).toContain('onKeyDown={e => handleMenuKeyDown(')
    expect(topNav).not.toMatch(/function (OpsDropdown|AdminDropdown)\(/)
    // Every desktop menu goes through this one keyboard-operable NavMenu.
    for (const label of ['Work', 'Manage', 'Brainbase']) {
      expect(topNav).toContain(`<NavMenu label="${label}" panelLabel="${label}"`)
    }
    expect(topNav).toMatch(/<NavMenu\s*\n\s*panelLabel="Account"/)
  })

  it('MobileMenu: the trigger is a real button with aria-expanded; Escape returns focus and Tab stays inside the open panel', () => {
    const start = topNav.indexOf('function MobileMenu(')
    expect(start).toBeGreaterThan(-1)
    const body = topNav.slice(start, topNav.indexOf('\nfunction ', start + 1))
    const trigger = body.slice(body.indexOf('<button'), body.indexOf('</button>'))
    expect(trigger).toContain('type="button"')
    expect(trigger).toContain('aria-expanded={open}')
    expect(trigger).toContain('aria-controls={open ? panelId : undefined}')
    expect(trigger).toContain('<span>Menu</span>')
    expect(body).toContain("if (e.key === 'Escape') {")
    expect(body).toContain('triggerRef.current?.focus()')
    expect(body).toContain("if (e.key !== 'Tab') return;")
    expect(body).toContain("addEventListener('pointerdown'")
  })

  it('dismissal handles Escape (returning focus to the trigger), outside press and focus leaving', () => {
    const body = fnBody(topNav, 'function useMenuDismissal(')
    expect(body).toContain("e.key !== 'Escape'")
    expect(body).toContain('triggerRef.current?.focus()')
    expect(body).toContain("addEventListener('pointerdown'")
    expect(body).toContain("addEventListener('focusin'")
  })

  it('menus are clamped inside the viewport', () => {
    expect(topNav).toMatch(/function clampMenuLeft\(/)
    // Nav consolidation update (feat/authenticated-nav-consolidation): the one
    // generic NavMenu clamps for both alignments (start: rect.left; end —
    // Account: rect.right - width) and passes its own width.
    expect((topNav.match(/clampMenuLeft\(/g) ?? []).length).toBe(2) // definition + single call site
    expect(fnBody(topNav, 'function NavMenu(')).toContain(
      "left: clampMenuLeft(align === 'end' ? rect.right - width : rect.left, width),",
    )
    expect(fnBody(topNav, 'function clampMenuLeft(')).toContain(
      'return Math.max(8, Math.min(left, window.innerWidth - width - 8));',
    )
  })
})

describe('Authenticated chrome — theme control, identity and brand', () => {
  const topNav = source['components/nav/TopNav.tsx']

  it('a named theme control uses the existing ThemeProvider (persistence and pre-paint unchanged)', () => {
    expect(topNav).toContain("import { useTheme } from '@/components/theme/ThemeProvider';")
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // theme control moved into the Account menu as ThemeMenuItem (was the
    // standalone ThemeControl). Same ThemeProvider/toggleTheme, same name.
    const body = fnBody(topNav, 'function ThemeMenuItem(')
    expect(body).toContain('const { theme, toggleTheme } = useTheme();')
    expect(body).toContain('onClick={toggleTheme}')
    expect(body).toContain('aria-label={`Switch to ${next} theme`}')
    expect(fnBody(topNav, 'function AccountEntries(')).toContain('<ThemeMenuItem />')
    expect(topNav).not.toContain('<ThemeControl />')
  })

  it('Branding (its only authenticated entry point) is never hidden at any width', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // standalone .brandingLink was removed; Branding is now a Manage entry in
    // navModel.ts (/settings/branding, admin+). It is reachable at every
    // width because Manage is rendered both by the desktop NavMenu and by
    // the ≤767px MobileMenu (the two swap via .desktopOnly/.mobileOnly).
    const css = source['components/nav/AppChrome.module.css']
    const rules = css.match(/[^{}]*\{[^{}]*\}/g) ?? []
    const hiding = rules.filter(r => /brandingLink/.test(r.slice(0, r.indexOf('{'))) && /display:\s*none/.test(r))
    expect(hiding).toEqual([])
    expect(css).not.toContain('.brandingLink')
    const model = stripComments(read('components/nav/navModel.ts'))
    const manageStart = model.indexOf('export const MANAGE_ITEMS')
    const manage = model.slice(manageStart, model.indexOf('\n];', manageStart))
    expect(manage).toMatch(/label: 'Branding', href: '\/settings\/branding',[\s\S]*?gate: \{ minRole: 'admin' \}/)
    expect(fnBody(topNav, 'function AppNav(')).toContain('<MenuEntries entries={nav.manage}')
    expect(fnBody(topNav, 'function MobileMenu(')).toContain('<MenuEntries entries={nav.manage}')
    const mobileRule = css.slice(css.indexOf('@media (max-width: 767px)'))
    expect(mobileRule).toMatch(/\.mobileOnly \{\s*display: flex;\s*\}/)
    expect(fnBody(topNav, 'function MobileMenu(')).toContain('<div className={styles.mobileOnly}>')
  })

  it('the avatar image is decorative beside the visible name (no alt="avatar")', () => {
    expect(topNav).not.toContain('alt="avatar"')
  })

  it('uses only the approved broken-orbit lockup — no legacy logo systems in the chrome', () => {
    const body = fnBody(topNav, 'function Logo(')
    expect(body).toContain('<BrainBaseWordmark')
    expect(body).toContain('<BrokenOrbitMark size={24} context="brainbase" />')
    expect(topNav).not.toMatch(/BrandLogo|HlnaOrb|HeroOrbitMark|OrbitalBackground|brainbase-logo/)
  })
})

describe('OrgSwitcher chrome — context is unmistakable and keyboard-operable', () => {
  const orgSwitcher = source['components/admin/OrgSwitcher.tsx']
  const css = source['components/admin/OrgSwitcher.module.css']

  it('impersonation is a distinct state on the bar only (text badge + accent edge), never a whole-app purple fill', () => {
    expect(orgSwitcher).toContain("data-impersonating={isOverriding ? 'true' : undefined}")
    expect(orgSwitcher).toContain('<span className={styles.badge}>{contextLabel}</span>')
    const start = css.indexOf(".bar[data-impersonating='true']")
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('background: var(--brand-brainbase-accent-muted);')
    expect(rule).not.toMatch(/background:\s*var\(--brand-brainbase-accent\);/)
  })

  it('the trigger exposes expanded state and the active organisation is marked for assistive tech', () => {
    expect(orgSwitcher).toContain('aria-expanded={open}')
    expect(orgSwitcher).toContain("aria-current={isCurrent ? 'true' : undefined}")
    expect(orgSwitcher).toContain('onKeyDown={handlePanelKeyDown}')
    expect(orgSwitcher).toContain("if (e.key === 'Escape') {")
  })

  it('the menu surface uses the overlay tokens', () => {
    const start = css.indexOf('.panel {')
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('background: var(--bg-overlay);')
    expect(rule).toContain('box-shadow: var(--shadow-menu);')
  })
})
