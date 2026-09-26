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
// 2. Assignee theme (R2, superseded by R3 below): the Assignee <select>'s
//    <option> elements had no style at all, so its open panel fell back
//    to the browser's default light theme. Per-<option> inline styling
//    (matching PillSelect/OptionsPillSelect) was tried first, but live
//    Preview QA in real Chrome showed it was NOT reliably honored by the
//    native <select> popup on that platform. R3 replaces the native
//    <select> entirely with a fully custom-rendered, always-themed
//    picker (AssigneeDropdown) — the same accessible button+listbox
//    pattern already proven in app/events/_components/ui.tsx's
//    FilterDropdown, re-implemented locally so it can use Organiser's
//    own useOpsTheme() tokens instead of a hardcoded palette.

function assigneeDropdownBlock(): string {
  const start = pageCode.indexOf('function AssigneeDropdown(')
  const end = pageCode.indexOf('\nfunction ', start + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return pageCode.slice(start, end)
}

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
    expect(block).toMatch(/position: "fixed", inset: 0, zIndex: "var\(--bb-z-drawer\)", display: "flex", justifyContent: "flex-end"/)
    expect(block).toMatch(/animation: "drawer-in var\(--bb-duration-base\) var\(--bb-ease-standard\)"/)
  })
})

describe('AssigneeDropdown — custom accessible picker (PR #214 assignee-theme fix, R3)', () => {
  it('the Assignee field no longer renders a native <select> — replaced entirely, not just re-styled', () => {
    const block = itemDrawerBlock()
    expect(block).not.toMatch(/<select[\s>]/)
    expect(block).toContain('<AssigneeDropdown')
  })

  it('is a fully custom-rendered picker: a button trigger with aria-haspopup="listbox"/aria-expanded, and a role="listbox" panel of role="option" buttons — the same accessible pattern as app/events/_components/ui.tsx\'s FilterDropdown', () => {
    const block = assigneeDropdownBlock()
    expect(block).toMatch(/aria-haspopup="listbox"/)
    expect(block).toMatch(/aria-expanded=\{open\}/)
    expect(block).toMatch(/role="listbox"/)
    expect(block).toMatch(/role="option"/)
    expect(block).toMatch(/aria-selected=\{isSelected\}/)
  })

  it('is themed via Organiser\'s own useOpsTheme() tokens (t.menuBg/t.ink), not a hardcoded palette — so it stays correct if Organiser\'s light theme is active, unlike importing FilterDropdown\'s own hardcoded-dark styles as-is would be', () => {
    const block = assigneeDropdownBlock()
    expect(block).toMatch(/background: t\.menuBg/)
    expect(block).toMatch(/t\.ink\(/)
    expect(block).not.toMatch(/rgba\(7,5,16/) // FilterDropdown's own hardcoded panel color — must not be copied in verbatim
  })

  it('every trigger/option element is a real native <button> — keyboard Tab/Enter/Space activation and the browser\'s own focus ring come from the platform, not reimplemented', () => {
    const block = assigneeDropdownBlock()
    const buttonCount = (block.match(/<button/g) ?? []).length
    expect(buttonCount).toBeGreaterThanOrEqual(2) // trigger + at least the "Unassigned" option
  })

  it('closes on outside click and on Escape (refocusing the trigger) — same UX contract as FilterDropdown', () => {
    const block = assigneeDropdownBlock()
    expect(block).toMatch(/addEventListener\("mousedown", onClickOutside\)/)
    expect(block).toMatch(/e\.key === "Escape"/)
    expect(block).toMatch(/triggerRef\.current\?\.focus\(\)/)
  })

  it('"Unassigned" is always the first option, mapping to assignee_user_id: null — same semantics as before', () => {
    const block = assigneeDropdownBlock()
    expect(block).toMatch(/\[\{ id: "", name: "Unassigned" \}, \.\.\.members\]/)
  })

  it('assignee change semantics are unchanged at the ItemDrawer call site — value/onChange still map "" to null (Unassigned), same PATCH-triggering onUpdate call', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/value=\{item\.assignee_user_id \?\? ""\}/)
    expect(block).toMatch(/onChange=\{v => onUpdate\(item\.id, \{ assignee_user_id: v \|\| null \}\)\}/)
  })

  it('renders exactly the same ACTIVE same-org members prop passed to ItemDrawer — no separate/duplicate member fetch', () => {
    const block = itemDrawerBlock()
    expect(block).toMatch(/members=\{members\}/)
  })
})
