import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.4 — source-text containment test for the supplier bill
// detail page, mirroring tests/containment/
// commercialPurchaseReceiptDetailPageRefresh.test.ts's own established
// idiom (no jsdom/React Testing Library harness exists in this repo).
// Confirms every mutation handler on this NEW page was built with the
// narrow, awaited refreshBillAndLines() pattern from the very start —
// explicitly avoiding the old PO Add-Line full-reload bug this whole C7
// arc was told not to repeat.

const PAGE_SRC = fs
  .readFileSync(path.join(process.cwd(), 'app/commercial/purchasing/supplier-bills/[id]/page.tsx'), 'utf8')
  .replace(/\r\n/g, '\n')

function block(startMarker: string, endMarker: string): string {
  const start = PAGE_SRC.indexOf(startMarker)
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
  const end = PAGE_SRC.indexOf(endMarker, start)
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start)
  return PAGE_SRC.slice(start, end)
}

describe('Phase C7.4 — refreshBillAndLines() is a narrow, single-route refresh', () => {
  const refreshFn = block('const refreshBillAndLines = useCallback(', 'const load = useCallback(')

  it('fetches only the single bill-detail route', () => {
    expect(refreshFn).toContain('fetch(`/api/commercial/supplier-bills/${id}`)')
  })

  it('does NOT fetch attachments, tax codes, or the current user — none can change from a line/status mutation', () => {
    expect(refreshFn).not.toContain('/attachments')
    expect(refreshFn).not.toContain("fetch('/api/commercial/tax-codes')")
    expect(refreshFn).not.toContain("fetch('/api/me')")
  })

  it('updates supplierBill, lines, purchaseOrder, poLines, and billedAmounts from the response', () => {
    expect(refreshFn).toMatch(/setSupplierBill\(data\.supplierBill\)/)
    expect(refreshFn).toMatch(/setLines\(data\.lines\)/)
    expect(refreshFn).toMatch(/setPurchaseOrder\(data\.purchaseOrder\)/)
    expect(refreshFn).toMatch(/setPoLines\(data\.purchaseOrderLines \?\? \[\]\)/)
    expect(refreshFn).toMatch(/setBilledAmounts\(data\.billedAmounts \?\? \{\}\)/)
  })

  it('reports success/failure via a boolean return rather than throwing', () => {
    expect(refreshFn).toMatch(/if \(!res\.ok\) return false/)
    expect(refreshFn).toContain('return true')
  })
})

describe('Phase C7.4 — load() reuses refreshBillAndLines() rather than duplicating the fetch', () => {
  const loadFn = block('const load = useCallback(', 'useEffect(() => { load(); }')

  it('delegates its bill/lines fetch to refreshBillAndLines()', () => {
    expect(loadFn).toMatch(/const ok = await refreshBillAndLines\(\)/)
  })

  it('still performs the attachments/tax-codes/current-user fetches it always needed', () => {
    expect(loadFn).toContain('/attachments`')
    expect(loadFn).toContain("fetch('/api/commercial/tax-codes')")
    expect(loadFn).toContain("fetch('/api/me')")
  })

  it('skips the rest of the chain when the initial fetch failed', () => {
    expect(loadFn).toMatch(/if \(!ok\) return/)
  })
})

describe('Phase C7.4 — every mutation handler awaits the narrow refresh, never a full page reload', () => {
  it.each(['addLine', 'removeLine', 'postAction', 'cancelAction'])('%s() awaits refreshBillAndLines()', (fnName) => {
    const start = PAGE_SRC.indexOf(`async function ${fnName}(`)
    expect(start, `${fnName} not found`).toBeGreaterThan(-1)
    const end = PAGE_SRC.indexOf('\n  }', start)
    const body = PAGE_SRC.slice(start, end)
    expect(body).toMatch(/await refreshBillAndLines\(\)/)
  })

  it('no mutation handler calls a full load() chain (the exact bug pattern this whole C7 arc was told not to repeat)', () => {
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
    expect(body).toMatch(/router\.push\('\/commercial\/purchasing\/supplier-bills'\)/)
    expect(body).not.toMatch(/refreshBillAndLines/)
  })
})

describe('Phase C7.4 — client-side over-billing display is advisory only, server remains authoritative', () => {
  it('remainingForPoLine() is computed client-side from ordered VALUE minus billed-elsewhere minus in-this-draft, not from quantity', () => {
    const fn = block('function remainingForPoLine(', '\n  async function addLine')
    expect(fn).toMatch(/poLine\.line_total_cents - billedElsewhere - inThisDraft/)
  })

  it('the page never blocks the Post action purely on the client-computed remaining value — the request always reaches the server', () => {
    const postActionFn = block('async function postAction()', '\n  async function cancelAction')
    expect(postActionFn).toMatch(/fetch\(`\/api\/commercial\/supplier-bills\/\$\{id\}\/post`, \{ method: 'POST' \}\)/)
    expect(postActionFn).not.toMatch(/if \(remaining/)
  })
})

describe('Phase C7.4 — posting and cancelling are gated on isAdmin, not just canEdit — stricter than purchase receipts', () => {
  it('the Post Bill button requires isDraft && isAdmin', () => {
    expect(PAGE_SRC).toMatch(/isDraft && isAdmin && lines\.length > 0 &&[\s\S]{0,200}Post Bill/)
  })

  it('the Cancel Bill button requires isPosted && isAdmin', () => {
    expect(PAGE_SRC).toMatch(/isPosted && isAdmin &&[\s\S]{0,200}Cancel Bill/)
  })
})

describe('Phase C7.4 — lines are selected only from the linked PO\'s own lines (no freeform/unmatched line entry)', () => {
  it('the add-line select is populated only from poLines, never a freeform text/description input', () => {
    const start = PAGE_SRC.indexOf('<select value={newPoLineId}')
    const end = PAGE_SRC.indexOf('</select>', start)
    const body = PAGE_SRC.slice(start, end)
    expect(body).toMatch(/poLines\.map\(pl =>/)
  })
})
