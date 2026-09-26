import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/reports/page.tsx'),
  'utf-8',
)

describe('A.3 Reports reference-screen migration', () => {
  it('uses the initial shared primitives and canonical BrainBase tokens', () => {
    expect(source).toContain("import { Badge, SectionHeader, Surface } from '@/components/ui'")
    expect(source).toContain('<SectionHeader')
    expect(source).toContain('<Surface')
    expect(source).toContain('<Badge')
    expect(source).toContain("background: 'var(--bb-canvas)'")
    expect(source).toContain("color: 'var(--bb-text-primary)'")
    expect(source).toContain("fontFamily: 'var(--bb-font-sans)'")
  })

  it('preserves authentication and unauthenticated redirect behaviour', () => {
    expect(source).toContain("import { getSession } from '@/lib/session'")
    expect(source).toContain("import { redirect } from 'next/navigation'")
    expect(source).toContain('const session = await getSession()')
    expect(source).toContain("if (!session) redirect('/login')")
  })

  it('preserves the exact organisation-scoped read query and ordering', () => {
    expect(source).toContain('FROM reports r')
    expect(source).toContain('JOIN users u ON u.id = r.created_by')
    expect(source).toContain('LEFT JOIN uploaded_files uf ON uf.id = r.source_file_id')
    expect(source).toContain('WHERE r.organisation_id = ${session.organisationId}')
    expect(source).toContain('ORDER BY r.created_at DESC')
  })

  it('remains read-only — no report mutations, API writes, or client state were introduced', () => {
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/)
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('useState')
    expect(source).not.toContain('useEffect')
    expect(source).not.toContain("'use client'")
    expect(source).not.toContain('"use client"')
  })

  it('preserves report links and the empty-state destination', () => {
    expect(source).toContain('href="/data"')
    expect(source).toContain('href={`/reports/${r.id}`}')
    expect(source).toContain('Upload data and generate your first report →')
    expect(source).toContain('View →')
  })

  it('preserves report type labels and category colours rather than reinterpreting report data', () => {
    for (const label of [
      'Waste Summary',
      'Contamination',
      'Cost Analysis',
      'Diversion Rate',
      'Custom',
    ]) {
      expect(source).toContain(label)
    }
    expect(source).toContain("const typeColor = TYPE_COLORS[String(r.report_type)] ?? '#9ca3af'")
    expect(source).toContain('TYPE_LABELS[String(r.report_type)] ?? r.report_type')
  })

  it('does not import any new app behaviour, routing, database, or design dependencies beyond the shared UI barrel', () => {
    expect(source).not.toMatch(/@\/components\/(?!ui)/)
    expect(source).not.toMatch(/@\/lib\/(?!session|db)/)
  })
})
