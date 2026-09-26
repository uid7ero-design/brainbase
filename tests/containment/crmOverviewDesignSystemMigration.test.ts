import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/crm/page.tsx'),
  'utf-8',
)

describe('C.1 CRM overview design-system migration', () => {
  it('uses shared BrainBase primitives and canonical tokens for page chrome', () => {
    expect(source).toContain("import { SectionHeader, Surface, TextLink } from '@/components/ui'")
    expect(source).toContain('<SectionHeader title="CRM" description="Companies, contacts, deals & activities" />')
    expect(source.match(/<Surface /g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toContain("var(--bb-border-default)")
    expect(source).toContain("var(--bb-text-primary)")
    expect(source).toContain("var(--bb-text-tertiary)")
    expect(source).toContain("var(--bb-text-muted)")
    expect(source).toContain("var(--bb-space-8)")
    expect(source).toContain("var(--bb-type-label-size)")
  })

  it('preserves the four CRM overview fetches and their existing limits', () => {
    for (const endpoint of [
      "fetch('/api/crm/deals')",
      "fetch('/api/crm/activities?limit=15')",
      "fetch('/api/crm/companies')",
      "fetch('/api/crm/contacts')",
    ]) {
      expect(source).toContain(endpoint)
    }
    expect(source).toContain('Promise.all([')
  })

  it('preserves overview calculations and loading behavior', () => {
    expect(source).toContain("const pipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage))")
    expect(source).toContain('const pipelineValue = pipeline.reduce((s, d) => s + (d.value ?? 0), 0)')
    expect(source).toContain("const wonValue = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value ?? 0), 0)")
    expect(source).toContain("{loading ? '—' : s.value}")
  })

  it('preserves all overview navigation destinations', () => {
    for (const href of [
      '/crm/companies',
      '/crm/contacts',
      '/crm/deals',
      '/crm/activities',
    ]) {
      expect(source.includes(`href: '${href}'`) || source.includes(`href="${href}"`)).toBe(true)
    }
  })

  it('preserves open-deal and recent-activity row limits and empty states', () => {
    expect(source).toContain('pipeline.slice(0, 6)')
    expect(source).toContain('activities.slice(0, 8)')
    expect(source).toContain('No open deals.')
    expect(source).toContain('No activity yet.')
    expect(source).toContain('Loading…')
  })

  it('preserves stage and activity category semantics', () => {
    expect(source).toContain("const STAGE_COLORS: Record<string, string> = { lead: '#6b7280', qualified: '#60a5fa', proposal: '#a78bfa', negotiation: '#fbbf24', closed_won: '#34d399', closed_lost: '#f87171' }")
    expect(source).toContain("const TYPE_ICONS: Record<string, string> = { call: '📞', email: '✉️', note: '📝', meeting: '🤝' }")
    expect(source).toContain('STAGE_COLORS[d.stage]')
    expect(source).toContain("TYPE_ICONS[a.type] ?? '•'")
  })

  it('does not add mutations, capability logic, routing state, or new persistence behavior', () => {
    expect(source).not.toContain('POST')
    expect(source).not.toContain('PATCH')
    expect(source).not.toContain('DELETE')
    expect(source).not.toContain('enabledCapabilities')
    expect(source).not.toContain('useRouter')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
  })

  it('removes the legacy generic chrome constants while retaining intentional data colours', () => {
    expect(source).not.toContain("const CARD = '#0e1014'")
    expect(source).not.toContain("const BORDER = '#1a1d24'")
    expect(source).not.toContain("color: '#6b7280'")
    expect(source).not.toContain("color: '#4b5563'")
    expect(source).not.toContain("color: '#f9fafb'")
    expect(source).not.toContain("color: '#1a6aff'")
    expect(source).toContain("qualified: '#60a5fa'")
    expect(source).toContain("closed_won: '#34d399'")
  })
})
