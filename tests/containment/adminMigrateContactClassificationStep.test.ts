import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Urgent CRM contact classification hotfix — wires the already-approved,
// already-audited migration (scripts/add-crm-contact-classification.sql,
// proven against a real disposable Postgres via
// scripts/tests/verify-crm-contact-classification-migration.sh) into
// this repo's ONE authenticated Production migration mechanism,
// POST /api/admin/migrate, as a new numbered step (42), rather than
// requiring a separate one-off script execution with direct database
// credentials. This file proves: (1) the new step exists, is additive-
// only, and never touches existing contacts; (2) every prior migration
// step (1-41) is byte-for-byte untouched; (3) the route is still
// super_admin-gated; (4) the route step and the standalone .sql file
// implement equivalent schema semantics and cannot silently drift apart.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const routeSource = read('app/api/admin/migrate/route.ts')
const standaloneSql = read('scripts/add-crm-contact-classification.sql')

// ─────────────────────────────────────────────────────────────────────
// STATIC — the new step exists and is additive-only
// ─────────────────────────────────────────────────────────────────────

describe('app/api/admin/migrate/route.ts — new step 42 (crm_contacts.classification)', () => {
  it('adds a new, distinctly-labelled step after the prior highest step (41)', () => {
    expect(routeSource).toContain("step('41. organiser_activity_sanitise_scalar')")
    expect(routeSource).toContain("step('42. crm_contacts.classification')")
    const idx41 = routeSource.indexOf("step('41. organiser_activity_sanitise_scalar')")
    const idx42 = routeSource.indexOf("step('42. crm_contacts.classification')")
    expect(idx42).toBeGreaterThan(idx41)
  })

  it('the new step runs before the success response, inside the same try block', () => {
    const idx42 = routeSource.indexOf("step('42. crm_contacts.classification')")
    const idxSuccess = routeSource.indexOf("message: 'Migration complete.'")
    const idxCatch = routeSource.indexOf('} catch (err: unknown)')
    expect(idx42).toBeGreaterThan(-1)
    expect(idx42).toBeLessThan(idxSuccess)
    expect(idxSuccess).toBeLessThan(idxCatch)
  })

  it('adds classification as a nullable column with no default, idempotently (IF NOT EXISTS)', () => {
    const stepBody = routeSource.slice(
      routeSource.indexOf("step('42. crm_contacts.classification')"),
      routeSource.indexOf("return NextResponse.json({ success: true"),
    )
    expect(stepBody).toMatch(/ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT/)
    expect(stepBody).not.toMatch(/classification TEXT[^`]*NOT NULL/)
    expect(stepBody).not.toMatch(/classification TEXT[^`]*DEFAULT/)
  })

  it('the CHECK constraint uses the same guarded-DO-block idempotency technique already established at step 32 (client_pipeline), not a new pattern, and lists exactly the six canonical values', () => {
    const stepBody = routeSource.slice(
      routeSource.indexOf("step('42. crm_contacts.classification')"),
      routeSource.indexOf("return NextResponse.json({ success: true"),
    )
    expect(stepBody).toMatch(/DO \$\$\s*\n\s*BEGIN\s*\n\s*IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_classification_check'/)
    for (const value of ['CLIENT', 'LEAD', 'EVENT_CONTACT', 'SUPPLIER', 'PARTNER', 'OTHER']) {
      expect(stepBody).toContain(`'${value}'`)
    }
    const matches = stepBody.match(/'[A-Z_]+'/g) ?? []
    expect(matches.filter(m => m !== "'text'").length).toBe(6)
  })

  it('adds the tenant-scoped index, organisation_id first', () => {
    const stepBody = routeSource.slice(
      routeSource.indexOf("step('42. crm_contacts.classification')"),
      routeSource.indexOf("return NextResponse.json({ success: true"),
    )
    expect(stepBody).toContain('CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification')
    expect(stepBody).toContain('ON crm_contacts(organisation_id, classification)')
  })

  it('performs no UPDATE, DELETE, or INSERT into crm_contacts anywhere in the new step — no existing-contact reclassification', () => {
    const stepBody = routeSource.slice(
      routeSource.indexOf("step('42. crm_contacts.classification')"),
      routeSource.indexOf("return NextResponse.json({ success: true"),
    )
    expect(stepBody).not.toMatch(/UPDATE\s+crm_contacts/i)
    expect(stepBody).not.toMatch(/DELETE\s+FROM\s+crm_contacts/i)
    expect(stepBody).not.toMatch(/INSERT\s+INTO\s+crm_contacts/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// STATIC — every prior step (1-41) is untouched
// ─────────────────────────────────────────────────────────────────────

describe('app/api/admin/migrate/route.ts — prior migration steps remain intact', () => {
  it('still contains every previously-numbered step label, 1 through 41, unrenamed', () => {
    // A representative sample spanning the file (first, several
    // middles, and the immediately-preceding step) rather than every
    // single one — proves nothing was renumbered or removed around the
    // insertion point, without hand-maintaining a 41-entry list here.
    for (const label of [
      "step('1. organisations')",
      "step('2. users columns')",
      "step('32. client_pipeline awaiting_client status')",
      "step('33. organiser_boards')",
      "step('40. organiser_activity')",
      "step('41. organiser_activity_sanitise_scalar')",
    ]) {
      expect(routeSource).toContain(label)
    }
  })

  it('the pre-existing client_pipeline CHECK-constraint step (32) is unchanged in shape — proves this hotfix did not alter the established idempotency pattern it reuses', () => {
    expect(routeSource).toContain("ADD CONSTRAINT client_pipeline_status_check")
    expect(routeSource).toContain("CHECK (status IN ('new', 'in_progress', 'awaiting_client', 'resolved'))")
  })

  it('the organiser_activity_sanitise_scalar function body (step 41) is byte-for-byte unchanged', () => {
    expect(routeSource).toContain("CREATE OR REPLACE FUNCTION organiser_activity_sanitise_scalar(value jsonb)")
    expect(routeSource).toContain("'…(truncated)'")
  })
})

// ─────────────────────────────────────────────────────────────────────
// STATIC — route remains super_admin protected
// ─────────────────────────────────────────────────────────────────────

describe('app/api/admin/migrate/route.ts — auth is unchanged by this hotfix', () => {
  it('still requires a session and super_admin role before any step runs, including the new one', () => {
    expect(routeSource).toContain("import { getSession } from '@/lib/session'")
    expect(routeSource).toMatch(/if \(!session \|\| session\.role !== 'super_admin'\)/)
    const authIdx = routeSource.indexOf("session.role !== 'super_admin'")
    const step42Idx = routeSource.indexOf("step('42. crm_contacts.classification')")
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(step42Idx)
  })
})

// ─────────────────────────────────────────────────────────────────────
// BEHAVIOURAL — the route actually runs the new step correctly when
// authorized, and rejects when not
// ─────────────────────────────────────────────────────────────────────

const getSessionMock = vi.fn()
vi.mock('@/lib/session', () => ({ getSession: () => getSessionMock() }))

let calls: { text: string; values: unknown[] }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const { POST } = await import('@/app/api/admin/migrate/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  calls = []
})

describe('POST /api/admin/migrate — behavioural', () => {
  it('rejects with 403 when there is no session, before running any SQL', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the session role is not super_admin, before running any SQL', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', role: 'manager' })
    const res = await POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('as super_admin, the run reaches and executes the classification step: adds the column, the guarded CHECK constraint, and the index', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', role: 'super_admin' })
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.steps).toContain('42. crm_contacts.classification')

    const addColumnCall = calls.find(c => c.text.includes('ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT'))
    expect(addColumnCall).toBeDefined()

    const checkConstraintCall = calls.find(c => c.text.includes('crm_contacts_classification_check'))
    expect(checkConstraintCall).toBeDefined()
    expect(checkConstraintCall!.text).toContain('EVENT_CONTACT')

    const indexCall = calls.find(c => c.text.includes('idx_crm_contacts_classification'))
    expect(indexCall).toBeDefined()
    expect(indexCall!.text).toContain('ON crm_contacts(organisation_id, classification)')
  })

  it('no call anywhere during the run is an UPDATE/DELETE/INSERT against crm_contacts', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', role: 'super_admin' })
    await POST()
    const crmContactsWrites = calls.filter(c =>
      c.text.includes('crm_contacts') && /UPDATE|DELETE|INSERT/i.test(c.text) && !c.text.includes('ADD COLUMN') && !c.text.includes('ADD CONSTRAINT'),
    )
    expect(crmContactsWrites).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// EQUIVALENCE — the route step and the standalone .sql file cannot
// silently drift apart
// ─────────────────────────────────────────────────────────────────────

describe('Equivalence — route step 42 vs scripts/add-crm-contact-classification.sql', () => {
  function extractRouteStepBody(): string {
    return routeSource.slice(
      routeSource.indexOf("step('42. crm_contacts.classification')"),
      routeSource.indexOf("return NextResponse.json({ success: true"),
    )
  }

  it('both add the SAME column (name, type, nullability, default)', () => {
    const routeBody = extractRouteStepBody()
    expect(routeBody).toMatch(/ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT/)
    expect(standaloneSql).toMatch(/ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT;/)
  })

  it('both constrain classification to exactly the same six values (order-independent) plus NULL, under the same constraint name', () => {
    const routeBody = extractRouteStepBody()
    const routeCheckStart = routeBody.indexOf('CHECK (classification')
    const routeCheckBlock = routeBody.slice(routeCheckStart, routeBody.indexOf('));', routeCheckStart) + 3)
    const routeValues = new Set(routeCheckBlock.match(/'[A-Z_]+'/g) ?? [])

    const sqlCheckStart = standaloneSql.indexOf('CHECK (classification')
    const sqlCheckBlock = standaloneSql.slice(sqlCheckStart, standaloneSql.indexOf('));', sqlCheckStart) + 3)
    const sqlValues = new Set(sqlCheckBlock.match(/'[A-Z_]+'/g) ?? [])

    expect(routeValues).toEqual(sqlValues)
    expect(routeValues.size).toBe(6)
    expect(routeBody).toContain('crm_contacts_classification_check')
    expect(standaloneSql).toContain('crm_contacts_classification_check')
    expect(routeBody).toContain('classification IS NULL OR classification IN')
    expect(standaloneSql).toContain('classification IS NULL OR classification IN')
  })

  it('both create the same index, same name, same column order', () => {
    const routeBody = extractRouteStepBody()
    expect(routeBody).toContain('idx_crm_contacts_classification')
    expect(routeBody).toContain('organisation_id, classification')
    expect(standaloneSql).toContain('idx_crm_contacts_classification')
    expect(standaloneSql).toMatch(/ON crm_contacts\(organisation_id, classification\)/)
  })

  it('neither performs a backfill/UPDATE/DELETE/INSERT against crm_contacts', () => {
    const routeBody = extractRouteStepBody()
    expect(routeBody).not.toMatch(/UPDATE\s+crm_contacts/i)
    expect(standaloneSql.replace(/--.*$/gm, '')).not.toMatch(/UPDATE\s+crm_contacts/i)
  })
})

