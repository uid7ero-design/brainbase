import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase D.1 — direct Organiser access + navigation boundary.
// Updated for Phase D.2 (Organiser promoted to its canonical route,
// /organiser — see organiserCanonicalRoute.test.ts for the D.2-specific
// promotion/redirect/single-implementation assertions): every literal
// /command/organiser reference below was the pre-D.2 route and has been
// updated to /organiser; the underlying behaviours these tests lock down
// (deep-link tenancy, safe fallback, untouched CRUD, untouched Command
// demo content) are unchanged by the route promotion itself.
//
// Sharing Organiser persistence (organiser_boards/organiser_items) with
// Founder OS never implied sharing a navigation journey through Command's
// demo/prototype overview. This file proves: (1) a direct nav path to the
// real Organiser exists and never routes through /command's demo page,
// (2) Founder OS's "Open in Organiser" deep-links to the resolved Founder
// Tasks board (never WORK/Tafe, never a caller-controlled org), (3) the new
// ?board= contract falls back safely for invalid/foreign ids and cannot
// leak cross-org data, (4) normal Organiser board switching is untouched,
// (5) Founder Tasks CRUD/board-resolution is untouched, and (6) Command's
// existing demo/prototype content was left completely alone.
//
// Static source-text assertions — this project has no jsdom/React Testing
// Library harness (same caveat as every other *StaticCheck.test.ts file).

const ORGANISER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/organiser/page.tsx'), 'utf-8')
const COMMAND_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')
const WORKSPACE_SHELL_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../components/ops/WorkspaceShell.tsx'), 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const ORGANISER_BOARDS_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/route.ts'), 'utf-8')
const ORGANISER_BOARD_BY_ID_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/route.ts'), 'utf-8')
const TASKS_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/route.ts'), 'utf-8')
const ITEM_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/[itemId]/route.ts'), 'utf-8')
const BOARD_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/board/route.ts'), 'utf-8')
const TASKS_BOARD_LIB_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/tasksBoard.ts'), 'utf-8')

// Scoped to executable code, not this file's own explanatory prose — the
// FounderTasksPanel comment legitimately names WORK/Tafe when explaining
// why the deep-link must never point at them (same established pattern as
// founderTrustBoundaryHardening.test.ts / founderTasks.test.ts).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// ── 1/2. Direct Organiser navigation exists and bypasses Command's overview ─

describe('Direct Organiser navigation exists, independent of /command', () => {
  it('Founder OS\'s own left sidebar has a top-level "Organiser" entry pointing straight at the canonical /organiser route', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("{ label: 'Organiser',  href: '/organiser' }")
  })

  it('the sidebar entry is not nested under or gated by a Command overview visit — it is a plain top-level href', () => {
    const navStart = FOUNDER_PAGE_SOURCE.indexOf('const NAV: NavItem[] = [')
    const navEnd = FOUNDER_PAGE_SOURCE.indexOf('];', navStart)
    const navBlock = FOUNDER_PAGE_SOURCE.slice(navStart, navEnd)
    expect(navBlock).toContain("href: '/organiser'")
    expect(navBlock).not.toContain("href: '/command'")
    expect(navBlock).not.toContain("href: '/command/organiser'")
  })

  it('there is no app/command/layout.tsx wrapping /command/organiser in /command\'s own page content — the two routes render fully independently', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../app/command/layout.tsx'))).toBe(false)
  })

  it('the canonical Organiser page renders none of Command\'s demo overview content (no shared ALERTS/SYS_STATUS/CHANGES/Demo Environment banner)', () => {
    expect(ORGANISER_PAGE_SOURCE).not.toContain('Demo Environment')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const ALERTS')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const SYS_STATUS')
    expect(ORGANISER_PAGE_SOURCE).not.toContain('const CHANGES')
  })

  it('WorkspaceShell (Command Centre/Bin Maintenance\'s own chrome) carries no demo content of its own — no longer reused by /organiser as of D.4.4E (see organiserShellBoundary.test.ts for the current-architecture assertion that /organiser renders OrganiserShell, not WorkspaceShell)', () => {
    expect(WORKSPACE_SHELL_SOURCE).not.toContain('Demo Environment')
    expect(WORKSPACE_SHELL_SOURCE).not.toContain('const ALERTS')
  })

  // Phase D.4.4E — Organiser was promoted to a first-class TopNav workspace
  // (its own OrganiserShell/OrganiserRail, no longer nested inside the
  // generic ops WorkspaceShell/Sidebar). components/ops/Sidebar.tsx no
  // longer knows about Organiser at all — see
  // tests/containment/opsSidebarOrganiserRemoval.test.ts for the dedicated
  // suite proving that removal, and organiserShellBoundary.test.ts /
  // clientNavOwnership.test.ts for the new TopNav-based entry point.
  it('components/ops/Sidebar.tsx no longer references Organiser at all — it moved to a dedicated TopNav entry + OrganiserShell, not the generic ops shell', () => {
    const sidebarSource = fs.readFileSync(path.resolve(__dirname, '../../components/ops/Sidebar.tsx'), 'utf-8')
    expect(sidebarSource).toContain("{ icon: I.command,   label: 'Command Centre', href: '/command',     exact: true }")
    expect(sidebarSource).not.toContain('Organiser')
    expect(sidebarSource).not.toContain('/organiser')
  })
})

// ── 3/4/5. Founder OS "Open in Organiser" deep-link behaviour ──────────────

describe('Founder OS "Open in Organiser" targets the canonical Organiser and the resolved Founder Tasks board', () => {
  it('the link is a next/link Link to the canonical /organiser route, not a plain <a> and not the Command overview or the legacy /command/organiser path', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("href={board ? `/organiser?board=${encodeURIComponent(board.id)}` : '/organiser'}")
    expect(FOUNDER_PAGE_SOURCE).not.toContain('/command/organiser?board=')
  })

  it('the board id used is the exact same `board` state resolved by useFounderTasks() — never a hardcoded, WORK/Tafe, or caller-supplied id', () => {
    const panelStart = FOUNDER_PAGE_SOURCE.indexOf('function FounderTasksPanel()')
    const panelEnd = FOUNDER_PAGE_SOURCE.indexOf('\nfunction ', panelStart + 10)
    const panelBody = stripComments(FOUNDER_PAGE_SOURCE.slice(panelStart, panelEnd))
    expect(panelBody).toContain('const { board, groups, loading, loadError, createBoard, creatingBoard, reload, patchLocalTask } = useFounderTasks();')
    expect(panelBody).not.toContain('WORK')
    expect(panelBody).not.toContain('Tafe')
  })

  it('when no Founder Tasks board exists yet, the link falls back to the plain (still-real) canonical Organiser URL — never broken, never pointing at /command', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("'/organiser'}")
  })

  it('the deep-link never creates a board or mutates data — it is a GET navigation using board data already fetched by GET /api/founder/tasks, not a new request', () => {
    const panelStart = FOUNDER_PAGE_SOURCE.indexOf('function FounderTasksPanel()')
    const linkStart = FOUNDER_PAGE_SOURCE.indexOf('Open in Organiser', panelStart)
    const linkBlockStart = FOUNDER_PAGE_SOURCE.lastIndexOf('<Link', linkStart)
    const linkBlockEnd = FOUNDER_PAGE_SOURCE.indexOf('</Link>', linkStart)
    const linkBlock = FOUNDER_PAGE_SOURCE.slice(linkBlockStart, linkBlockEnd)
    expect(linkBlock).not.toContain('POST')
    expect(linkBlock).not.toContain('fetch(')
    expect(linkBlock).not.toContain('onClick')
  })
})

// ── 6/7. Board deep-link contract: safe fallback + tenancy ─────────────────

describe('Organiser ?board= deep-link contract: safe fallback and tenancy preserved', () => {
  it('a requested board id is only ever adopted if it is present in this org\'s own already-scoped board list — never trusted directly', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('const requested = requestedBoardId && list.some(b => b.id === requestedBoardId) ? requestedBoardId : null;')
  })

  it('an invalid/missing/foreign board id falls back to the existing first-board behaviour, not an error or blank state', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('if (requested) setActiveId(requested);')
    expect(ORGANISER_PAGE_SOURCE).toContain('else if (list.length > 0) setActiveId(list[0].id);')
  })

  it('the board list Organiser validates the requested id against still comes from the same, unchanged, org-scoped GET /api/organiser/boards call', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('const res = await fetch("/api/organiser/boards", { credentials: "include" });')
  })

  it('GET /api/organiser/boards is unchanged and still scopes strictly to the caller session organisation', () => {
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).toContain('WHERE b.organisation_id = ${session.organisationId}')
  })

  it('GET /api/organiser/boards/[boardId] (used to load the selected board\'s data) is unchanged and still returns 404 for a board outside the caller\'s org — a foreign-org id in the URL can never load another tenant\'s board/items', () => {
    expect(ORGANISER_BOARD_BY_ID_ROUTE_SOURCE).toContain('WHERE id = ${boardId} AND organisation_id = ${session.organisationId}')
    expect(ORGANISER_BOARD_BY_ID_ROUTE_SOURCE).toContain("if (boardRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });")
  })

  it('no data mutation is triggered by URL board selection — the deep-link logic only calls setActiveId, never a POST/PATCH/DELETE', () => {
    const loadBoardsStart = ORGANISER_PAGE_SOURCE.indexOf('const loadBoards = useCallback')
    const loadBoardsEnd = ORGANISER_PAGE_SOURCE.indexOf('}, [activeId, requestedBoardId]);') + 40
    const block = ORGANISER_PAGE_SOURCE.slice(loadBoardsStart, loadBoardsEnd)
    expect(block).not.toContain('method:')
  })
})

// ── 8. Normal Organiser board selection still works ─────────────────────────

describe('Normal (manual) Organiser board switching is untouched', () => {
  it('OrganiserRail\'s (formerly BoardRail, promoted in D.4.4E) onSelect still wires directly to setActiveId, unaffected by the deep-link addition or the shell extraction', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('onSelect={setActiveId} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard}')
  })

  it('board creation/rename/delete still call setActiveId directly with a selected/explicit id, not through the URL', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('if (d.board) await loadBoards(d.board.id);')
    expect(ORGANISER_PAGE_SOURCE).toContain('setActiveId(nextActive);')
  })

  it('the page still renders inside a Suspense boundary (required by useSearchParams in a client component) without changing the exported component name consumers import', () => {
    expect(ORGANISER_PAGE_SOURCE).toContain('export default function OrganiserPage() {')
    expect(ORGANISER_PAGE_SOURCE).toContain('<Suspense fallback={null}>')
    expect(ORGANISER_PAGE_SOURCE).toContain('<OrganiserPageContent />')
  })
})

// ── 9. Founder Tasks CRUD / board resolution remain unchanged ──────────────

describe('Regression: Founder Tasks CRUD and board resolution are untouched by the navigation correction', () => {
  it('the Founder task API routes still exist with their established persistence markers (organiser_items, organiser_boards) — unmodified in this correction', () => {
    expect(TASKS_ROUTE_SOURCE).toContain('FROM organiser_items')
    expect(ITEM_ROUTE_SOURCE).toContain('UPDATE organiser_items SET')
    expect(BOARD_ROUTE_SOURCE).toContain('INSERT INTO organiser_boards')
  })

  it('resolveFounderBoard still resolves by exact name only (the Phase D pre-merge correction is untouched)', () => {
    expect(TASKS_BOARD_LIB_SOURCE).toContain("const FOUNDER_BOARD_NAME = 'Founder Tasks';")
    expect(TASKS_BOARD_LIB_SOURCE).toContain('WHERE organisation_id = ${organisationId} AND name = ${FOUNDER_BOARD_NAME}')
  })

  it('FounderTasksPanel\'s create/update flow still posts/patches the same endpoints, unaffected by the added Link', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("fetch('/api/founder/tasks', {")
    expect(FOUNDER_PAGE_SOURCE).toContain('fetch(`/api/founder/tasks/${id}`, {')
  })
})

// ── 10. No fake/demo data introduced into Founder OS ────────────────────────

describe('No fake/demo data introduced into Founder OS by this navigation correction', () => {
  it('the sidebar "Organiser" entry is a plain href with no fabricated count/badge/metric attached', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/label:\s*'Organiser',\s*href:\s*'\/organiser',\s*(count|badge|metric)/)
  })

  it('no MOCK/DEMO/FAKE constant was added anywhere in the founder page or organiser page diffs for this correction', () => {
    for (const src of [FOUNDER_PAGE_SOURCE, ORGANISER_PAGE_SOURCE]) {
      expect(src).not.toMatch(/const MOCK_|const DEMO_|const FAKE_/)
    }
  })
})

// ── 11. Command demo/prototype content remains untouched by this branch ────

describe('Regression: Command demo/prototype content is untouched (documented, not cleaned up)', () => {
  it('Command\'s own "Demo Environment" indicator and static demo arrays are still present, unmodified, unremoved', () => {
    expect(COMMAND_PAGE_SOURCE).toContain('Demo Environment')
    expect(COMMAND_PAGE_SOURCE).toContain('const ALERTS')
    expect(COMMAND_PAGE_SOURCE).toContain('const SYS_STATUS')
    expect(COMMAND_PAGE_SOURCE).toContain('const CHANGES')
    expect(COMMAND_PAGE_SOURCE).toContain('const SUGGESTED')
  })

  it('Command\'s real, API-backed KPI tabs (waste/dumping/kerbside/financial) remain wired exactly as before', () => {
    expect(COMMAND_PAGE_SOURCE).toContain('/api/missed-collections/kpi')
    expect(COMMAND_PAGE_SOURCE).toContain('/api/illegal-dumping/kpi')
    expect(COMMAND_PAGE_SOURCE).toContain('/api/waste/kpi')
  })

  it('Command\'s own in-page link to Organiser (its toolbar shortcut) is unchanged', () => {
    expect(COMMAND_PAGE_SOURCE).toContain('<Link href="/command/organiser"')
  })
})
