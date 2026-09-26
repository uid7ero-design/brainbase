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

describe('C.2 Organiser overview design-system migration', () => {
  it('uses the shared Surface primitive and canonical overview tokens', () => {
    expect(page).toContain('import { Surface } from "@/components/ui"')
    expect(page).toContain("const FONT = 'var(--bb-font-sans)'")
    expect(page).toContain('<Surface variant="soft" radius="xl"')
    expect(page).toContain('<Surface variant="selected" radius="md"')
    expect(page).toContain('background: "var(--bb-surface-1)"')
    expect(page).toContain('background: "var(--bb-canvas)"')
    expect(page).toContain('borderBottom: "1px solid var(--bb-border-subtle)"')
    expect(page).toContain('background: view === v ? "var(--bb-surface-selected)" : "transparent"')
    expect(page).toContain('color: view === v ? "var(--bb-accent-300)" : "var(--bb-text-tertiary)"')
    expect(page).toContain('background: "var(--bb-danger-soft)"')
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
    expect(page).toContain('status.state === "saving" ? "var(--bb-accent-500)"')
    expect(page).toContain('status.state === "saved" ? "var(--bb-success)" : "var(--bb-danger)"')
    expect(page).toContain('status.state === "saving" ? "Saving…" : "Saved"')
    expect(page).toContain('{status.message ?? "Couldn\'t save"}')
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
