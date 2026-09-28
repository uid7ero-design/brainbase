import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// BrainBase Assurance — static security guards over the source tree
// (this repo's containment-test convention). They pin the structural
// rules the behavioural proof (scripts/tests/assuranceUi.integration.test.ts)
// relies on, so a future edit cannot silently bypass them.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

const apiRoutes = walk('app/api/assurance').filter(f => f.endsWith('/route.ts'))
const pages = walk('app/assurance').filter(f => f.endsWith('/page.tsx'))
const uiFiles = walk('app/assurance')
const libFiles = walk('lib/assurance')
const CLIENT_SAFE_LIB = ['lib/assurance/domain.ts', 'lib/assurance/input.ts', 'lib/assurance/errors.ts', 'lib/assurance/references.ts']

describe('API routes', () => {
  it('exist and every one is built from the authorizing factories', () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(20)
    for (const f of apiRoutes) {
      const src = stripComments(read(f))
      expect(src, f).toMatch(/export const POST = assurancePost(WithId)?\('(view|record|verify|close|administer)'/)
      expect(src, f).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)/)
      expect(src, f).not.toMatch(/export const (GET|PUT|PATCH|DELETE)/)
      // organisation is never taken from the request
      expect(src, f).not.toMatch(/organisation_?[iI]d/)
    }
  })
  it('the factories authorize before reading the body', () => {
    const src = stripComments(read('lib/assurance/route.ts'))
    for (const fn of ['assurancePost', 'assurancePostWithId']) {
      const body = src.slice(src.indexOf(`export function ${fn}(`))
      expect(body.indexOf('authorizeAssuranceRequest(')).toBeGreaterThan(-1)
      expect(body.indexOf('authorizeAssuranceRequest(')).toBeLessThan(body.indexOf('readJsonObject('))
    }
  })
})

describe('pages', () => {
  it('every Assurance page re-checks access itself (layouts are not a security boundary)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(15)
    for (const f of pages) {
      const src = stripComments(read(f))
      expect(src, f).toMatch(/await resolvePageViewer\(\)/)
      expect(src, f).toMatch(/if \(!viewer\) return denied;/)
    }
  })
  it('client components never import server modules (client/server bundle leak guard)', () => {
    const clientFiles = uiFiles.filter(f => /^\s*['"]use client['"]/.test(read(f)))
    expect(clientFiles.length).toBeGreaterThan(0)
    for (const f of clientFiles) {
      const src = read(f)
      const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)]
      for (const [, isType, spec] of imports) {
        if (isType) continue
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^@\/lib\/(db|org|session|capabilities)/)
        if (spec.startsWith('@/lib/assurance/')) {
          expect(CLIENT_SAFE_LIB, `${f} imports ${spec}`).toContain(`${spec.replace('@/', '')}.ts`)
        }
      }
    }
  })
  it('client-safe lib modules have no server imports', () => {
    for (const f of CLIENT_SAFE_LIB) {
      const src = stripComments(read(f))
      expect(src, f).not.toMatch(/server-only|@\/lib\/db|next\/headers|from '\.\/(authorize|access|audit|users|lookups|sqlHelpers)'/)
    }
  })
  it('Audit is shown only as a disabled placeholder (A0.1E-1 is still in deployment gating)', () => {
    const src = read('app/assurance/_components/AssuranceSidebar.tsx')
    expect(src).toMatch(/aria-disabled="true"/)
    expect(src).not.toMatch(/\/assurance\/audits?/)
    expect(walk('app').some(f => /assurance\/audits?/.test(f))).toBe(false)
    expect(walk('lib/assurance').some(f => /audit(s)?\.ts$/.test(f) && !f.endsWith('/audit.ts'))).toBe(false)
  })
})

describe('service layer', () => {
  it('server modules are server-only', () => {
    for (const f of libFiles.filter(f => !CLIENT_SAFE_LIB.includes(f) && f !== 'lib/assurance/policy.ts')) {
      expect(read(f), f).toMatch(/^import 'server-only';/)
    }
  })
  it('never deletes Assurance history or mutates immutable/append-only tables', () => {
    for (const f of libFiles) {
      const src = stripComments(read(f))
      expect(src, f).not.toMatch(/\bDELETE\s+FROM\b/i)
      expect(src, f).not.toMatch(/\bTRUNCATE\b/i)
      expect(src, f).not.toMatch(/UPDATE\s+assurance_inspection_template_versions/i)
      expect(src, f).not.toMatch(/UPDATE\s+assurance_verifications/i)
      expect(src, f).not.toMatch(/UPDATE\s+assurance_timeframes\s+SET\s+original_due_at/i)
    }
  })
  it('sql.unsafe() only ever receives allow-listed identifiers', () => {
    for (const f of libFiles) {
      const src = stripComments(read(f))
      for (const [, arg] of src.matchAll(/sql\.unsafe\(([^)]*)\)/g)) {
        expect(['name', 'cte', 't.table', 't.column'], `${f}: sql.unsafe(${arg})`).toContain(arg.trim())
      }
    }
    const access = read('lib/assurance/access.ts')
    expect(access).toMatch(/ALLOWED_ALIASES = new Set\(/)
    expect(read('lib/assurance/sqlHelpers.ts')).toMatch(/CTE_NAMES = new Set\(/)
    expect(read('lib/assurance/evidence.ts')).toMatch(/const LINK_TABLES: Record<EvidenceLinkTarget/)
  })
  it('restricted-visibility base predicates are NULL-safe (two-valued)', () => {
    const src = read('lib/assurance/access.ts')
    for (const fn of ['incidentVisibleSql', 'investigationVisibleSql']) {
      const body = src.slice(src.indexOf(`export function ${fn}(`))
      expect(body.slice(0, body.indexOf('\n}')), fn).toMatch(/return sql`COALESCE\(\(/)
    }
  })
  it('never reads an organisation id from request data', () => {
    for (const f of libFiles) {
      const src = stripComments(read(f))
      expect(src, f).not.toMatch(/raw\.organisation|body\.organisation|raw\[['"]organisation/)
    }
  })
  it('every service that accepts a user id from input validates same-org membership', () => {
    for (const f of libFiles) {
      const src = stripComments(read(f))
      if (/optionalUserId\(raw\./.test(src)) {
        expect(src, f).toMatch(/assertSameOrgUsers\(/)
      }
    }
  })
  it('user-name joins are organisation-constrained (no cross-tenant name leak through a bad FK)', () => {
    for (const f of libFiles) {
      const src = stripComments(read(f))
      for (const [join] of src.matchAll(/JOIN users (\w+) ON [^\n]+/g)) {
        expect(join, f).toMatch(/organisation_id = /)
      }
    }
  })
  it('there is no generic entity_type/entity_id relationship', () => {
    for (const f of [...libFiles, ...uiFiles]) {
      expect(stripComments(read(f)), f).not.toMatch(/entity_type|entity_id/)
    }
  })
  it('every Assurance mutation writes an audit row', () => {
    for (const f of ['incidents', 'investigations', 'inspections', 'templates', 'findings', 'actions', 'evidence', 'verifications']) {
      const src = stripComments(read(`lib/assurance/${f}.ts`))
      const writes = (src.match(/\b(INSERT INTO assurance_|UPDATE assurance_)/g) ?? []).length
      const audits = (src.match(/auditInsert\(|auditFromCte\(|INSERT INTO audit_logs/g) ?? []).length
      expect(writes, f).toBeGreaterThan(0)
      expect(audits, f).toBeGreaterThan(0)
    }
  })
})

describe('navigation', () => {
  it('TopNav shows Assurance only when the organisation has the assurance capability', () => {
    const src = stripComments(read('components/nav/TopNav.tsx'))
    expect(src).toMatch(/const hasAssurance =\s*enabledCapabilities\.includes\(\s*'assurance',?\s*\)/)
    expect((src.match(/\{hasAssurance && \(\s*<NavItem\s*href="\/assurance"\s*label="Assurance"\s*capability="assurance"/g) ?? []).length).toBe(2)
  })
})
