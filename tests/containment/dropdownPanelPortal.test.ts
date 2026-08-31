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

describe('TopNav dropdown panels — portaled outside the horizontally-scrolling nav row, never clipped by it', () => {
  it('react-dom\'s createPortal is imported and used — the panels are not rendered as a plain descendant of the scroll container', () => {
    expect(topNavSource).toContain("import { createPortal } from 'react-dom';")
    const portalCount = (topNavSource.match(/createPortal\(/g) ?? []).length
    expect(portalCount).toBe(2) // OpsDropdown + AdminDropdown, exactly
  })

  it('both dropdown panels are portaled to document.body — the actual target, not just calling createPortal without specifying it', () => {
    const portalCalls = topNavSource.match(/createPortal\(([\s\S]*?)\n {8}document\.body,/g) ?? []
    expect(portalCalls.length).toBe(2)
  })

  it('both panels use position: fixed with coordinates computed from the trigger\'s own getBoundingClientRect() — never position: absolute against an ancestor inside the scrolling row', () => {
    const fixedCount = (topNavSource.match(/position: 'fixed',\s*\n\s*top: coords\.top,\s*\n\s*left: coords\.left,/g) ?? []).length
    expect(fixedCount).toBe(2)
    const rectCount = (topNavSource.match(/wrapperRef\.current\?\.getBoundingClientRect\(\)/g) ?? []).length
    expect(rectCount).toBe(2)
  })

  it('each dropdown wrapper carries a ref (wrapperRef) used to measure its own position — not a hardcoded or guessed offset', () => {
    expect((topNavSource.match(/ref={wrapperRef}/g) ?? []).length).toBe(2)
  })

  it('coordinates are computed on hover-open (handleEnter), guarded by a coords !== null check before portaling, so the panel never renders at a stale (0,0) position before its first measurement', () => {
    expect((topNavSource.match(/if \(rect\) \{\s*\n\s*setCoords\(\{/g) ?? []).length).toBe(2)
    expect((topNavSource.match(/\{open &&\s*\n\s*coords &&/g) ?? []).length).toBe(2)
  })

  it('each portaled panel keeps its own onMouseEnter/onMouseLeave — required once portaled, since it is no longer a DOM descendant of the trigger\'s hover-tracking wrapper, so hovering the panel itself must independently cancel the close timer', () => {
    const panelsWithHandlers = topNavSource.match(/createPortal\(\s*\n\s*<div\s*\n\s*onMouseEnter={handleEnter}\s*\n\s*onMouseLeave={handleLeave}/g) ?? []
    expect(panelsWithHandlers.length).toBe(2)
  })

  it('the centre nav row\'s horizontal-scroll behaviour itself is untouched — overflowX: \'auto\' remains, so narrow-width scrolling still works; only the dropdown panels were moved out of its clipping subtree', () => {
    const centreIdx = topNavRawSource.indexOf('{/* Centre navigation')
    expect(centreIdx).toBeGreaterThan(-1)
    const centreBlock = topNavRawSource.slice(centreIdx, centreIdx + 1200)
    expect(centreBlock).toContain("overflowX: 'auto'")
  })

  it('OPS_ITEMS and ADMIN_ITEMS content is untouched by this fix — this is a rendering/positioning fix only, not a content or gating change', () => {
    const opsStart = topNavSource.indexOf('const OPS_ITEMS')
    const opsBody = topNavSource.slice(opsStart, topNavSource.indexOf('\n];', opsStart))
    for (const label of ['Waste', 'Fleet', 'Social', 'CRM']) {
      expect(opsBody).toMatch(new RegExp(`label:\\s*'${label}'`))
    }
    const adminStart = topNavSource.indexOf('const ADMIN_ITEMS')
    const adminBody = topNavSource.slice(adminStart, topNavSource.indexOf('\n];', adminStart))
    for (const label of ['Organisations', 'Users', 'Client Events', 'Pipeline', 'Setup']) {
      expect(adminBody).toMatch(new RegExp(`label:\\s*'${label}'`))
    }
  })
})
