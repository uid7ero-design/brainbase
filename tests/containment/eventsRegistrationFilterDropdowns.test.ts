import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events registration operations phase — replaces the five native
// <select> filter controls in RegistrationsPanel with FilterDropdown
// (app/events/_components/ui.tsx), a click-toggle, value-emitting
// dropdown styled to match the top-nav dropdown family (components/nav/
// TopNav.tsx's OpsDropdown/AdminDropdown dark popup surface) rather than
// a native browser <option> popup. UI-only: this phase does not touch
// lib/events/registrationFilters.ts, either orders route, or
// lib/events/csvExport.ts — their own existing test suites (tests/
// containment/eventsRegistrationSearchFilter.test.ts and
// eventsRegistrationCsvExport.test.ts) remain the authority for backend
// filter semantics, CSV privacy, and auth; not duplicated here. This
// file proves only the UI-facing claims: no native <select> remains,
// every filter now uses FilterDropdown with the exact same option
// values/labels as before, selection still drives the exact same state
// setters (so the query-string/CSV-export wiring is provably
// unaffected), and FilterDropdown's own interaction mechanics (click-
// toggle, click-outside-close, Escape-close, focus-return) are present
// as designed — proven structurally, matching this repo's established
// convention for UI behavior in the absence of a jsdom/React Testing
// Library harness (see e.g. tests/containment/
// crmHeaderContextSwitcher.test.ts's own header comment on the same
// constraint).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const panelSrc = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))
const uiSrc = stripComments(read('app/events/_components/ui.tsx'))

// ─────────────────────────────────────────────────────────────────────
// No native <select> remains; all five filters use FilterDropdown
// ─────────────────────────────────────────────────────────────────────

describe('RegistrationsPanel.tsx — no native <select> remains for the five filters', () => {
  it('contains zero <select> elements', () => {
    expect(panelSrc).not.toMatch(/<select[\s>]/)
  })

  it('imports FilterDropdown and DropdownOption from the shared Events ui module', () => {
    expect(panelSrc).toMatch(/import\s*\{[\s\S]*?\bFilterDropdown\b[\s\S]*?\}\s*from\s*'\.\.\/_components\/ui'/)
    expect(panelSrc).toContain('DropdownOption')
  })

  it('renders exactly five <FilterDropdown> instances', () => {
    const matches = [...panelSrc.matchAll(/<FilterDropdown\b/g)]
    expect(matches.length).toBe(5)
  })

  it('all five carry the same aria-labels as the prior native selects (payment, check-in, cancellation, ticket type, session)', () => {
    for (const label of [
      'Filter by payment status',
      'Filter by check-in status',
      'Filter by cancellation',
      'Filter by ticket type',
      'Filter by session',
    ]) {
      expect(panelSrc).toContain(`ariaLabel="${label}"`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// Exact option/value mappings unchanged
// ─────────────────────────────────────────────────────────────────────

describe('RegistrationsPanel.tsx — option value/label mappings are byte-identical to the prior native <select>s', () => {
  it('payment status: same six values plus "Any payment status", each label equal to its own value (unchanged from the raw PAYMENT_STATUS_OPTIONS map)', () => {
    expect(panelSrc).toContain("{ value: '', label: 'Any payment status' }")
    expect(panelSrc).toContain('...PAYMENT_STATUS_OPTIONS.map(v => ({ value: v, label: v }))')
    expect(panelSrc).toContain("const PAYMENT_STATUS_OPTIONS = ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const")
  })

  it('check-in: Any / Checked in / Not checked in, with the same in/out values the shared filter module expects', () => {
    expect(panelSrc).toContain("{ value: '', label: 'Any check-in status' }")
    expect(panelSrc).toContain("{ value: 'in', label: 'Checked in' }")
    expect(panelSrc).toContain("{ value: 'out', label: 'Not checked in' }")
  })

  it('cancellation: Active + cancelled / Active only / Cancelled only, with the same true/false string values', () => {
    expect(panelSrc).toContain("{ value: '', label: 'Active + cancelled' }")
    expect(panelSrc).toContain("{ value: 'false', label: 'Active only' }")
    expect(panelSrc).toContain("{ value: 'true', label: 'Cancelled only' }")
  })

  it('ticket type: "Any ticket type" plus one entry per ticketTypes prop item, id as value, name as label', () => {
    expect(panelSrc).toContain("{ value: '', label: 'Any ticket type' }")
    expect(panelSrc).toContain('...ticketTypes.map((t): DropdownOption => ({ value: t.id, label: t.name }))')
  })

  it('session: "Any session" plus one entry per sessions prop item, id as value, name as label', () => {
    expect(panelSrc).toContain("{ value: '', label: 'Any session' }")
    expect(panelSrc).toContain('...sessions.map((s): DropdownOption => ({ value: s.id, label: s.name }))')
  })

  it('the ticket-type and session dropdowns remain conditionally rendered only when their list is non-empty, exactly as the prior selects were', () => {
    expect(panelSrc).toMatch(/\{ticketTypes\.length > 0 && \(\s*<FilterDropdown/)
    expect(panelSrc).toMatch(/\{sessions\.length > 0 && \(\s*<FilterDropdown/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Selection still drives the exact same state — query-string/CSV wiring
// downstream of this is therefore provably unaffected
// ─────────────────────────────────────────────────────────────────────

describe('RegistrationsPanel.tsx — each FilterDropdown\'s onChange is wired to the SAME state setter the prior <select onChange> used', () => {
  it('payment status onChange is setPaymentStatusFilter', () => {
    const block = panelSrc.slice(panelSrc.indexOf('ariaLabel="Filter by payment status"') - 200, panelSrc.indexOf('ariaLabel="Filter by payment status"') + 400)
    expect(block).toContain('onChange={setPaymentStatusFilter}')
  })

  it('check-in onChange is setCheckinFilter', () => {
    const block = panelSrc.slice(panelSrc.indexOf('ariaLabel="Filter by check-in status"') - 200, panelSrc.indexOf('ariaLabel="Filter by check-in status"') + 400)
    expect(block).toContain('onChange={setCheckinFilter}')
  })

  it('cancellation onChange is setCancelledFilter', () => {
    const block = panelSrc.slice(panelSrc.indexOf('ariaLabel="Filter by cancellation"') - 200, panelSrc.indexOf('ariaLabel="Filter by cancellation"') + 400)
    expect(block).toContain('onChange={setCancelledFilter}')
  })

  it('ticket type onChange is setTicketTypeFilter', () => {
    const block = panelSrc.slice(panelSrc.indexOf('ariaLabel="Filter by ticket type"') - 200, panelSrc.indexOf('ariaLabel="Filter by ticket type"') + 400)
    expect(block).toContain('onChange={setTicketTypeFilter}')
  })

  it('session onChange is setSessionFilter', () => {
    const block = panelSrc.slice(panelSrc.indexOf('ariaLabel="Filter by session"') - 200, panelSrc.indexOf('ariaLabel="Filter by session"') + 400)
    expect(block).toContain('onChange={setSessionFilter}')
  })

  it('the five filter state variables themselves (and their setters) are unchanged from before this phase', () => {
    expect(panelSrc).toContain("const [paymentStatusFilter, setPaymentStatusFilter] = useState('')")
    expect(panelSrc).toContain("const [checkinFilter, setCheckinFilter] = useState('')")
    expect(panelSrc).toContain("const [cancelledFilter, setCancelledFilter] = useState('')")
    expect(panelSrc).toContain("const [ticketTypeFilter, setTicketTypeFilter] = useState('')")
    expect(panelSrc).toContain("const [sessionFilter, setSessionFilter] = useState('')")
  })
})

describe('RegistrationsPanel.tsx — everything downstream of filter state is untouched by this phase', () => {
  it('buildQueryString() still builds the exact same six query params from the exact same state variables', () => {
    const start = panelSrc.indexOf('function buildQueryString')
    const end = panelSrc.indexOf('return params.toString()', start) + 'return params.toString()'.length
    const block = panelSrc.slice(start, end)
    expect(block).toContain("params.set('q', debouncedQuery)")
    expect(block).toContain("params.set('paymentStatus', paymentStatusFilter)")
    expect(block).toContain("params.set('checkin', checkinFilter)")
    expect(block).toContain("params.set('cancelled', cancelledFilter)")
    expect(block).toContain("params.set('ticketTypeId', ticketTypeFilter)")
    expect(block).toContain("params.set('sessionId', sessionFilter)")
  })

  it('the list-fetch effect still calls the same GET /api/events/[id]/orders endpoint with buildQueryString()\'s output', () => {
    expect(panelSrc).toContain('`/api/events/${eventId}/orders${qs ? `?${qs}` : \'\'}`')
  })

  it('the Export CSV link still points at the export route with the exact same buildQueryString() output, and remains manager+ gated', () => {
    const exportIdx = panelSrc.indexOf('Export CSV')
    const surrounding = panelSrc.slice(Math.max(0, exportIdx - 400), exportIdx + 50)
    expect(surrounding).toContain('canManage &&')
    expect(surrounding).toContain('`/api/events/${eventId}/orders/export${buildQueryString()')
  })

  it('clearFilters() still resets exactly the search input and all five filter states, nothing more and nothing less', () => {
    const start = panelSrc.indexOf('function clearFilters')
    const end = panelSrc.indexOf('}', start) + 1
    const block = panelSrc.slice(start, end)
    expect(block).toContain('setSearchInput(\'\')')
    expect(block).toContain('setDebouncedQuery(\'\')')
    expect(block).toContain('setPaymentStatusFilter(\'\')')
    expect(block).toContain('setCheckinFilter(\'\')')
    expect(block).toContain('setCancelledFilter(\'\')')
    expect(block).toContain('setTicketTypeFilter(\'\')')
    expect(block).toContain('setSessionFilter(\'\')')
  })

  it('the search <input> is untouched — still a plain text input, still debounced the same way', () => {
    expect(panelSrc).toContain("type=\"text\"")
    expect(panelSrc).toContain('value={searchInput}')
    expect(panelSrc).toContain('onChange={e => setSearchInput(e.target.value)}')
    expect(panelSrc).toMatch(/setTimeout\(\(\) => setDebouncedQuery\(searchInput\.trim\(\)\), 300\)/)
  })

  it('no registration-answer export affordance was added anywhere in this file', () => {
    expect(panelSrc).not.toContain('includeAnswers')
  })
})

// ─────────────────────────────────────────────────────────────────────
// FilterDropdown itself — interaction mechanics (structural proof, no
// jsdom/RTL harness available in this repo)
// ─────────────────────────────────────────────────────────────────────

describe('app/events/_components/ui.tsx — FilterDropdown interaction mechanics', () => {
  const start = uiSrc.indexOf('export function FilterDropdown')
  const end = uiSrc.indexOf('\n}\n', start) + 2
  const block = uiSrc.slice(start, end)

  it('the trigger opens on click, not hover (matching OrgSwitcher\'s interaction model, not TopNav\'s hover-open link menus) — the only onMouseEnter in this component is the per-option hover highlight on an already-open menu, never what opens it', () => {
    const triggerButtonEnd = block.indexOf('</button>', block.indexOf('ref={triggerRef}'))
    const triggerBlock = block.slice(block.indexOf('ref={triggerRef}'), triggerButtonEnd)
    expect(triggerBlock).toContain('onClick={() => setOpen(o => !o)}')
    expect(triggerBlock).not.toContain('onMouseEnter')
  })

  it('closes on click-outside via a document mousedown listener, scoped to the wrapper ref', () => {
    expect(block).toMatch(/document\.addEventListener\('mousedown', onClickOutside\)/)
    expect(block).toMatch(/wrapperRef\.current && !wrapperRef\.current\.contains\(e\.target as Node\)/)
  })

  it('closes on Escape and returns focus to the trigger — a gap neither existing dark-dropdown precedent (TopNav\'s OpsDropdown/AdminDropdown, OrgSwitcher) closes', () => {
    expect(block).toMatch(/e\.key === 'Escape'/)
    expect(block).toContain('triggerRef.current?.focus()')
  })

  it('selecting an option calls the caller\'s onChange with the option\'s own value, then closes and returns focus to the trigger', () => {
    const selectFnStart = block.indexOf('function select(')
    const selectFnEnd = block.indexOf('}', selectFnStart) + 1
    const selectFn = block.slice(selectFnStart, selectFnEnd)
    expect(selectFn).toContain('onChange(next)')
    expect(selectFn).toContain('setOpen(false)')
    expect(selectFn).toContain('triggerRef.current?.focus()')
  })

  it('trigger and options are native <button> elements — Enter/Space activation and the browser\'s default focus outline are not reimplemented', () => {
    expect(block).toMatch(/<button[\s\S]*?ref=\{triggerRef\}/)
    expect(block).not.toMatch(/outline:\s*'none'/)
  })

  it('uses standard WAI-ARIA listbox semantics (not invented/ad-hoc attributes) — aria-haspopup, aria-expanded, role="listbox", role="option", aria-selected', () => {
    expect(block).toContain("aria-haspopup=\"listbox\"")
    expect(block).toContain('aria-expanded={open}')
    expect(block).toContain("role=\"listbox\"")
    expect(block).toContain("role=\"option\"")
    expect(block).toContain('aria-selected={isSelected}')
  })

  it('the open panel is a viewport-aware, capped-width absolutely-positioned element (not a browser-native popup, not portaled — no ancestor overflow clip applies to this toolbar, unlike TopNav\'s own nav row)', () => {
    expect(block).toContain("position: 'absolute'")
    expect(block).toMatch(/maxWidth:\s*'min\(260px, calc\(100vw - 32px\)\)'/)
    expect(block).not.toContain('createPortal')
  })

  it('the closed trigger reuses inputStyle (visual consistency with the adjacent native search input); the open panel uses the TopNav dark-popup palette, not inputStyle', () => {
    expect(block).toMatch(/\.\.\.inputStyle/)
    expect(block).toContain("background: 'rgba(7,5,16,.98)'")
  })
})
