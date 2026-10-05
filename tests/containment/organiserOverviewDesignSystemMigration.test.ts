import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const page = fs.readFileSync(
  path.resolve(__dirname, '../../app/organiser/page.tsx'),
  'utf-8',
)

const shell = fs.readFileSync(
  path.resolve(__dirname, '../../components/organiser/OrganiserShell.tsx'),
  'utf-8',
)

const organiserCss = fs.readFileSync(path.resolve(__dirname, '../../components/organiser/Organiser.module.css'), 'utf-8')

describe('C.2 Organiser overview design-system migration', () => {
  it('uses the shared Surface primitive and canonical overview tokens', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(page).toMatch(/from "@\/components\/ui\/app"/)
    expect(page).toContain('import styles from "@/components/organiser/Organiser.module.css"')
    expect(page).toContain('<PageHeader')
    expect(page).toContain('<StateMessage')
    expect(page).toContain('aria-pressed={view === v}')
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--brand-brainbase-accent)', 'var(--status-danger)'])
      expect(organiserCss).toContain(token)

  })

  it('moves the Organiser shell onto canonical canvas/font/z-index tokens without changing its layout contract', () => {
    expect(shell).toContain("background: 'var(--bb-canvas)'")
    expect(shell).toContain("fontFamily: 'var(--bb-font-sans)'")
    expect(shell).toContain("zIndex: 'var(--bb-z-header)'")
    expect(shell).toContain('top: APP_HEADER_OFFSET_VAR')
    expect(shell).toContain("position: 'fixed'")
    expect(shell).toContain("overflow: 'hidden'")
    expect(shell).toContain('{rail}')
    expect(shell).toContain('{children}')
    expect(shell).not.toContain('useOpsTheme')
  })

  it('preserves board loading, selection, deep-link, and tenant-scoped fetch behavior', () => {
    expect(page).toContain('const requestedBoardId = searchParams.get("board")')
    expect(page).toContain('fetch("/api/organiser/boards", { credentials: "include" })')
    expect(page).toContain('fetch(`/api/organiser/boards/${boardId}`, { credentials: "include" })')
    expect(page).toContain('const requested = requestedBoardId && list.some(b => b.id === requestedBoardId) ? requestedBoardId : null')
    expect(page).toContain('if (requested) setActiveId(requested)')
    expect(page).toContain('else if (list.length > 0) setActiveId(list[0].id)')
  })

  it('preserves all four Organiser views and their existing render branches', () => {
    expect(page).toContain('type ViewMode = "table" | "board" | "calendar" | "activity"')
    expect(page).toContain('(["table", "board", "calendar", "activity"] as ViewMode[])')
    expect(page).toContain('onClick={() => setView(v)}')
    expect(page).toContain('{view === "table" && (')
    expect(page).toContain('{view === "board" && boardData && (')
    expect(page).toContain('{view === "calendar" && boardData && (')
    expect(page).toContain('{view === "activity" && boardData && (')
    expect(page).toContain('<KanbanView')
    expect(page).toContain('<CalendarView')
    expect(page).toContain('<BoardActivity')
  })

  it('preserves board/group/item/import mutation entry points and reliability guards', () => {
    for (const behavior of [
      'async function createBoard(name: string)',
      'async function renameBoard(id: string, name: string)',
      'async function deleteBoard(id: string)',
      'async function submitNewGroup()',
      'async function updateItem(',
      'async function deleteItem(',
      'async function addItem(',
      'async function handleImport(',
      'const boardLoadSeqRef = useRef(0)',
      'const itemFieldQueueRef = useRef<CoalescingQueueMap<Record<string, unknown>>>({})',
    ]) {
      expect(page).toContain(behavior)
    }
    expect(page).toContain('enqueueCoalesced(')
    expect(page).toContain('if (boardLoadSeqRef.current !== seq) return')
  })

  it('preserves fast group creation, duplicate-submit guard, and exact keyboard interactions', () => {
    expect(page).toContain('if (!trimmed || groupSubmitting) return')
    expect(page).toContain('setGroupSubmitting(true)')
    expect(page).toContain('setGroupName("")')
    expect(page).toContain('setTimeout(() => groupNameInputRef.current?.focus(), 0)')
    expect(page).toContain('if (e.key === "Enter") submitNewGroup()')
    expect(page).toContain('if (e.key === "Escape") { setGroupName(""); setGroupError(null); setAddingGroup(false); }')
    expect(page).toContain('disabled={groupSubmitting}')
  })

  it('preserves import behavior and file-input acceptance', () => {
    expect(page).toContain('accept=".csv,.xlsx,.xls"')
    expect(page).toContain('if (f) handleImport(f)')
    expect(page).toContain('{importing ? "Importing…" : "Import CSV/XLSX"}')
    expect(page).toContain('{sheetChoices && pendingImportFile && (')
    expect(page).toContain('onPick={sheetName => handleImport(pendingImportFile, sheetName)}')
    expect(page).toContain('onCancel={() => { setSheetChoices(null); setPendingImportFile(null); }}')
  })

  it('preserves drawer freshness, save-state, members, and activity wiring', () => {
    expect(page).toContain('const [openDrawerItemId, setOpenDrawerItemId] = useState<string | null>(null)')
    expect(page).toContain('fetch("/api/organiser/members", { credentials: "include" })')
    expect(page).toContain('const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({})')
    expect(page).toContain('const boardActivityRefreshKey = useMemo(() => {')
    expect(page).toContain('key={`${activeBoard.id}:${boardActivityRefreshKey}`}')
    expect(page).toContain('<ItemDrawer item={openItem}')
  })

  it('tokenises overview save/error status colours without changing status semantics', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(page).toContain('if (status.state === "saving") return <span className={styles.saveText} data-state="saving">Saving…</span>')
    expect(page).toContain('if (status.state === "saved") return <span className={styles.saveText} data-state="saved">Saved</span>')
    expect(page).toContain('{status.message ?? "Couldn\'t save"}')
    expect(organiserCss).toMatch(/\.saveText\[data-state='saved'\][^}]*var\(--status-success\)/)
    expect(organiserCss).toMatch(/\.saveText\[data-state='error'\][^}]*var\(--status-danger\)/)

  })

  it('does not change capability, auth, database, schema, or routing ownership', () => {
    expect(page).not.toContain('requireCapability')
    expect(page).not.toContain('requireRole')
    expect(page).not.toContain('sql`')
    expect(page).not.toContain('prisma.')
    expect(shell).not.toContain('fetch(')
    expect(shell).not.toContain('enabledCapabilities')
    expect(shell).not.toContain('role ===')
  })
})
