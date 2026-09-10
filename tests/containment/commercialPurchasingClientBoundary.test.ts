import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C6.2 — client/server boundary regression coverage, mirroring
// tests/containment/commercialPaymentMethodsClientBoundary.test.ts's
// exact idiom. The C5.3B Production incident (a Client Component
// importing a runtime value from a module that also imports lib/db,
// silently shipping neon() into the browser bundle) is the reason this
// class of test now exists at all — this file proves the same defect
// cannot occur in the new Purchasing modules from day one, rather than
// waiting for a Production incident to prove it retroactively.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const SUPPLIERS_PATH = 'lib/commercial/suppliers.ts'
const PURCHASE_ORDERS_PATH = 'lib/commercial/purchaseOrders.ts'
const LIFECYCLE_PATH = 'lib/commercial/purchaseOrderLifecycle.ts'

describe('Phase C6.2 — lib/commercial/suppliers.ts is guarded as server-only', () => {
  const source = readSource(SUPPLIERS_PATH)

  it('imports the server-only package as its very first import', () => {
    const firstImportLine = source.split('\n').find((l) => l.trim().startsWith('import '))?.trim()
    expect(firstImportLine).toMatch(/^import ['"]server-only['"];?$/)
  })

  it('imports lib/db (this module legitimately needs the DB client — it is server-only, not DB-free)', () => {
    expect(source).toMatch(/import sql from ['"]@\/lib\/db['"]/)
  })
})

describe('Phase C6.2 — lib/commercial/purchaseOrders.ts is guarded as server-only', () => {
  const source = readSource(PURCHASE_ORDERS_PATH)

  it('imports the server-only package as its very first import', () => {
    const firstImportLine = source.split('\n').find((l) => l.trim().startsWith('import '))?.trim()
    expect(firstImportLine).toMatch(/^import ['"]server-only['"];?$/)
  })

  it('imports lib/db (this module legitimately needs the DB client — it is server-only, not DB-free)', () => {
    expect(source).toMatch(/import sql from ['"]@\/lib\/db['"]/)
  })

  it('imports the client-safe lifecycle module back (server -> client-safe is fine; the reverse is the bug)', () => {
    expect(source).toMatch(/from ['"]\.\/purchaseOrderLifecycle['"]/)
  })
})

describe('Phase C6.2 — lib/commercial/purchaseOrderLifecycle.ts is client-safe', () => {
  const source = readSource(LIFECYCLE_PATH)

  it('imports nothing at all (zero dependencies — cannot transitively pull in a server module)', () => {
    expect(source).not.toMatch(/^import /m)
  })

  it('has no import line referencing lib/db, neon, or server-only (prose mentioning them in comments is fine)', () => {
    const importLines = source.split('\n').filter((l) => l.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).not.toMatch(/lib\/db|neon|server-only/)
    }
  })

  it('exports the exact five-state status union and the transition guard functions', () => {
    expect(source).toMatch(/export type PurchaseOrderStatus = 'DRAFT' \| 'PENDING_APPROVAL' \| 'APPROVED' \| 'ISSUED' \| 'CANCELLED'/)
    expect(source).toMatch(/export function assertPurchaseOrderTransition/)
    expect(source).toMatch(/export function isPurchaseOrderEditable/)
  })
})

describe('Phase C6.2 — no client component anywhere in the repo imports the server DB client or the new Purchasing server modules', () => {
  const ROOT = path.resolve(__dirname, '../../')
  const SCAN_DIRS = ['app', 'components', 'lib']

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('every "use client" file in app/, components/, lib/ is free of @/lib/db, @/lib/commercial/suppliers, and @/lib/commercial/purchaseOrders imports', () => {
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const full = path.join(ROOT, dir)
      if (!fs.existsSync(full)) continue
      for (const file of walk(full)) {
        const text = fs.readFileSync(file, 'utf-8')
        if (!text.includes("'use client'")) continue
        if (
          /from ['"]@\/lib\/db['"]/.test(text) ||
          /from ['"]@\/lib\/commercial\/suppliers['"]/.test(text) ||
          /from ['"]@\/lib\/commercial\/purchaseOrders['"]/.test(text)
        ) {
          violations.push(path.relative(ROOT, file))
        }
      }
    }
    expect(violations).toEqual([])
  })
})
