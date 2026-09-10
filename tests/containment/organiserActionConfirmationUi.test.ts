import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6J — the user-facing confirmation UI for D.4.6I's already-merged
// backend Organiser write contract (propose_organiser_comment). This repo's
// vitest config collects only tests/containment/**, in a plain Node
// environment with no jsdom/React Testing Library harness (see CLAUDE.md) —
// there is no component-rendering setup for hooks/useHelena.js or
// components/chat/ChatPanel.jsx anywhere in this repo, so — exactly like
// every other load-bearing security test in this suite — this file proves
// the mandatory product principle ("a Helena write action must never execute
// merely because Helena proposes it") via static source-text containment,
// block-scoped to the exact function/component whose behavior is being
// proven, rather than by rendering.
//
// One exception (test N below): viewer-refusal is provable by actually
// executing the real, unmocked lib/organiser/helenaTools.ts dispatch layer
// (same mock-only-the-DB-and-auth pattern as organiserHelenaToolsExecution
// .test.ts) — that is a stronger proof than a source-text check for "the
// frontend could never receive proposal data for a viewer" and duplicates no
// existing test (D.4.6I's own suite proves authorizeHelenaOrganiserWrite's
// manager floor in isolation; this proves the frontend-visible JSON shape a
// denial actually produces).

// ── Test N's mocks (module top-level, matching organiserHelenaWrite.test.ts's
// own established pattern — vi.mock is hoisted above imports, so its factory
// cannot close over a describe-block-local const).
const nSqlMock = vi.fn(() => Promise.resolve([]))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (nSqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))
const nAuthorizeOrganiserRequestMock = vi.fn()
vi.mock('@/lib/organiser/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organiser/authorize')>()
  return { ...actual, authorizeOrganiserRequest: (...args: unknown[]) => nAuthorizeOrganiserRequestMock(...args) }
})

const HOOK_SOURCE      = fs.readFileSync(path.resolve(__dirname, '../../hooks/useHelena.js'), 'utf8')
const CHATPANEL_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../components/chat/ChatPanel.jsx'), 'utf8')
const WRAPPER_SOURCE   = fs.readFileSync(path.resolve(__dirname, '../../components/brand/HlnaAssistantWrapper.jsx'), 'utf8')
const BRAINBASE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../components/BrainBase.jsx'), 'utf8')
const WORKSPACE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../components/helena/HelenaWorkspace.jsx'), 'utf8')

// ── Helper: block-scope a named function's body out of a larger source file
// by slicing from its declaration to the next top-level function/const at
// column 0 that looks like a sibling declaration — same anchor-based-slicing
// idiom CLAUDE.md documents for avoiding whole-file substring false
// positives (e.g. tests/containment/organiserHelenaWrite.test.ts).
function sliceFrom(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`marker not found: ${startMarker}`)
  if (!endMarker) return source.slice(start)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (end === -1) throw new Error(`end marker not found after start: ${endMarker}`)
  return source.slice(start, end)
}

// Strip `//` line comments before substring assertions, so an explanatory
// comment mentioning a forbidden token never produces a false positive/negative.
function stripLineComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '')
}

describe('A/B/C — confirmation card renders exact action summary', () => {
  it('ChatPanel renders OrganiserActionCard only when pendingOrganiserAction is present', () => {
    expect(CHATPANEL_SOURCE).toContain('{pendingOrganiserAction && (')
    expect(CHATPANEL_SOURCE).toContain('<OrganiserActionCard')
  })

  it('card shows a fixed "Post comment" action label, the target item name, and the exact proposed body', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    expect(card).toContain('Post comment')
    expect(card).toContain('action.proposal?.item_name')
    expect(card).toContain('action.proposal?.body')
  })

  it('card is visually distinct from a normal chat message (no YOU/HLNΛ byline, own amber framing)', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    expect(card).not.toContain('>YOU<')
    expect(card).not.toContain('◈ HLNΛ')
    expect(card).toContain('ACTION AWAITING YOUR CONFIRMATION')
  })
})

describe('D/E/F — Confirm sends the token ONLY via the trusted top-level field', () => {
  it('confirmOrganiserAction sends organiserActionConfirmation:{token} as extraBody, not inside message text', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const confirmOrganiserAction = useCallback(', 'const cancelOrganiserAction = useCallback(')
    expect(fn).toContain('organiserActionConfirmation: { token: action.confirmationToken }')
  })

  it('runChatTurn spreads extraBody at the TOP LEVEL of the JSON body (sibling of messages), not nested inside it', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    const bodyBlock = sliceFrom(fn, 'body: JSON.stringify({', 'const data = await res.json();')
    // ...extraBody must appear as its own top-level spread inside the
    // JSON.stringify({...}) object, not inside the `messages:` array
    // expression itself.
    const messagesField = sliceFrom(bodyBlock, 'messages:', 'memoryContext:')
    expect(messagesField).not.toContain('extraBody')
    expect(bodyBlock).toContain('...extraBody,')
  })

  it('the fixed confirm-turn text never interpolates the token', () => {
    const line = HOOK_SOURCE.split('\n').find(l => l.includes('CONFIRM_TURN_TEXT ='))
    expect(line).toBeTruthy()
    expect(line).not.toContain('confirmationToken')
    expect(line).not.toContain('${')
  })

  it('the confirmationToken never appears inside the messages array construction anywhere in the hook', () => {
    // The token identifier may legitimately appear near organiserActionConfirmation
    // (extraBody) and in state plumbing (pendingOrganiserAction, action.confirmationToken
    // reads) — what must NEVER happen is it being interpolated into the `text`
    // argument passed as a chat message. Block-scope strictly to the messages:
    // array expression inside runChatTurn's fetch body.
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    const messagesField = sliceFrom(fn, 'messages:          [...messages,', 'memoryContext:')
    expect(messagesField).not.toContain('confirmationToken')
    expect(messagesField).not.toContain('Token')
  })
})

describe('G — Cancel is non-mutating: zero network calls', () => {
  it('cancelOrganiserAction contains no fetch() and never calls runChatTurn', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const cancelOrganiserAction = useCallback(', '}, [pendingOrganiserAction]);')
    expect(fn).not.toContain('fetch(')
    expect(fn).not.toContain('runChatTurn(')
    expect(fn).not.toContain('organiserActionConfirmation')
  })

  it('cancelOrganiserAction clears the pending action locally and appends a local note', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const cancelOrganiserAction = useCallback(', '}, [pendingOrganiserAction]);')
    expect(fn).toContain('setPendingOrganiserAction(null)')
    expect(fn).toContain('Action cancelled')
  })
})

describe('H/I — duplicate-click protection and disabled submitting state', () => {
  it('confirmOrganiserAction guards with a synchronous ref BEFORE any await', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const confirmOrganiserAction = useCallback(', 'const cancelOrganiserAction = useCallback(')
    const guardIdx  = fn.indexOf('organiserConfirmInFlightRef.current) return')
    const setTrueIdx = fn.indexOf('organiserConfirmInFlightRef.current = true')
    const firstAwaitIdx = fn.indexOf('await ')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(setTrueIdx).toBeGreaterThan(guardIdx)
    expect(firstAwaitIdx).toBeGreaterThan(setTrueIdx)
  })

  it('the in-flight flag is reset in a finally block so it always clears, success or failure', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const confirmOrganiserAction = useCallback(', 'const cancelOrganiserAction = useCallback(')
    expect(fn).toContain('finally {')
    expect(fn).toContain('organiserConfirmInFlightRef.current = false')
  })

  it('OrganiserActionCard disables both buttons while submitting', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    const confirmBtn = sliceFrom(card, 'onClick={onConfirm}', 'Cancel')
    expect(confirmBtn).toContain('disabled={submitting}')
    const cancelBtn = sliceFrom(card, 'onClick={onCancel}', '</button>')
    expect(cancelBtn).toContain('disabled={submitting}')
  })
})

describe('J — ordinary chat text ("yes", "confirm", "do it", "okay") never sends the token', () => {
  it('sendMessage never references organiserActionConfirmation as a functional dependency (comments aside)', () => {
    const fn = stripLineComments(sliceFrom(HOOK_SOURCE, '// ── Send message', 'useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);'))
    expect(fn).not.toContain('organiserActionConfirmation')
  })

  it('sendMessage calls runChatTurn with exactly one argument (no extraBody)', () => {
    const fn = sliceFrom(HOOK_SOURCE, '// ── Send message', 'useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);')
    expect(fn).toContain('await runChatTurn(text);')
  })

  it('there is no text-pattern matcher (regex/keyword check) anywhere in the hook that inspects user text for "yes"/"confirm"/"do it"/"okay" to trigger a write', () => {
    const stripped = stripLineComments(HOOK_SOURCE)
    // The only literal appearances of these words in the shipped source are
    // this file's own fixed CONFIRM_TURN_TEXT constant and the cancellation
    // notice — never a conditional/regex test against arbitrary chat input.
    expect(stripped).not.toMatch(/text\.(toLowerCase|trim)\(\)\s*(===|\.match|\.test)/)
    expect(stripped).not.toMatch(/\/(yes|confirm|do it|okay)\//i)
  })
})

describe('K/L — expired/invalid confirmation and success both clear the stale card exactly once', () => {
  it('a fresh proposal in the response always replaces the pending card', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    expect(fn).toContain('if (data.pendingOrganiserAction) {')
    expect(fn).toContain('setPendingOrganiserAction({ ...data.pendingOrganiserAction, receivedAt: Date.now() });')
  })

  it('a confirm turn that returns no fresh proposal (success OR rejection) clears the card', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    expect(fn).toContain('} else if (isConfirmFlow) {')
    expect(fn).toContain('setPendingOrganiserAction(null);')
  })

  it('a network failure during a confirm turn also clears the card (never leaves it in an ambiguous "maybe still running" state)', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    const catchBlock = sliceFrom(fn, '} catch (err) {', '  }, [messages, speak, clearHistory]);')
    expect(catchBlock).toContain('if (isConfirmFlow) setPendingOrganiserAction(null);')
  })

  it('no auto-retry exists anywhere in the confirm path', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const confirmOrganiserAction = useCallback(', 'const cancelOrganiserAction = useCallback(')
    expect(fn).not.toContain('setTimeout')
    expect(fn).not.toContain('retry')
  })
})

describe('M — successful confirmation shows the backend result exactly once', () => {
  it('runChatTurn appends the assistant message exactly once per call (no duplicate success banner)', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    const occurrences = fn.split("role: 'assistant', content: data.response,").length - 1
    expect(occurrences).toBe(1)
  })

  it('no synthetic success/failure banner is fabricated client-side — the model\'s own constrained reply is the single source of truth', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    expect(fn).not.toContain("'Comment posted")
    expect(fn).not.toContain("'Action confirmed")
  })
})

describe('N — viewer cannot obtain an executable confirmation card (real dispatch, mocked DB/auth only)', () => {
  beforeEach(() => {
    nSqlMock.mockClear()
    nAuthorizeOrganiserRequestMock.mockReset()
  })

  it('viewer role -> executeOrganiserTool(propose_organiser_comment) returns a generic denial with a deterministic unauthorized status and NO proposal/confirmation_token fields', async () => {
    nAuthorizeOrganiserRequestMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const { executeOrganiserTool } = await import('@/lib/organiser/helenaTools')
    const raw = await executeOrganiserTool('propose_organiser_comment', { item_id: '33333333-3333-3333-3333-333333333333', body: 'hi' })
    const parsed = JSON.parse(raw)
    expect(parsed.error).toBe('Organiser access is not available for this account.')
    // Phase D.4.6L — 'unauthorized' is now a deterministic status the chat
    // route can key its fixed denial wording on; it carries no additional
    // detail beyond the same generic denial string already asserted above.
    expect(parsed.status).toBe('unauthorized')
    expect(parsed.proposal).toBeUndefined()
    expect(parsed.confirmation_token).toBeUndefined()
  })
})

describe('O — one active pending action at a time', () => {
  it('setPendingOrganiserAction is called with a single object (never appended to an array/list)', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    expect(fn).not.toContain('setPendingOrganiserAction(prev =>')
    expect(fn).not.toContain('setPendingOrganiserAction([')
  })

  it('pendingOrganiserAction state itself is a single value (useState(null)), not an array/Map', () => {
    expect(HOOK_SOURCE).toContain('useState(null)')
    const decl = HOOK_SOURCE.split('\n').find(l => l.includes('setPendingOrganiserAction]') && l.includes('useState'))
    expect(decl).toBeTruthy()
    expect(decl).not.toContain('useState([')
  })
})

describe('P — exactly one Organiser write action is surfaced in the UI', () => {
  it('ChatPanel/useHelena reference only propose_organiser_comment — no delete/move/update/create-item action type', () => {
    for (const src of [CHATPANEL_SOURCE, HOOK_SOURCE]) {
      const stripped = stripLineComments(src)
      expect(stripped).not.toMatch(/delete_organiser|move_organiser|update_organiser|create_organiser_item/)
    }
  })

  it('OrganiserActionCard\'s fixed Action label is the single literal "Post comment" (not derived from a variable action-type map)', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    expect(card).toContain('>Post comment<')
  })
})

describe('Q — existing normal Helena chat behavior is unaffected by the refactor', () => {
  it('sendMessage still runs the local command fast-path before any network call', () => {
    const fn = sliceFrom(HOOK_SOURCE, '// ── Send message', 'useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);')
    expect(fn).toContain('parseCommand(text)')
    expect(fn).toContain('executeCommand(cmd, clearHistory)')
  })

  it('every original side-effect branch survives inside runChatTurn (scout_search, note_create, navigate, spotify_control, task_add, task_complete, task_clear, calendar_create, memory_update)', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    for (const marker of [
      "data.action === 'scout_search'",
      "data.action === 'note_create'",
      "data.action === 'navigate'",
      "data.action === 'spotify_control'",
      "data.action === 'task_add'",
      "data.action === 'task_complete'",
      "data.action === 'task_clear'",
      "data.action === 'calendar_create'",
      'data.memory_update?.fact',
    ]) {
      expect(fn).toContain(marker)
    }
  })

  it('speak(data.response) still runs on every turn, confirm turns included', () => {
    const fn = sliceFrom(HOOK_SOURCE, 'const runChatTurn = useCallback(', 'const sendMessage = useCallback(')
    expect(fn).toContain('speak(data.response);')
  })
})

describe('Wiring — every live ChatPanel call site passes the new props through', () => {
  it('HlnaAssistantWrapper (mounted in Organiser + Dashboard layouts) wires all four props', () => {
    for (const prop of ['pendingOrganiserAction={helena.pendingOrganiserAction}', 'organiserActionSubmitting={helena.organiserActionSubmitting}', 'onConfirmOrganiserAction={helena.confirmOrganiserAction}', 'onCancelOrganiserAction={helena.cancelOrganiserAction}']) {
      expect(WRAPPER_SOURCE).toContain(prop)
    }
  })

  it('BrainBase.jsx (/dashboard\'s own Helena surface) wires all four props', () => {
    for (const prop of ['pendingOrganiserAction={helena.pendingOrganiserAction}', 'organiserActionSubmitting={helena.organiserActionSubmitting}', 'onConfirmOrganiserAction={helena.confirmOrganiserAction}', 'onCancelOrganiserAction={helena.cancelOrganiserAction}']) {
      expect(BRAINBASE_SOURCE).toContain(prop)
    }
  })

  it('HelenaWorkspace.jsx (/hlna docked surface) wires all four props', () => {
    for (const prop of ['pendingOrganiserAction={helena.pendingOrganiserAction}', 'organiserActionSubmitting={helena.organiserActionSubmitting}', 'onConfirmOrganiserAction={helena.confirmOrganiserAction}', 'onCancelOrganiserAction={helena.cancelOrganiserAction}']) {
      expect(WORKSPACE_SOURCE).toContain(prop)
    }
  })
})

describe('Accessibility (source-level)', () => {
  it('Confirm/Cancel are native <button> elements (keyboard reachable by default), not clickable divs', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    expect(card).toContain('<button')
    expect((card.match(/<button/g) || []).length).toBe(2)
  })

  it('card has an accessible region label and both buttons have explicit aria-labels', () => {
    const card = sliceFrom(CHATPANEL_SOURCE, 'function OrganiserActionCard(', 'export function ChatPanel(')
    expect(card).toContain('role="region"')
    expect(card).toContain('aria-label="Helena Organiser action awaiting your confirmation"')
    expect(card).toContain('aria-label="Confirm: post this exact comment now"')
    expect(card).toContain('aria-label="Cancel: do not post this comment"')
  })

  it('no window.confirm()/window.alert() browser dialog is used', () => {
    expect(CHATPANEL_SOURCE).not.toContain('window.confirm(')
    expect(CHATPANEL_SOURCE).not.toContain('confirm(')
  })
})
