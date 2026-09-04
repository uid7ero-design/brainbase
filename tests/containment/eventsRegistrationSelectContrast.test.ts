import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Registration operations phase — dark select dropdown contrast fix.
//
// ROOT CAUSE: app/events/_components/ui.tsx's shared inputStyle already
// set an explicit dark background/light text for the CLOSED state of
// every <input>/<select> that uses it — RegistrationsPanel's five
// filter selects among them. But background/color on the element itself
// never reaches the browser's OPEN native option popup; only the
// color-scheme CSS property does. With no color-scheme set anywhere
// (confirmed absent from both ui.tsx and globals.css before this fix),
// browsers fell back to their default LIGHT popup theme — white
// background, near-invisible light-on-light option text — while the
// closed control itself looked correct. This is the same fix already
// applied per-element elsewhere in this codebase (e.g.
// components/ops/maintenance/CreateJobModal.tsx's selects), applied
// once here to the shared primitive so every current AND future
// consumer of inputStyle gets it for free — not just RegistrationsPanel.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('app/events/_components/ui.tsx — shared inputStyle sets colorScheme: dark', () => {
  const uiSrc = stripComments(read('app/events/_components/ui.tsx'))

  it('inputStyle includes colorScheme: \'dark\' alongside its existing explicit dark background/light color', () => {
    const start = uiSrc.indexOf('export const inputStyle')
    const end = uiSrc.indexOf('};', start)
    const block = uiSrc.slice(start, end)
    expect(block).toContain("colorScheme: 'dark'")
    // Not a replacement for the existing closed-state styling — both
    // must coexist (colorScheme fixes the open popup; background/color
    // still governs the closed control).
    expect(block).toMatch(/background:\s*'rgba\(255,255,255,\.03\)'/)
    expect(block).toContain('color: TEXT_PRIMARY')
  })

  it('no other exported style constant in this file was touched by this fix', () => {
    // fieldStyle (the label wrapper, not a form control) must remain
    // exactly as it was — this fix is scoped to inputStyle only.
    const fieldStart = uiSrc.indexOf('export const fieldStyle')
    const fieldEnd = uiSrc.indexOf(';', fieldStart)
    const fieldBlock = uiSrc.slice(fieldStart, fieldEnd)
    expect(fieldBlock).not.toContain('colorScheme')
  })
})

describe('RegistrationsPanel.tsx — all five filter selects inherit the fix via inputStyle', () => {
  const src = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))

  it('imports inputStyle from the shared Events ui module', () => {
    expect(src).toMatch(/import\s*\{[^}]*\binputStyle\b[^}]*\}\s*from\s*'\.\.\/_components\/ui'/)
  })

  it('all five filter <select> elements spread ...inputStyle into their style prop — none define a competing local background/color/colorScheme that would shadow it', () => {
    const selectBlocks = [...src.matchAll(/<select[\s\S]*?<\/select>/g)]
    expect(selectBlocks.length, 'expected exactly 5 <select> elements in this file (payment, checkin, cancelled, ticket type, session)').toBe(5)
    for (const [block] of selectBlocks) {
      expect(block, `select block missing ...inputStyle spread:\n${block.slice(0, 120)}`).toMatch(/style=\{\{\s*\.\.\.inputStyle/)
      expect(block).not.toMatch(/colorScheme:\s*'light'/)
    }
  })

  it('the five selects are: payment status, check-in status, cancellation, ticket type, session (aria-labels confirm coverage)', () => {
    for (const label of [
      'Filter by payment status',
      'Filter by check-in status',
      'Filter by cancellation',
      'Filter by ticket type',
      'Filter by session',
    ]) {
      expect(src).toContain(`aria-label="${label}"`)
    }
  })

  it('the dynamically-populated ticket type and session selects still map their own option lists — this fix did not touch that logic', () => {
    expect(src).toContain('{ticketTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}')
    expect(src).toContain('{sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}')
  })

  it('no native <select>/<option> semantics were replaced with a custom dropdown component', () => {
    expect(src).not.toMatch(/react-select|Listbox|Combobox|<Popover/i)
  })
})

describe('other pre-existing Events selects sharing inputStyle also receive the fix (unreported latent instances of the same bug)', () => {
  const consumers = [
    'app/events/[id]/EventDetailClient.tsx',
    'app/events/[id]/QuestionsPanel.tsx',
    'app/events/[id]/RegistrationDetail.tsx',
  ]

  for (const file of consumers) {
    it(`${file} imports inputStyle from the shared ui module (so it inherits colorScheme: dark automatically, no per-file change needed)`, () => {
      const src = stripComments(read(file))
      expect(src).toMatch(/import\s*\{[^}]*\binputStyle\b[^}]*\}\s*from\s*'[^']*_components\/ui'/)
    })
  }
})
