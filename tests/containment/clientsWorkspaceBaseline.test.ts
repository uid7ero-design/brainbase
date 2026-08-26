import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Clients 2.0 Phase B1 (F.7Y) — companion to clientsProductBaseline.test.ts.
// This file locks in the current ClientWorkspace tab UI and its mutation
// contracts (Contacts/Leads PATCH request shapes) and the current
// Opportunities derivation logic in app/clients/[id]/page.tsx, so Phase B2
// cannot accidentally remove or silently change any of them while adding
// the new Products/Implementations sections.
//
// Static source-text assertions — same established convention as
// clientsProductBaseline.test.ts and the rest of this repo's
// server-component/complex-client-component coverage (no jsdom/RTL
// harness). The Phase-A-fixed ID-cast contract on the two mutation
// routes is verified behaviourally in clientDataOrgIdCast.test.ts — this
// file only locks in that ClientWorkspace calls those exact routes with
// the exact expected body shape, not the routes' own internals.

const CLIENTS_DETAIL_PATH = path.resolve(__dirname, '../../app/clients/[id]/page.tsx')
const CLIENT_WORKSPACE_PATH = path.resolve(__dirname, '../../components/clients/ClientWorkspace.tsx')
const CONTACTS_ROUTE_PATH = path.resolve(__dirname, '../../app/api/admin/client-data/contacts/[id]/route.ts')
const LEADS_ROUTE_PATH = path.resolve(__dirname, '../../app/api/admin/client-data/leads/[id]/route.ts')

const CLIENTS_DETAIL_SOURCE = fs.readFileSync(CLIENTS_DETAIL_PATH, 'utf-8')
const CLIENT_WORKSPACE_SOURCE = fs.readFileSync(CLIENT_WORKSPACE_PATH, 'utf-8')
const CONTACTS_ROUTE_SOURCE = fs.readFileSync(CONTACTS_ROUTE_PATH, 'utf-8')
const LEADS_ROUTE_SOURCE = fs.readFileSync(LEADS_ROUTE_PATH, 'utf-8')

// ── E. Existing workspace tabs ────────────────────────────────────────────

describe('ClientWorkspace exposes exactly the existing Contacts/Leads/Opportunities tabs', () => {
  it('the Tab type still includes exactly these three tabs, in this order', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain("type Tab = 'contacts' | 'leads' | 'opportunities'")
  })

  it('the tab bar renders one button per tab, wired to the corresponding sub-component', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('contacts')")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('leads')")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('opportunities')")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("<ContactsTab      contacts={contacts}         orgId={orgId} />")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("<LeadsTab         leads={leads}               orgId={orgId} />")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("<OpportunitiesTab opportunities={opportunities} />")
  })

  it('no fourth tab (e.g. a placeholder Products/Implementations/Overview entry) has been added to the Tab union yet', () => {
    // Intentionally the B1 baseline — expected to change starting in B2.
    const tabTypeLine = CLIENT_WORKSPACE_SOURCE.split('\n').find(l => l.includes('type Tab ='))
    expect(tabTypeLine).toBeDefined()
    expect((tabTypeLine!.match(/'/g) ?? []).length).toBe(6) // 3 tab names × 2 quote marks
  })
})

// ── F. Contact mutation contract ────────────────────────────────────────

describe('Contact editing targets PATCH /api/admin/client-data/contacts/${id} with the orgId-bearing body', () => {
  it('ContactEditor.save() PATCHes the exact expected route with the row id in the URL', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('fetch(`/api/admin/client-data/contacts/${contact.id}`, {')
    expect(CLIENT_WORKSPACE_SOURCE).toContain("method: 'PATCH'")
  })

  it('the request body includes orgId alongside the full edited form', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('body: JSON.stringify({ orgId, ...form })')
  })

  it('the API route\'s row id remains ::uuid-cast (Phase A semantics preserved)', () => {
    expect(CONTACTS_ROUTE_SOURCE).toMatch(/id = \$\{id\}::uuid/)
  })

  it('the API route\'s organisation_id is NOT ::uuid-cast (Phase A fix preserved)', () => {
    expect(CONTACTS_ROUTE_SOURCE).not.toMatch(/organisation_id = \$\{body\.orgId\}::uuid/)
    expect(CONTACTS_ROUTE_SOURCE).toContain('organisation_id = ${body.orgId}')
  })

  it('the API route is still gated by requireRole(\'super_admin\'), independently of the page-level check', () => {
    expect(CONTACTS_ROUTE_SOURCE).toContain("await requireRole('super_admin')")
  })
})

// ── G. Lead mutation contract ───────────────────────────────────────────

describe('Lead status updates target PATCH /api/admin/client-data/leads/${id}, organisation-scoped', () => {
  it('LeadsTab.setStatus() PATCHes the exact expected route with the lead id in the URL', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('fetch(`/api/admin/client-data/leads/${lead.id}`, {')
    expect(CLIENT_WORKSPACE_SOURCE).toContain("method: 'PATCH'")
  })

  it('the request body sends orgId and the new status only', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('body: JSON.stringify({ orgId, status })')
  })

  it('the API route\'s row id remains ::uuid-cast (Phase A semantics preserved)', () => {
    expect(LEADS_ROUTE_SOURCE).toMatch(/id = \$\{id\}::uuid/)
  })

  it('the API route\'s organisation_id is NOT ::uuid-cast (Phase A fix preserved)', () => {
    expect(LEADS_ROUTE_SOURCE).not.toMatch(/organisation_id = \$\{orgId\}::uuid/)
    expect(LEADS_ROUTE_SOURCE).toContain('organisation_id = ${orgId}')
  })

  it('the API route is still gated by requireRole(\'super_admin\')', () => {
    expect(LEADS_ROUTE_SOURCE).toContain("await requireRole('super_admin')")
  })
})

// ── H. Opportunities current contract ───────────────────────────────────

describe('Opportunities derivation — current four categories/rules, as implemented in app/clients/[id]/page.tsx', () => {
  it('"cold_leads": leads with status new, older than 3 days, are flagged as "Leads going cold"', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("key: 'cold_leads'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("label: 'Leads going cold'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("l.status === 'new' && (now - new Date(l.created_at).getTime()) > 3 * 86400000")
  })

  it('"no_followup": contacts in lead/contacted/active status with no contact in 14+ days are flagged as "Contacts overdue for contact"', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("key: 'no_followup'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("label: 'Contacts overdue for contact'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("['lead', 'contacted', 'active'].includes(c.status)")
    expect(CLIENTS_DETAIL_SOURCE).toContain('(now - new Date(c.last_contacted_at).getTime()) > 14 * 86400000')
  })

  it('"no_next_action": active contacts with no next_action set are flagged as "No next action set"', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("key: 'no_next_action'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("label: 'No next action set'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("c.status === 'active' && !c.next_action")
  })

  it('"booked_upgrade": leads with status booked are flagged as "Booked leads to activate"', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("key: 'booked_upgrade'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("label: 'Booked leads to activate'")
    expect(CLIENTS_DETAIL_SOURCE).toContain("l.status === 'booked'")
  })

  it('exactly four opportunity categories exist — no fifth category has been added or one removed', () => {
    const keyMatches = CLIENTS_DETAIL_SOURCE.match(/key:\s*'(cold_leads|no_followup|no_next_action|booked_upgrade)'/g)
    expect(keyMatches).toHaveLength(4)
  })

  it('opportunities are computed from the already-fetched contacts/leads arrays, not a separate database query', () => {
    const oppBlockStart = CLIENTS_DETAIL_SOURCE.indexOf('const opportunities: Opportunity[] = [')
    const oppBlockEnd = CLIENTS_DETAIL_SOURCE.indexOf('\n  ]\n', oppBlockStart)
    const oppBlock = CLIENTS_DETAIL_SOURCE.slice(oppBlockStart, oppBlockEnd)
    expect(oppBlock).not.toMatch(/await sql`/)
  })

  it('the Opportunities tab itself remains read-only — no fetch/PATCH call exists inside OpportunitiesTab', () => {
    const tabStart = CLIENT_WORKSPACE_SOURCE.indexOf('function OpportunitiesTab(')
    const tabEnd = CLIENT_WORKSPACE_SOURCE.indexOf('\n// ── Root workspace', tabStart)
    const tabBlock = CLIENT_WORKSPACE_SOURCE.slice(tabStart, tabEnd)
    expect(tabBlock).not.toContain('fetch(')
  })
})
