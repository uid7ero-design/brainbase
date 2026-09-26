import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../components/ui', name), 'utf-8')

const surface = read('Surface.tsx')
const button = read('Button.tsx')
const iconButton = read('IconButton.tsx')
const badge = read('Badge.tsx')
const sectionHeader = read('SectionHeader.tsx')
const input = read('Input.tsx')
const barrel = read('index.ts')

const allPrimitiveSource = [
  surface,
  button,
  iconButton,
  badge,
  sectionHeader,
  input,
  barrel,
].join('\n')

describe('BrainBase initial shared UI primitives', () => {
  it('adds only the agreed initial primitive set and exports it from one barrel', () => {
    for (const component of ['Surface', 'Button', 'IconButton', 'Badge', 'SectionHeader', 'Input']) {
      expect(barrel).toContain(`export { ${component} }`)
    }
    expect(barrel).not.toMatch(/Modal|Drawer|DataTable|Select|Tabs|Menu|Tooltip|Toast/)
  })

  it('Button remains a native button wrapper and passes native props through', () => {
    expect(button).toContain('ButtonHTMLAttributes<HTMLButtonElement>')
    expect(button).toContain('<button')
    expect(button).toContain('{...rest}')
    expect(button).toContain('rest.disabled')
    expect(button).not.toContain('useState')
    expect(button).not.toContain('onClick=')
  })

  it('IconButton remains a native button and requires an accessible label', () => {
    expect(iconButton).toContain("Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>")
    expect(iconButton).toContain("'aria-label': string")
    expect(iconButton).toContain('<button')
    expect(iconButton).toContain('{...rest}')
  })

  it('Input remains a native input wrapper, forwards its ref, and owns no form state', () => {
    expect(input).toContain('export type InputProps = InputHTMLAttributes<HTMLInputElement>')
    expect(input).toContain('forwardRef<HTMLInputElement, InputProps>')
    expect(input).toContain('<input')
    expect(input).toContain('{...rest}')
    expect(input).not.toContain('useState')
    expect(input).not.toContain('onChange=')
  })

  it('Surface is presentation-only and supports the planned semantic variants', () => {
    expect(surface).toContain("export type SurfaceVariant = 'base' | 'raised' | 'overlay' | 'soft' | 'selected'")
    expect(surface).toContain("base: 'var(--bb-surface-1)'")
    expect(surface).toContain("raised: 'var(--bb-surface-2)'")
    expect(surface).toContain("overlay: 'var(--bb-surface-3)'")
    expect(surface).toContain("soft: 'var(--bb-surface-soft)'")
    expect(surface).toContain("selected: 'var(--bb-surface-selected)'")
    expect(surface).not.toContain('useState')
    expect(surface).not.toContain('useEffect')
  })

  it('Badge variants use semantic brand/status tokens rather than interpreting data', () => {
    for (const token of [
      '--bb-accent-soft',
      '--bb-success-soft',
      '--bb-warning-soft',
      '--bb-danger-soft',
      '--bb-info-soft',
    ]) {
      expect(badge).toContain(token)
    }
    expect(badge).not.toContain('if (')
    expect(badge).not.toContain('switch (')
  })

  it('SectionHeader is visual composition only', () => {
    expect(sectionHeader).toContain('eyebrow?: ReactNode')
    expect(sectionHeader).toContain('title: ReactNode')
    expect(sectionHeader).toContain('description?: ReactNode')
    expect(sectionHeader).toContain('actions?: ReactNode')
    expect(sectionHeader).not.toContain('useState')
    expect(sectionHeader).not.toContain('useEffect')
  })

  it('all primitives consume canonical BrainBase tokens and contain no app/data dependencies', () => {
    expect(allPrimitiveSource).toContain('var(--bb-')
    expect(allPrimitiveSource).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(allPrimitiveSource).not.toContain('fetch(')
    expect(allPrimitiveSource).not.toContain('useRouter')
    expect(allPrimitiveSource).not.toContain('localStorage')
    expect(allPrimitiveSource).not.toContain('sessionStorage')
  })

  it('does not add client-only directives to presentation primitives', () => {
    expect(allPrimitiveSource).not.toContain("'use client'")
    expect(allPrimitiveSource).not.toContain('"use client"')
  })
})
