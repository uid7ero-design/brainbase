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
// Also NOT ported: an assertion that the centre-nav row's overflowX:'auto'
// crowded-nav fix is preserved. That CSS does not exist on this branch at
// all — feat/hybrid-orbit-helena diverged from main before PR #72 (which
// introduced it) landed, confirmed via `grep -n overflowX
// components/nav/TopNav.tsx` returning nothing. The exact clipping bug this
// hotfix fixes therefore does not currently reproduce on this branch, but
// position:'fixed' positioned from a measured trigger rect is strictly more
// robust than position:'absolute' regardless of whether an ancestor
// currently constrains overflow, so the fix was still integrated
// defensively, per the C.2F task brief.
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

  it('REGRESSION FIX: both OpsDropdown and AdminDropdown flyout panels are position:\'fixed\' (viewport-relative), not position:\'absolute\'', () => {
    const opsFnStart = topNavSource.indexOf('function OpsDropdown(')
    const opsFnEnd = topNavSource.indexOf('\nfunction ', opsFnStart + 1)
    const opsBody = topNavSource.slice(opsFnStart, opsFnEnd)
    const opsPanelStart = opsBody.indexOf('{open && panelPos && (')
    expect(opsPanelStart, 'OpsDropdown panel must be gated on a measured panelPos, not open alone').toBeGreaterThan(-1)
    const opsPanelStyle = opsBody.slice(opsPanelStart, opsBody.indexOf('minWidth: 220', opsPanelStart))
    expect(opsPanelStyle).toMatch(/position:\s*'fixed'/)
    expect(opsPanelStyle).not.toMatch(/position:\s*'absolute'/)
    expect(opsPanelStyle).not.toMatch(/top:\s*'calc\(100% \+ 10px\)'/)

    const adminFnStart = topNavSource.indexOf('function AdminDropdown(')
    const adminFnEnd = topNavSource.indexOf('\nfunction ', adminFnStart + 1)
    const adminBody = topNavSource.slice(adminFnStart, adminFnEnd)
    const adminPanelStart = adminBody.indexOf('{open && panelPos && (')
    expect(adminPanelStart, 'AdminDropdown panel must be gated on a measured panelPos, not open alone').toBeGreaterThan(-1)
    const adminPanelStyle = adminBody.slice(adminPanelStart, adminBody.indexOf('minWidth: 220', adminPanelStart))
    expect(adminPanelStyle).toMatch(/position:\s*'fixed'/)
    expect(adminPanelStyle).not.toMatch(/position:\s*'absolute'/)
  })

  it('REGRESSION FIX: both dropdowns measure the trigger\'s real screen position via getBoundingClientRect before opening, rather than relying on CSS-relative offset', () => {
    for (const fn of ['OpsDropdown', 'AdminDropdown']) {
      const fnStart = topNavSource.indexOf(`function ${fn}(`)
      const fnEnd = topNavSource.indexOf('\nfunction ', fnStart + 1)
      const body = topNavSource.slice(fnStart, fnEnd)
      expect(body, `${fn} must call getBoundingClientRect on its trigger ref`).toMatch(/triggerRef\.current\?\.getBoundingClientRect\(\)/)
      expect(body, `${fn} must attach triggerRef to its wrapper element`).toMatch(/ref=\{triggerRef\}/)
    }
  })

  it('REGRESSION FIX: the panel keeps hover-open behaviour by attaching its own onMouseEnter/onMouseLeave, so moving the pointer from trigger to panel does not close it', () => {
    for (const fn of ['OpsDropdown', 'AdminDropdown']) {
      const fnStart = topNavSource.indexOf(`function ${fn}(`)
      const fnEnd = topNavSource.indexOf('\nfunction ', fnStart + 1)
      const body = topNavSource.slice(fnStart, fnEnd)
      const panelStart = body.indexOf('{open && panelPos && (')
      const panelHead = body.slice(panelStart, body.indexOf('minWidth: 220', panelStart))
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
