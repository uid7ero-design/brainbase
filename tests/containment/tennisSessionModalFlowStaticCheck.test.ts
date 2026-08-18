import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.
//
// Covers this round's Part A fix: Manage Sessions -> Edit used to render
// Edit Session BEHIND Manage Sessions (both showManageSessions and
// editingSession stayed truthy at once, differentiated only by z-index —
// Manage Sessions at 1100 sat visually on top of Edit at 1000). The fix is
// close-before-open, not a z-index bump.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — Manage Sessions -> Edit no longer stacks two dialogs', () => {
  it('1. onEdit closes Manage Sessions before opening Edit Session — Manage Sessions is never left mounted underneath', () => {
    expect(source).toContain('onEdit={s => { setShowManageSessions(false); setEditingSession(s) }}')
  })

  it('2. Edit Session now owns its own focus-on-mount, independent of whatever opened it', () => {
    const fnStart = source.indexOf('function EditModal(')
    const fnEnd = source.indexOf('\n// ─── Manage Session Types')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const closeRef = useRef<HTMLButtonElement>(null)')
    expect(body).toContain('closeRef.current?.focus()')
    expect(body).toContain('ref={closeRef}')
  })

  it('3. Edit Session owns its own Escape-to-close, so Escape closes only the dialog actually on screen', () => {
    const fnStart = source.indexOf('function EditModal(')
    const fnEnd = source.indexOf('\n// ─── Manage Session Types')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain("e.key === 'Escape'")
    expect(body).toContain('document.addEventListener')
    expect(body).toContain('document.removeEventListener') // cleanup — a hidden/unmounted Edit can't keep trapping Escape
  })

  it('4. Edit Session exposes dialog semantics matching the rest of the modal system', () => {
    const fnStart = source.indexOf('function EditModal(')
    const fnEnd = source.indexOf('\n// ─── Manage Session Types')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('role="dialog"')
    expect(body).toContain('aria-modal="true"')
    expect(body).toContain('aria-label="Edit session"')
  })

  it('5. Delete confirmation stays fully inline inside Manage Sessions — it never opens a second dialog that could stack', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    // Confirm/Cancel are rendered conditionally on local confirmDeleteId
    // state within this same component — not a separate modal/component.
    expect(body).toContain('confirmDeleteId === s.id')
    expect(body).toContain('async function handleDeleteConfirmed(')
    // Never reaches for any of the page-level dialog setters.
    expect(body).not.toMatch(/setShowCreate|setShowManageTypes|setEditingSession/)
  })

  it('6. Repair opens no other dialog — it only updates local busy/notes state and calls the onRepaired refresh callback', () => {
    const fnStart = source.indexOf('async function handleRepair(')
    const fnEnd = source.indexOf('\n  async function handleDeleteConfirmed(')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const body = source.slice(fnStart, fnEnd)
    expect(body).not.toMatch(/setShowCreate|setShowManageTypes|setEditingSession|setShowManageSessions/)
  })

  it('7. Manage Types is not reachable from within Manage Sessions — no prop/handler exists to open it from that surface', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const propsLine = source.slice(fnStart, source.indexOf('{', fnStart))
    const body = source.slice(fnStart, fnEnd)
    expect(propsLine).not.toContain('onManageTypes')
    expect(body).not.toContain('setShowManageTypes')
  })
})
