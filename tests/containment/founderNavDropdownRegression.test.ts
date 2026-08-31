import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

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

describe('TopNav — founder Operations/Admin dropdown clipping fix (integrated from hotfix/founder-nav-dropdown-clipping)', () => {
  it('OPS_ITEMS contains the founder\'s expected always-on items (Waste/Fleet/Social — no capabilityKey) plus capability-gated CRM', () => {
    const start = topNavSource.indexOf('const OPS_ITEMS = [')
    const end = topNavSource.indexOf('];', start)
    const block = topNavSource.slice(start, end)
    for (const label of ["label: 'Waste'", "label: 'Fleet'", "label: 'Social'", "label: 'CRM'"]) {
      expect(block, `OPS_ITEMS missing ${label}`).toContain(label)
    }
    expect(block).toMatch(/capabilityKey:\s*'crm'/)
    const wasteEntry = block.slice(block.indexOf("label: 'Waste'"), block.indexOf("label: 'Fleet'"))
    const fleetEntry = block.slice(block.indexOf("label: 'Fleet'"), block.indexOf("label: 'Social'"))
    const socialEntry = block.slice(block.indexOf("label: 'Social'"), block.indexOf("label: 'CRM'"))
    for (const entry of [wasteEntry, fleetEntry, socialEntry]) {
      expect(entry).not.toMatch(/capabilityKey/)
    }
  })

  it('ADMIN_ITEMS contains the founder\'s expected items and is never filtered by any capability/module list', () => {
    const start = topNavSource.indexOf('const ADMIN_ITEMS = [')
    const end = topNavSource.indexOf('];', start)
    const block = topNavSource.slice(start, end)
    for (const label of ["label: 'Organisations'", "label: 'Users'", "label: 'Pipeline'", "label: 'Setup'"]) {
      expect(block, `ADMIN_ITEMS missing ${label}`).toContain(label)
    }
    expect(block).not.toMatch(/capabilityKey/)
  })

  it('AdminDropdown renders ADMIN_ITEMS unconditionally via a bare .map — no enabledCapabilities/enabledModules filter step exists', () => {
    const fnStart = topNavSource.indexOf('function AdminDropdown(')
    const fnEnd = topNavSource.indexOf('\nfunction ', fnStart + 1)
    const body = topNavSource.slice(fnStart, fnEnd)
    expect(body).toMatch(/ADMIN_ITEMS\.map\(/)
    expect(body).not.toMatch(/ADMIN_ITEMS\.filter\(/)
    expect(body).not.toContain('enabledModules')
  })

  it('REGRESSION FIX: both OpsDropdown and AdminDropdown flyout panels are portaled to document.body and position:\'fixed\' (viewport-relative), not position:\'absolute\'', () => {
    const opsFnStart = topNavSource.indexOf('function OpsDropdown(')
    const opsFnEnd = topNavSource.indexOf('\nfunction ', opsFnStart + 1)
    const opsBody = topNavSource.slice(opsFnStart, opsFnEnd)
    const opsPortalStart = opsBody.indexOf('createPortal(')
    expect(opsPortalStart, 'OpsDropdown panel must be rendered via createPortal').toBeGreaterThan(-1)
    expect(opsBody.slice(opsBody.indexOf('{open', opsPortalStart - 200), opsPortalStart)).toMatch(/coords\s*&&/)
    const opsPanelStyle = opsBody.slice(opsPortalStart, opsBody.indexOf('minWidth: 220', opsPortalStart))
    expect(opsPanelStyle).toMatch(/position:\s*'fixed'/)
    expect(opsPanelStyle).not.toMatch(/position:\s*'absolute'/)
    expect(opsPanelStyle).toMatch(/top:\s*coords\.top/)
    expect(opsPanelStyle).toMatch(/left:\s*coords\.left/)
    expect(opsBody).toContain('document.body')

    const adminFnStart = topNavSource.indexOf('function AdminDropdown(')
    const adminFnEnd = topNavSource.indexOf('\nfunction ', adminFnStart + 1)
    const adminBody = topNavSource.slice(adminFnStart, adminFnEnd)
    const adminPortalStart = adminBody.indexOf('createPortal(')
    expect(adminPortalStart, 'AdminDropdown panel must be rendered via createPortal').toBeGreaterThan(-1)
    expect(adminBody.slice(adminBody.indexOf('{open', adminPortalStart - 200), adminPortalStart)).toMatch(/coords\s*&&/)
    const adminPanelStyle = adminBody.slice(adminPortalStart, adminBody.indexOf('minWidth: 220', adminPortalStart))
    expect(adminPanelStyle).toMatch(/position:\s*'fixed'/)
    expect(adminPanelStyle).not.toMatch(/position:\s*'absolute'/)
    expect(adminBody).toContain('document.body')
  })

  it('REGRESSION FIX: both dropdowns measure the trigger\'s real screen position via getBoundingClientRect before opening, rather than relying on CSS-relative offset', () => {
    for (const fn of ['OpsDropdown', 'AdminDropdown']) {
      const fnStart = topNavSource.indexOf(`function ${fn}(`)
      const fnEnd = topNavSource.indexOf('\nfunction ', fnStart + 1)
      const body = topNavSource.slice(fnStart, fnEnd)
      expect(body, `${fn} must call getBoundingClientRect on its wrapper ref`).toMatch(/wrapperRef\.current\?\.getBoundingClientRect\(\)/)
      expect(body, `${fn} must attach wrapperRef to its wrapper element`).toMatch(/ref=\{wrapperRef\}/)
    }
  })

  it('REGRESSION FIX: the panel keeps hover-open behaviour by attaching its own onMouseEnter/onMouseLeave, so moving the pointer from trigger to panel does not close it', () => {
    for (const fn of ['OpsDropdown', 'AdminDropdown']) {
      const fnStart = topNavSource.indexOf(`function ${fn}(`)
      const fnEnd = topNavSource.indexOf('\nfunction ', fnStart + 1)
      const body = topNavSource.slice(fnStart, fnEnd)
      const portalStart = body.indexOf('createPortal(')
      const panelHead = body.slice(portalStart, body.indexOf('minWidth: 220', portalStart))
      expect(panelHead, `${fn} panel must attach onMouseEnter/onMouseLeave`).toMatch(/onMouseEnter=\{handleEnter\}/)
      expect(panelHead, `${fn} panel must attach onMouseEnter/onMouseLeave`).toMatch(/onMouseLeave=\{handleLeave\}/)
    }
  })

  it('Operations is gated on isBrainbaseHQ (not the broader isManager role check); Admin is gated on isSuperAdmin — matching C.2D\'s deliberate, unchanged gating for that item — neither depends on enabledModules/enabledCapabilities length', () => {
    const opsGateIdx = topNavSource.indexOf('{isBrainbaseHQ && (\n              <OpsDropdown')
    expect(opsGateIdx, 'OpsDropdown render site not found behind an isBrainbaseHQ gate').toBeGreaterThan(-1)
    const adminGateIdx = topNavSource.indexOf('{isSuperAdmin && (\n              <AdminDropdown')
    expect(adminGateIdx, 'AdminDropdown render site not found behind an isSuperAdmin gate').toBeGreaterThan(-1)
  })

  it('the LD Tennis branch never renders OpsDropdown or AdminDropdown — founder tools stay founder-only', () => {
    const ldTennisBlockStart = topNavSource.indexOf('{isLdTennis ? (')
    expect(ldTennisBlockStart, 'isLdTennis branch not found').toBeGreaterThan(-1)
    const ldTennisBlockEnd = topNavSource.indexOf(') : (', ldTennisBlockStart)
    const ldTennisBlock = topNavSource.slice(ldTennisBlockStart, ldTennisBlockEnd)
    expect(ldTennisBlock).not.toContain('<OpsDropdown')
    expect(ldTennisBlock).not.toContain('<AdminDropdown')
  })

  it('a generic tenant (isBrainbaseHQ false, isLdTennis false) never renders OpsDropdown or AdminDropdown — confirmed by the gate being the ONLY render site for each', () => {
    const opsOccurrences = topNavSource.match(/<OpsDropdown/g) ?? []
    const adminOccurrences = topNavSource.match(/<AdminDropdown/g) ?? []
    // Exactly one render site each (inside the isBrainbaseHQ-gated block
    // already proven above) — if a second, ungated render site existed
    // anywhere, a generic tenant could reach it.
    expect(opsOccurrences.length).toBe(1)
    expect(adminOccurrences.length).toBe(1)
  })
})
