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

// Block-scoped extraction of a single `model X { ... }` body from
// schema.prisma — mirrors the block-scoped source-slicing idiom already
// established by tests/containment/orgCapabilityAdmin.test.ts, to avoid
// a whole-file false positive (e.g. matching a comment mentioning
// "EventSession" from inside an unrelated model).
function extractPrismaModel(schemaSrc: string, modelName: string): string {
  const start = schemaSrc.indexOf(`model ${modelName} {`)
  if (start === -1) throw new Error(`model ${modelName} not found in schema.prisma`)
  const end = schemaSrc.indexOf('\n}', start)
  if (end === -1) throw new Error(`closing brace for model ${modelName} not found`)
  return schemaSrc.slice(start, end)
}

// R2 remediation 1 — Prisma/SQL status-column parity. Independent
// review (Phase 1-R1 final review) found Event.status declared as a
// genuine Prisma `enum`, implying a native Postgres enum type, while
// the live SQL column is TEXT + CHECK. This proves the three-way
// contract (Prisma type, SQL column type/CHECK vocabulary, and the
// application's own EVENT_STATUSES list) all agree, and specifically
// fails if Event.status is ever reverted to a Prisma enum while the SQL
// column stays TEXT (mutation A from the R2 remediation brief).
describe('Events architecture containment — Event.status Prisma/SQL parity (R2)', () => {
  it('Event.status is a plain Prisma String (not a native-enum-implying Prisma enum), defaulting to "DRAFT"', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const eventBlock = extractPrismaModel(schemaSrc, 'Event')
    expect(eventBlock).toMatch(/status\s+String\s+@default\("DRAFT"\)/)
    // No lingering reference to a dedicated Prisma enum type for status —
    // if `status EventStatus` (or any other custom enum identifier)
    // reappears, this fails.
    expect(eventBlock).not.toMatch(/status\s+[A-Z]\w*\s+@default\(\s*[A-Z]/)
  })

  it('no Events-specific Prisma enum block exists in schema.prisma', () => {
    const schemaSrc = read('prisma/schema.prisma')
    expect(schemaSrc).not.toMatch(/enum\s+EventStatus\s*\{/)
  })

  it('scripts/create-events.sql keeps events.status as TEXT + CHECK, matching the same DRAFT default and three-value vocabulary', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).toMatch(
      /status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'DRAFT'\s+CHECK\s*\(status IN \('DRAFT',\s*'PUBLISHED',\s*'CANCELLED'\)\)/,
    )
    expect(live).not.toMatch(/CREATE TYPE\s+\S*status/i)
  })

  it("the SQL CHECK vocabulary matches lib/events/validation.ts's EVENT_STATUSES exactly", () => {
    const validationSrc = read('lib/events/validation.ts')
    expect(validationSrc).toMatch(/EVENT_STATUSES = \['DRAFT', 'PUBLISHED', 'CANCELLED'\] as const/)
  })
})

// R2 remediation 5 (schema half) — protects the composite tenant-
// integrity FK the whole Phase 1 design rests on. Independent review
// found this had zero test coverage of any kind. Fails on mutations G/H
// from the R2 remediation brief (event-session or ticket-type composite
// FK replaced by a single-column event_id-only FK), on either the
// Prisma or the SQL side.
describe('Events architecture containment — composite tenant-integrity FK protection (R2)', () => {
  it('events has a UNIQUE(id, organisation_id) constraint backing the composite FK (Prisma)', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const eventBlock = extractPrismaModel(schemaSrc, 'Event')
    expect(eventBlock).toMatch(/@@unique\(\[id, organisation_id\]\)/)
  })

  it('events has a UNIQUE(id, organisation_id) constraint backing the composite FK (SQL)', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).toMatch(/UNIQUE\s*\(id,\s*organisation_id\)/)
  })

  it('EventSession.event relation is a composite FK on [event_id, organisation_id] -> Event[id, organisation_id] (Prisma)', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const sessionBlock = extractPrismaModel(schemaSrc, 'EventSession')
    expect(sessionBlock).toMatch(
      /@relation\(fields:\s*\[event_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/,
    )
  })

  it('EventTicketType.event relation is a composite FK on [event_id, organisation_id] -> Event[id, organisation_id] (Prisma)', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const ticketTypeBlock = extractPrismaModel(schemaSrc, 'EventTicketType')
    expect(ticketTypeBlock).toMatch(
      /@relation\(fields:\s*\[event_id,\s*organisation_id\],\s*references:\s*\[id,\s*organisation_id\]/,
    )
  })

  it('event_sessions has a composite FK on (event_id, organisation_id) -> events (id, organisation_id) (SQL) — column order matters for Postgres', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).toMatch(
      /FOREIGN KEY \(event_id, organisation_id\)\s*\n\s*REFERENCES events \(id, organisation_id\)/,
    )
  })

  it('event_ticket_types has a composite FK on (event_id, organisation_id) -> events (id, organisation_id) (SQL) — column order matters for Postgres', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    // Two composite FKs of this exact shape must exist (event_sessions
    // and event_ticket_types) — a single match would mean one table
    // silently reverted to a single-column FK.
    const matches = live.match(/FOREIGN KEY \(event_id, organisation_id\)\s*\n\s*REFERENCES events \(id, organisation_id\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2)
  })

  it('neither child table has a single-column event_id-only foreign key instead of the composite one', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    // A bare `FOREIGN KEY (event_id) REFERENCES events (id)` (no
    // organisation_id) would be the exact regression mutations G/H
    // describe — must never appear.
    expect(live).not.toMatch(/FOREIGN KEY \(event_id\)\s*\n?\s*REFERENCES events \(id\)/)
  })
})

// R2 remediation 6 (schema half) — protects the per-organisation slug
// uniqueness contract. Independent review found this had no test
// verifying the DB constraint's existence. Fails on mutation I from the
// R2 remediation brief (the (organisation_id, slug) uniqueness removed).
describe('Events architecture containment — slug uniqueness protection (R2)', () => {
  it('Event has an organisation-scoped unique slug constraint (Prisma)', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const eventBlock = extractPrismaModel(schemaSrc, 'Event')
    expect(eventBlock).toMatch(/@@unique\(\[organisation_id, slug\]\)/)
  })

  it('events has a UNIQUE(organisation_id, slug) constraint (SQL)', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).toMatch(/UNIQUE\s*\(organisation_id,\s*slug\)/)
  })

  it('slug uniqueness is not global — no bare UNIQUE(slug) constraint exists', () => {
    const live = stripSqlLineComments(read('scripts/create-events.sql'))
    expect(live).not.toMatch(/UNIQUE\s*\(slug\)/)
  })
})

// Extracts the body of the Nth `async function remove(` in a source
// file, up to its closing `  }` — this repo has no jsdom/React Testing
// Library harness (see vitest.config.ts / CLAUDE.md's documented
// testing architecture), so behavioral component rendering isn't
// available without disproportionate new test infrastructure; a
// block-scoped static source check (the established idiom for avoiding
// whole-file false positives) is the lightweight equivalent for this UI
// fix.
function extractRemoveFunctionBody(src: string, occurrence: 0 | 1): string {
  let searchFrom = 0
  let start = -1
  for (let i = 0; i <= occurrence; i++) {
    start = src.indexOf('async function remove(', searchFrom)
    if (start === -1) throw new Error(`"async function remove(" occurrence ${i} not found`)
    searchFrom = start + 1
  }
  const end = src.indexOf('\n  }\n', start)
  if (end === -1) throw new Error('closing brace for remove() not found')
  return src.slice(start, end)
}

// R2 remediation 8 — independent review found SessionsPanel.remove()/
// TicketTypesPanel.remove() reloaded unconditionally after DELETE
// without checking res.ok, silently treating a failed delete as a
// success. Fixed by checking res.ok and surfacing a user-facing error
// via the panel's own error-state pattern instead of reloading.
describe('EventDetailClient — delete error handling (R2 remediation 8)', () => {
  it("SessionsPanel.remove() checks res.ok and surfaces an error instead of reloading on failure", () => {
    const code = read('app/events/[id]/EventDetailClient.tsx')
    const removeBody = extractRemoveFunctionBody(code, 0) // SessionsPanel is defined first
    expect(removeBody).toMatch(/if\s*\(!res\.ok\)/)
    expect(removeBody).toMatch(/setDeleteError/)
    // onChanged() (the reload trigger) must be reachable only outside/
    // after the !res.ok early-return branch, not unconditionally.
    const okBranchIndex = removeBody.indexOf('if (!res.ok)')
    const onChangedIndex = removeBody.indexOf('onChanged()')
    expect(onChangedIndex).toBeGreaterThan(okBranchIndex)
  })

  it("TicketTypesPanel.remove() checks res.ok and surfaces an error instead of reloading on failure", () => {
    const code = read('app/events/[id]/EventDetailClient.tsx')
    const removeBody = extractRemoveFunctionBody(code, 1) // TicketTypesPanel is defined second
    expect(removeBody).toMatch(/if\s*\(!res\.ok\)/)
    expect(removeBody).toMatch(/setDeleteError/)
    const okBranchIndex = removeBody.indexOf('if (!res.ok)')
    const onChangedIndex = removeBody.indexOf('onChanged()')
    expect(onChangedIndex).toBeGreaterThan(okBranchIndex)
  })
})
