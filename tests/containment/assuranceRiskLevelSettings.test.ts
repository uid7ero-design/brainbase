import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  normaliseRiskCode, riskCodeProblem, REQUIRES_VERIFICATION_HELP, SERIOUS_ACTIVE_LEVEL_COUNT, SERIOUS_RULE_TEXT,
} from '@/lib/assurance/riskLevelRules'

// Settings → Risk levels — structural guards (this repo's containment-test
// convention). Behaviour is proven against real Postgres in
// scripts/tests/assuranceRiskLevelSettings.integration.test.ts.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const ROUTES = [
  ['app/api/assurance/risk-levels/route.ts', 'assurancePost', 'createRiskLevel'],
  ['app/api/assurance/risk-levels/[id]/route.ts', 'assurancePostWithId', 'updateRiskLevel'],
  ['app/api/assurance/risk-levels/[id]/deactivate/route.ts', 'assurancePostWithId', 'deactivateRiskLevel'],
  ['app/api/assurance/risk-levels/[id]/reactivate/route.ts', 'assurancePostWithId', 'reactivateRiskLevel'],
] as const

describe('code rules (pure)', () => {
  it('normalises by trimming and upper-casing only', () => {
    expect(normaliseRiskCode('  critical ')).toBe('CRITICAL')
    expect(normaliseRiskCode('test_critical')).toBe('TEST_CRITICAL')
    expect(normaliseRiskCode(42)).toBe('')
  })
  it('accepts the existing Brainbase codes and rejects malformed ones', () => {
    for (const c of ['LOW', 'MEDIUM', 'HIGH', 'EXTREME', 'TEST_CRITICAL', 'L2']) expect(riskCodeProblem(c), c).toBeNull()
    expect(riskCodeProblem('')).toMatch(/required/)
    expect(riskCodeProblem('2HIGH')).toMatch(/start with a letter/)
    expect(riskCodeProblem('VERY HIGH')).toMatch(/letters, numbers and underscores/)
    expect(riskCodeProblem('A-B')).toMatch(/letters, numbers and underscores/)
    expect(riskCodeProblem('X'.repeat(31))).toMatch(/at most 30/)
  })
  it('keeps the documented serious rule and the inert requires-verification wording', () => {
    expect(SERIOUS_ACTIVE_LEVEL_COUNT).toBe(2)
    expect(SERIOUS_RULE_TEXT).toBe('The two highest-ranked active risk levels are currently treated as serious on the Assurance dashboard.')
    expect(REQUIRES_VERIFICATION_HELP).toBe('Recorded for policy/configuration purposes. This setting does not currently enforce verification automatically.')
  })
})

describe('routes and permissions', () => {
  it('every risk-level route is a POST built from the administer factory, with no other methods', () => {
    const found = walk('app/api/assurance/risk-levels').filter(f => f.endsWith('route.ts')).sort()
    expect(found).toEqual(ROUTES.map(r => r[0]).sort())
    for (const [file, factory, fn] of ROUTES) {
      const src = stripComments(read(file))
      expect(src, file).toMatch(new RegExp(`export const POST = ${factory}\\('administer', \\([^)]*\\) => ${fn}\\(`))
      expect(src, file).not.toMatch(/export (const|async function|function) (GET|PUT|PATCH|DELETE)/)
      expect(src, file).not.toMatch(/organisation_?[iI]d/)
    }
  })
  it('every mutation re-checks administer inside the service', () => {
    const src = stripComments(read('lib/assurance/riskLevels.ts'))
    expect(src).toMatch(/function requireAdminister\(viewer: AssuranceViewer\) \{\s*if \(!viewerCan\(viewer, 'administer'\)\)/)
    for (const fn of ['createRiskLevel', 'updateRiskLevel', 'setRiskLevelActive']) {
      const body = src.slice(src.indexOf(`function ${fn}(`))
      expect(body.slice(0, 200), fn).toMatch(/requireAdminister\(viewer\)/)
    }
  })
  it('both settings pages re-check access themselves', () => {
    for (const f of ['app/assurance/settings/page.tsx', 'app/assurance/settings/risk-levels/page.tsx']) {
      const src = stripComments(read(f))
      expect(src, f).toMatch(/await resolvePageViewer\(\)/)
      expect(src, f).toMatch(/if \(!viewer\) return denied;/)
    }
  })
})

describe('no delete path', () => {
  it('there is no delete route, service, action or button', () => {
    expect(walk('app/api/assurance/risk-levels').some(f => /delete|remove/i.test(f))).toBe(false)
    const service = stripComments(read('lib/assurance/riskLevels.ts'))
    expect(service).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(service).not.toMatch(/function\s+(delete|remove)\w*/i)
    expect(service).not.toMatch(/export (async )?function \w*(Delete|Remove)\w*/)
    const ui = stripComments(read('app/assurance/_components/RiskLevelsManager.tsx'))
    expect(ui).not.toMatch(/>\s*Delete\s*</)
    expect(ui).not.toMatch(/method: 'DELETE'/)
  })
})

describe('one definition of "serious"', () => {
  it('the dashboard uses the shared helper and no inline top-two query remains', () => {
    const dash = stripComments(read('lib/assurance/dashboard.ts'))
    expect(dash).toMatch(/seriousRankFloorSql\(organisationLevelsSql\(org\)\)/)
    expect(dash).not.toMatch(/LIMIT 2/)
    const svc = stripComments(read('lib/assurance/riskLevels.ts'))
    expect(svc.match(/ORDER BY serious_src\.rank DESC/g) ?? []).toHaveLength(1)
    expect(svc).toMatch(/LIMIT \$\{SERIOUS_ACTIVE_LEVEL_COUNT\}/)
  })
  it('every write is serialised per organisation and audited in the same statement', () => {
    const svc = stripComments(read('lib/assurance/riskLevels.ts'))
    expect(svc).toMatch(/pg_advisory_xact_lock\(hashtextextended\('assurance-risk-levels:'/)
    expect(svc.match(/sql\.transaction\(\[\s*lockStatement\(org\),/g) ?? []).toHaveLength(2)
    for (const verb of ['created', 'updated', 'deactivated', 'reactivated']) expect(svc).toContain(verb)
    expect(svc).toMatch(/'assurance_risk_level\.created'/)
    expect(svc).toMatch(/`assurance_risk_level\.\$\{verb\}`/)
  })
})

describe('selectors vs. historical display', () => {
  it('new-record selectors offer ACTIVE levels only', () => {
    const lookups = stripComments(read('lib/assurance/lookups.ts'))
    const fn = lookups.slice(lookups.indexOf('export async function listRiskLevels('))
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/AND is_active = true/)
    expect(lookups).toMatch(/assurance_risk_levels WHERE organisation_id = \$\{organisationId\} AND id = \$\{refs\.riskLevelId\} AND is_active = true/)
  })
  it('existing records resolve their level by id without an active-only filter', () => {
    for (const f of ['lib/assurance/incidents.ts', 'lib/assurance/investigations.ts', 'lib/assurance/findings.ts']) {
      const src = stripComments(read(f))
      const joins = src.match(/LEFT JOIN assurance_risk_levels rl ON [^\n]+/g) ?? []
      expect(joins.length, f).toBeGreaterThan(0)
      for (const j of joins) expect(j, f).not.toMatch(/is_active/)
    }
  })
})

describe('UI wording', () => {
  it('shows the serious rule, the inert requires-verification help, code immutability and the empty state', () => {
    const ui = read('app/assurance/_components/RiskLevelsManager.tsx')
    expect(ui).toMatch(/SERIOUS_RULE_TEXT/)
    expect(ui).toMatch(/REQUIRES_VERIFICATION_HELP/)
    expect(ui).toMatch(/cannot be changed after the risk level is created/)
    expect(ui).toMatch(/No risk levels have been configured for this organisation\./)
    expect(ui).toMatch(/will change which risk levels are treated as serious on the Assurance dashboard/)
  })
})
