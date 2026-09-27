import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../app/crm/page.tsx'),'utf-8')

describe('C.1 CRM overview after latest-main visual convergence', () => {
  it('uses the latest main application theme variables', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D4 CRM implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    const uiImport = source.match(/import \{([^}]*)\} from '@\/components\/ui\/app'/)?.[1] ?? ''
    for (const name of ['Metric', 'MetricStrip', 'PageHeader', 'Panel', 'StateMessage', 'tableStyles'])
      expect(uiImport).toMatch(new RegExp(`\\b${name}\\b`))
    for (const token of ['var(--border)','var(--text-primary)','var(--text-secondary)']) expect(source).toContain(token)
    expect(source).not.toContain('var(--purple-')

  })
  it('preserves the four overview fetches', () => {
    for (const endpoint of ["fetch('/api/crm/deals')","fetch('/api/crm/activities?limit=15')","fetch('/api/crm/companies')","fetch('/api/crm/contacts')"]) expect(source).toContain(endpoint)
    expect(source).toContain('Promise.all([')
  })
  it('preserves calculations, limits, and empty states', () => {
    expect(source).toContain("const pipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage))")
    expect(source).toContain('pipeline.slice(0, 6)')
    expect(source).toContain('activities.slice(0, 8)')
    expect(source).toContain('No open deals.')
    expect(source).toContain('No activity yet.')
  })
  it('preserves all overview destinations', () => {
    for (const href of ['/crm/companies','/crm/contacts','/crm/deals','/crm/activities']) expect(source.includes(`href: '${href}'`) || source.includes(`href="${href}"`)).toBe(true)
  })
  it('preserves category semantics and intentional data colours', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D4 CRM implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    // D4 maps the stage categories onto semantic status tokens; proposal keeps its domain pink.
    expect(source).toContain("qualified: 'var(--status-info)'")
    expect(source).toContain("closed_won: 'var(--status-success)'")
    expect(source).toContain("proposal: '#f472b6'")
    expect(source).toContain('STAGE_COLORS[d.stage]')
    expect(source).toContain('TYPE_ICONS[a.type]')

  })
  it('does not add mutations or persistence behavior', () => {
    for (const text of ['POST','PATCH','DELETE','enabledCapabilities','useRouter','localStorage','sessionStorage']) expect(source).not.toContain(text)
  })
})
