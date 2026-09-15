import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.2 — repository-confirmed C6 follow-up. addLine() previously
// cleared the add-line form synchronously and then called the page's
// full load() chain WITHOUT awaiting it — load() itself performs a long
// sequential chain (PO+lines, then attachments, then a 4-way
// Promise.all for suppliers/products/tax-codes/current-user) before the
// new line is reflected in state. That produced a real, reproducible
// window where the form had already reset but the line table still
// showed its pre-mutation contents, observed as a "reset, then the line
// pops in later" visual lag.
//
// Fix: a new refreshPoAndLines() helper re-fetches ONLY
// GET /api/commercial/purchase-orders/:id (which already returns
// purchaseOrder + lines + deliveries + supplier together in one
// response) and is AWAITED by addLine() — nothing about suppliers,
// products, tax codes, or the current user's role can change from
// adding a line, so none of those are re-fetched on this path anymore.
// load() itself is refactored to call the same helper internally (so
// its own behaviour — including the full suppliers/products/tax-codes/
// /api/me refresh it still needs for header edits and lifecycle
// actions — is unchanged), never duplicated.
//
// This is a source-text containment test (no jsdom/React Testing
// Library harness exists in this repo — see CLAUDE.md), following the
// same block-scoped start/end-anchor idiom every other containment test
// in this suite uses.

const PAGE_SRC = fs
  .readFileSync(path.join(process.cwd(), 'app/commercial/purchasing/purchase-orders/[id]/page.tsx'), 'utf8')
  .replace(/\r\n/g, '\n')

function block(startMarker: string, endMarker: string): string {
  const start = PAGE_SRC.indexOf(startMarker)
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
  const end = PAGE_SRC.indexOf(endMarker, start)
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start)
  return PAGE_SRC.slice(start, end)
}

describe('Phase C7.2 — refreshPoAndLines() is a narrow, PO-only refresh', () => {
  const refreshFn = block('const refreshPoAndLines = useCallback(', 'const load = useCallback(')

  it('fetches only the single PO-detail route', () => {
    expect(refreshFn).toContain('fetch(`/api/commercial/purchase-orders/${id}`)')
  })

  it('does NOT fetch suppliers, products, tax-codes, or /api/me — none of those can change from a line mutation', () => {
    expect(refreshFn).not.toContain("fetch('/api/commercial/suppliers')")
    expect(refreshFn).not.toContain("fetch('/api/commercial/products')")
    expect(refreshFn).not.toContain("fetch('/api/commercial/tax-codes')")
    expect(refreshFn).not.toContain("fetch('/api/me')")
    expect(refreshFn).not.toContain('/attachments')
  })

  it('updates po, lines, deliveries, and the live linked supplier from the response', () => {
    expect(refreshFn).toMatch(/setPo\(data\.purchaseOrder\)/)
    expect(refreshFn).toMatch(/setLines\(data\.lines\)/)
    expect(refreshFn).toMatch(/setDeliveries\(data\.deliveries \?\? \[\]\)/)
    expect(refreshFn).toMatch(/setLinkedSupplier\(data\.supplier \?\? null\)/)
  })

  it('reports success/failure via a boolean return rather than throwing, so callers (including load()) can branch on it', () => {
    expect(refreshFn).toMatch(/if \(!res\.ok\) return false/)
    expect(refreshFn).toContain('return true')
  })
})

describe('Phase C7.2 — load() reuses refreshPoAndLines() rather than duplicating the PO fetch', () => {
  const loadFn = block('const load = useCallback(', 'useEffect(() => { load(); }')

  it('delegates its PO/lines fetch to refreshPoAndLines()', () => {
    expect(loadFn).toMatch(/const ok = await refreshPoAndLines\(\)/)
  })

  it('still performs the full suppliers/products/tax-codes/attachments/me refresh it always needed — this fix narrows addLine()\'s own refresh, it does not remove load()\'s existing behaviour for header edits and lifecycle actions', () => {
    expect(loadFn).toContain('/attachments`')
    expect(loadFn).toContain("fetch('/api/commercial/suppliers')")
    expect(loadFn).toContain("fetch('/api/commercial/products')")
    expect(loadFn).toContain("fetch('/api/commercial/tax-codes')")
    expect(loadFn).toContain("fetch('/api/me')")
  })

  it('skips the rest of the chain when the PO fetch itself failed, matching the original early-return-on-!res.ok behaviour', () => {
    expect(loadFn).toMatch(/if \(!ok\) return/)
  })
})

describe('Phase C7.2 — addLine() awaits the narrow refresh instead of the old fire-and-forget full load()', () => {
  const addLineFn = block('async function addLine(e: React.FormEvent) {', '\n  async function removeLine')

  it('awaits refreshPoAndLines() (not a bare, un-awaited call)', () => {
    expect(addLineFn).toMatch(/await refreshPoAndLines\(\)/)
  })

  it('does not fall back to calling the full load() chain', () => {
    expect(addLineFn).not.toContain('load();')
  })

  it('still clears the add-line form fields on success, unchanged from before', () => {
    expect(addLineFn).toMatch(/setNewProductId\(''\); setNewDescription\(''\); setNewQuantity\('1'\); setNewPrice\(''\); setNewTaxCodeId\(''\);/)
  })

  it('still surfaces a server error via actionError and returns early without touching form state or refreshing, unchanged from before', () => {
    expect(addLineFn).toMatch(/if \(!res\.ok\) \{ setActionError\(data\.error \?\? 'Failed to add line\.'\); return; \}/)
  })
})

describe('Phase C7.2 — scope guard: sibling mutation handlers are unchanged, proving this fix stayed narrowly scoped to Add Line', () => {
  it('removeLine() still calls the full load() chain — this ticket only fixed addLine()\'s own refresh, not every line mutation', () => {
    const removeLineFn = block('async function removeLine(lineId: string) {', '\n  // Phase C6.4')
    expect(removeLineFn).toContain('load();')
    expect(removeLineFn).not.toContain('refreshPoAndLines')
  })

  it('lifecycle actions (submit/approve/return/issue/cancel) still call the full load() chain — status transitions can change far more than lines/totals, so they correctly keep the full refresh', () => {
    for (const fn of ['submitAction', 'approveAction', 'issueAction']) {
      const start = PAGE_SRC.indexOf(`async function ${fn}(`)
      expect(start, `${fn} not found`).toBeGreaterThan(-1)
      const end = PAGE_SRC.indexOf('\n  }', start)
      const body = PAGE_SRC.slice(start, end)
      expect(body).toContain('load();')
    }
  })
})
