import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  BRAINBASE_ITEMS,
  isGateOpen,
  resolveNav,
  type NavContext,
  type NavEntry,
} from '@/components/nav/navModel'

// Phase C.2F — integrates the verified founder nav dropdown clipping fix
// (hotfix/founder-nav-dropdown-clipping, commit 26d4596) into this branch's
// current, C.2D-rewritten TopNav.tsx.
//
// Ported/adapted from that branch's tests/containment/
// founderNavDropdownRegression.test.ts. NOT a straight copy: that file's
// tenant-classification assertions targeted the OLD isClientOrg heuristic
// (!isSuperAdmin && enabledModules.length === 0) and an ADMIN_ITEMS list
// that included a "Client Events" entry this branch never received (both
// belong to a later point on main this branch diverged before). Updated
// here to assert against the CURRENT architecture: isLdTennis/isBrainbaseHQ
// tenant classification (see tests/containment/tenantAwareNavigation.test.ts
// for the dedicated suite covering that classification itself) and this
// branch's actual OPS_ITEMS/ADMIN_ITEMS content.
//
// UPDATED AGAIN during the D.2.3 origin/main reconciliation merge: the
// positioning-mechanism assertions below were rewritten wholesale. C.2F's
// own plain-`position:'fixed'` implementation (a `panelPos` state variable,
// a `triggerRef`) has been REPLACED with origin/main's independently-
// developed `createPortal(..., document.body)` implementation (commit
// f8c6449 "fix(nav): restore founder dropdowns and client access"), which
// D.2.2's reconciliation audit judged strictly more robust: an ancestor
// with any overflow value other than 'visible' clips ALL descendants that
// paint outside its box — including absolutely- AND fixed-positioned ones —
// as long as the element remains a DOM descendant of that ancestor: plain
// position:'fixed' does not reliably escape this, only a portal does. main's
// centre-nav row DOES carry `overflowX:'auto'` (added on main, not present
// when this branch was originally cut — see the superseded note this
// replaced), so main's fix addresses a clipping bug that plain
// position:'fixed' alone would not have reliably survived. The state/ref
// names below (`coords`, `wrapperRef`) are main's, not C.2F's.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): the
// founder Operations dropdown (OpsDropdown/OPS_ITEMS) and Admin dropdown
// (AdminDropdown/ADMIN_ITEMS) are now ONE "Brainbase" menu whose content is
// navModel.ts BRAINBASE_ITEMS, rendered by the single generic NavMenu that
// every desktop menu uses. The clipping-fix pins below therefore target
// NavMenu; the content/gating pins target the model (source-level AND
// behaviourally via resolveNav). APPROVED gating change: the founder menu is
// visible iff the REAL role is super_admin — independent of dashboardVariant
// (was: Operations behind isBrainbaseHQ, Admin behind isSuperAdmin). The
// Operations "CRM" duplicate is gone (CRM lives in Work) and "Pipeline" is
// labelled "Client requests".
//
// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other containment test in this suite).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavRaw = read('components/nav/TopNav.tsx')
const topNavSource = stripComments(topNavRaw)
const modelSource = stripComments(read('components/nav/navModel.ts'))

function fnBody(name: string): string {
  const start = topNavSource.indexOf(`function ${name}(`)
  expect(start, `function ${name} not found in TopNav.tsx`).toBeGreaterThan(-1)
  const end = topNavSource.indexOf('\nfunction ', start + 1)
  return topNavSource.slice(start, end === -1 ? undefined : end)
}

function brainbaseBlock(): string {
  const start = modelSource.indexOf('export const BRAINBASE_ITEMS')
  expect(start).toBeGreaterThan(-1)
  return modelSource.slice(start, modelSource.indexOf('\n];', start))
}

function groupBlock(block: string, id: string): string {
  const start = block.indexOf(`id: '${id}'`)
  expect(start, `group ${id} not found`).toBeGreaterThan(-1)
  return block.slice(start, block.indexOf('\n    ],', start))
}

function ctx(role: string, caps: string[] = [], dashboardVariant: NavContext['dashboardVariant'] = null): NavContext {
  return { role, enabledCapabilities: caps, dashboardVariant }
}

const labels = (entries: readonly NavEntry[]): string[] =>
  entries.flatMap(e => (e.kind === 'group' ? [e.label, ...e.children.map(c => c.label)] : [e.label]))

describe('TopNav — founder Operations/Admin dropdown clipping fix (integrated from hotfix/founder-nav-dropdown-clipping)', () => {
  it('OPS_ITEMS contains the founder\'s expected always-on items (Waste/Fleet/Social — no capabilityKey) plus capability-gated CRM', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // OPS_ITEMS → BRAINBASE_ITEMS' Operations group. Waste/Fleet/Social stay
    // capability-free (only the internal super_admin gate); CRM moved to Work,
    // still gated on the 'crm' capability, and no longer duplicated here.
    const ops = groupBlock(brainbaseBlock(), 'operations')
    for (const [label, href] of [['Waste', '/dashboard/wste'], ['Fleet', '/dashboard/fleet'], ['Social', '/dashboard/social']]) {
      expect(ops, `Operations missing ${label}`).toContain(`label: '${label}', href: '${href}'`)
    }
    expect(ops).not.toMatch(/anyCapability/)
    expect(ops).not.toContain("label: 'CRM'")
    const workStart = modelSource.indexOf('export const WORK_ITEMS')
    const work = modelSource.slice(workStart, modelSource.indexOf('\n];', workStart))
    expect(work).toMatch(/label: 'CRM', href: '\/crm'[\s\S]*?gate: \{ anyCapability: \['crm'\] \}/)
    // Behaviour: a super_admin sees Waste/Fleet/Social with NO capabilities
    // enabled; CRM appears only in Work and only with the capability.
    const noCaps = resolveNav(ctx('super_admin', []))
    const operations = noCaps.brainbase.find(e => e.id === 'operations')
    expect(operations?.kind).toBe('group')
    expect(operations && operations.kind === 'group' ? operations.children.map(c => c.label) : []).toEqual(
      ['Waste', 'Fleet', 'Social', 'All dashboards'],
    )
    expect(labels(noCaps.work)).not.toContain('CRM')
    expect(labels(resolveNav(ctx('super_admin', ['crm'])).work)).toContain('CRM')
    expect(labels(resolveNav(ctx('super_admin', ['crm'])).brainbase)).not.toContain('CRM')
  })

  it('ADMIN_ITEMS contains the founder\'s expected items and is never filtered by any capability/module list', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // ADMIN_ITEMS → BRAINBASE_ITEMS (Platform group + Client requests, which
    // is the renamed /admin/pipeline "Pipeline" entry). No entry in the whole
    // Brainbase menu depends on a capability or module.
    const block = brainbaseBlock()
    const platform = groupBlock(block, 'platform')
    for (const [label, href] of [['Organisations', '/admin/orgs'], ['Users', '/admin/users'], ['Setup', '/onboarding']]) {
      expect(platform, `Platform missing ${label}`).toContain(`label: '${label}', href: '${href}'`)
    }
    expect(block).toContain("label: 'Client requests', href: '/admin/pipeline'")
    expect(block).not.toMatch(/anyCapability|capabilityKey|enabledModules/)
    // Behaviour: identical Brainbase menu for a super_admin with no
    // capabilities and with every capability.
    const bare = labels(resolveNav(ctx('super_admin', [])).brainbase)
    const full = labels(resolveNav(ctx('super_admin', ['events', 'crm', 'quotes', 'organiser', 'people'])).brainbase)
    expect(full).toEqual(bare)
    for (const label of ['Organisations', 'Users', 'Client requests', 'Setup']) {
      expect(bare).toContain(label)
    }
  })

  it('AdminDropdown renders ADMIN_ITEMS unconditionally via a bare .map — no enabledCapabilities/enabledModules filter step exists', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // Brainbase menu renders nav.brainbase through MenuEntries (bare .map over
    // links and group children). The ONLY filter is the model's gate, and
    // every BRAINBASE_ITEMS gate is the internal (real super_admin) gate.
    const menuEntries = fnBody('MenuEntries')
    expect(menuEntries).toMatch(/links\.map\(/)
    expect(menuEntries).toMatch(/group\.children\.map\(/)
    expect(menuEntries).not.toMatch(/enabledCapabilities|enabledModules/)
    expect(fnBody('AppNav')).toMatch(/<MenuEntries entries=\{nav\.brainbase\}/)
    const walk = (entries: readonly NavEntry[]): void => {
      for (const e of entries) {
        expect(e.gate, `${e.id} must carry the internal gate`).toEqual({ internal: true })
        if (e.kind === 'group') walk(e.children)
      }
    }
    walk(BRAINBASE_ITEMS)
  })

  it('REGRESSION FIX: both OpsDropdown and AdminDropdown flyout panels are portaled to document.body and position:\'fixed\' (viewport-relative), not position:\'absolute\'', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): both
    // bespoke dropdowns are now the ONE generic NavMenu (Work, Manage,
    // Brainbase, Account all render through it), so the fix is pinned once,
    // on NavMenu, and the old components must not reappear.
    expect(topNavSource).not.toMatch(/function (OpsDropdown|AdminDropdown)\(/)
    const body = fnBody('NavMenu')
    const portalStart = body.indexOf('createPortal(')
    expect(portalStart, 'NavMenu panel must be rendered via createPortal').toBeGreaterThan(-1)
    expect(body.slice(body.indexOf('{open', portalStart - 200), portalStart)).toMatch(/coords\s*&&/)
    const panelStyle = body.slice(portalStart, body.indexOf('minWidth: 220', portalStart))
    expect(panelStyle).toMatch(/position:\s*'fixed'/)
    expect(panelStyle).not.toMatch(/position:\s*'absolute'/)
    expect(panelStyle).toMatch(/top:\s*coords\.top/)
    expect(panelStyle).toMatch(/left:\s*coords\.left/)
    expect(body).toContain('document.body')
    expect(fnBody('AppNav')).toMatch(/<NavMenu label="Brainbase" panelLabel="Brainbase"/)
  })

  it('REGRESSION FIX: both dropdowns measure the trigger\'s real screen position via getBoundingClientRect before opening, rather than relying on CSS-relative offset', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): pinned
    // on the single generic NavMenu (was OpsDropdown + AdminDropdown).
    const body = fnBody('NavMenu')
    expect(body, 'NavMenu must call getBoundingClientRect on its wrapper ref').toMatch(/wrapperRef\.current\?\.getBoundingClientRect\(\)/)
    expect(body, 'NavMenu must attach wrapperRef to its wrapper element').toMatch(/ref=\{wrapperRef\}/)
  })

  it('REGRESSION FIX: the panel keeps hover-open behaviour by attaching its own onMouseEnter/onMouseLeave, so moving the pointer from trigger to panel does not close it', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): pinned
    // on the single generic NavMenu (was OpsDropdown + AdminDropdown).
    const body = fnBody('NavMenu')
    const portalStart = body.indexOf('createPortal(')
    const panelHead = body.slice(portalStart, body.indexOf('minWidth: 220', portalStart))
    expect(panelHead, 'NavMenu panel must attach onMouseEnter/onMouseLeave').toMatch(/onMouseEnter=\{handleEnter\}/)
    expect(panelHead, 'NavMenu panel must attach onMouseEnter/onMouseLeave').toMatch(/onMouseLeave=\{handleLeave\}/)
  })

  it('Operations is gated on isBrainbaseHQ (not the broader isManager role check); Admin is gated on isSuperAdmin — matching C.2D\'s deliberate, unchanged gating for that item — neither depends on enabledModules/enabledCapabilities length', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // APPROVED gating change — Operations and Admin are one Brainbase menu,
    // visible iff the REAL role is super_admin (internal gate), independent
    // of dashboardVariant and of capability/module counts. The render site is
    // gated on the resolved (non-empty) Brainbase list.
    expect(modelSource).toMatch(/if \(gate\.internal && ctx\.role !== 'super_admin'\) return false;/)
    expect(topNavSource).toContain('{nav.brainbase.length > 0 && (\n          <NavMenu label="Brainbase"')
    for (const variant of [null, 'brainbase-hq', 'ld-tennis'] as const) {
      expect(resolveNav(ctx('super_admin', [], variant)).brainbase.length).toBeGreaterThan(0)
      for (const role of ['viewer', 'manager', 'admin', 'analyst']) {
        expect(resolveNav(ctx(role, ['events', 'crm'], variant)).brainbase).toEqual([])
      }
    }
    // Not the broader manager role check: manager/admin fail the internal gate.
    expect(isGateOpen({ internal: true }, ctx('admin', [], 'brainbase-hq'))).toBe(false)
    expect(isGateOpen({ internal: true }, ctx('super_admin', [], null))).toBe(true)
  })

  it('the LD Tennis branch never renders OpsDropdown or AdminDropdown — founder tools stay founder-only', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): there is
    // no isLdTennis branch any more (one universal render path). The invariant
    // — LD Tennis users never get founder tools — now holds via the model:
    // every non-super_admin role on the ld-tennis variant resolves an empty
    // Brainbase menu, and TopNav has no dashboardVariant branching.
    expect(topNavSource).not.toMatch(/isLdTennis|isBrainbaseHQ/)
    expect(fnBody('AppNav')).not.toMatch(/dashboardVariant\s*===/)
    for (const role of ['viewer', 'manager', 'admin', 'analyst']) {
      const nav = resolveNav(ctx(role, ['events', 'crm', 'quotes', 'organiser', 'people'], 'ld-tennis'))
      expect(nav.brainbase).toEqual([])
      expect(labels(nav.work)).not.toContain('Organisations')
      expect(labels(nav.manage)).not.toContain('Organisations')
    }
  })

  it('a generic tenant (isBrainbaseHQ false, isLdTennis false) never renders OpsDropdown or AdminDropdown — confirmed by the gate being the ONLY render site for each', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): exactly
    // one Brainbase render site on desktop (behind nav.brainbase.length) and
    // one in the mobile menu (same resolved list) — no ungated site exists.
    expect(topNavSource.match(/<OpsDropdown|<AdminDropdown/g) ?? []).toEqual([])
    expect((topNavSource.match(/entries=\{nav\.brainbase\}/g) ?? []).length).toBe(2)
    expect((topNavSource.match(/\{nav\.brainbase\.length > 0 && \(/g) ?? []).length).toBe(2)
    for (const role of ['viewer', 'manager', 'admin']) {
      expect(resolveNav(ctx(role, ['events', 'crm', 'quotes', 'organiser', 'people'], null)).brainbase).toEqual([])
    }
  })
})
