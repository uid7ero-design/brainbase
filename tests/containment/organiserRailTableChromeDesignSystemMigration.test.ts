import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf-8')

const page = read('app/organiser/page.tsx')
const rail = read('components/organiser/OrganiserRail.tsx')

describe('C.3 Organiser rail and table chrome design-system migration', () => {
  it('migrates OrganiserRail chrome to canonical BrainBase tokens', () => {
    for (const token of [
      '--bb-font-sans', '--bb-shell-sidebar', '--bb-border-subtle', '--bb-border-default',
      '--bb-border-strong', '--bb-border-focus', '--bb-surface-soft', '--bb-surface-hover',
      '--bb-surface-selected', '--bb-surface-3', '--bb-text-primary', '--bb-text-secondary',
      '--bb-text-tertiary', '--bb-text-muted', '--bb-accent-300', '--bb-accent-500',
      '--bb-danger', '--bb-radius-md', '--bb-radius-sm', '--bb-shadow-float',
      '--bb-duration-fast', '--bb-duration-base', '--bb-ease-standard', '--bb-z-menu',
    ]) expect(rail).toContain(token)
    expect(rail).not.toContain('useOpsTheme')
    expect(rail).not.toContain('var(--font-inter)')
  })

  it('preserves rail collapse persistence, exact widths, and hydration guard', () => {
    expect(rail).toContain("const COLLAPSE_KEY = 'organiser-rail-collapsed'")
    expect(rail).toContain('localStorage.getItem(COLLAPSE_KEY)')
    expect(rail).toContain('localStorage.setItem(COLLAPSE_KEY, String(next))')
    expect(rail).toContain('const width = collapsed ? 56 : 208')
    expect(rail).toContain("visibility: mounted ? 'visible' : 'hidden'")
    expect(rail).toContain("aria-label={collapsed ? 'Expand Organiser rail' : 'Collapse Organiser rail'}")
    expect(rail).toContain("transform: collapsed ? 'rotate(180deg)' : 'none'")
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
    for (const token of [
      '--bb-border-subtle', '--bb-border-default', '--bb-border-strong', '--bb-surface-soft',
      '--bb-surface-hover', '--bb-text-primary', '--bb-text-secondary', '--bb-text-muted',
      '--bb-accent-400', '--bb-danger', '--bb-danger-soft', '--bb-radius-sm',
      '--bb-radius-md', '--bb-shadow-float', '--bb-duration-fast', '--bb-ease-standard',
      '--bb-z-menu', '--bb-type-micro-size', '--bb-type-micro-tracking',
    ]) expect(page).toContain(token)
    expect(page).toContain('<Surface variant="base" radius="xl" style={{ marginBottom: 18, overflow: "hidden" }}>')
    expect(page).toContain('background: hover ? "var(--bb-surface-hover)" : "transparent"')
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

  it('does not introduce or rewrite drag/drop hooks in this design branch', () => {
    for (const source of [page, rail]) {
      expect(source).not.toContain('draggable=')
      expect(source).not.toContain('onDragStart=')
      expect(source).not.toContain('onDragOver=')
      expect(source).not.toContain('onDrop=')
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
