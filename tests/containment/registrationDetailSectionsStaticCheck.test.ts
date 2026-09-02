import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisSessionManagementUiStaticCheck.test.ts for the same caveat spelled
// out in full.
//
// Events UX polish — RegistrationDetail.tsx was refactored from a flat
// "customer-submitted information" + "internal staff notes" layout into
// five explicitly separated sections (Purchaser / Attendees / Booking
// answers / Attendee answers / Internal staff notes). This suite proves
// the section split and answer-grouping actually landed, and that every
// pre-existing handler/API call/behaviour survived the refactor untouched.

const SOURCE_PATH = path.resolve(__dirname, '../../app/events/[id]/RegistrationDetail.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('RegistrationDetail.tsx — five-section structure', () => {
  it('renders exactly five top-level labelled sections, in order: Purchaser, Attendees, Booking answers, Attendee answers, Internal staff notes', () => {
    const labels = ['Purchaser', 'Attendees', 'Booking answers', 'Attendee answers', 'Internal staff notes']
    const indices = labels.map(l => source.indexOf(`sectionHeaderStyle}>${l}<`))
    indices.forEach((idx, i) => expect(idx, `label "${labels[i]}" not found as a section header`).toBeGreaterThan(-1))
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `"${labels[i]}" should appear after "${labels[i - 1]}"`).toBeGreaterThan(indices[i - 1])
    }
  })
})

describe('RegistrationDetail.tsx — Purchaser section (A)', () => {
  it('is a compact card showing name and contact grouped together, with Edit as a secondary action', () => {
    const body = section('{/* A. PURCHASER */}', '{/* B. ATTENDEES */}')
    expect(body).toContain('order.purchaser_name')
    expect(body).toContain('order.purchaser_email')
    expect(body).toContain('order.purchaser_phone')
    expect(body).toContain('setEditingPurchaser(true)')
    expect(body).toContain('ghostBtnSm') // secondary/ghost, not primaryBtnStyle, for the Edit trigger
  })

  it('the purchaser Save action uses the primary button style (save/confirm action)', () => {
    const body = section('{/* A. PURCHASER */}', '{/* B. ATTENDEES */}')
    const saveIdx = body.indexOf('onClick={savePurchaser}')
    expect(saveIdx).toBeGreaterThan(-1)
    expect(body.slice(saveIdx, saveIdx + 120)).toContain('primaryBtnStyle')
  })
})

describe('RegistrationDetail.tsx — Attendees section (B)', () => {
  it('renders one repeatable row per attendee with checked-in status visible', () => {
    const body = section('{/* B. ATTENDEES */}', '{/* C. BOOKING ANSWERS')
    expect(body).toContain('order.attendees.map(a =>')
    expect(body).toContain('rowCardStyle')
    expect(body).toContain("StatusBadge label={a.checked_in_at ? 'Checked in' : 'Not checked in'}")
  })

  it('Edit / View ticket / Copy link are all visually subordinate (ghost/secondary), not primary', () => {
    const body = section('{/* B. ATTENDEES */}', '{/* C. BOOKING ANSWERS')
    expect(body).toContain('startEditAttendee(a)')
    expect(body).toContain('ticketUrl(a.ticket_token)')
    expect(body).toContain('copyTicketLink(a.ticket_token!, a.id)')
    // None of the three row-level (view-mode) actions reach for
    // primaryBtnStyle — bounded to the read-only row, not the edit form
    // that follows it (which legitimately has its own Save action).
    const viewModeBlock = body.slice(body.indexOf('startEditAttendee(a)'), body.indexOf(') : ('))
    expect(viewModeBlock).not.toContain('primaryBtnStyle')
    expect(viewModeBlock).toContain('ghostBtnSm')
  })

  it('attendee Save (inside edit mode) still uses the primary style — the one genuine confirm action in the row', () => {
    const body = section('{/* B. ATTENDEES */}', '{/* C. BOOKING ANSWERS')
    const saveIdx = body.indexOf('onClick={() => saveAttendee(a.id)}')
    expect(saveIdx).toBeGreaterThan(-1)
    expect(body.slice(saveIdx, saveIdx + 100)).toContain('primaryBtnStyle')
  })
})

describe('RegistrationDetail.tsx — Booking answers (C) vs Attendee answers (D) — grouping', () => {
  it('Booking answers renders only order.order_responses (order-scope), not the flat combined list the old layout used', () => {
    const body = section('{/* C. BOOKING ANSWERS', '{/* D. ATTENDEE ANSWERS')
    expect(body).toContain('order.order_responses.map(r =>')
    expect(body).not.toContain('allResponses')
  })

  it('Attendee answers groups each attendee\'s own responses under that attendee\'s own name/card, not a flat list', () => {
    const body = section('{/* D. ATTENDEE ANSWERS', '{/* E. INTERNAL STAFF NOTES')
    expect(body).toContain('attendeesWithResponses.map(a =>')
    // The attendee's name is rendered as the group heading for that card.
    expect(body).toMatch(/\{a\.name\}<\/div>/)
    expect(body).toContain('a.responses.map(r =>')
  })

  it('there is no single combined order_responses + attendees.flatMap(responses) array anywhere in the file (the old flat-list pattern is gone)', () => {
    expect(source).not.toMatch(/order_responses,\s*\.\.\.order\.attendees\.flatMap/)
  })

  it('response editing (edit/save/cancel) is shared between both sections via the same ResponseEditor, not duplicated', () => {
    const bookingBody = section('{/* C. BOOKING ANSWERS', '{/* D. ATTENDEE ANSWERS')
    const attendeeBody = section('{/* D. ATTENDEE ANSWERS', '{/* E. INTERNAL STAFF NOTES')
    expect(bookingBody).toContain('<ResponseEditor key={r.id} r={r} />')
    expect(attendeeBody).toContain('<ResponseEditor key={r.id} r={r} />')
    expect(source).toContain('function ResponseEditor(')
    expect(source).toContain('startEditResponse(r)')
    expect(source).toContain('saveResponse(r)')
  })
})

describe('RegistrationDetail.tsx — Internal staff notes (E)', () => {
  it('retains full add/edit/delete note behaviour', () => {
    const body = section('{/* E. INTERNAL STAFF NOTES', 'function formatAnswer(')
    expect(body).toContain('onClick={addNote}')
    expect(body).toContain('startEditNote(n)')
    expect(body).toContain('onClick={() => saveNote(n.id)}')
    expect(body).toContain('deleteNote(n.id)')
  })

  it('the add-note textarea starts at a single row (reduced visual dominance) rather than the old multi-row default', () => {
    const body = section('{/* E. INTERNAL STAFF NOTES', 'function formatAnswer(')
    const addTextareaIdx = body.indexOf('value={newNote}')
    expect(addTextareaIdx).toBeGreaterThan(-1)
    expect(body.slice(addTextareaIdx, addTextareaIdx + 200)).toContain('rows={1}')
  })

  it('author, timestamp, and "edited" remain present but styled subtly (muted colour, small font)', () => {
    const body = section('{/* E. INTERNAL STAFF NOTES', 'function formatAnswer(')
    expect(body).toContain('n.author_name_snapshot')
    expect(body).toContain('new Date(n.created_at).toLocaleString()')
    expect(body).toContain("n.edited_at ? ' · edited' : ''")
    expect(body).toContain('TEXT_MUTED')
  })

  it('notes remain visually distinct from customer-submitted sections (own background/border treatment, not the same rowCardStyle sea)', () => {
    const body = section('{/* E. INTERNAL STAFF NOTES', 'function formatAnswer(')
    expect(body).toContain('background: ROW_BG')
  })

  it('the notes API calls (load/add/edit/delete) are unchanged', () => {
    expect(source).toContain('`/api/events/${eventId}/orders/${order.id}/notes`')
    expect(source).toContain('`/api/events/${eventId}/orders/${order.id}/notes/${noteId}`')
    expect(source).toContain("method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newNote })")
    expect(source).toContain("method: 'DELETE'")
  })
})

describe('RegistrationDetail.tsx — preserved functionality (no regressions from the visual refactor)', () => {
  it('all pre-existing mutation endpoints are untouched', () => {
    expect(source).toContain('`/api/events/${eventId}/orders/${order.id}`')
    expect(source).toContain('`/api/events/${eventId}/orders/${order.id}/attendees/${attendeeId}`')
    expect(source).toContain('`/api/events/${eventId}/orders/${order.id}/responses/${r.id}`')
  })

  it('ticket URL construction and copy behaviour are unchanged', () => {
    expect(source).toContain('function ticketUrl(token: string): string')
    expect(source).toContain('${window.location.origin}/t/${token}')
    expect(source).toContain('async function copyTicketLink(token: string, attendeeId: string)')
    expect(source).toContain('navigator.clipboard.writeText(ticketUrl(token))')
  })

  it('the ticket token is never regenerated by this component (no mutating call touches ticket_token — only read via ticketUrl)', () => {
    expect(source).not.toMatch(/method:\s*'(POST|PATCH|PUT)'[^}]*ticket_token/)
    expect(source).not.toMatch(/\/ticket[^`]*`,\s*\{\s*method:\s*'(POST|PATCH)'/)
  })

  it('all original handler function names still exist unchanged', () => {
    for (const fn of ['savePurchaser', 'startEditAttendee', 'saveAttendee', 'startEditResponse', 'saveResponse', 'loadNotes', 'addNote', 'startEditNote', 'saveNote', 'deleteNote']) {
      expect(source).toContain(`${fn}(`)
    }
  })
})

describe('RegistrationDetail.tsx — no horizontal overflow / responsive wrapping', () => {
  function windowAround(anchor: string, span = 400): string {
    const idx = source.indexOf(anchor)
    expect(idx, `anchor "${anchor}" not found`).toBeGreaterThan(-1)
    return source.slice(Math.max(0, idx - span), idx + span)
  }

  it('the purchaser summary row wraps on narrow viewports', () => {
    expect(windowAround('order.purchaser_name}</div>')).toContain("flexWrap: 'wrap'")
  })

  it('the attendee summary row wraps on narrow viewports', () => {
    expect(windowAround("checked_in_at ? 'Checked in'")).toContain("flexWrap: 'wrap'")
  })

  it('action button groups (attendee actions, header actions) wrap rather than overflow', () => {
    expect(windowAround('startEditAttendee(a)')).toContain("flexWrap: 'wrap'")
  })

  it('a majority of the component\'s flex rows declare flexWrap or an explicit flexDirection (no bare unwrapped horizontal rows dominating the file)', () => {
    const flexRows = source.match(/display: 'flex'[^}]*\}/g) ?? []
    const rowsMissingWrap = flexRows.filter(r => !r.includes('flexWrap') && !r.includes('flexDirection'))
    expect(rowsMissingWrap.length).toBeLessThan(flexRows.length)
  })
})
