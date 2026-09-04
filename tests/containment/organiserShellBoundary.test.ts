import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.4E — Organiser first-class workspace shell extraction.
// Organiser no longer renders inside the generic ops WorkspaceShell/
// Sidebar/OpBar chrome; it owns a dedicated OrganiserShell (layout only)
// and OrganiserRail (board navigation, promoted from the former inline
// BoardRail). This file proves the shell boundary: OrganiserShell is
// presentation-only (no session/capability fetch, no auth, no DB access,
// no Sidebar/OpBar/WorkspaceShell import), and app/organiser/page.tsx
// renders it in place of WorkspaceShell while retaining every existing
// behaviour (board loading, query-param deep link, table/kanban/calendar,
// item drawer, column editor, import, +New group).
//
// Static source-text containment — this repo has no jsdom/React Testing
// Library harness (see AGENTS.md/CLAUDE.md and every other containment
// test file's own note).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const shellSource = read('components/organiser/OrganiserShell.tsx')
const shellCode = stripComments(shellSource)
const railSource = read('components/organiser/OrganiserRail.tsx')
const railCode = stripComments(railSource)
const pageSource = read('app/organiser/page.tsx')
const pageCode = stripComments(pageSource)

describe('OrganiserShell — presentation/layout only', () => {
  it('is a client component', () => {
    expect(shellSource.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('does not import Sidebar', () => {
    expect(shellCode).not.toMatch(/from '@\/components\/ops\/Sidebar'/)
    expect(shellCode).not.toContain('<Sidebar')
  })

  it('does not import OpBar', () => {
    expect(shellCode).not.toMatch(/from '@\/components\/ops\/OpBar'/)
    expect(shellCode).not.toContain('<OpBar')
  })

  it('does not import WorkspaceShell', () => {
    expect(shellCode).not.toMatch(/from '@\/components\/ops\/WorkspaceShell'/)
    expect(shellCode).not.toContain('<WorkspaceShell')
  })

  it('does not fetch session or capability state — no /api/me fetch, no requireSession/requireCapability/checkCapability import', () => {
    expect(shellCode).not.toContain("fetch('/api/me')")
    expect(shellCode).not.toContain('fetch("/api/me")')
    expect(shellCode).not.toMatch(/requireSession|requireCapability|checkCapability/)
  })

  it('performs no DB access — no @/lib/db import, no sql template call', () => {
    expect(shellCode).not.toMatch(/from '@\/lib\/db'/)
    expect(shellCode).not.toMatch(/\bsql`/)
  })

  it('contains no auth/redirect logic', () => {
    expect(shellCode).not.toMatch(/redirect\(|requireRole|roleGte/)
  })

  it('takes only layout props (rail, children) — no board/session/capability data props', () => {
    expect(shellCode).toMatch(/interface OrganiserShellProps \{\s*\n\s*rail: React\.ReactNode;\s*\n\s*children: React\.ReactNode;\s*\n\s*\}/)
  })

  // Phase D.4.5C-W2 — this assertion originally read a hardcoded
  // `top: 52` literal. That was correct until super_admin sessions
  // started rendering a real, non-zero-height OrgSwitcher bar above
  // TopNav in normal document flow (see the D.4.5C-W1 audit), at which
  // point the hardcoded literal silently stopped matching TopNav's
  // real rendered position. Updated to assert use of the shared
  // --app-header-offset primitive instead of the literal — see
  // tests/containment/appHeaderOffset.test.ts for that primitive's own
  // dedicated coverage — rather than the assertion being weakened or
  // deleted.
  it('renders below the app header stack via the shared --app-header-offset primitive (position: fixed, top: APP_HEADER_OFFSET_VAR — the same convention WorkspaceShell also uses, not a new offset)', () => {
    expect(shellCode).toMatch(/import \{ APP_HEADER_OFFSET_VAR \} from '@\/lib\/layout\/headerOffset'/)
    expect(shellCode).toMatch(/position:\s*'fixed',\s*top:\s*APP_HEADER_OFFSET_VAR/)
  })

  it('owns the rail+canvas flex layout directly — rail and children are siblings in one flex row, canvas gets flex:1/minWidth:0/overflow:hidden', () => {
    expect(shellCode).toMatch(/display:\s*'flex'/)
    expect(shellCode).toMatch(/\{rail\}/)
    expect(shellCode).toMatch(/flex:\s*1,\s*minWidth:\s*0,[\s\S]{0,80}overflow:\s*'hidden'/)
  })
})

describe('OrganiserRail — board navigation, no generic Sidebar dependency', () => {
  it('is a client component', () => {
    expect(railSource.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('does not import the generic ops Sidebar', () => {
    expect(railCode).not.toMatch(/from '@\/components\/ops\/Sidebar'/)
  })

  it('preserves the board CRUD contract exactly: boards, activeId, onSelect, onCreate, onRename, onDelete props', () => {
    expect(railCode).toMatch(/boards:\s*OrganiserBoard\[\];/)
    expect(railCode).toMatch(/activeId:\s*string \| null;/)
    expect(railCode).toMatch(/onSelect:\s*\(id:\s*string\)\s*=>\s*void;/)
    expect(railCode).toMatch(/onCreate:\s*\(name:\s*string\)\s*=>\s*void;/)
    expect(railCode).toMatch(/onRename:\s*\(id:\s*string,\s*name:\s*string\)\s*=>\s*void;/)
    expect(railCode).toMatch(/onDelete:\s*\(id:\s*string\)\s*=>\s*void;/)
  })

  it('uses its own collapse localStorage key, distinct from the generic ops Sidebar\'s key', () => {
    expect(railCode).toContain("'organiser-rail-collapsed'")
    expect(railCode).not.toContain('ops-sidebar-collapsed')
  })

  it('renders the module identity header (CapabilityIcon capability="organiser" + visible "Organiser" label), not repeated per board', () => {
    expect(railCode).toMatch(/capability="organiser"/)
    const capabilityIconMatches = railCode.match(/<CapabilityIcon/g) ?? []
    expect(capabilityIconMatches.length).toBe(1)
    expect(railCode).toContain('Organiser')
  })

  it('renders a + New board control', () => {
    expect(railCode).toMatch(/New board/)
  })
})

describe('app/organiser/page.tsx — re-parented under OrganiserShell, no functionality lost', () => {
  it('imports and renders OrganiserShell, not WorkspaceShell', () => {
    expect(pageCode).toMatch(/import OrganiserShell from ['"]@\/components\/organiser\/OrganiserShell['"]/)
    expect(pageCode).toContain('<OrganiserShell')
    expect(pageCode).not.toMatch(/from '@\/components\/ops\/WorkspaceShell'/)
    expect(pageCode).not.toContain('<WorkspaceShell')
  })

  it('imports and renders OrganiserRail via the shell\'s rail prop, not an inline BoardRail definition', () => {
    expect(pageCode).toMatch(/import OrganiserRail from ['"]@\/components\/organiser\/OrganiserRail['"]/)
    expect(pageCode).toMatch(/rail=\{\s*\n\s*<OrganiserRail/)
    expect(pageCode).not.toMatch(/function BoardRail\(/)
  })

  it('retains the exact board query-param deep-link resolution logic, byte-for-byte', () => {
    expect(pageCode).toContain('const requested = requestedBoardId && list.some(b => b.id === requestedBoardId) ? requestedBoardId : null;')
  })

  it('retains table/kanban/calendar view switching', () => {
    expect(pageCode).toMatch(/view === "table"/)
    expect(pageCode).toMatch(/view === "board"/)
    expect(pageCode).toMatch(/view === "calendar"/)
    expect(pageCode).toContain('<KanbanView')
    expect(pageCode).toContain('<CalendarView')
  })

  it('retains the item drawer and column options editor', () => {
    // Phase D.4.5D — the drawer now also receives groupNamesById (for the
    // Item Activity tab's group_id resolution), which pushed this JSX onto
    // multiple lines. Updated to match that real, deliberate shape rather
    // than the old single-line form — see organiserItemActivityTab.test.ts
    // for this same wiring's own dedicated coverage.
    expect(pageCode).toMatch(/\{drawerItem && \(\s*\n\s*<ItemDrawer item=\{drawerItem\}/)
    expect(pageCode).toMatch(/\{editingColumn && \(/)
    expect(pageCode).toContain('<ColumnOptionsEditor')
  })

  it('retains +New group and Import CSV/XLSX', () => {
    expect(pageCode).toContain('+ New group')
    expect(pageCode).toMatch(/Import CSV\/XLSX/)
  })

  it('retains files/updates (comments) support inside the item drawer, untouched', () => {
    expect(pageCode).toMatch(/\/files/)
    expect(pageCode).toMatch(/\/updates/)
  })

  it('the OrganiserRail instantiation wires the exact same handlers as before (onSelect/onCreate/onRename/onDelete), unchanged by the extraction', () => {
    expect(pageCode).toContain('onSelect={setActiveId} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard}')
  })

  it('the exported component name and Suspense boundary are unchanged', () => {
    expect(pageCode).toContain('export default function OrganiserPage() {')
    expect(pageCode).toContain('<Suspense fallback={null}>')
    expect(pageCode).toContain('<OrganiserPageContent />')
  })
})
