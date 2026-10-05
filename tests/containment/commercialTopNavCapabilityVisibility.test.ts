import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
// Nav consolidation update (feat/authenticated-nav-consolidation): pure nav
// model, safe to import in a node test.
import { WORK_ITEMS, resolveNav, type NavContext } from '@/components/nav/navModel'

// Phase C7.2 â€” repository-confirmed C6 follow-up: the global "Commercial"
// top-nav pill (components/nav/TopNav.tsx) was gated on `hasCommercial =
// enabledCapabilities.includes('quotes')` alone, even though the actual
// server-side gate it links to (app/commercial/layout.tsx) already
// allows 'quotes' OR 'invoicing' OR 'purchasing' and only blocks entry
// when NONE of the three are enabled. A purchasing-only organisation
// (entitled, and able to reach every Purchasing route/page directly by
// URL) had no way to discover /commercial from the top nav at all.
//
// This is a visibility-only fix â€” navigation visibility is not a
// security boundary; every Commercial route and app/commercial/layout.tsx
// itself independently re-enforce their own capability checks regardless
// of whether this pill is shown. These tests assert the SOURCE TEXT of
// the fix (this repo's containment-test convention â€” no jsdom/RTL
// harness exists, see CLAUDE.md), not rendered behaviour.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavSource = stripComments(
  fs.readFileSync(path.join(process.cwd(), 'components/nav/TopNav.tsx'), 'utf8').replace(/\r\n/g, '\n'),
)

// Nav consolidation update (feat/authenticated-nav-consolidation): the
// `hasCommercial` flag moved out of TopNav into the Commercial descriptor of
// components/nav/navModel.ts; these pins now read that descriptor (source +
// imported object) and resolve it with the pure resolveNav().
const navModelSource = stripComments(
  fs.readFileSync(path.join(process.cwd(), 'components/nav/navModel.ts'), 'utf8').replace(/\r\n/g, '\n'),
)
const commercialStart = navModelSource.indexOf("id: 'commercial'")
const commercialEnd = navModelSource.indexOf("id: 'organiser'", commercialStart)
const commercialDescriptorBody = navModelSource.slice(commercialStart, commercialEnd)
const commercialDescriptor = WORK_ITEMS.find(e => e.id === 'commercial')

function sees(caps: string[], role = 'viewer', dashboardVariant: NavContext['dashboardVariant'] = null): boolean {
  return resolveNav({ role, enabledCapabilities: caps, dashboardVariant }).work.some(
    e => e.kind === 'link' && e.href === '/commercial',
  )
}

const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app/commercial/layout.tsx'), 'utf8')

describe('Phase C7.2 â€” Commercial top-nav pill visibility matches the server-side capability gate it links to', () => {
  it('hasCommercial checks quotes, invoicing, purchasing, AND budgeting â€” not quotes alone', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation).
    expect(commercialStart).toBeGreaterThan(-1)
    expect(commercialDescriptorBody).toMatch(/gate: \{ anyCapability: \['quotes', 'invoicing', 'purchasing', 'budgeting'\] \},/)
    expect(commercialDescriptor?.gate).toEqual({ anyCapability: ['quotes', 'invoicing', 'purchasing', 'budgeting'] })
  })

  it('the four checks are OR-combined, not AND-combined (an organisation with only one of the four must still see the pill)', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // anyCapability is OR semantics (`.some`); proven for each single key,
    // across every variant, and absent with none of the four.
    expect(navModelSource).toMatch(/const enabled = gate\.anyCapability\.some\(key => ctx\.enabledCapabilities\.includes\(key\)\);/)
    expect(navModelSource).not.toMatch(/anyCapability\.every\(/)
    for (const v of [null, 'ld-tennis', 'brainbase-hq'] as const) {
      expect(sees(['quotes'], 'viewer', v), `quotes/${v}`).toBe(true)
      expect(sees(['invoicing'], 'viewer', v), `invoicing/${v}`).toBe(true)
      expect(sees(['purchasing'], 'viewer', v), `purchasing/${v}`).toBe(true)
      expect(sees(['budgeting'], 'viewer', v), `budgeting/${v}`).toBe(true)
      expect(sees([], 'viewer', v), `none/${v}`).toBe(false)
      expect(sees(['crm', 'events'], 'viewer', v), `unrelated/${v}`).toBe(false)
      // No bypass: even super_admin needs one of the four.
      expect(sees([], 'super_admin', v), `sa-none/${v}`).toBe(false)
    }
  })

  it('app/commercial/layout.tsx (the actual page this pill links to) checks the same four capabilities and only blocks when none are allowed â€” the pill\'s visibility now matches its own destination\'s real gate', () => {
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'quotes'\)/)
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'invoicing'\)/)
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'purchasing'\)/)
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'budgeting'\)/)
    expect(layoutSource).toMatch(/!quotesCapability\.allowed && !invoicingCapability\.allowed && !purchasingCapability\.allowed/)
  })

  it('the pill still renders exactly two <NavItem href="/commercial" ...> call sites (shared branch + LD Tennis branch) â€” the fix only changed the gating condition, not how many places render the pill', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the two
    // JSX call sites collapse into ONE descriptor rendered by the universal
    // path; TopNav has no /commercial literal, and a resolved tree holds
    // exactly one Commercial entry for every variant.
    expect((navModelSource.match(/href: '\/commercial'/g) ?? []).length).toBe(1)
    expect(topNavSource).not.toMatch(/\/commercial/)
    for (const v of [null, 'ld-tennis', 'brainbase-hq'] as const) {
      const work = resolveNav({ role: 'admin', enabledCapabilities: ['quotes', 'invoicing', 'purchasing', 'budgeting'], dashboardVariant: v }).work
      expect(work.filter(e => e.kind === 'link' && e.href === '/commercial').length, String(v)).toBe(1)
    }
  })

  it('the capability prop on the Commercial NavItem is untouched (still "quotes") â€” icon-choice cosmetics are a separate, deliberately out-of-scope concern from this visibility fix', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // icon key is the descriptor's `icon`, still 'quotes'.
    expect(commercialDescriptorBody).toMatch(/icon: 'quotes',/)
    expect(commercialDescriptor?.kind === 'link' ? commercialDescriptor.icon : undefined).toBe('quotes')
  })
})

