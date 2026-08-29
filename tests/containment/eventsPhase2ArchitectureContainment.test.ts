import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 — static source-text containment proving
// the Phase 2 scope boundary from the implementation brief: no QR, no
// payment gateway, no email sending, no CRM write, no audit
// integration, no LD_TENNIS_ORG_ID, no ::uuid, no client-trusted
// organisation id, and that the new tenant-integrity composite FKs
// (extending Phase 1's own chain) actually exist in both the Prisma
// schema and the live SQL. Comments are stripped before matching to
// avoid false positives on explanatory prose (matching the idiom
// established in Phase 1's own containment suite).

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function stripSqlLineComments(sql: string): string {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
}

// Normalises CRLF -> LF once at the source — see the identical fix (and
// its full rationale) in tests/containment/eventsArchitectureContainment.test.ts's
// own read() helper.
function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const PHASE2_SOURCE_FILES = [
  'app/api/public/events/[organisationSlug]/[eventSlug]/route.ts',
  'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts',
  'app/api/events/[id]/orders/route.ts',
  'app/e/[organisationSlug]/[eventSlug]/page.tsx',
  'app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx',
  'app/events/[id]/RegistrationsPanel.tsx',
  'lib/events/publicResolve.ts',
  'lib/events/publicValidation.ts',
  'lib/events/publicEventDetail.ts',
]

describe('Events Phase 2 containment — no QR/payment/email/CRM/audit scope creep', () => {
  for (const file of PHASE2_SOURCE_FILES) {
    it(`${file} has no QR/barcode/camera code`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/qrcode|jsbarcode|bwip|getUserMedia|barcode/i)
    })

    it(`${file} has no payment gateway dependency`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/stripe|paypal|square|checkout\.session|payment_intent/i)
    })

    it(`${file} sends no email`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/resend|sendEmail|nodemailer|getResendClient/i)
    })

    it(`${file} writes nothing to crm_* tables or CRM contacts`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/crm_contacts|crm_companies|crm_deals|crm_activities/i)
    })

    it(`${file} writes nothing to audit_logs`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/audit_logs/i)
      expect(code).not.toMatch(/AuditLog/)
    })

    it(`${file} never references LD_TENNIS_ORG_ID or a hardcoded organisation env var`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/LD_TENNIS_ORG_ID/)
      expect(code).not.toMatch(/process\.env\.[A-Z_]*ORG_ID/)
    })

    it(`${file} never casts an id column to ::uuid`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/::uuid/i)
    })
  }

  it('package.json has no new QR/payment dependency', () => {
    const pkg = read('package.json')
    expect(pkg).not.toMatch(/"qrcode"|"jsbarcode"|"stripe"|"paypal"|"square"/i)
  })

  it('no attendee/order/check-in QR-token column exists in the Phase 2 SQL script (deferred to Phase 3)', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).not.toMatch(/ticket_token|qr_/i)
    expect(live).not.toMatch(/checked_in/i)
  })
})

describe('Events Phase 2 containment — every API route enforces its intended auth boundary', () => {
  it('the public GET and register routes never call an authenticated session helper', () => {
    for (const file of [
      'app/api/public/events/[organisationSlug]/[eventSlug]/route.ts',
      'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts',
    ]) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/requireSession|requireRole|getSession|getAuthSession|cookies\(\)/)
    }
  })

  it('the internal orders route uses authorizeEventsRequest, matching every other staff Events route', () => {
    const code = stripComments(read('app/api/events/[id]/orders/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\(/)
  })
})

// Block-scoped extraction of a single `model X { ... }` body — mirrors
// the idiom already established in Phase 1's own containment suite.
function extractPrismaModel(schemaSrc: string, modelName: string): string {
  const start = schemaSrc.indexOf(`model ${modelName} {`)
  if (start === -1) throw new Error(`model ${modelName} not found in schema.prisma`)
  const end = schemaSrc.indexOf('\n}', start)
  return schemaSrc.slice(start, end)
}

describe('Events Phase 2 containment — composite tenant-integrity FK chain (Prisma)', () => {
  const schemaSrc = read('prisma/schema.prisma')

  it('EventOrder composite-FKs onto Event(id, organisation_id)', () => {
    const block = extractPrismaModel(schemaSrc, 'EventOrder')
    expect(block).toMatch(/@relation\(fields:\s*\[event_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/)
    expect(block).toMatch(/@@unique\(\[id, organisation_id\]\)/)
  })

  it('EventOrderItem composite-FKs onto EventOrder(id, organisation_id) and EventTicketType(id, organisation_id)', () => {
    const block = extractPrismaModel(schemaSrc, 'EventOrderItem')
    expect(block).toMatch(/@relation\(fields:\s*\[order_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/)
    expect(block).toMatch(/@relation\(fields:\s*\[ticket_type_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/)
    expect(block).toMatch(/@@unique\(\[id, organisation_id\]\)/)
  })

  it('EventOrderItem composite-FKs onto EventSession(id, organisation_id) when session-bound', () => {
    const block = extractPrismaModel(schemaSrc, 'EventOrderItem')
    expect(block).toMatch(/@relation\(fields:\s*\[event_session_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/)
  })

  it('EventAttendee composite-FKs onto EventOrderItem(id, organisation_id)', () => {
    const block = extractPrismaModel(schemaSrc, 'EventAttendee')
    expect(block).toMatch(/@relation\(fields:\s*\[order_item_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/)
  })

  it('EventSession and EventTicketType each gained UNIQUE(id, organisation_id) — the Phase 1 addition Phase 2 depends on', () => {
    const sessionBlock = extractPrismaModel(schemaSrc, 'EventSession')
    const ticketTypeBlock = extractPrismaModel(schemaSrc, 'EventTicketType')
    expect(sessionBlock).toMatch(/@@unique\(\[id, organisation_id\]\)/)
    expect(ticketTypeBlock).toMatch(/@@unique\(\[id, organisation_id\]\)/)
  })
})

describe('Events Phase 2 containment — composite tenant-integrity FK chain (SQL)', () => {
  it('event_orders has a composite FK onto events(id, organisation_id)', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/FOREIGN KEY \(event_id, organisation_id\)\s*\n?\s*REFERENCES events \(id, organisation_id\)/)
  })

  it('event_order_items has composite FKs onto event_orders, event_ticket_types, and event_sessions', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/FOREIGN KEY \(order_id, organisation_id\)\s*\n?\s*REFERENCES event_orders \(id, organisation_id\)/)
    expect(live).toMatch(/FOREIGN KEY \(ticket_type_id, organisation_id\)\s*\n?\s*REFERENCES event_ticket_types \(id, organisation_id\)/)
    expect(live).toMatch(/FOREIGN KEY \(event_session_id, organisation_id\)\s*\n?\s*REFERENCES event_sessions \(id, organisation_id\)/)
  })

  it('event_attendees has a composite FK onto event_order_items(id, organisation_id)', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/FOREIGN KEY \(order_item_id, organisation_id\)\s*\n?\s*REFERENCES event_order_items \(id, organisation_id\)/)
  })

  it('the Phase 1 event_sessions/event_ticket_types tables gain UNIQUE(id, organisation_id) via an additive, idempotent DO block — no DROP, no destructive ALTER', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/ALTER TABLE event_sessions\s*\n\s*ADD CONSTRAINT event_sessions_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
    expect(live).toMatch(/ALTER TABLE event_ticket_types\s*\n\s*ADD CONSTRAINT event_ticket_types_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
    expect(live).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+event_sessions\s+DROP\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+event_ticket_types\s+DROP\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+organisations\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+users\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+events\b/i)
  })

  it('scripts/create-events-phase2.sql uses only additive, idempotent DDL for its three new tables', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS event_orders/)
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS event_order_items/)
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS event_attendees/)
  })
})

describe('Events Phase 2 containment — status/price vocabulary parity (same lesson as Phase 1)', () => {
  it('EventOrder.status is a plain Prisma String, not a native-enum-implying Prisma enum', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const block = extractPrismaModel(schemaSrc, 'EventOrder')
    expect(block).toMatch(/status\s+String\s+@default\("PENDING"\)/)
  })

  it("the SQL status CHECK vocabulary matches ('PENDING'|'CONFIRMED'|'CANCELLED')", () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'PENDING'\s+CHECK\s*\(status IN \('PENDING',\s*'CONFIRMED',\s*'CANCELLED'\)\)/)
  })

  it('unit_price_cents/total_cents are never hard-locked to 0 at the DB level (a future paid-orders phase needs no migration to relax it) — the free-only invariant is enforced in application code', () => {
    const live = stripSqlLineComments(read('scripts/create-events-phase2.sql'))
    expect(live).not.toMatch(/CHECK\s*\(\s*(unit_)?price_cents\s*=\s*0\s*\)/i)
    expect(live).not.toMatch(/CHECK\s*\(\s*total_cents\s*=\s*0\s*\)/i)
  })
})
