import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1.2 — client_pipeline / pipeline_messages organisation_id (and
// client_pipeline.submitted_by) TEXT/UUID type mismatch. organisations.id
// and users.id are TEXT (cuid) everywhere else in this schema; a session's
// real organisationId is not valid UUID literal syntax, so a UUID-typed
// organisation_id column here would throw "invalid input syntax for type
// uuid" against every query comparing it to a real session value.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

describe('Phase C1.2 — schema-definition sources declare organisation_id/submitted_by as TEXT', () => {
  it("app/api/pipeline/route.ts's ensureTable() creates organisation_id/submitted_by as TEXT with FK references, not UUID", () => {
    const source = readSource('app/api/pipeline/route.ts')
    expect(source).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES organisations\(id\)/)
    expect(source).toMatch(/submitted_by\s+TEXT\s+REFERENCES users\(id\)/)
    expect(source).not.toMatch(/organisation_id\s+UUID/)
    expect(source).not.toMatch(/submitted_by\s+UUID/)
  })

  it('scripts/migrate-client-pipeline.ts declares the same corrected TEXT types', () => {
    const source = readSource('scripts/migrate-client-pipeline.ts')
    expect(source).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES organisations\(id\)/)
    expect(source).toMatch(/submitted_by\s+TEXT\s+REFERENCES users\(id\)/)
    expect(source).not.toMatch(/organisation_id\s+UUID/)
  })

  it('scripts/migrate-pipeline-messages.ts declares organisation_id as TEXT, while pipeline_id correctly stays UUID (it references client_pipeline.id, a genuine UUID PK)', () => {
    const source = readSource('scripts/migrate-pipeline-messages.ts')
    expect(source).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES organisations\(id\)/)
    expect(source).toMatch(/pipeline_id\s+UUID\s+NOT NULL\s+REFERENCES client_pipeline\(id\)/)
  })
})

describe('Phase C1.2 — prepared (not executed) live-data migration exists and is preflight-safe', () => {
  const source = readSource('scripts/fix-client-pipeline-organisation-id-type.ts')

  it('never changes TEXT back to UUID — only UUID -> TEXT, and only after checking the live type first', () => {
    expect(source).toMatch(/type !== 'uuid'/)
    expect(source).toMatch(/ALTER COLUMN \$\{column\} TYPE TEXT USING \$\{column\}::text/)
    expect(source).not.toMatch(/TYPE UUID/)
  })

  it('adds a foreign key only when a preflight orphan-row count is exactly zero, and never deletes/reassigns orphan rows', () => {
    expect(source).toMatch(/orphanCount > 0/)
    expect(source).toMatch(/FK NOT added/)
    expect(source).not.toMatch(/DELETE FROM/)
    expect(source).not.toMatch(/UPDATE .* SET organisation_id/)
  })

  it('is not invoked/imported by any application code or test — a prepared artifact only, never auto-run', () => {
    const appWideMatches = ['app', 'lib', 'components', 'services', 'modules']
      .flatMap(dir => {
        try {
          return fs.readdirSync(path.resolve(__dirname, '../../', dir), { recursive: true, encoding: 'utf-8' }) as string[]
        } catch { return [] }
      })
    // Cheap sanity check rather than a full grep: the migration script's own
    // filename must not appear as a literal import specifier anywhere under
    // app/lib/components/services/modules.
    expect(appWideMatches.some(f => f.includes('fix-client-pipeline-organisation-id-type'))).toBe(false)
  })
})
