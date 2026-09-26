import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../app/crm/page.tsx'),'utf-8')

describe('C.1 CRM overview after latest-main visual convergence', () => {
  it('uses the latest main application theme variables', () => {
    for (const token of ['var(--bg-surface)','var(--border)','var(--text-primary)','var(--text-secondary)','var(--text-muted)','var(--purple-600)']) expect(source).toContain(token)
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
    expect(source).toContain("qualified: '#60a5fa'")
    expect(source).toContain("closed_won: '#34d399'")
    expect(source).toContain('STAGE_COLORS[d.stage]')
    expect(source).toContain('TYPE_ICONS[a.type]')
  })
  it('does not add mutations or persistence behavior', () => {
    for (const text of ['POST','PATCH','DELETE','enabledCapabilities','useRouter','localStorage','sessionStorage']) expect(source).not.toContain(text)
  })
})
