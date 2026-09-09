import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C5.3B-fix — regression coverage for the Production incident where
// app/commercial/invoices/[id]/page.tsx ('use client') imported the
// runtime value PAYMENT_METHODS from lib/commercial/payments.ts, which
// also imports lib/db.ts. Because PAYMENT_METHODS is a value (not
// type-only), the bundler could not tree-shake lib/db.ts's module-scope
// `neon(process.env.DATABASE_URL!)` call out of the client bundle, and it
// threw in the browser (no DATABASE_URL client-side), crashing the whole
// route on every load. Fixed by extracting PAYMENT_METHODS/PaymentMethod
// into lib/commercial/paymentMethods.ts — a dependency-free, client-safe
// module — and guarding lib/commercial/payments.ts with `import
// 'server-only'` so this specific mistake fails the BUILD, not Production.
//
// Static source-text containment, matching this repo's established idiom
// (see tests/containment/commercialPaymentsSchema.test.ts): read the real
// files, assert on their actual import lines — no DOM/bundler harness
// exists in this repo (see vitest.config.ts), so this is the strongest
// regression proof available short of an actual production build, which
// is exercised separately in CI/manual validation, not here.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const PAGE_PATH = 'app/commercial/invoices/[id]/page.tsx'
const PAYMENTS_PATH = 'lib/commercial/payments.ts'
const PAYMENT_METHODS_PATH = 'lib/commercial/paymentMethods.ts'

describe('Phase C5.3B-fix — invoice detail client page never imports the server payments module', () => {
  const page = readSource(PAGE_PATH)

  it('is still a Client Component (sanity check that this is the right file)', () => {
    expect(page.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('does NOT import anything from lib/commercial/payments', () => {
    expect(page).not.toMatch(/from ['"]@\/lib\/commercial\/payments['"]/)
  })

  it('imports PAYMENT_METHODS and PaymentMethod only from the dependency-free client-safe module', () => {
    expect(page).toMatch(/import\s*\{\s*PAYMENT_METHODS,\s*type PaymentMethod\s*\}\s*from\s*['"]@\/lib\/commercial\/paymentMethods['"]/)
  })
})

describe('Phase C5.3B-fix — lib/commercial/paymentMethods.ts is client-safe', () => {
  const source = readSource(PAYMENT_METHODS_PATH)

  it('imports nothing at all (zero dependencies — cannot transitively pull in a server module)', () => {
    expect(source).not.toMatch(/^import /m)
  })

  it('has no import line referencing lib/db, neon, or server-only (prose mentioning them in comments is fine)', () => {
    const importLines = source.split('\n').filter((l) => l.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).not.toMatch(/lib\/db|neon|server-only/)
    }
  })

  it('defines the canonical, exact payment method vocabulary', () => {
    expect(source).toMatch(/export const PAYMENT_METHODS = \['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'\] as const/)
    expect(source).toMatch(/export type PaymentMethod = typeof PAYMENT_METHODS\[number\]/)
  })
})

describe('Phase C5.3B-fix — lib/commercial/payments.ts is guarded as server-only', () => {
  const source = readSource(PAYMENTS_PATH)

  it('imports the server-only package as its very first import', () => {
    const firstImportLine = source.split('\n').find((l) => l.trim().startsWith('import '))?.trim()
    expect(firstImportLine).toMatch(/^import ['"]server-only['"];?$/)
  })

  it('still imports lib/db (this module legitimately needs the DB client — it is server-only, not DB-free)', () => {
    expect(source).toMatch(/import sql from ['"]@\/lib\/db['"]/)
  })

  it('does NOT redefine PAYMENT_METHODS/PaymentMethod locally — it re-exports the single source of truth from paymentMethods.ts', () => {
    expect(source).not.toMatch(/export const PAYMENT_METHODS = \[/)
    expect(source).toMatch(/from ['"]\.\/paymentMethods['"]/)
    expect(source).toMatch(/export \{ PAYMENT_METHODS, type PaymentMethod \}/)
  })
})

describe('Phase C5.3B-fix — no client component anywhere in the repo imports the server DB client or the server payments module', () => {
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

  it('every "use client" file in app/, components/, lib/ is free of @/lib/db and @/lib/commercial/payments imports', () => {
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const full = path.join(ROOT, dir)
      if (!fs.existsSync(full)) continue
      for (const file of walk(full)) {
        const text = fs.readFileSync(file, 'utf-8')
        if (!text.includes("'use client'")) continue
        if (/from ['"]@\/lib\/db['"]/.test(text) || /from ['"]@\/lib\/commercial\/payments['"]/.test(text)) {
          violations.push(path.relative(ROOT, file))
        }
      }
    }
    expect(violations).toEqual([])
  })
})
