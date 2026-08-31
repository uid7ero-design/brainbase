import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 5 privacy regression coverage — the explicit checklist this
// phase's own brief required proof for. Static source-text assertions
// only (no DB, no mocking needed for most of these): confirms the
// SHAPE of the code, not runtime behaviour, which is the correct tool
// for "this field is never selected/written" style claims. The runtime/
// concurrency/tenant-isolation claims that genuinely need a live
// database are proven separately in scripts/tests/verify-events-crm-
// link.sh (composite FK cross-tenant rejection) and
// scripts/tests/verify-events-crm-sync-concurrency.sh.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

describe('1-3. registration answers never enter CRM', () => {
  it('lib/crm/eventSync.ts never references any registration-answer table/column', () => {
    const source = read('lib/crm/eventSync.ts')
    expect(source).not.toContain('event_registration_responses')
    expect(source).not.toContain('event_registration_questions')
    expect(source).not.toMatch(/question_label_snapshot|field_type_snapshot|answer_json/)
  })

  it('the free registration route passes only purchaser_name/email/phone to syncEventOrderContact — never validated.attendees or any response data', () => {
    const source = read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts')
    const callIdx = source.indexOf('await syncEventOrderContact({')
    expect(callIdx).toBeGreaterThan(-1)
    const callBlock = source.slice(callIdx, source.indexOf('});', callIdx) + 3)
    expect(callBlock).toContain('purchaserName: validated.purchaser_name')
    expect(callBlock).toContain('purchaserEmail: validated.purchaser_email')
    expect(callBlock).toContain('purchaserPhone: validated.purchaser_phone')
    expect(callBlock).not.toContain('validated.attendees')
    expect(callBlock).not.toContain('validated.order_responses')
    expect(callBlock).not.toContain('validatedResponses')
  })

  it('the paid checkout route passes only purchaser_name/email/phone to syncEventOrderContact — never validated.attendees or any response data', () => {
    const source = read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts')
    const callIdx = source.indexOf('await syncEventOrderContact({')
    expect(callIdx).toBeGreaterThan(-1)
    const callBlock = source.slice(callIdx, source.indexOf('});', callIdx) + 3)
    expect(callBlock).toContain('purchaserName: validated.purchaser_name')
    expect(callBlock).toContain('purchaserEmail: validated.purchaser_email')
    expect(callBlock).toContain('purchaserPhone: validated.purchaser_phone')
    expect(callBlock).not.toContain('validated.attendees')
    expect(callBlock).not.toContain('validatedResponses')
  })

  it('recordEventBookingActivity\'s input type carries only safe operational fields — no free-text/answer field exists to accidentally pass through', () => {
    const source = read('lib/crm/eventSync.ts')
    const ifaceIdx = source.indexOf('export interface RecordEventBookingActivityInput')
    const ifaceBlock = source.slice(ifaceIdx, source.indexOf('}', ifaceIdx))
    expect(ifaceBlock).toMatch(/organisationId: string/)
    expect(ifaceBlock).toMatch(/orderId: string/)
    expect(ifaceBlock).toMatch(/eventName: string/)
    expect(ifaceBlock).toMatch(/quantity: number/)
    expect(ifaceBlock).toMatch(/totalCents: number/)
    expect(ifaceBlock).toMatch(/currency: string/)
    expect(ifaceBlock).toMatch(/paymentStatus: string/)
    expect(ifaceBlock).not.toMatch(/answer|response|note[s]?:|dietary|accessibility/i)
  })
})

describe('4-5. public Events endpoints expose no CRM data', () => {
  it('lib/events/publicResolve.ts (backs the public event page + checkout/register routes) never selects or references any crm_* table/column', () => {
    const source = read('lib/events/publicResolve.ts')
    expect(source).not.toMatch(/crm_contacts|crm_activities|crm_companies|crm_deals|crm_contact_id/)
  })

  it('lib/events/publicTicket.ts (backs the public /t/[token] ticket page) never selects or references any crm_* table/column', () => {
    const source = read('lib/events/publicTicket.ts')
    expect(source).not.toMatch(/crm_contacts|crm_activities|crm_companies|crm_deals|crm_contact_id/)
  })

  it('the public checkout/register route responses never include crm_contact_id or any crm_* field in their NextResponse.json payloads', () => {
    const checkoutSource = read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts')
    const registerSource = read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts')
    for (const source of [checkoutSource, registerSource]) {
      const jsonCalls = [...source.matchAll(/NextResponse\.json\(([\s\S]*?)\)/g)].map(m => m[1])
      for (const call of jsonCalls) {
        expect(call).not.toMatch(/crm_contact_id|crm_contacts|crm_activities/)
      }
    }
  })
})

describe('6. event manager only gets link/contact access within the same tenant', () => {
  it('the orders route selects crm_contact_id from the SAME organisation_id-scoped query as every other order field — no separate, unscoped lookup', () => {
    const source = read('app/api/events/[id]/orders/route.ts')
    const selectIdx = source.indexOf('eo.crm_contact_id')
    const whereIdx = source.indexOf('WHERE eo.event_id')
    expect(selectIdx).toBeGreaterThan(-1)
    expect(whereIdx).toBeGreaterThan(selectIdx)
    expect(source.slice(whereIdx, whereIdx + 120)).toContain('eo.organisation_id = ${session.organisationId}')
  })

  it('crm_enabled is computed from session.organisationId (server-derived), never from a client-supplied organisation id', () => {
    const source = read('app/api/events/[id]/orders/route.ts')
    expect(source).toContain("checkCapability(session.organisationId, 'crm')")
    expect(source).not.toMatch(/checkCapability\([^)]*req\.|checkCapability\([^)]*params\./)
  })

  it('the manager orders route remains staff-authenticated (authorizeEventsRequest), never a public endpoint', () => {
    const source = read('app/api/events/[id]/orders/route.ts')
    expect(source).toContain("authorizeEventsRequest('viewer')")
  })
})

describe('7. cross-tenant crm_contact_id linkage is rejected by the DB (static proof of the mechanism; runtime proof lives in scripts/tests/verify-events-crm-link.sh)', () => {
  it('the migration declares a COMPOSITE foreign key on (crm_contact_id, organisation_id), not a plain single-column FK', () => {
    const source = read('scripts/add-events-crm-link.sql')
    expect(source).toMatch(/FOREIGN KEY \(crm_contact_id, organisation_id\)/)
    expect(source).toMatch(/REFERENCES crm_contacts \(id, organisation_id\)/)
  })

  it('crm_contacts gains a matching UNIQUE(id, organisation_id) so the composite FK target is well-formed', () => {
    const source = read('scripts/add-events-crm-link.sql')
    expect(source).toMatch(/ADD CONSTRAINT crm_contacts_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })

  it('the ON DELETE action is column-scoped SET NULL (crm_contact_id) — not a plain whole-FK SET NULL, which would also null organisation_id (the bug this migration\'s own harness caught)', () => {
    const source = read('scripts/add-events-crm-link.sql')
    expect(source).toMatch(/ON DELETE SET NULL \(crm_contact_id\)/)
  })
})
