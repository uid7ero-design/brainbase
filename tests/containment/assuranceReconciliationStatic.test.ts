import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// Assurance docs-to-product reconciliation — static wiring guards.
// Behaviour is proven against real Postgres in
// scripts/tests/assuranceUi.integration.test.ts and in jsdom in
// tests/components/app/AssuranceReconciliation.test.tsx; these pin the
// page/route wiring so a later edit cannot silently undo it.

const ROOT = path.resolve(__dirname, '../..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const exists = (f: string) => fs.existsSync(path.join(ROOT, f))
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('link existing finding — only schema-supported sources', () => {
  it('incident, investigation, inspection and audit each have a record-gated link route', () => {
    for (const s of ['incidents', 'investigations', 'inspections', 'audits']) {
      const f = `app/api/assurance/${s}/[id]/findings/route.ts`
      expect(exists(f), f).toBe(true)
      expect(stripComments(read(f)), f).toMatch(/assurancePostWithId\('record'/)
    }
  })
  it('no finding-link route exists for records without a finding link table', () => {
    for (const s of ['actions', 'evidence', 'templates', 'audit-templates']) {
      expect(exists(`app/api/assurance/${s}/[id]/findings/route.ts`), s).toBe(false)
    }
  })
  it('the service accepts only incident / investigation / inspection (audits keep linkFindingToAudit)', () => {
    const src = stripComments(read('lib/assurance/findings.ts'))
    expect(src).toMatch(/export type FindingLinkSource = 'incident' \| 'investigation' \| 'inspection';/)
    expect(src).toMatch(/INSERT INTO assurance_incident_findings/)
    expect(src).toMatch(/INSERT INTO assurance_investigation_findings/)
    expect(src).toMatch(/INSERT INTO assurance_inspection_findings/)
  })
  it('every source page offers the same shared "Link existing finding" control', () => {
    for (const p of ['incidents', 'investigations', 'inspections', 'audits']) {
      const src = read(`app/assurance/${p}/[id]/page.tsx`)
      expect(src, p).toMatch(new RegExp(`<LinkExistingFinding endpoint=\\{\`/api/assurance/${p}/\\$\\{`))
    }
  })
})

describe('evidence linking — every supported target from one selector', () => {
  it('the evidence page uses the shared selector and no longer hard-codes incident/finding forms', () => {
    const src = read('app/assurance/evidence/[id]/page.tsx')
    expect(src).toMatch(/<EvidenceLinkPanel /)
    expect(src).toMatch(/listEvidenceLinkTargetOptions\(viewer\)/)
    expect(src).not.toMatch(/label="Link to incident"|label="Link to finding"/)
  })
  it('the selector posts to the existing links endpoint and never offers verification', () => {
    const src = read('app/assurance/evidence/[id]/EvidenceLinkPanel.tsx')
    expect(src).toMatch(/\/api\/assurance\/evidence\/\$\{evidenceId\}\/links/)
    expect(src).not.toMatch(/verification/)
    expect(src).not.toMatch(/from '@\/lib\/(db|assurance\/(?!domain))/)
  })
})

describe('inspection cancellation — reason + explicit confirmation', () => {
  it('the page opens a reason form (confirmation step) and the route forwards the body', () => {
    const page = read('app/assurance/inspections/[id]/page.tsx')
    expect(page).toMatch(/label="Cancel inspection"[\s\S]{0,400}fields=\{\[\{ kind: 'textarea', name: 'reason', label: 'Reason', required: true/)
    const route = stripComments(read('app/api/assurance/inspections/[id]/cancel/route.ts'))
    expect(route).toMatch(/assurancePostWithId\('close', \(viewer, id, body\) => cancelInspection\(viewer, id, body\)/)
  })
  it('the service requires the reason and records it in the audit row (no new column)', () => {
    const src = stripComments(read('lib/assurance/inspections.ts'))
    const fn = src.slice(src.indexOf('export async function cancelInspection('))
    expect(fn).toMatch(/requiredText\(raw\.reason, 'Reason', 2000\)/)
    expect(fn).toMatch(/after: \{ status: 'CANCELLED', reason \}/)
  })
})

describe('template activation — confirmation', () => {
  it('both template pages confirm Deactivate / Reactivate', () => {
    for (const p of ['app/assurance/inspections/templates/[id]/page.tsx', 'app/assurance/audits/templates/[id]/page.tsx']) {
      const src = read(p)
      expect(src, p).toMatch(/label=\{t\.is_active \? 'Deactivate' : 'Reactivate'\}[\s\S]{0,500}confirm=\{t\.is_active/)
    }
  })
})

describe('copy', () => {
  it('the Findings register names audits as a source', () => {
    expect(read('app/assurance/findings/page.tsx')).toMatch(/from incidents, investigations, inspections and audits\./)
  })
})
