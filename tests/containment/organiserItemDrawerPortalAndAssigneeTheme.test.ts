import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// PR #214 UI blocker fixes (D.4.6P-R2 live-Preview QA correction), narrowly
// scoped to two defects found during authenticated Preview QA on the
// guarded assignee-change drawer — NOT a save-model/picker redesign (that
// is deferred to D.4.7). Static source-text containment only — this repo
// has no jsdom/React Testing Library harness (see AGENTS.md/CLAUDE.md and
// every other containment test file's own note).
//
// 1. Drawer occlusion: OrganiserShell wraps the page tree in its own
//    `position: fixed; z-index: 50` box, which establishes a stacking
//    context. A z-index set on a descendant (ItemDrawer's own 200) is only
//    ever compared *inside* that context, so it could never out-rank
//    siblings of OrganiserShell itself — TopNav (z-index: 100) and the
//    HLNA assistant bar (z-index: 60-70) both live outside it and always
//    painted over the drawer regardless of the drawer's own z-index.
//    Fixed by portaling straight to document.body, the same technique
//    components/nav/TopNav.tsx already uses for its own dropdown menus.
// 2. Assignee theme: the Assignee <select>'s <option> elements had no
//    style at all, so its open panel fell back to the browser's default
//    light theme, unlike PillSelect/OptionsPillSelect's options a few
//    lines above it in this same file, which already set
//    `background: t.menuBg, color: t.ink(.90)` per option.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const pageSource = read('app/organiser/page.tsx')
const pageCode = stripComments(pageSource)

function itemDrawerBlock(): string {
  const start = pageCode.indexOf('function ItemDrawer(')
  const end = pageCode.indexOf('\nfunction Field(', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return pageCode.slice(start, end)
}

describe('ItemDrawer — portaled to document.body (PR #214 drawer-occlusion fix)', () => {
  it('imports createPortal from react-dom', () => {
    expect(pageCode).toMatch(/import \{ createPortal \} from ["']react-dom["']/)
  })

  it('does not return its JSX directly — it returns a createPortal(..., document.body) call, SSR-guarded like TopNav.tsx\'s own dropdown portals', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/return typeof document !== ["']undefined["'] \? createPortal\(drawerContent, document\.body\) : null;/)
  })

  it('still renders the exact same drawer markup (overlay + panel) into the portaled content — this is a mounting-mechanism change only, not a redesign', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/const drawerContent = \(/)
    expect(block).toMatch(/position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end"/)
    expect(block).toMatch(/animation: "drawer-in \.18s ease"/)
  })
})

describe('Assignee <select> — themed options (PR #214 assignee-theme fix)', () => {
  it('the "Unassigned" option carries the same dark-panel style PillSelect/OptionsPillSelect already use', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/<option value="" style=\{\{ background: t\.menuBg, color: t\.ink\(\.90\) \}\}>Unassigned<\/option>/)
  })

  it('every member option carries the same dark-panel style, not a one-off custom picker component', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/\{members\.map\(m => <option key=\{m\.id\} value=\{m\.id\} style=\{\{ background: t\.menuBg, color: t\.ink\(\.90\) \}\}>\{m\.name\}<\/option>\)\}/)
  })

  it('the Assignee control is still a native <select> — no new custom picker import was introduced', () => {
    const block = itemDrawerBlock()
    expect(block).not.toMatch(/import .*Picker.* from/)
  })

  it('assignee change semantics are unchanged — value/onChange still map "" to null (Unassigned)', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/value=\{item\.assignee_user_id \?\? ""\}/)
    expect(block).toMatch(/onChange=\{e => onUpdate\(item\.id, \{ assignee_user_id: e\.target\.value \|\| null \}\)\}/)
  })
})
