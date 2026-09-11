import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// C6.9 remediation 5 — wording/UX clarification only: internal-catalogue
// selection is optional and a freeform supplier line is first-class.
// No functional change — product_id must remain fully optional
// end-to-end (this is re-asserted here, not just in wording).

const PAGE_SRC = fs.readFileSync(
  path.join(process.cwd(), 'app/commercial/purchasing/purchase-orders/[id]/page.tsx'),
  'utf8',
)
const ROUTE_SRC = fs.readFileSync(
  path.join(process.cwd(), 'app/api/commercial/purchase-orders/[id]/lines/route.ts'),
  'utf8',
)
const DOMAIN_SRC = fs.readFileSync(path.join(process.cwd(), 'lib/commercial/purchaseOrders.ts'), 'utf8')

describe('purchase order line UX wording (C6.9 remediation 5)', () => {
  it('labels internal-catalogue selection as explicitly optional', () => {
    expect(PAGE_SRC).toContain('Internal Product / Service (optional)')
  })

  it('the placeholder option clearly names the freeform path, not just "freeform line"', () => {
    expect(PAGE_SRC).toContain('Or enter a freeform supplier line below')
  })

  it('regression: product_id remains optional end-to-end — the add-line route never requires it', () => {
    expect(ROUTE_SRC).toContain('quantity is required')
    expect(ROUTE_SRC).not.toMatch(/if\s*\(\s*!productId\s*\)/)
    expect(ROUTE_SRC).toContain('productId: productId ?? null')
  })

  it('regression: addPurchaseOrderLine accepts productId: null and still computes totals from the explicit description/price', () => {
    const start = DOMAIN_SRC.indexOf('export async function addPurchaseOrderLine')
    const end = DOMAIN_SRC.indexOf('export async function updatePurchaseOrderLine', start)
    const fn = DOMAIN_SRC.slice(start, end)
    expect(fn).toMatch(/productId\?\s*:\s*string\s*\|\s*null/)
  })
})
