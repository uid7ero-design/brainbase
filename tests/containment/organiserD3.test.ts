import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D3 regression guard — Organiser convergence.
//
// Scoped to the Organiser page, shell and rail and their stylesheets. It
// blocks the failure classes D3 removed — dark-only neutrals, the retired
// violet palette, glass/glow/gradients, forced-dark controls, outline
// suppression, click-only <div>/<span> targets, hover-only (mouse-only)
// row actions, overlays without dialog semantics — and keeps semantic
// state separate from product/selection purple. Documented user-data
// colour encodings (the column-option swatch palette, board/group colours)
// are left alone (see the D3 audit note).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function fnBody(src: string, start: string, end: string): string {
  const i = src.indexOf(start)
  expect(i, `${start} not found`).toBeGreaterThan(-1)
  const j = src.indexOf(end, i + start.length)
  return src.slice(i, j === -1 ? undefined : j)
}

const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|f87171)\b|rgba?\(\s*(124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|99\s*,\s*102\s*,\s*241)\b|var\(--purple-\d/i
const GLASS = /backdrop-?[fF]ilter|(?<![.\w])blur\(/ // not the element .blur() method
const GRADIENT = /(linear|radial|conic)-?[gG]radient/
const GLOW = /drop-shadow|text-?[sS]hadow|(box-shadow|boxShadow)\s*:\s*[`'"]?\s*0 0 \d+px/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/
const FORCED_DARK = /colorScheme:\s*["']dark["']|invert\(1\)/

const PAGE = 'app/organiser/page.tsx'
const RAIL = 'components/organiser/OrganiserRail.tsx'
const SHELL = 'components/organiser/OrganiserShell.tsx'
const CSS = ['components/organiser/Organiser.module.css', 'components/organiser/OrganiserRail.module.css']

const page = stripComments(read(PAGE))
const rail = stripComments(read(RAIL))
const shell = stripComments(read(SHELL))

// The one documented user-data palette (column-option swatches).
const pageWithoutUserPalette = page.split('\n').filter(l => !l.includes('const SWATCH_COLORS')).join('\n')
// AssigneeDropdown keeps its pinned useOpsTheme (t.menuBg / t.ink) styling.
const pageWithoutAssignee = pageWithoutUserPalette.replace(fnBody(pageWithoutUserPalette, 'function AssigneeDropdown(', '\nfunction '), '')

// ── Surfaces ────────────────────────────────────────────────────────────
describe('Organiser surfaces — tokens only, no legacy treatments', () => {
  for (const [name, code] of [[PAGE, pageWithoutUserPalette], [RAIL, rail], [SHELL, shell]] as const) {
    it(`${name}: no glass, gradients, glow, white-alpha, retired violet, forced dark or outline suppression`, () => {
      expect(code).not.toMatch(GLASS)
      expect(code).not.toMatch(GRADIENT)
      expect(code).not.toMatch(GLOW)
      expect(code).not.toMatch(WHITE_ALPHA)
      expect(code).not.toMatch(OLD_VIOLET)
      expect(code).not.toMatch(FORCED_DARK)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
    })
  }

  it('no raw colour literals outside the documented user palette (and the pinned assignee picker)', () => {
    expect(pageWithoutAssignee).not.toMatch(COLOUR_LITERAL)
    expect(rail).not.toMatch(COLOUR_LITERAL)
    expect(shell).not.toMatch(COLOUR_LITERAL)
    for (const f of CSS) {
      const css = stripComments(read(f))
      expect(css, f).not.toMatch(COLOUR_LITERAL)
      expect(css, f).not.toMatch(GRADIENT)
      expect(css, f).not.toMatch(GLASS)
      expect(css, f).not.toMatch(OUTLINE_SUPPRESSION)
    }
  })

  it('the shell and rail no longer read the ops JS palette (surfaces come from CSS tokens)', () => {
    expect(shell).not.toMatch(/useOpsTheme|t\.pageBg/)
    expect(rail).not.toMatch(/useOpsTheme|t\.sidebarBg|t\.accentText/)
    expect(shell).toContain("background: 'var(--bg-base)'")
    // Only the pinned AssigneeDropdown still uses the helper in the page.
    expect(pageWithoutAssignee).not.toMatch(/useOpsTheme\(\)|\bt\.(ink|paper|menuBg|accentText|panelBgSolid)\b/)
  })
})

// ── Keyboard / interaction ──────────────────────────────────────────────
describe('Organiser keyboard access — no click-only targets, no mouse-only actions', () => {
  it('no <div>/<span>/<td> click targets except the documented ones (scrims, kanban card surface)', () => {
    const matches = page.match(/<(div|span|td|li)\b[^>]*\bonClick=\{[^}]*\}?/g) ?? []
    // Two aria-hidden scrims (drawer, column options) and the kanban card
    // surface (a mouse convenience; its title is a real button).
    expect(matches).toHaveLength(3)
    expect(page).toMatch(/<div onClick=\{onClose\} className=\{styles\.scrim\} aria-hidden="true" \/>/)
    expect(page).toMatch(/<li\s+key=\{item\.id\} onClick=\{\(\) => onOpenDrawer\(item\)\}\s+className=\{styles\.card\}/)
    expect(page).toMatch(/className=\{`\$\{styles\.textButton\} \$\{styles\.cardTitle\}`\} onClick=/)
    expect(rail).not.toMatch(/<(div|span|li)\b[^>]*\bonClick=/)
  })

  it('the rail uses real buttons with aria-current, and a named, stateful options menu', () => {
    expect(rail).toContain("aria-current={active ? 'page' : undefined}")
    expect(rail).toContain('aria-haspopup="menu"')
    expect(rail).toContain('aria-expanded={menuFor === b.id}')
    expect(rail).toMatch(/if \(e\.key !== 'Escape'\) return;[\s\S]{0,120}optionsButtons\.current\[owner\]\?\.focus\(\)/)
  })

  it('row actions are never hover-only: always rendered, revealed on hover OR focus-within', () => {
    const row = fnBody(page, 'function ItemRow(', '\nfunction GroupSection(')
    expect(row).not.toMatch(/onMouseEnter|setHover|\bhover &&/)
    expect(row).toContain('className={`${styles.iconButton} ${styles.reveal}`}')
    const css = read('components/organiser/Organiser.module.css')
    expect(css).toMatch(/\.row:hover \.reveal,\s*\n\.row:focus-within \.reveal,\s*\n\.reveal:focus-visible \{\s*\n\s*opacity: 1;/)
  })

  it('click-to-edit text and item names are buttons', () => {
    const inline = fnBody(page, 'function InlineText(', '\nfunction CustomCell(')
    expect(inline).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => setEditing\(true\)\}/)
    expect(inline).not.toMatch(/<span\s+onClick/)
    expect(page).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => onOpenDrawer\(item\)\}\s+title="Open details"/)
  })

  it('icon-only buttons all carry an accessible name', () => {
    // Every element styled as an icon button: its opening tag (from the
    // nearest preceding "<button" up to the class reference's line end)
    // must include an aria-label.
    let count = 0
    for (let i = page.indexOf('styles.iconButton'); i !== -1; i = page.indexOf('styles.iconButton', i + 1)) {
      const start = page.lastIndexOf('<button', i)
      const end = page.indexOf('\n', i)
      const tag = page.slice(start, end === -1 ? undefined : end)
      expect(tag, tag).toMatch(/aria-label=/)
      count++
    }
    expect(count).toBeGreaterThan(8)
  })
})

// ── Overlays ────────────────────────────────────────────────────────────
describe('Organiser overlays — dialog semantics and shared focus handling', () => {
  it('the item drawer is a labelled modal dialog using the shared focus behaviour', () => {
    const drawer = fnBody(page, 'function ItemDrawer(', '\nfunction Field(')
    expect(drawer).toContain('useDialogFocus(true, onClose, drawerPanelRef);')
    expect(drawer).toContain('role="dialog"')
    expect(drawer).toContain('aria-modal="true"')
    expect(drawer).toContain('aria-label={`Item details: ${item.name}`}')
    expect(drawer).toContain('data-dialog-body=""')
    expect(drawer).toContain('aria-label="Close item details"')
  })

  it('the column options editor is a labelled modal dialog using the shared focus behaviour', () => {
    const editor = fnBody(page, 'function ColumnOptionsEditor(', '\n// ── ITEM ROW')
    expect(editor).toContain('useDialogFocus(true, onClose, panelRef);')
    expect(editor).toContain('role="dialog" aria-modal="true" aria-labelledby="column-options-title"')
    expect(editor).toContain('aria-pressed={o.color === c}')
  })

  it('an Escape already consumed by an inner control does not close the dialog', () => {
    const hook = read('components/ui/app/useDialogFocus.ts')
    expect(hook).toMatch(/if \(e\.key === 'Escape'\) \{[\s\S]{0,300}if \(e\.defaultPrevented\) return;/)
    const assignee = fnBody(page, 'function AssigneeDropdown(', '\nfunction ')
    expect(assignee).toContain('if (open) e.preventDefault();')
  })
})

// ── Semantic state vs product state ─────────────────────────────────────
describe('Organiser status / priority — semantic tokens; purple only for selection', () => {
  it('status and priority map to status tokens (never the accent or a violet)', () => {
    expect(page).toContain('"working on it": "var(--status-warning)",')
    expect(page).toContain('"stuck": "var(--status-danger)",')
    expect(page).toContain('"done": "var(--status-success)",')
    expect(page).toContain('medium: "var(--status-info)",')
    expect(page).toContain('high: "var(--status-warning)",')
    expect(page).toContain('critical: "var(--status-danger)",')
    const maps = fnBody(page, 'const STATUS_COLORS', 'const SWATCH_COLORS')
    expect(maps).not.toMatch(/brand-brainbase-accent|purple|#/)
  })

  it('selection / product state uses the accent: active board, active view, today, recommended sheet', () => {
    const css = read('components/organiser/Organiser.module.css')
    expect(css).toMatch(/\.viewButton\[aria-pressed='true'\] \{[^}]*--brand-brainbase-accent/)
    expect(css).toMatch(/\.day\[data-today\] \.dayNumber \{[^}]*--brand-brainbase-accent/)
    expect(css).toMatch(/\.sheetOption\[data-recommended\] \{[^}]*--brand-brainbase-accent/)
    expect(read('components/organiser/OrganiserRail.module.css')).toMatch(/\.item\[aria-current='page'\] \{[^}]*--brand-brainbase-accent/)
  })

  it('save state is written as text, not only a coloured dot', () => {
    const dot = fnBody(page, 'function SaveDot(', '\nfunction SaveStatusText(')
    expect(dot).toContain('<span className={styles.srOnly}>{text}</span>')
  })
})
