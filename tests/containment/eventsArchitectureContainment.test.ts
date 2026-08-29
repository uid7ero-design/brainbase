import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 1 — static source-text containment proving
// the architecture invariants from the Phase 1 spec, not just runtime
// behaviour: no ::uuid casts, no dependency on the tennis booking
// domain, no reuse of the single-tenant LD_TENNIS_ORG_ID shortcut, every
// management route enforces auth, no public route was introduced, and
// no payment dependency was added. Comments are stripped before
// matching to avoid false positives on explanatory prose (matching the
// idiom established by tests/containment/requireCapability.test.ts).

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

const ROUTE_FILES = [
  'app/api/events/route.ts',
  'app/api/events/[id]/route.ts',
  'app/api/events/[id]/sessions/route.ts',
  'app/api/events/[id]/sessions/[sessionId]/route.ts',
  'app/api/events/[id]/ticket-types/route.ts',
  'app/api/events/[id]/ticket-types/[ticketTypeId]/route.ts',
]

const EVENTS_LIB_FILES = [
  'lib/events/authorize.ts',
  'lib/events/validation.ts',
]

const SQL_SCRIPTS = [
  'scripts/create-events.sql',
  'scripts/seed-events-capability.sql',
]

const ALL_NEW_SOURCE_FILES = [...ROUTE_FILES, ...EVENTS_LIB_FILES]

describe('Events architecture containment — no ::uuid casts', () => {
  for (const file of ALL_NEW_SOURCE_FILES) {
    it(`${file} never casts an id column to ::uuid`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/::uuid/i)
    })
  }

  for (const file of SQL_SCRIPTS) {
    it(`${file} never casts an id column to ::uuid (live SQL, not documentation comments)`, () => {
      // Uses gen_random_uuid()::text throughout (a UUID generated then
      // cast to TEXT) — that is the opposite of what this test guards
      // against, so the pattern below specifically targets a cast TO
      // uuid, not the id-generation idiom itself.
      const live = stripSqlLineComments(read(file))
      expect(live).not.toMatch(/::uuid\b/i)
    })
  }
})

describe('Events architecture containment — no tennis/booking domain coupling', () => {
  for (const file of ALL_NEW_SOURCE_FILES) {
    it(`${file} imports nothing from the tennis Session/SessionInstance/Booking domain`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/lib\/tennisSchedule/)
      expect(code).not.toMatch(/lib\/sessionDisplay/)
      expect(code).not.toMatch(/lib\/tennisSessionTypes/)
      expect(code).not.toMatch(/app\/api\/tennis/)
      expect(code).not.toMatch(/from ['"]@\/lib\/booking['"]/)
      // The Events domain has its own event_sessions/event_ticket_types
      // tables — it must never read/write the tennis "sessions" or
      // "bookings" tables directly.
      expect(code).not.toMatch(/\bFROM\s+sessions\b/i)
      expect(code).not.toMatch(/\bFROM\s+bookings\b/i)
      expect(code).not.toMatch(/\bINTO\s+sessions\b/i)
      expect(code).not.toMatch(/\bINTO\s+bookings\b/i)
      expect(code).not.toMatch(/\bUPDATE\s+sessions\b/i)
      expect(code).not.toMatch(/\bUPDATE\s+bookings\b/i)
    })
  }

  it('scripts/create-events.sql never references the sessions/session_instances/bookings tables in its live DDL', () => {
    // Checked against the live SQL only (comments stripped) — the file's
    // own header commentary explains the tennis-domain non-reuse
    // decision in prose and necessarily names those tables while doing
    // so; that documentation is not a schema dependency.
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).not.toMatch(/\bsessions\b/)
    expect(live).not.toMatch(/\bsession_instances\b/)
    expect(live).not.toMatch(/\bbookings\b/)
  })
})

describe('Events architecture containment — no LD_TENNIS_ORG_ID / single-tenant shortcut', () => {
  for (const file of ALL_NEW_SOURCE_FILES) {
    it(`${file} never references LD_TENNIS_ORG_ID or any hardcoded organisation env var`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/LD_TENNIS_ORG_ID/)
      expect(code).not.toMatch(/process\.env\.[A-Z_]*ORG_ID/)
    })
  }
})

describe('Events architecture containment — no payment dependency', () => {
  for (const file of ALL_NEW_SOURCE_FILES) {
    it(`${file} references no payment SDK/checkout/webhook code`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/stripe|paypal|square|checkout\.session|payment_intent/i)
    })
  }

  it('package.json has no new payment dependency', () => {
    const pkg = read('package.json')
    expect(pkg).not.toMatch(/"stripe"|"paypal"|"square"/i)
  })
})

describe('Events architecture containment — every route enforces auth via the shared gate', () => {
  for (const file of ROUTE_FILES) {
    it(`${file} calls authorizeEventsRequest before any handler logic`, () => {
      const code = stripComments(read(file))
      expect(code).toMatch(/authorizeEventsRequest\(/)
      // Never a bare, ungated exported handler that skips the gate.
      expect(code).toMatch(/from ['"]@\/lib\/events\/authorize['"]/)
    })

    it(`${file} never trusts a client-supplied organisation id`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/body\.organisation_id/)
      expect(code).not.toMatch(/body\.organisationId/)
      expect(code).not.toMatch(/searchParams\.get\(['"]organisation_id['"]\)/)
      expect(code).not.toMatch(/searchParams\.get\(['"]organisationId['"]\)/)
    })
  }

  it('lib/events/authorize.ts itself enforces session, capability, AND role — additively', () => {
    const code = stripComments(read('lib/events/authorize.ts'))
    expect(code).toMatch(/requireSession\(/)
    expect(code).toMatch(/requireCapability\(/)
    expect(code).toMatch(/roleGte\(/)
    expect(code).not.toMatch(/\bJOIN\b/i) // never collapses the two requireCapability lookups
  })
})

describe('Events architecture containment — no public/attendee-facing surface introduced', () => {
  it('no app/api/public/events route exists in Phase 1', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/api/public/events'))).toBe(false)
  })

  it('no app/(public)/events or app/e route exists in Phase 1', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/(public)/events'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'app/e'))).toBe(false)
  })

  it('middleware.ts was not modified to add a public /events entry — Phase 1 has no public route', () => {
    const code = stripComments(read('middleware.ts'))
    expect(code).not.toMatch(/['"]\/events['"]/)
  })

  for (const file of ROUTE_FILES) {
    it(`${file} contains no QR/check-in/attendee-facing endpoint logic`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/qrcode|checkin|check-in|attendee|ticket_token/i)
    })
  }
})

describe('Events architecture containment — no audit-log dependency', () => {
  for (const file of ALL_NEW_SOURCE_FILES) {
    it(`${file} does not write to audit_logs — deferred per the unresolved schema-drift dependency`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/audit_logs/i)
      expect(code).not.toMatch(/AuditLog/)
    })
  }
})

// SQL line comments ("-- ...") are where this repo's migration scripts
// document their own rollback instructions (e.g. "-- DROP TABLE IF
// EXISTS ...") — that documentation must not be mistaken for a live
// statement. Strip full-line/trailing "--" comments before asserting
// what the script actually EXECUTES.
function stripSqlLineComments(sql: string): string {
  return sql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
}

describe('Events architecture containment — schema additivity', () => {
  it('scripts/create-events.sql uses only additive, idempotent DDL', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).toMatch(/CREATE TABLE IF NOT EXISTS/)
    expect(live).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+organisations\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+users\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+modules\b/i)
    expect(live).not.toMatch(/\bALTER\s+TABLE\s+organisation_modules\b/i)
  })

  it('scripts/seed-events-capability.sql only inserts into modules, with an idempotent conflict guard', () => {
    const live = stripSqlLineComments(read('scripts/seed-events-capability.sql'))
    expect(live).toMatch(/INSERT INTO modules/)
    expect(live).toMatch(/ON CONFLICT \(key\) DO NOTHING/)
    expect(live).not.toMatch(/INSERT INTO organisation_modules/)
    expect(live).not.toMatch(/\bDROP\b/i)
    expect(live).not.toMatch(/\bUPDATE\b/i)
    expect(live).not.toMatch(/\bDELETE\b/i)
  })
})
