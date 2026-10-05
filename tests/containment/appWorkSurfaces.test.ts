import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C regression guard — shared authenticated work surfaces.
//
// Scope is deliberately narrow: the Phase C primitives in components/ui/app
// and the representative module surfaces migrated onto them. It protects
// the invariants that make the shared system worth having — token-only
// styling, visible focus, the table density contract, semantic status
// usage, one dialog shell — without pinning module-specific design that
// has not been converged yet (see docs/design/AUTHENTICATED_UI_AUDIT.md,
// Phase C note, for the unconverted remainder).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} rule not found`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

const PRIMITIVE_CSS = [
  'components/ui/app/PageHeader.module.css',
  'components/ui/app/WorkToolbar.module.css',
  'components/ui/app/Table.module.css',
  'components/ui/app/StateMessage.module.css',
  'components/ui/app/SlidePanel.module.css',
  'components/ui/app/Field.module.css',
  'components/ui/app/Button.module.css',
]

// Module surfaces converted wholesale in Phase C: no hard-coded colour
// may remain in their code (comments excluded).
const CONVERTED_SURFACES = [
  'app/crm/companies/page.tsx',
  'app/crm/_components/CompanyForm.tsx',
  'app/people/page.tsx',
  'app/people/_components/PersonForm.tsx',
  'app/commercial/invoices/page.tsx',
  'app/commercial/invoices/_status.tsx',
  'app/commercial/quotes/_status.tsx',
  'app/commercial/purchasing/_status.tsx',
  'app/crm/_components/SlidePanel.tsx',
  'app/people/_components/SlidePanel.tsx',
  'app/commercial/_components/SlidePanel.tsx',
]

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/

describe('Phase C primitives — token-only, flat, focus-visible', () => {
  for (const file of PRIMITIVE_CSS) {
    const css = stripComments(read(file))

    it(`${file}: colours come only from semantic tokens`, () => {
      expect(css).not.toMatch(COLOUR_LITERAL)
      expect(css).not.toMatch(/var\(--purple-\d/)
    })

    it(`${file}: no gradient, glass, blur or glow`, () => {
      expect(css).not.toMatch(/(linear|radial|conic)-gradient/)
      expect(css).not.toMatch(/backdrop-filter|\bblur\(|text-shadow|drop-shadow/)
    })

    it(`${file}: never suppresses the focus outline`, () => {
      expect(css).not.toMatch(OUTLINE_SUPPRESSION)
    })

    it(`${file}: no decorative card shadows — only flat inset rules or the dialog elevation token`, () => {
      const shadows = css.match(/box-shadow:\s*[^;]+;/g) ?? []
      for (const shadow of shadows) {
        expect(shadow, shadow).toMatch(/box-shadow:\s*(inset\s+[^;]*var\(--[a-z-]+\)|var\(--shadow-dialog\));/)
      }
    })
  }

  it('no Phase C surface is a large rounded card: radii come from the token scale', () => {
    for (const file of PRIMITIVE_CSS) {
      const radii = stripComments(read(file)).match(/border-radius:\s*[^;]+;/g) ?? []
      for (const r of radii) {
        expect(r, `${file}: ${r}`).toMatch(/border-radius:\s*(var\(--radius-(sm|md|lg)\)|50%|0);/)
      }
    }
  })
})

describe('Table density contract', () => {
  const css = stripComments(read('components/ui/app/Table.module.css'))

  it('compact header: 32px, 11px uppercase labels', () => {
    const th = cssRule(css, '.table th')
    expect(th).toContain('height: 32px;')
    expect(th).toContain('font-size: 0.6875rem;')
    expect(th).toContain('text-transform: uppercase;')
  })

  it('body rows ~40px at 13px text', () => {
    expect(cssRule(css, '.table td')).toContain('height: 40px;')
    expect(cssRule(css, '.table')).toContain('font-size: 0.8125rem;')
  })

  it('numeric cells are right-aligned with tabular figures', () => {
    const num = cssRule(css, '.table .num')
    expect(num).toContain('text-align: right;')
    expect(num).toContain('font-variant-numeric: tabular-nums;')
  })

  it('wide tables scroll inside their own container, never the page', () => {
    expect(cssRule(css, '.container')).toContain('overflow-x: auto;')
    const tableTsx = read('components/ui/app/Table.tsx')
    expect(tableTsx).toContain('role="region"')
    expect(tableTsx).toContain('tabIndex={0}')
  })

  it('selected rows use the product accent tint, hover uses the sunken surface', () => {
    expect(css).toMatch(/tr\[aria-selected='true'\] > td \{\s*background: var\(--brand-brainbase-accent-muted\);/)
    expect(css).toMatch(/:hover > td \{\s*background: var\(--bg-sunken\);/)
  })
})

describe('Representative module surfaces — converted onto the shared system', () => {
  for (const file of CONVERTED_SURFACES) {
    const code = stripComments(read(file))

    it(`${file}: no hard-coded colours, dark-only white-alpha, legacy purple or outline suppression`, () => {
      expect(code).not.toMatch(COLOUR_LITERAL)
      expect(code).not.toMatch(/var\(--purple-\d/)
      expect(code).not.toMatch(OUTLINE_SUPPRESSION)
    })
  }

  it('list pages use the shared header, toolbar and table contract', () => {
    for (const file of ['app/crm/companies/page.tsx', 'app/people/page.tsx', 'app/commercial/invoices/page.tsx']) {
      const code = read(file)
      expect(code, file).toContain('<PageHeader')
      expect(code, file).toContain('<WorkToolbar')
      expect(code, file).toContain('<TableContainer')
      expect(code, file).toContain('className={tableStyles.table}')
      expect(code, file).toContain('<TableStateRow')
    }
  })

  it('money and counts are numeric cells', () => {
    expect(read('app/commercial/invoices/page.tsx')).toMatch(/className=\{tableStyles\.num\}>\{formatMoneyCents\(/)
    expect(read('app/crm/companies/page.tsx')).toMatch(/className=\{tableStyles\.num\}>\{c\.deal_count\}/)
  })

  it('forms label every control through the shared Field (no placeholder-only or unassociated labels)', () => {
    for (const file of ['app/crm/_components/CompanyForm.tsx', 'app/people/_components/PersonForm.tsx']) {
      const code = stripComments(read(file))
      expect(code, file).toMatch(/from '@\/components\/ui\/app'/)
      expect(code, file).not.toMatch(/<label style=/)
      expect(code, file).toContain('className={fieldControlClassName}')
      expect(code, file).toContain('<FormActions')
    }
  })
})

describe('Semantic status usage', () => {
  const STATUS_FILES = [
    'app/commercial/invoices/_status.tsx',
    'app/commercial/quotes/_status.tsx',
    'app/commercial/purchasing/_status.tsx',
  ]

  it('Commercial lifecycle badges render the canonical semantic Badge, not local colour maps', () => {
    for (const file of STATUS_FILES) {
      const code = stripComments(read(file))
      expect(code, file).toMatch(/import \{ Badge, type SemanticState \} from '@\/components\/ui\/app'/)
      expect(code, file).toContain('<Badge state=')
      expect(code, file).not.toMatch(/STATUS_STYLE/)
    }
  })

  it('People employment status, invoice payment state and Data Hub source state use the semantic Badge', () => {
    expect(read('app/people/page.tsx')).toMatch(/const EMPLOYMENT_STATUS_STATE: Record<string, SemanticState>/)
    expect(read('app/people/page.tsx')).toContain('<Badge state={state}>{label}</Badge>')
    expect(read('app/commercial/invoices/[id]/page.tsx')).toContain('<Badge state={s.state}>{s.label}</Badge>')
    expect(read('app/data-hub/sources/SourcesAdminClient.tsx')).toContain('<SemanticBadge state={active ? "active" : "inactive"}>')
  })

  it('status wording stays visible (never colour alone)', () => {
    expect(read('app/commercial/invoices/_status.tsx')).toContain('<Badge state="warning">Overdue</Badge>')
  })
})

describe('One slide-panel shell', () => {
  const shell = stripComments(read('components/ui/app/SlidePanel.tsx'))

  it('CRM, People and Commercial re-export the shared shell instead of private copies', () => {
    for (const file of ['app/crm/_components/SlidePanel.tsx', 'app/people/_components/SlidePanel.tsx', 'app/commercial/_components/SlidePanel.tsx']) {
      const code = stripComments(read(file))
      expect(code, file).toContain("export { SlidePanel as default } from '@/components/ui/app/SlidePanel';")
      expect(code, file).not.toMatch(/<div/)
    }
  })

  it('the shell is a labelled modal dialog with Escape, focus containment and a named close button', () => {
    expect(shell).toContain('role="dialog"')
    expect(shell).toContain('aria-modal="true"')
    expect(shell).toContain('aria-labelledby={titleId}')
    expect(shell).toContain('useDialogFocus(open, onClose, panelRef)')
    expect(shell).toContain('aria-label={`Close ${title}`}')
    const focus = stripComments(read('components/ui/app/useDialogFocus.ts'))
    expect(focus).toContain("e.key === 'Escape'")
    expect(focus).toContain('opener.focus()')
  })

  it('it keeps the original close paths (scrim click and close button both call onClose)', () => {
    expect(shell).toMatch(/className=\{styles\.scrim\} onClick=\{onClose\}/)
    expect(shell).toMatch(/className=\{styles\.close\} onClick=\{onClose\}/)
  })

  it('it never overflows a narrow viewport', () => {
    const css = read('components/ui/app/SlidePanel.module.css')
    expect(cssRule(css, '.panel')).toContain('max-width: 100vw;')
  })
})
