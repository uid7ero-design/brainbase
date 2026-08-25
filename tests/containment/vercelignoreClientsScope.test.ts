import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Fix — .vercelignore's original bare `Clients` rule (added 2026-05-02
// to keep the large repository-root Clients/ material, including the
// embedded Clients/ld-tennis/** Next.js scaffold, out of Vercel
// deployment uploads) is a gitignore-style pattern with no leading
// slash, so it matches a directory/file named "Clients" at ANY depth
// in the tree — not just the repository root. Vercel's own build for
// commit e2a7af9 confirmed this: its deployed route manifest was
// missing /clients and /clients/[id] entirely, even though both are
// genuinely tracked in git and compile correctly in a plain local
// build (which never consults .vercelignore at all — only Vercel's
// own deploy-upload step does). The unrelated, lowercase, in-app
// app/clients/** (added a week later, 2026-05-09, by someone with no
// reason to know about the earlier ignore rule) was being silently
// stripped from Vercel's build input by the same old rule.
//
// The fix anchors the pattern to the repository root (leading /) and
// keeps it directory-scoped (trailing /), so it can only ever match a
// directory literally named "Clients" sitting directly at the repo
// root — never a nested path like app/clients or components/clients,
// regardless of how Vercel's own (unobserved) ignore-matcher handles
// case. This suite cannot safely reimplement or simulate Vercel's
// actual ignore-matching semantics (no such library is a dependency
// of this repository, and hand-rolling one here would risk giving
// false confidence rather than real coverage) — it instead locks in
// the exact, reviewed fix as source text, the same convention already
// used elsewhere in this repository for config-file correctness (see
// organisationTimezoneSchema.test.ts).

const VERCELIGNORE_PATH = path.resolve(__dirname, '../../.vercelignore')
const VERCELIGNORE_SOURCE = fs.readFileSync(VERCELIGNORE_PATH, 'utf-8')
// Normalise CRLF/LF up front so line comparisons below are robust to
// either the file's or the checkout's line-ending convention.
const LINES = VERCELIGNORE_SOURCE.split(/\r?\n/)

describe('.vercelignore — Clients rule is scoped to the repository root only', () => {
  it('contains the root-anchored, directory-scoped replacement rule', () => {
    expect(LINES).toContain('/Clients/')
  })

  it('no longer contains the original unanchored rule that matched at any depth', () => {
    expect(LINES).not.toContain('Clients')
  })

  it('does not contain any other pattern that could unintentionally match app/clients or components/clients (e.g. a bare "clients", "**/clients", or "*clients*")', () => {
    const suspicious = LINES.filter(l => {
      const trimmed = l.trim()
      if (!trimmed || trimmed.startsWith('#')) return false
      return /clients/i.test(trimmed) && trimmed !== '/Clients/'
    })
    expect(suspicious).toEqual([])
  })

  it('the unrelated Dr Soong exclusion (same original commit, same purpose) is unchanged', () => {
    expect(LINES).toContain('Dr Soong')
  })

  it('every other pre-existing rule is unchanged (this was a one-line, single-rule fix)', () => {
    const expectedLines = [
      'node_modules',
      '.next',
      '.git',
      'Dr Soong',
      '/Clients/',
      '.brainbase',
      'public/avatars',
      'coverage',
      '*.log',
      '*.pem',
      '.env*',
      '# WIP — not yet ready for production',
      'app/api/ops',
      'backend_migration',
      'scripts/clear-bin-maintenance.ts',
      '"Waste Intelligence Dashboard"',
    ]
    const actualNonEmptyLines = LINES.map(l => l.trimEnd()).filter(l => l.length > 0)
    expect(actualNonEmptyLines).toEqual(expectedLines)
  })
})

describe('app/clients and components/clients remain genuinely tracked source, unaffected by this fix', () => {
  it('app/clients/page.tsx exists', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../app/clients/page.tsx'))).toBe(true)
  })

  it('app/clients/[id]/page.tsx exists', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../app/clients/[id]/page.tsx'))).toBe(true)
  })

  it('components/clients/ClientWorkspace.tsx exists', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../components/clients/ClientWorkspace.tsx'))).toBe(true)
  })
})
