import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf-8')

const page = read('app/organiser/page.tsx')
const rail = read('components/organiser/OrganiserRail.tsx')
// D.4.7F — the group/item/subitem drag handle's own `draggable`/onDragStart
// markup was extracted into this component (still owned by, and only ever
// rendered from, table chrome — never the rail). See ReorderHandle.tsx.
const reorderHandle = read('components/organiser/ReorderHandle.tsx')

const organiserCss = fs.readFileSync(path.resolve(__dirname, '../../components/organiser/Organiser.module.css'), 'utf-8')
const railCss = fs.readFileSync(path.resolve(__dirname, '../../components/organiser/OrganiserRail.module.css'), 'utf-8')

describe('C.3 Organiser rail and table chrome design-system migration', () => {
  it('migrates OrganiserRail chrome to canonical BrainBase tokens', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(rail).toContain("import styles from './OrganiserRail.module.css'")
    expect(rail).toContain('<nav')
    expect(rail).toContain('aria-current')
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)', 'var(--brand-brainbase-accent)'])
      expect(railCss).toContain(token)
    expect(rail).not.toContain('useOpsTheme')
    expect(rail).not.toContain('var(--font-inter)')

  })

  it('preserves rail collapse persistence, exact widths, and hydration guard', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(rail).toContain("const COLLAPSE_KEY = 'organiser-rail-collapsed'")
    expect(rail).toContain('localStorage.getItem(COLLAPSE_KEY)')
    expect(rail).toContain('localStorage.setItem(COLLAPSE_KEY, String(next))')
    expect(rail).toContain('const width = collapsed ? 56 : 208')
    expect(rail).toContain("visibility: mounted ? 'visible' : 'hidden'")
    expect(rail).toContain("aria-label={collapsed ? 'Expand Organiser rail' : 'Collapse Organiser rail'}")
    // The collapsed chevron rotation lives in the rail CSS module (D3).
    expect(railCss).toMatch(/\.rail\[data-collapsed\] \.collapse \{\s*transform: rotate\(180deg\)/)

  })

  it('preserves rail board selection, create, rename, and delete behavior', () => {
    expect(rail).toContain('onClick={() => onSelect(b.id)}')
    expect(rail).toContain("onBlur={() => { if (name.trim()) onCreate(name.trim()); setName(''); setAdding(false); }}")
    expect(rail).toContain("if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); setAdding(false); }")
    expect(rail).toContain("if (e.key === 'Escape') { setName(''); setAdding(false); }")
    expect(rail).toContain("const n = prompt('Rename board', b.name)")
    expect(rail).toContain('if (n?.trim()) onRename(b.id, n.trim())')
    expect(rail).toContain('confirm(`Delete board \"${b.name}\"? This deletes all its groups and items.`)')
    expect(rail).toContain('onDelete(b.id)')
  })

  it('migrates table group, row, input, menu, and destructive-action chrome to canonical tokens', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(page).toContain('className={styles.')
    for (const token of ['var(--border)', 'var(--bg-surface)', 'var(--bg-sunken)', 'var(--text-secondary)', 'var(--status-danger)', 'var(--radius-sm)', 'var(--shadow-menu)'])
      expect(organiserCss).toContain(token)

  })

  it('preserves item mutation entry points and row interaction semantics', () => {
    expect(page).toContain('onSave={v => onUpdate(item.id, { name: v })}')
    expect(page).toContain('onClick={() => onOpenDrawer(item)}')
    expect(page).toContain('onChange={v => onUpdate(item.id, { status: v })}')
    expect(page).toContain('onChange={v => onUpdate(item.id, { priority: v })}')
    expect(page).toContain('onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}')
    expect(page).toContain('onChange={v => onUpdate(item.id, { custom_values: { [col.id]: v } })}')
    expect(page).toContain('onClick={() => onDelete(item.id)}')
    expect(page).toContain('onClick={onToggleCollapse}')
  })

  it('preserves AddItemRow duplicate-submit protection and retry behavior', () => {
    expect(page).toContain('if (!trimmed || submitting) return')
    expect(page).toContain('setSubmitting(true)')
    expect(page).toContain('const ok = await onAdd(trimmed)')
    expect(page).toContain('setSubmitting(false)')
    expect(page).toContain('setValue("")')
    expect(page).toContain('setError("Couldn\'t create item. Try again.")')
    expect(page).toContain('if (e.key === "Enter") submit()')
    expect(page).toContain('disabled={submitting}')
  })

  it('preserves group membership, sibling ordering, subitem rendering, and collapse behavior', () => {
    expect(page).toContain('.filter(i => i.group_id === (group?.id ?? null) && !i.parent_item_id)')
    expect(page).toContain('.sort((a, b) => a.position - b.position)')
    expect(page).toContain('const childrenOf = (parentId: string) => items.filter(i => i.parent_item_id === parentId).sort((a, b) => a.position - b.position)')
    expect(page).toContain('const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())')
    expect(page).toContain('n.has(item.id) ? n.delete(item.id) : n.add(item.id)')
    expect(page).toContain('<AddItemRow indent onAdd={name => onAddItem(name, group?.id ?? null, item.id)} />')
    expect(page).toContain('<AddItemRow onAdd={name => onAddItem(name, group?.id ?? null, null)} />')
  })

  it('preserves column add, rename, option-edit, and delete interactions', () => {
    expect(page).toContain('onClick={() => setOpen(true)} title="Add column"')
    expect(page).toContain('onAdd(name.trim(), type)')
    expect(page).toContain('const n = prompt("Rename column", column.name)')
    expect(page).toContain('if (n?.trim()) onRename(n.trim())')
    expect(page).toContain('onEditOptions()')
    expect(page).toContain('onDelete()')
  })

  it('preserves the integrated drag/drop hooks in table chrome without moving them into the rail', () => {
    // D.4.7F — `draggable` and `onDragStart=` now live in ReorderHandle.tsx
    // (extracted from page.tsx so the new keyboard wiring could get real
    // rendered accessibility coverage) — that component is itself only
    // ever imported and rendered by page.tsx's table chrome, so the two
    // together still prove drag/drop stayed in table chrome, not the rail.
    expect(reorderHandle).toContain('draggable')
    expect(reorderHandle).toContain('onDragStart=')
    expect(page).toContain("import { ReorderHandle } from \"@/components/organiser/ReorderHandle\"")
    for (const hook of ['onDragOver=', 'onDrop=']) {
      expect(page).toContain(hook)
    }
    expect(page).toContain('onGroupDragHandleStart')
    expect(page).toContain('onItemDragHandleStart')
    for (const hook of ['draggable=', 'onDragStart=', 'onDragOver=', 'onDrop=']) {
      expect(rail).not.toContain(hook)
    }
  })

  it('does not move auth, capability, database, or persistence ownership into table chrome', () => {
    expect(page).not.toContain('requireCapability')
    expect(page).not.toContain('requireRole')
    expect(page).not.toContain('sql`')
    expect(page).not.toContain('prisma.')
    expect(rail).not.toContain('enabledCapabilities')
    expect(rail).not.toContain('role ===')
    expect(rail).not.toContain('fetch(')
  })
})
