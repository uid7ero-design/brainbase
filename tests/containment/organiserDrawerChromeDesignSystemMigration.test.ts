import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/organiser/page.tsx'),
  'utf-8',
)

const drawerStart = source.indexOf('function ItemDrawer(')
const drawerEnd = source.indexOf('\nfunction Field(', drawerStart)
const drawer = source.slice(drawerStart, drawerEnd)
const fieldStart = source.indexOf('function Field(', drawerEnd)
const fieldEnd = source.indexOf('\n// ── PAGE', fieldStart)
const field = source.slice(fieldStart, fieldEnd)

describe('C.4 Organiser drawer chrome design-system migration', () => {
  it('uses canonical drawer, scrim, surface, border, shadow, radius, motion, and text tokens', () => {
    for (const token of [
      '--bb-z-drawer', '--bb-scrim', '--bb-surface-1', '--bb-surface-soft',
      '--bb-border-default', '--bb-border-subtle', '--bb-shadow-modal',
      '--bb-radius-sm', '--bb-radius-md', '--bb-duration-base', '--bb-ease-standard',
      '--bb-text-primary', '--bb-text-secondary', '--bb-text-tertiary', '--bb-text-muted',
      '--bb-accent-400', '--bb-danger', '--bb-space-6', '--bb-space-7',
    ]) {
      expect(drawer).toContain(token)
    }
  })

  it('preserves the portal mounting and close-overlay behavior', () => {
    expect(drawer).toContain('const drawerContent = (')
    expect(drawer).toContain('onClick={onClose}')
    expect(drawer).toContain('createPortal(drawerContent, document.body)')
    expect(drawer).toContain('typeof document !== "undefined"')
  })

  it('preserves all direct item field mutation callbacks', () => {
    expect(drawer).toContain('onSave={v => onUpdate(item.id, { name: v })}')
    expect(drawer).toContain('onChange={v => onUpdate(item.id, { status: v })}')
    expect(drawer).toContain('onChange={v => onUpdate(item.id, { priority: v })}')
    expect(drawer).toContain('onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}')
    expect(drawer).toContain('onChange={e => onUpdate(item.id, { owner: e.target.value })}')
    expect(drawer).toContain('onChange={v => onUpdate(item.id, { assignee_user_id: v || null })}')
  })

  it('preserves Notes draft, 800ms autosave, blur flush, and item-switch safety wiring', () => {
    expect(drawer).toContain('value={notesDraft}')
    expect(drawer).toContain('onChange={e => handleNotesChange(e.target.value)}')
    expect(drawer).toContain('onBlur={flushNotesNow}')
    expect(drawer).toContain('{ debounceMs: 800 }')
    expect(drawer).toContain('notesAutosave.schedule(item.id, value)')
    expect(drawer).toContain('onUpdate(pending.itemId, { notes: pending.value })')
    expect(drawer).toContain('if (notesSeenItemId !== item.id)')
  })

  it('preserves file upload/delete success and failure behavior', () => {
    expect(drawer).toContain('fd.append("file", file)')
    expect(drawer).toContain('method: "POST"')
    expect(drawer).toContain('setFiles(prev => [d.file!, ...prev])')
    expect(drawer).toContain('method: "DELETE"')
    expect(drawer).toContain('setFiles(prev => prev.filter(f => f.id !== fileId))')
    expect(drawer).toContain('setFileError(d.error || `Upload failed (${res.status}).`)')
    expect(drawer).toContain('setFileError(`Couldn\'t delete file (${res.status}).`)')
  })

  it('preserves update posting semantics and does not fake success', () => {
    expect(drawer).toContain('const body = newUpdate.trim()')
    expect(drawer).toContain('if (!body) return')
    expect(drawer).toContain('if (!res.ok || !d.update)')
    expect(drawer).toContain('setUpdates(prev => [d.update, ...prev])')
    expect(drawer).toContain('setNewUpdate("")')
    expect(drawer).toContain('disabled={!newUpdate.trim()}')
  })

  it('preserves fresh activity and same-org member/assignee wiring', () => {
    expect(drawer).toContain('<ItemActivity key={`${item.id}:${item.updated_at}`}')
    expect(drawer).toContain('members={members}')
    expect(drawer).toContain('for (const m of members) map[m.id] = m.name')
    expect(drawer).toContain('<AssigneeDropdown')
  })

  it('tokenises the shared drawer Field label without changing save-status composition', () => {
    expect(field).toContain('fontSize: "var(--bb-type-micro-size)"')
    expect(field).toContain('letterSpacing: "var(--bb-type-micro-tracking)"')
    expect(field).toContain('color: "var(--bb-text-muted)"')
    expect(field).toContain('<SaveStatusText status={status} />')
    expect(field).not.toContain('useOpsTheme')
  })

  it('removes the targeted legacy drawer chrome literals', () => {
    for (const literal of [
      'background: "rgba(0,0,0,.45)"',
      'boxShadow: "-16px 0 40px rgba(0,0,0,.5)"',
      'animation: "drawer-in .18s ease"',
      'background: t.panelBgSolid',
      'color: "#EF4444"',
      'color: "#a5b4fc"',
      'color: "rgba(239,68,68,.6)"',
    ]) {
      expect(drawer).not.toContain(literal)
    }
  })
})
