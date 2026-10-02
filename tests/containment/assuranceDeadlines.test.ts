import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  DUE_SOON_DAYS, ESCALATION_TRANSITIONS, EXTENSION_STATUSES, ESCALATION_STATUSES, ESCALATION_LEVEL_MAX,
  deadlineUrgency, isExtended, safeTimeZone,
} from '@/lib/assurance/deadlineRules'

// Deadlines — structural guards (this repo's containment-test convention).
// Behaviour is proven against real Postgres in
// scripts/tests/assuranceDeadlines.integration.test.ts.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const A01C = read('scripts/create-assurance-core-a01c.sql')

const ROUTES = [
  ['app/api/assurance/timeframes/[id]/extensions/route.ts', 'record', 'requestExtension(viewer, id, body)'],
  ['app/api/assurance/timeframes/[id]/escalations/route.ts', 'record', 'raiseEscalation(viewer, id, body)'],
  ['app/api/assurance/extensions/[id]/approve/route.ts', 'administer', "decideExtension(viewer, id, body, 'approve')"],
  ['app/api/assurance/extensions/[id]/reject/route.ts', 'administer', "decideExtension(viewer, id, body, 'reject')"],
  ['app/api/assurance/extensions/[id]/cancel/route.ts', 'record', 'cancelExtension(viewer, id, body)'],
  ['app/api/assurance/escalations/[id]/acknowledge/route.ts', 'record', "transitionEscalation(viewer, id, body, 'acknowledge')"],
  ['app/api/assurance/escalations/[id]/resolve/route.ts', 'record', "transitionEscalation(viewer, id, body, 'resolve')"],
  ['app/api/assurance/escalations/[id]/cancel/route.ts', 'record', "transitionEscalation(viewer, id, body, 'cancel')"],
] as const

describe('rules mirror the A0.1C schema', () => {
  it('extension and escalation statuses match the CHECK constraints exactly', () => {
    const list = (c: string) => A01C.match(new RegExp(`${c}\\s+CHECK \\(status IN \\(([^)]*)\\)`))![1].split(',').map(s => s.trim().replace(/'/g, ''))
    expect([...EXTENSION_STATUSES]).toEqual(list('assurance_timeframe_extensions_status_check'))
    expect([...ESCALATION_STATUSES]).toEqual(list('assurance_escalations_status_check'))
    expect(A01C).toMatch(/CHECK \(escalation_level >= 1\)/)
    expect(ESCALATION_LEVEL_MAX).toBeGreaterThanOrEqual(1)
  })
  it('escalation transitions are exactly the documented ones and never leave a terminal status', () => {
    expect(ESCALATION_TRANSITIONS).toEqual({
      acknowledge: { from: ['OPEN'], to: 'ACKNOWLEDGED' },
      resolve: { from: ['ACKNOWLEDGED'], to: 'RESOLVED' },
      cancel: { from: ['OPEN', 'ACKNOWLEDGED'], to: 'CANCELLED' },
    })
  })
  it('original_due_at is immutable at DB level (trigger exists in A0.1C)', () => {
    expect(A01C).toMatch(/CREATE TRIGGER trg_assurance_timeframes_original_due_at_immutable\s+BEFORE UPDATE OF original_due_at ON assurance_timeframes/)
  })
})

describe('urgency (pure)', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  it('overdue / due soon / on track / closed', () => {
    expect(deadlineUrgency('2026-10-01T23:59:00Z', true, now)).toBe('OVERDUE')
    expect(deadlineUrgency('2026-10-04T23:59:00Z', true, now)).toBe('DUE_SOON')
    expect(deadlineUrgency(new Date(now.getTime() + DUE_SOON_DAYS * 864e5), true, now)).toBe('ON_TRACK')
    expect(deadlineUrgency('2026-09-01T00:00:00Z', false, now)).toBe('CLOSED')
    expect(deadlineUrgency(null, true, now)).toBe('CLOSED')
  })
  it('extended compares instants; timezone falls back safely', () => {
    expect(isExtended('2026-10-02T13:29:00.000Z', '2026-10-02T13:29:00Z')).toBe(false)
    expect(isExtended('2026-10-02T13:29:00Z', '2026-10-09T13:29:00Z')).toBe(true)
    expect(safeTimeZone(null)).toBe('Australia/Adelaide')
    expect(safeTimeZone('Australia/Perth')).toBe('Australia/Perth')
    expect(safeTimeZone('Not/AZone')).toBe('Australia/Adelaide')
  })
  it('rules module is client-safe (zero imports)', () => {
    expect(stripComments(read('lib/assurance/deadlineRules.ts'))).not.toMatch(/^\s*import\s/m)
  })
})

describe('routes and permissions', () => {
  it('each deadline route is a POST from the id factory with the intended operation floor, no other methods, no posted org', () => {
    for (const [file, op, call] of ROUTES) {
      const src = stripComments(read(file))
      expect(src, file).toContain(`export const POST = assurancePostWithId('${op}', (viewer, id, body) => ${call}`)
      expect(src, file).not.toMatch(/export (const|async function|function) (GET|PUT|PATCH|DELETE)/)
      expect(src, file).not.toMatch(/organisation_?[iI]d/)
    }
  })
  it('the service re-checks the operation floor on every mutation and refuses self-decision', () => {
    const src = stripComments(read('lib/assurance/deadlines.ts'))
    const body = (fn: string) => src.slice(src.indexOf(`export async function ${fn}(`), src.indexOf(`export async function ${fn}(`) + 600)
    expect(body('requestExtension')).toMatch(/viewerCan\(viewer, 'record'\)/)
    expect(body('decideExtension')).toMatch(/viewerCan\(viewer, 'administer'\)/)
    expect(body('decideExtension')).toMatch(/ext\.requested_by === viewer\.userId/)
    expect(body('cancelExtension')).toMatch(/viewerCan\(viewer, 'record'\)/)
    expect(body('raiseEscalation')).toMatch(/viewerCan\(viewer, 'record'\)/)
    expect(body('transitionEscalation')).toMatch(/viewerCan\(viewer, 'record'\)/)
  })
})

describe('data safety', () => {
  const src = stripComments(read('lib/assurance/deadlines.ts'))
  it('never writes original_due_at, never deletes, never changes timeframe status or the parent record', () => {
    expect(src).not.toMatch(/SET[^;]*original_due_at\s*=/i)
    expect(src).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(src).not.toMatch(/UPDATE assurance_timeframes[\s\S]{0,80}SET[^`]*\bstatus\s*=/)
    expect(src).not.toMatch(/UPDATE\s+assurance_(findings|actions)\b/i)
    // the only timeframe write is current_due_at, from an APPROVED extension
    expect(src.match(/UPDATE assurance_timeframes/g)).toHaveLength(1)
    expect(src).toMatch(/UPDATE assurance_timeframes t SET current_due_at = x\.approved_due_at, updated_at = now\(\)/)
  })
  it('every mutation locks the timeframe first, then writes change + audit in one guarded statement', () => {
    for (const fn of ['requestExtension', 'decideExtension', 'cancelExtension', 'raiseEscalation', 'transitionEscalation']) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`))
      const next = body.indexOf('\nexport async function ', 10)
      const own = next > 0 ? body.slice(0, next) : body
      const tx = own.match(/sql\.transaction\(\[/g)?.length ?? 0
      expect(tx, fn).toBeGreaterThanOrEqual(1)
      expect(own.match(/lockTimeframe\(org, tf\.id\)/g)?.length, fn).toBe(tx)
      expect(own.match(/INSERT INTO audit_logs/g)?.length, fn).toBe(tx)
    }
    expect(src).toMatch(/FROM assurance_timeframes WHERE organisation_id = \$\{organisationId\} AND id = \$\{id\}::uuid FOR UPDATE/)
  })
  it('audit actions use the established <resource>.<verb> naming', () => {
    for (const a of ['assurance_timeframe.extension_requested', 'assurance_timeframe.extension_approved', 'assurance_timeframe.extension_rejected',
      'assurance_timeframe.extension_cancelled', 'assurance_escalation.created']) {
      expect(src).toContain(`'${a}'`)
    }
    expect(src).toMatch(/assurance_escalation\.\$\{rule\.to === 'ACKNOWLEDGED' \? 'acknowledged' : rule\.to === 'RESOLVED' \? 'resolved' : 'cancelled'\}/)
    expect(read('lib/assurance/audit.ts')).toMatch(/'assurance_timeframe'\s*\|\s*'assurance_escalation'/)
  })
  it('free-text reasons and notes are not copied into audit payloads', () => {
    for (const m of src.matchAll(/INSERT INTO audit_logs[\s\S]*?FROM (ins|x|upd)/g)) {
      expect(m[0]).not.toMatch(/\$\{(reason|notes)\}|'reason'|'notes'|decision_notes/)
    }
  })
  it('escalation writes are guarded on the exact status the caller saw', () => {
    expect(src).toMatch(/AND e\.status = \$\{esc\.status\}::text/)
  })
  it('no organisation-wide SLA / policy configuration or automatic escalation was introduced', () => {
    expect(src).not.toMatch(/sla|policy_|auto_?escalat|cron/i)
    const all = ['lib/assurance', 'app/api/assurance'].flatMap(d => fs.readdirSync(path.join(ROOT, d), { recursive: true }) as string[])
    expect(all.filter(f => /cron|schedule/i.test(String(f)))).toEqual([])
  })
})

describe('shared due-soon / overdue definition', () => {
  it('the dashboard and Deadlines use the same SQL helpers; no duplicated literals remain', () => {
    const dash = read('lib/assurance/dashboard.ts')
    expect(dash).toMatch(/import \{ dueSoonCutoffSql, timeframeRunningSql \} from '\.\/deadlineSql'/)
    expect(dash).not.toMatch(/interval '3 days'/)
    expect(dash).not.toMatch(/t\.status IN \('ACTIVE', 'OVERDUE'\)/)
    const helper = read('lib/assurance/deadlineSql.ts')
    expect(helper).toMatch(/now\(\) \+ interval '3 days'/)
    expect(read('lib/assurance/deadlines.ts')).toMatch(/dueSoonCutoffSql\(\)/)
    expect(DUE_SOON_DAYS).toBe(3)
  })
})

describe('UI wiring', () => {
  it('Deadlines is a first-class nav destination (not under Settings) and has help + a work instruction', () => {
    const nav = read('app/assurance/_components/AssuranceSidebar.tsx')
    expect(nav).toMatch(/\{ href: '\/assurance\/actions', label: 'Actions' \},\n\s+\{ href: '\/assurance\/deadlines', label: 'Deadlines' \},/)
    expect(fs.existsSync(path.join(ROOT, 'app/assurance/deadlines/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'app/assurance/settings/deadlines'))).toBe(false)
    expect(read('lib/assurance/help/topics.ts')).toMatch(/deadlines: \{ slug: 'manage-deadlines'/)
    expect(read('lib/assurance/help/registry.ts')).toMatch(/file: 'work-instructions\/13-manage-deadlines\.md'/)
  })
  it('finding and action detail pages render the Deadline section in the organisation timezone', () => {
    for (const [p, kind] of [['app/assurance/findings/[id]/page.tsx', 'finding'], ['app/assurance/actions/[id]/page.tsx', 'action']]) {
      const src = read(p)
      expect(src, p).toMatch(new RegExp(`listRecordTimeframes\\(viewer, '${kind}', id\\)`))
      expect(src, p).toMatch(/<Section title="Deadline" count=\{timeframes\.length\} id="deadline">/)
      expect(src, p).toMatch(/getAssuranceTimeZone\(viewer\.organisationId\)/)
    }
  })
  it('the empty state does not imply organisation-wide rules', () => {
    const page = read('app/assurance/deadlines/page.tsx')
    expect(page).toContain('No active Assurance deadlines.')
    expect(page).toContain('There are no organisation-wide deadline rules.')
  })
  it('docs no longer say extensions are unavailable', () => {
    expect(read('docs/assurance/user-guide.md')).not.toMatch(/extensions cannot be requested or approved/i)
    expect(read('docs/assurance/admin-guide.md')).not.toMatch(/cannot be requested or approved in the UI/)
  })
})
