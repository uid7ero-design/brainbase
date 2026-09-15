import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.3 — source-text containment test for the purchase receipt
// detail page, mirroring tests/containment/
// commercialPurchaseOrderAddLineRefresh.test.ts's own established idiom
// (no jsdom/React Testing Library harness exists in this repo — see
// CLAUDE.md). Confirms every mutation handler on this NEW page was built
// with the narrow, awaited refreshReceiptAndLines() pattern from the very
// start — explicitly avoiding the old PO Add-Line full-reload bug this
// phase was told not to repeat (C7.3 instruction #20).

const PAGE_SRC = fs
  .readFileSync(path.join(process.cwd(), 'app/commercial/purchasing/purchase-receipts/[id]/page.tsx'), 'utf8')
  .replace(/\r\n/g, '\n')

function block(startMarker: string, endMarker: string): string {
  const start = PAGE_SRC.indexOf(startMarker)
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
  const end = PAGE_SRC.indexOf(endMarker, start)
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start)
  return PAGE_SRC.slice(start, end)
}

describe('Phase C7.3 — refreshReceiptAndLines() is a narrow, single-route refresh', () => {
  const refreshFn = block('const refreshReceiptAndLines = useCallback(', 'const load = useCallback(')

  it('fetches only the single receipt-detail route', () => {
    expect(refreshFn).toContain('fetch(`/api/commercial/purchase-receipts/${id}`)')
  })

  it('does NOT fetch attachments or the current user — neither can change from a line/status mutation', () => {
    expect(refreshFn).not.toContain('/attachments')
    expect(refreshFn).not.toContain("fetch('/api/me')")
  })

  it('updates receipt, lines, purchaseOrder, poLines, and receivedQuantities from the response', () => {
    expect(refreshFn).toMatch(/setReceipt\(data\.purchaseReceipt\)/)
    expect(refreshFn).toMatch(/setLines\(data\.lines\)/)
    expect(refreshFn).toMatch(/setPurchaseOrder\(data\.purchaseOrder\)/)
    expect(refreshFn).toMatch(/setPoLines\(data\.purchaseOrderLines \?\? \[\]\)/)
    expect(refreshFn).toMatch(/setReceivedQuantities\(data\.receivedQuantities \?\? \{\}\)/)
  })

  it('reports success/failure via a boolean return rather than throwing', () => {
    expect(refreshFn).toMatch(/if \(!res\.ok\) return false/)
    expect(refreshFn).toContain('return true')
  })
})

describe('Phase C7.3 — load() reuses refreshReceiptAndLines() rather than duplicating the fetch', () => {
  const loadFn = block('const load = useCallback(', 'useEffect(() => { load(); }')

  it('delegates its receipt/lines fetch to refreshReceiptAndLines()', () => {
    expect(loadFn).toMatch(/const ok = await refreshReceiptAndLines\(\)/)
  })

  it('still performs the attachments and current-user fetches it always needed — this only narrows mutation handlers, not the initial load', () => {
    expect(loadFn).toContain('/attachments`')
    expect(loadFn).toContain("fetch('/api/me')")
  })

  it('skips the rest of the chain when the initial fetch failed', () => {
    expect(loadFn).toMatch(/if \(!ok\) return/)
  })
})

describe('Phase C7.3 — every mutation handler awaits the narrow refresh, never a full page reload', () => {
  it.each(['addLine', 'removeLine', 'postAction', 'cancelAction'])('%s() awaits refreshReceiptAndLines()', (fnName) => {
    const start = PAGE_SRC.indexOf(`async function ${fnName}(`)
    expect(start, `${fnName} not found`).toBeGreaterThan(-1)
    const end = PAGE_SRC.indexOf('\n  }', start)
    const body = PAGE_SRC.slice(start, end)
    expect(body).toMatch(/await refreshReceiptAndLines\(\)/)
  })

  it('no mutation handler calls a full load() chain (the exact bug pattern this phase was told not to repeat)', () => {
    for (const fnName of ['addLine', 'removeLine', 'postAction', 'cancelAction']) {
      const start = PAGE_SRC.indexOf(`async function ${fnName}(`)
      const end = PAGE_SRC.indexOf('\n  }', start)
      const body = PAGE_SRC.slice(start, end)
      expect(body, `${fnName} must not call load()`).not.toMatch(/[^.\w]load\(\);/)
    }
  })

  it('deleteAction() navigates away rather than refreshing a now-deleted resource', () => {
    const start = PAGE_SRC.indexOf('async function deleteAction(')
    const end = PAGE_SRC.indexOf('\n  }', start)
    const body = PAGE_SRC.slice(start, end)
    expect(body).toMatch(/router\.push\('\/commercial\/purchasing\/purchase-receipts'\)/)
    expect(body).not.toMatch(/refreshReceiptAndLines/)
  })
})

describe('Phase C7.3 — client-side over-receipt display is advisory only, server remains authoritative', () => {
  it('remainingForPoLine() is computed client-side from ordered minus posted-elsewhere minus in-this-draft', () => {
    const fn = block('function remainingForPoLine(', '\n  async function addLine')
    expect(fn).toMatch(/poLine\.quantity - postedElsewhere - inThisDraft/)
  })

  it('the page never blocks the Post action purely on the client-computed remaining value — the request always reaches the server', () => {
    const postActionFn = block('async function postAction()', '\n  async function cancelAction')
    expect(postActionFn).toMatch(/fetch\(`\/api\/commercial\/purchase-receipts\/\$\{id\}\/post`, \{ method: 'POST' \}\)/)
    expect(postActionFn).not.toMatch(/if \(remaining/)
  })
})

describe('Phase C7.3 — lines are selected only from the linked PO\'s own lines (no freeform/unplanned line entry)', () => {
  it('the add-line select is populated only from poLines, never a freeform text/description input', () => {
    const start = PAGE_SRC.indexOf('<select value={newPoLineId}')
    const end = PAGE_SRC.indexOf('</select>', start)
    const body = PAGE_SRC.slice(start, end)
    expect(body).toMatch(/poLines\.map\(pl =>/)
  })
})
