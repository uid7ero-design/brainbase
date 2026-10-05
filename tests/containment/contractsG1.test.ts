import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// Reviewer G1 — source-level contracts that are impractical to render.
// Expected values are copied from the base commit ecb5b03.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

describe('G1 contract — admin layout super_admin gate (base ecb5b03)', () => {
  const src = stripComments(read('app/admin/layout.tsx'))

  it('imports getSession and redirect from the same modules as base', () => {
    expect(src).toContain("import { getSession } from '@/lib/session';")
    expect(src).toContain("import { redirect } from 'next/navigation';")
  })

  it('awaits the session and redirects to / unless the role is exactly super_admin, before rendering', () => {
    expect(src).toContain('const session = await getSession();')
    expect(src).toContain("if (!session || session.role !== 'super_admin') redirect('/');")
    const gate = src.indexOf("redirect('/')")
    const render = src.indexOf('return (')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(render)
    // exactly one redirect, no alternative role allowances
    expect(src.match(/redirect\(/g)).toHaveLength(1)
    expect(src.match(/super_admin/g)).toHaveLength(1)
  })

  it('still mounts AdminAside with the session name around the children', () => {
    expect(src).toContain('<AdminAside name={session.name} />')
    expect(src).toContain('{children}')
  })
})

describe('G1 contract — SessionProvider WelcomeBackBanner (base ecb5b03)', () => {
  const src = stripComments(read('components/session/SessionProvider.tsx'))

  it('keeps the base copy "Welcome back, <first name>"', () => {
    expect(src).toContain("const firstName = name.split(' ')[0];")
    expect(src).toMatch(/Welcome back,\{' '\}/)
  })
})
