import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6D — the UI half of Organiser context awareness: publishing
// the current board/item to useAppStore, reading it back in
// hooks/useHelena.js's request body, and giving app/organiser its own
// embedded Helena chat surface. Static source-text containment — this
// repo has no jsdom/React Testing Library harness (see
// organiserShellBoundary.test.ts's own identical note).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

const pageSource = read('app/organiser/page.tsx')
const layoutSource = read('app/organiser/layout.tsx')
const storeSource = read('lib/state/useAppStore.js')
const helenaSource = read('hooks/useHelena.js')

describe('useAppStore — organiserContext field (Phase D.4.6D)', () => {
  it('defines organiserContext and setOrganiserContext', () => {
    expect(storeSource).toMatch(/organiserContext:\s*null,/)
    expect(storeSource).toMatch(/setOrganiserContext:\s*\(ctx\) => set\(\{ organiserContext: ctx \}\),/)
  })

  it('organiserContext is NOT in the persist() partialize whitelist — it must never survive a reload, unlike activeModule', () => {
    const partializeIdx = storeSource.indexOf('partialize: (state) => ({')
    expect(partializeIdx).toBeGreaterThan(-1)
    const partializeEnd = storeSource.indexOf('})', partializeIdx)
    const block = storeSource.slice(partializeIdx, partializeEnd)
    expect(block).not.toMatch(/organiserContext/)
    // activeModule IS persisted (a pre-existing, documented staleness
    // trade-off this phase does not change) — asserted here so a future
    // edit that also persists organiserContext fails loudly.
    expect(block).toMatch(/activeModule:\s*state\.activeModule,/)
  })
})

describe('hooks/useHelena.js — organiserContext request wiring', () => {
  it('sendMessage reads organiserContext from useAppStore.getState(), never from a local ref/prop, mirroring moduleKey\'s own pattern', () => {
    expect(helenaSource).toMatch(/organiserContext:\s*useAppStore\.getState\(\)\.organiserContext \|\| undefined,/)
  })

  it('sends undefined (not an empty object) when no Organiser context exists, so the server sees "no hint" rather than a present-but-empty one', () => {
    const idx = helenaSource.indexOf('organiserContext:')
    const line = helenaSource.slice(idx, helenaSource.indexOf('\n', idx))
    expect(line).toMatch(/\|\| undefined/)
  })
})

describe('app/organiser/page.tsx — publishing current board/item context', () => {
  it('imports useAppStore', () => {
    expect(pageSource).toMatch(/import \{ useAppStore \} from "@\/lib\/state\/useAppStore";/)
  })

  it('publishes {boardId, itemId} — IDs only, never activeBoard.name/drawerItem.name — derived from activeBoard/drawerItem', () => {
    const idx = pageSource.indexOf('useAppStore.getState().setOrganiserContext(')
    expect(idx).toBeGreaterThan(-1)
    const block = pageSource.slice(idx, idx + 300)
    expect(block).toMatch(/boardId:\s*activeBoard\?\.id/)
    expect(block).toMatch(/itemId:\s*drawerItem\?\.id/)
    expect(block).not.toMatch(/activeBoard\?\.name|drawerItem\?\.name|boardName|itemName/)
  })

  it('clears the context on unmount (effect cleanup), mirroring DashboardShell.tsx\'s own dashboardAiContext pattern — this is what prevents stale board/item context from leaking to another page', () => {
    const idx = pageSource.indexOf('useAppStore.getState().setOrganiserContext(')
    const effectEnd = pageSource.indexOf('}, [activeBoard?.id, drawerItem?.id]);', idx)
    expect(effectEnd).toBeGreaterThan(idx)
    const block = pageSource.slice(idx, effectEnd)
    expect(block).toMatch(/return \(\) => useAppStore\.getState\(\)\.setOrganiserContext\(null\);/)
  })

  it('the effect re-runs whenever the board or item id changes — not on every render, and not missing either dependency', () => {
    expect(pageSource).toMatch(/\}, \[activeBoard\?\.id, drawerItem\?\.id\]\);/)
  })
})

describe('app/organiser/layout.tsx — embedded Helena chat surface (Phase D.4.6D)', () => {
  it('imports and renders the EXISTING HlnaAssistantWrapper — no second Helena implementation', () => {
    expect(layoutSource).toMatch(/import \{ HlnaAssistantWrapper \} from '@\/components\/brand\/HlnaAssistantWrapper';/)
    expect(layoutSource).toMatch(/<HlnaAssistantWrapper \/>/)
  })

  it('HlnaAssistantWrapper renders only inside the final capability-allowed return — never before the capability/role checks', () => {
    const capabilityCheckIdx = layoutSource.indexOf("if (!capability.allowed)")
    const wrapperIdx = layoutSource.indexOf('<HlnaAssistantWrapper />')
    expect(capabilityCheckIdx).toBeGreaterThan(-1)
    expect(wrapperIdx).toBeGreaterThan(capabilityCheckIdx)
  })

  it('children still render alongside the wrapper — Organiser\'s own UI is not replaced', () => {
    const wrapperIdx = layoutSource.indexOf('<HlnaAssistantWrapper />')
    const nearby = layoutSource.slice(Math.max(0, wrapperIdx - 100), wrapperIdx)
    expect(nearby).toMatch(/\{children\}/)
  })
})

describe('no D.4.6D UI plumbing beyond {boardId, itemId} was added', () => {
  it('no boardName/itemName field is introduced anywhere in the four touched UI files', () => {
    for (const src of [pageSource, layoutSource, storeSource, helenaSource]) {
      expect(src).not.toMatch(/\bboardName\b|\bitemName\b/)
    }
  })
})
