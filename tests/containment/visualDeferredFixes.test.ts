import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { LEAD_STATUS_STATE, leadStatusLabel, leadStatusState } from '@/app/dashboard/leads/leadStatus'

// Deferred-issues pass after the authenticated visual-completion work.
// N1/N2: page roots that shrank to fit their content (flex child + auto side
// margins) let a wide child widen the whole page at phone width.
// N4: Organiser view switch selected state (4.35:1 in light).
// N5: missing page h1s and raw lead status copy.
// Layout itself is verified in a real browser; these pins keep the fixes in place.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

describe('N1 — Sessions page cannot be widened by the week calendar', () => {
  const src = strip(read('app/dashboard/sessions/page.tsx'))
  it('the page root is bounded to its container', () => {
    expect(src).toContain("<div style={{ width: '100%', boxSizing: 'border-box', maxWidth: 1400, margin: '0 auto', padding: '32px 16px', fontFamily: FONT, color: 'var(--text-primary)', minWidth: 0 }}>")
  })
  it('the seven-day grid keeps its usable minimum and scrolls inside its own wrapper', () => {
    expect(src).toContain("<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, minWidth: 700 }}>")
    expect(src).toMatch(/<div style=\{\{ overflowX: 'auto', paddingBottom: 4 \}\}>\s*\{calendarView === 'week' \? \(\s*<WeekGrid /)
  })
})

describe('N2 — Event detail cannot be widened by its metric strip', () => {
  it('the page root is bounded to its container', () => {
    const src = strip(read('app/events/[id]/EventDetailClient.tsx'))
    expect(src).toContain("<div style={{ width: '100%', boxSizing: 'border-box', padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 1140, margin: '0 auto' }}>")
    expect(src).toContain('<MetricStrip style={{ marginTop: 20 }}>')
  })
  it('keeps the earlier QuestionsPanel action-row wrap', () => {
    expect(read('app/events/[id]/QuestionsPanel.tsx')).toContain("alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}")
  })
})

describe('N4 — Organiser view switch selected state is readable and keeps the focus ring', () => {
  const css = strip(read('components/organiser/Organiser.module.css'))
  const rule = (sel: string) => css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')) + 1)
  it('selected = raised surface + accent ring + accent text (not accent on accent tint)', () => {
    const sel = rule(".viewButton[aria-pressed='true']")
    expect(sel).toMatch(/background:\s*var\(--bg-surface\)/)
    expect(sel).toMatch(/border-color:\s*var\(--brand-brainbase-accent-border\)/)
    expect(sel).toMatch(/color:\s*var\(--brand-brainbase-accent\)/)
    expect(sel).not.toMatch(/accent-muted/)
  })
  it('uses a border, never outline or box-shadow, so :focus-visible still wins', () => {
    expect(rule('.viewButton')).toMatch(/border:\s*1px solid transparent/)
    for (const sel of ['.viewButton', ".viewButton[aria-pressed='true']"]) expect(rule(sel)).not.toMatch(/outline|box-shadow/)
  })
})

describe('N5 — headings and status copy', () => {
  it('/hlna has one visually hidden page h1 and the wordmark stays the visual identity', () => {
    const src = strip(read('components/helena/HelenaWorkspace.jsx'))
    expect((src.match(/<h1\b/g) ?? []).length).toBe(1)
    expect(src).toContain('<h1 className="sr-only">HLNΛ workspace</h1>')
    expect(src).toContain('<BrainBaseWordmark width={116} />')
  })

  it('Bin Maintenance Insights has exactly one h1, via the shared PageHeader', () => {
    const page = strip(read('app/dashboard/bin-maintenance/insights/page.tsx'))
    expect(page).toContain('<PageHeader title="Bin Maintenance Insights" />')
    expect(page).not.toMatch(/titleAs=/)
    const dir = path.join(root, 'app/dashboard/bin-maintenance/insights/tabs')
    const others = [page, ...fs.readdirSync(dir).map(f => strip(read(`app/dashboard/bin-maintenance/insights/tabs/${f}`))), strip(read('components/ops/widgets/Widget.tsx'))]
    expect(others.reduce((n, s) => n + (s.match(/<h1\b|<PageHeader\b/g) ?? []).length, 0)).toBe(1)
  })

  it('lead status badges render display copy, never the raw stored value', () => {
    for (const p of ['app/dashboard/leads/page.tsx', 'app/dashboard/leads/[id]/page.tsx']) {
      const src = strip(read(p))
      expect(src, p).toMatch(/leadStatusLabel\(lead\.status( as string)?\)/)
      expect(src, p).not.toMatch(/>\s*\{lead\.status( as string)?\}\s*</)
    }
  })

  it('leadStatusLabel humanises display copy without touching the domain value', () => {
    expect(leadStatusLabel('in_progress')).toBe('In Progress')
    expect(leadStatusLabel('new')).toBe('New')
    expect(leadStatusLabel('cancelled')).toBe('Cancelled')
    expect(leadStatusLabel('awaiting_parent_reply')).toBe('Awaiting parent reply')
    expect(leadStatusLabel('')).toBe('')
    // State mapping (colour/meaning) and the enum keys are unchanged.
    expect(Object.keys(LEAD_STATUS_STATE)).toEqual(['new', 'contacted', 'in_progress', 'booked', 'closed', 'cancelled'])
    expect(leadStatusState('in_progress')).toBe('warning')
    expect(leadStatusState('unknown')).toBe('info')
  })

  it('the status picker still submits the raw enum values with matching labels', () => {
    const picker = read('app/dashboard/leads/[id]/LeadStatusPicker.tsx')
    expect(picker).toContain("{ value: 'in_progress', label: 'In Progress', state: 'warning' }")
  })
})
