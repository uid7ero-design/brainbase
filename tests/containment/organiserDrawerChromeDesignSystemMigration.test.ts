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

const organiserCss = fs.readFileSync(path.resolve(__dirname, '../../components/organiser/Organiser.module.css'), 'utf-8')

describe('C.4 Organiser drawer chrome design-system migration', () => {
  it('uses canonical drawer, scrim, surface, border, shadow, radius, motion, and text tokens', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(drawer).toContain('role="dialog"')
    expect(drawer).toContain('aria-modal="true"')
    expect(drawer).toContain('useDialogFocus(true, onClose, drawerPanelRef)')
    expect(drawer).toContain('zIndex: "var(--bb-z-drawer)"')
    expect(drawer).toContain('animation: "drawer-in var(--bb-duration-base) var(--bb-ease-standard)"')
    for (const token of ['var(--scrim)', 'var(--shadow-dialog)', 'var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)'])
      expect(organiserCss).toContain(token)

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
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(field).toContain('<span className={styles.fieldLabel}>')
    expect(field).toContain('role="group" aria-labelledby={labelId}')
    expect(field).toContain('<SaveStatusText status={status} />')
    expect(field).not.toContain('useOpsTheme')
    expect(organiserCss).toMatch(/\.fieldLabel \{[^}]*var\(--text-muted\)/)

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
