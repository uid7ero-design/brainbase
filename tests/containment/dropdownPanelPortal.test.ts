import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts / containment test in this suite). The
// actual visual/geometric proof for this fix was gathered separately, with
// a real headless browser (Playwright, installed transiently for this
// investigation, not added as a project dependency) — see the accompanying
// report for the full DOM/computed-style/screenshot evidence. These tests
// exist to make the specific structural cause impossible to silently
// reintroduce.
//
// ROOT CAUSE: OpsDropdown's and AdminDropdown's panels were rendered as a
// plain DOM child of their own `position: relative` wrapper, itself a
// child of TopNav's centre nav row. That row gained `overflowX: 'auto'`
// (paired with an explicit `overflowY: 'hidden'`) in an earlier pass to
// make a crowded/narrow nav horizontally scrollable. CSS clipping via
// `overflow` applies to ALL painted descendants of the clipping ancestor,
// regardless of their own `position` value or which element establishes
// their positioning containing block — an absolutely-positioned panel
// nested inside an `overflow-x:auto` row is clipped to that row's ~32px
// tall box the instant it extends below it, even though the panel's own
// computed style (display/visibility/opacity/z-index) all look completely
// correct in isolation. Confirmed in a real browser: the panel existed in
// the DOM with a correct bounding box and computed style, but rendered
// zero visible pixels — exactly matching the reported "arrow rotates,
// nothing appears" symptom. The fix moves each panel into a React portal
// (`createPortal(..., document.body)`), positioned `fixed` at coordinates
// computed from the trigger's own `getBoundingClientRect()` — this removes
// the panel from the DOM subtree of any clipping ancestor entirely, which
// is the only fix that is robust regardless of how the nav row's overflow
// is configured (z-index cannot escape ancestor overflow clipping, and
// `position: fixed` alone does not either while the element remains a DOM
// descendant of the clipping ancestor).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavRawSource = read('components/nav/TopNav.tsx')
const topNavSource = stripComments(topNavRawSource)
const cssSource = read('components/nav/AppChrome.module.css')

// Nav consolidation update (feat/authenticated-nav-consolidation): the two
// bespoke OpsDropdown/AdminDropdown components were replaced by ONE generic
// NavMenu (rendered for Work, Manage, Brainbase and Account) plus the ≤767px
// MobileMenu. Both of those are portaled. The per-panel pins below now target
// the single NavMenu definition (so every desktop menu inherits the fix) and
// the MobileMenu panel.
function fnBody(name: string): string {
  const start = topNavSource.indexOf(`function ${name}(`)
  expect(start, `function ${name} not found in TopNav.tsx`).toBeGreaterThan(-1)
  const end = topNavSource.indexOf('\nfunction ', start + 1)
  return topNavSource.slice(start, end === -1 ? undefined : end)
}

describe('TopNav dropdown panels — portaled outside the horizontally-scrolling nav row, never clipped by it', () => {
  it('react-dom\'s createPortal is imported and used — the panels are not rendered as a plain descendant of the scroll container', () => {
    expect(topNavSource).toContain("import { createPortal } from 'react-dom';")
    const portalCount = (topNavSource.match(/createPortal\(/g) ?? []).length
    // Nav consolidation update (feat/authenticated-nav-consolidation): the 2
    // portals are now NavMenu (all desktop menus) + MobileMenu, exactly.
    expect(portalCount).toBe(2)
    expect((fnBody('NavMenu').match(/createPortal\(/g) ?? []).length).toBe(1)
    expect((fnBody('MobileMenu').match(/createPortal\(/g) ?? []).length).toBe(1)
    // The old bespoke dropdowns are gone — no second, unportaled menu path.
    expect(topNavSource).not.toMatch(/function (OpsDropdown|AdminDropdown)\(/)
  })

  it('both dropdown panels are portaled to document.body — the actual target, not just calling createPortal without specifying it', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // generic NavMenu/MobileMenu nest one level deeper, so the indentation of
    // `document.body,` changed; the target itself is still pinned exactly.
    const portalCalls = topNavSource.match(/createPortal\(([\s\S]*?)\n\s*document\.body,\s*\n\s*\)\}/g) ?? []
    expect(portalCalls.length).toBe(2)
    expect(fnBody('NavMenu')).toMatch(/createPortal\([\s\S]*?\n\s*document\.body,/)
    expect(fnBody('MobileMenu')).toMatch(/createPortal\([\s\S]*?\n\s*document\.body,/)
  })

  it('both panels use position: fixed with coordinates computed from the trigger\'s own getBoundingClientRect() — never position: absolute against an ancestor inside the scrolling row', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): one
    // generic NavMenu serves every desktop menu, so exactly ONE fixed,
    // measured panel definition exists (was 2 copies). The mobile panel is
    // fixed via .mobilePanel, anchored under the bar at TOP_NAV_HEIGHT_PX.
    const navMenu = fnBody('NavMenu')
    const fixedCount = (topNavSource.match(/position: 'fixed',\s*\n\s*top: coords\.top,\s*\n\s*left: coords\.left,/g) ?? []).length
    expect(fixedCount).toBe(1)
    expect(navMenu).toMatch(/position: 'fixed',\s*\n\s*top: coords\.top,\s*\n\s*left: coords\.left,/)
    const rectCount = (topNavSource.match(/wrapperRef\.current\?\.getBoundingClientRect\(\)/g) ?? []).length
    expect(rectCount).toBe(1)
    expect(navMenu).toMatch(/wrapperRef\.current\?\.getBoundingClientRect\(\)/)
    expect(topNavSource).not.toMatch(/position:\s*'absolute'/)
    const mobile = fnBody('MobileMenu')
    expect(mobile).toMatch(/className=\{styles\.mobilePanel\}/)
    expect(mobile).toMatch(/style=\{\{ top: TOP_NAV_HEIGHT_PX \}\}/)
    const mobilePanelRule = cssSource.slice(cssSource.indexOf('.mobilePanel {'), cssSource.indexOf('}', cssSource.indexOf('.mobilePanel {')))
    expect(mobilePanelRule).toMatch(/position:\s*fixed;/)
  })

  it('each dropdown wrapper carries a ref (wrapperRef) used to measure its own position — not a hardcoded or guessed offset', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): one
    // wrapperRef in the single generic NavMenu (was one per bespoke dropdown).
    expect((topNavSource.match(/ref={wrapperRef}/g) ?? []).length).toBe(1)
    expect(fnBody('NavMenu')).toMatch(/ref=\{wrapperRef\}/)
  })

  it('coordinates are computed on hover-open (handleEnter), guarded by a coords !== null check before portaling, so the panel never renders at a stale (0,0) position before its first measurement', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): exactly
    // one measured-panel implementation now (NavMenu), pinned inside it.
    const navMenu = fnBody('NavMenu')
    expect((topNavSource.match(/if \(rect\) \{\s*\n\s*setCoords\(\{/g) ?? []).length).toBe(1)
    expect(navMenu).toMatch(/function handleEnter\(\) \{[\s\S]*?if \(rect\) \{\s*\n\s*setCoords\(\{/)
    expect((topNavSource.match(/\{open &&\s*\n\s*coords &&/g) ?? []).length).toBe(1)
    expect(navMenu).toMatch(/\{open &&\s*\n\s*coords &&\s*\n\s*typeof document !== 'undefined' &&\s*\n\s*createPortal\(/)
  })

  it('each portaled panel keeps its own onMouseEnter/onMouseLeave — required once portaled, since it is no longer a DOM descendant of the trigger\'s hover-tracking wrapper, so hovering the panel itself must independently cancel the close timer', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // hover-opening desktop panel is the single NavMenu panel. (MobileMenu is
    // click-only, so it has no hover timer to cancel.)
    const panelsWithHandlers = topNavSource.match(/createPortal\(\s*\n\s*<div\s*\n\s*onMouseEnter={handleEnter}\s*\n\s*onMouseLeave={handleLeave}/g) ?? []
    expect(panelsWithHandlers.length).toBe(1)
    expect(fnBody('NavMenu')).toMatch(/createPortal\(\s*\n\s*<div\s*\n\s*onMouseEnter={handleEnter}\s*\n\s*onMouseLeave={handleLeave}/)
    // Every desktop menu goes through that one NavMenu: Work, Manage,
    // Brainbase and Account.
    expect((topNavSource.match(/<NavMenu\b/g) ?? []).length).toBe(4)
  })

  it('the centre nav row\'s horizontal-scroll behaviour itself is untouched — overflowX: \'auto\' remains, so narrow-width scrolling still works; only the dropdown panels were moved out of its clipping subtree', () => {
    const centreIdx = topNavRawSource.indexOf('{/* Centre navigation')
    expect(centreIdx).toBeGreaterThan(-1)
    const centreBlock = topNavRawSource.slice(centreIdx, centreIdx + 1200)
    expect(centreBlock).toContain("overflowX: 'auto'")
  })

  it('OPS_ITEMS and ADMIN_ITEMS content is untouched by this fix — this is a rendering/positioning fix only, not a content or gating change', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // founder Operations/Admin content moved from TopNav's OPS_ITEMS /
    // ADMIN_ITEMS into navModel.ts BRAINBASE_ITEMS (Operations + Platform
    // groups). Approved changes: the Operations "CRM" duplicate is gone (CRM
    // lives in Work, still capability-gated) and "Pipeline" is now labelled
    // "Client requests" (same /admin/pipeline href). Everything else is pinned
    // with its exact href.
    const modelSource = stripComments(read('components/nav/navModel.ts'))
    const bbStart = modelSource.indexOf('export const BRAINBASE_ITEMS')
    expect(bbStart).toBeGreaterThan(-1)
    const bbBody = modelSource.slice(bbStart, modelSource.indexOf('\n];', bbStart))
    const expected: Array<[string, string]> = [
      ['Waste', '/dashboard/wste'], ['Fleet', '/dashboard/fleet'], ['Social', '/dashboard/social'],
      ['Organisations', '/admin/orgs'], ['Users', '/admin/users'], ['Client Events', '/admin/client-events'],
      ['Client requests', '/admin/pipeline'], ['Setup', '/onboarding'],
    ]
    for (const [label, href] of expected) {
      expect(bbBody).toMatch(new RegExp(`label:\\s*'${label}',\\s*href:\\s*'${href.replace(/\//g, '\\/')}'`))
    }
    expect(bbBody).not.toMatch(/label:\s*'CRM'/)
    const workStart = modelSource.indexOf('export const WORK_ITEMS')
    const workBody = modelSource.slice(workStart, modelSource.indexOf('\n];', workStart))
    expect(workBody).toMatch(/label: 'CRM', href: '\/crm'[\s\S]*?gate: \{ anyCapability: \['crm'\] \}/)
    // TopNav itself holds no menu content any more — it renders the model.
    expect(topNavSource).not.toMatch(/const (OPS_ITEMS|ADMIN_ITEMS)\b/)
    expect(topNavSource).toMatch(/resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\)/)
  })
})
