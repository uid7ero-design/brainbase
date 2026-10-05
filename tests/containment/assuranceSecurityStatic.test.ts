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
// In-app Help's pure modules are zero-import too (content.ts is the server-only loader).
const CLIENT_SAFE_LIB = ['lib/assurance/domain.ts', 'lib/assurance/input.ts', 'lib/assurance/errors.ts', 'lib/assurance/references.ts',
  'lib/assurance/help/registry.ts', 'lib/assurance/help/markdown.ts', 'lib/assurance/help/search.ts', 'lib/assurance/help/topics.ts',
  'lib/assurance/riskLevelRules.ts', 'lib/assurance/deadlineRules.ts', 'lib/assurance/contractorAssuranceRules.ts',
  'lib/assurance/evidenceRules.ts']

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
  it('navigation: Contractor assurance after Templates; later A0.1E workflows (Evaluation, Insurance) absent', () => {
    const src = read('app/assurance/_components/AssuranceSidebar.tsx')
    const order = [...src.matchAll(/href: '(\/assurance[^']*)'/g)].map(m => m[1])
    expect(order).toEqual([
      '/assurance', '/assurance/incidents', '/assurance/investigations', '/assurance/inspections', '/assurance/audits',
      '/assurance/templates', '/assurance/contractors', '/assurance/findings', '/assurance/actions', '/assurance/deadlines', '/assurance/evidence',
      '/assurance/verification', '/assurance/settings',
    ])
    expect(src).not.toMatch(/aria-disabled/)
    expect(src).not.toMatch(/evaluation|insurance/i)
    expect(walk('app').some(f => /assurance\/(evaluations?|insurance)/i.test(f))).toBe(false)
  })
  it('Audit routes and pages exist', () => {
    for (const f of [
      'app/assurance/audits/page.tsx', 'app/assurance/audits/new/page.tsx', 'app/assurance/audits/[id]/page.tsx',
      'app/assurance/templates/page.tsx', 'app/assurance/templates/[kind]/[id]/page.tsx',
    ]) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true)
    const expect_ = (route: string, op: string) => {
      const src = stripComments(read(`app/api/assurance/${route}/route.ts`))
      expect(src, route).toMatch(new RegExp(`assurancePost(WithId)?\\('${op}'`))
    }
    expect_('audits', 'record')
    expect_('audits/[id]/start', 'record')
    expect_('audits/[id]/responses', 'record')
    expect_('audits/[id]/complete', 'record')
    expect_('audits/[id]/cancel', 'close')
    expect_('audits/[id]/findings', 'record')
    expect_('templates', 'administer')
    expect_('templates/[id]/versions', 'administer')
    expect_('templates/[id]/draft', 'administer')
    expect_('templates/[id]/publish', 'administer')
    expect_('templates/[id]/retire', 'administer')
    // A0.1F: the immediate-publish routes are gone; nothing bypasses the draft lifecycle.
    expect(fs.existsSync(path.join(ROOT, 'app/api/assurance/audit-templates'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'app/api/assurance/templates/[id]/active'))).toBe(false)
  })
  it('no Audit -> Action shortcut: Audit code never writes actions; findings are the only bridge', () => {
    for (const f of ['lib/assurance/audits.ts', 'lib/assurance/templateLifecycle.ts', ...walk('app/api/assurance/audits'), ...walk('app/api/assurance/templates')]) {
      const src = stripComments(read(f))
      expect(src, f).not.toMatch(/assurance_actions|assurance_action_findings|createAction|lib\/assurance\/actions/)
    }
    const audits = stripComments(read('lib/assurance/audits.ts'))
    // completion/response never touch findings
    expect(audits).not.toMatch(/INSERT INTO assurance_findings|UPDATE assurance_findings/)
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
      expect(src, f).not.toMatch(/UPDATE\s+assurance_audit_template_versions/i)
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
    expect(read('lib/assurance/templateLifecycle.ts')).toMatch(/ALLOWED_IDENTIFIERS = new Set\(/)
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
    for (const f of ['incidents', 'investigations', 'inspections', 'templateLifecycle', 'audits', 'findings', 'actions', 'evidence', 'verifications', 'riskLevels', 'contractorAssurance']) {
      const src = stripComments(read(`lib/assurance/${f}.ts`))
      // templateLifecycle names its (allow-listed) tables through ident().
      const writes = (src.match(/\b(INSERT INTO assurance_|UPDATE assurance_|INSERT INTO \$\{ident\(|UPDATE \$\{ident\()/g) ?? []).length
      const audits = (src.match(/auditInsert\(|auditFromCte\(|INSERT INTO audit_logs/g) ?? []).length
      expect(writes, f).toBeGreaterThan(0)
      expect(audits, f).toBeGreaterThan(0)
    }
  })
})

describe('navigation', () => {
  // Consolidated navigation (main PR #297): Assurance is ONE generic Work
  // descriptor in components/nav/navModel.ts. TopNav renders the model and
  // holds no Assurance-specific logic; the old flat insertion is gone.
  it('Assurance is registered once, in the nav model, gated on the assurance capability', () => {
    const model = stripComments(read('components/nav/navModel.ts'))
    expect(model.match(/id: 'assurance'/g) ?? []).toHaveLength(1)
    expect(model).toMatch(/id: 'assurance', label: 'Assurance', href: '\/assurance', match: \['\/assurance'\],[\s\S]{0,200}gate: \{ anyCapability: \['assurance'\], minRole: 'viewer' \}/)
    expect(model).not.toMatch(/verity/i)
  })
  it('TopNav has no Assurance-specific code (no flat pill, no capability check, no shim)', () => {
    const src = read('components/nav/TopNav.tsx')
    expect(src).not.toMatch(/assurance|verity/i)
    expect(src).not.toMatch(/hasAssurance/)
  })
  it('no second Assurance route or capability exists', () => {
    expect(walk('app').some(f => /(^|\/)verity(\/|$)/i.test(f))).toBe(false)
    expect(read('lib/assurance/authorize.ts')).toMatch(/ASSURANCE_CAPABILITY = 'assurance'/)
  })
})

describe('template lifecycle (A0.1F)', () => {
  const src = stripComments(read('lib/assurance/templateLifecycle.ts'))
  it('only templateLifecycle.ts writes template versions', () => {
    for (const f of libFiles.filter(f => f !== 'lib/assurance/templateLifecycle.ts')) {
      expect(stripComments(read(f)), f).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+(assurance_(inspection|audit)_template_versions|\$\{ident\(k\.versions\)\})/i)
    }
  })
  it('every version UPDATE is guarded on the lifecycle state it expects', () => {
    const updates = [...src.matchAll(/UPDATE \$\{ident\(k\.versions\)\} v([\s\S]*?)RETURNING/g)].map(m => m[1])
    expect(updates.length).toBe(3) // draft save, publish, retire
    for (const u of updates) expect(u).toMatch(/v\.status = '(DRAFT|PUBLISHED)'/)
    // draft edits and publishes are optimistic-locked
    expect(updates.filter(u => /v\.lock_version = \$\{lockVersion\}::int/.test(u))).toHaveLength(2)
  })
  it('drafts are inserted explicitly as DRAFT with no publication stamp', () => {
    const inserts = src.match(/'DRAFT', NULL, NULL, \$\{viewer\.userId\}, \$\{viewer\.userId\}/g) ?? []
    expect(inserts).toHaveLength(2) // create (v1) and new version
  })
  it('each mutation locks the template row in its own statement first', () => {
    for (const fn of ['updateTemplateDraft', 'createTemplateVersion', 'publishTemplateVersion', 'retireAssuranceTemplate']) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`))
      const tx = body.slice(body.indexOf('sql.transaction(['))
      expect(tx.indexOf('lockTemplate('), fn).toBeGreaterThan(-1)
      expect(tx.indexOf('lockTemplate('), fn).toBeLessThan(tx.indexOf('INSERT INTO audit_logs'))
    }
  })
  it('selectors offer only PUBLISHED versions of active templates', () => {
    const body = src.slice(src.indexOf('export async function listPublishedTemplateOptions('))
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/v\.status = 'PUBLISHED'[\s\S]*t\.is_active = true/)
    for (const f of ['lib/assurance/inspections.ts', 'lib/assurance/audits.ts']) {
      expect(stripComments(read(f)), f).toMatch(/t\.is_active = true AND v\.status = 'PUBLISHED'/)
      expect(stripComments(read(f)), f).toMatch(/rejectUnpublishedTemplate\(sql\.transaction\(/)
    }
  })
})

describe('contractor assurance (A0.1G)', () => {
  const src = stripComments(read('lib/assurance/contractorAssurance.ts'))
  it('routes use the authorizing factories with the agreed operations', () => {
    const expect_ = (route: string, op: string) => {
      const r = stripComments(read(`app/api/assurance/contractors/${route}/route.ts`))
      expect(r, route).toMatch(new RegExp(`assurancePost(WithId)?\\('${op}'`))
    }
    expect_('requirements', 'administer')
    expect_('requirements/[id]/update', 'administer')
    expect_('requirements/[id]/status', 'administer')
    expect_('scope', 'record')
    expect_('assignments', 'record')
    expect_('assignments/[id]/update', 'record')
    expect_('assignments/[id]/cancel', 'close')
    expect_('assignments/[id]/submissions', 'record')
    expect_('submissions/[id]/decide', 'verify')
    expect_('submissions/[id]/withdraw', 'record')
  })
  it('no contractor-specific task table, no copied organisations or people, no automatic findings', () => {
    expect(src).not.toMatch(/INSERT INTO (assurance_findings|assurance_actions|organiser_items|external_organisations|hr_people|users)\b/)
    expect(src).not.toMatch(/UPDATE external_organisations|UPDATE external_organisation_roles/)
  })
  it('decisions are verify-gated, never self-decided, and guarded on the observed state', () => {
    const body = src.slice(src.indexOf('export async function decideSubmission('))
    expect(body).toMatch(/viewerCan\(viewer, 'verify'\)/)
    expect(body).toMatch(/sub\.recorded_by === viewer\.userId/)
    expect(body).toMatch(/s\.status = 'SUBMITTED' AND s\.lock_version = \$\{lockVersion\}::int/)
    expect(body.indexOf('lockAssignment(')).toBeLessThan(body.indexOf('INSERT INTO audit_logs'))
  })
  it('submission snapshots are written only by the database trigger', () => {
    expect(src).not.toMatch(/requirement_name_snapshot\s*=|INSERT INTO assurance_requirement_submissions \([^)]*_snapshot/)
  })
  it('history times are unambiguous instants shown in the Assurance time zone, each entry naming its record kind', () => {
    expect(src).toMatch(/\(l\.created_at AT TIME ZONE 'UTC'\) AS created_at/)
    const page = stripComments(read('app/assurance/contractors/[id]/page.tsx'))
    expect(page).toMatch(/<HistoryList entries=\{historyEntries\} timeZone=\{tz\} \/>/)
  })
})

describe('evidence verification (A0.1H)', () => {
  const src = stripComments(read('lib/assurance/evidence.ts'))
  it('routes use the authorizing factories with the agreed operations', () => {
    const expect_ = (route: string, op: string) => {
      const r = stripComments(read(`app/api/assurance/evidence/${route}/route.ts`))
      expect(r, route).toMatch(new RegExp(`assurancePost(WithId)?\\('${op}'`))
    }
    expect_('[id]/request-verification', 'record')
    expect_('[id]/withdraw-verification', 'record')
    expect_('[id]/correct', 'record')
    expect_('[id]/replacement', 'record')
    expect_('[id]/decide', 'verify')
  })
  it('decisions are verify-gated, independent, and guarded on the observed state', () => {
    const body = src.slice(src.indexOf('export async function decideEvidence('), src.indexOf('export async function correctEvidence('))
    expect(body).toMatch(/viewerCan\(viewer, 'verify'\)/)
    expect(body).toMatch(/decisionConflicts\(/)
    expect(body).toMatch(/verification_status = 'AWAITING_VERIFICATION' AND lock_version = \$\{lockVersion\}::int/)
    expect(body.indexOf('FOR UPDATE')).toBeLessThan(body.indexOf('INSERT INTO audit_logs'))
  })
  it('the generic lifecycle never acts on contractor submission evidence', () => {
    for (const fn of ['requestEvidenceVerification', 'withdrawEvidenceVerification', 'decideEvidence', 'correctEvidence', 'recordReplacementEvidence']) {
      const start = src.indexOf(`export async function ${fn}(`)
      const body = src.slice(start, src.indexOf('\nexport ', start + 10))
      expect(body, fn).toMatch(/assertGeneric\(/)
    }
  })
  it('evidence never changes the records it supports, never verifies or closes work, never creates findings', () => {
    expect(src).not.toMatch(/UPDATE assurance_(actions|findings|inspections|audits|incidents|investigations|timeframes|escalations|requirement_submissions|requirement_assignments)\b/)
    expect(src).not.toMatch(/INSERT INTO assurance_(verifications|findings|actions|timeframes)\b/)
  })
  it('history times are unambiguous instants', () => {
    expect(src).toMatch(/\(l\.created_at AT TIME ZONE 'UTC'\) AS created_at/)
  })
})
