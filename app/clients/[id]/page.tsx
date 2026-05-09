import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import ClientWorkspace, { type Contact, type Lead, type Opportunity } from '@/components/clients/ClientWorkspace'

export const dynamic = 'force-dynamic'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export default async function ClientSpacePage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { redirect('/dashboard') }

  const { id: oid } = await params

  const orgs = await sql`SELECT id, name FROM organisations WHERE id = ${oid} LIMIT 1`
  if (!orgs[0]) notFound()
  const org = orgs[0] as { id: string; name: string }

  const [contacts, leads] = await Promise.all([
    sql`
      SELECT id, name, email, phone, status, address, age, program,
             session_times, next_action, last_contacted_at, created_at
      FROM contacts
      WHERE organisation_id = ${oid}
      ORDER BY
        CASE WHEN last_contacted_at IS NULL THEN 0 ELSE 1 END ASC,
        last_contacted_at ASC NULLS FIRST,
        created_at DESC
    `.catch(() => []),
    sql`
      SELECT id, name, email, phone, session_type, message, status, created_at
      FROM tennis_leads
      WHERE organisation_id = ${oid}
      ORDER BY created_at DESC
    `.catch(() => []),
  ])

  const now = Date.now()

  const opportunities: Opportunity[] = [
    {
      key: 'cold_leads',
      label: 'Leads going cold',
      description: 'Enquiries stuck in "new" for more than 3 days with no follow-up',
      items: (leads as Lead[])
        .filter(l => l.status === 'new' && (now - new Date(l.created_at).getTime()) > 3 * 86400000)
        .map(l => ({
          id: l.id, type: 'lead' as const, name: l.name,
          detail: `${Math.floor((now - new Date(l.created_at).getTime()) / 86400000)}d old · ${l.session_type ?? 'general enquiry'}`,
        })),
    },
    {
      key: 'no_followup',
      label: 'Contacts overdue for contact',
      description: 'Active or lead contacts not reached in 14+ days',
      items: (contacts as Contact[])
        .filter(c =>
          ['lead', 'contacted', 'active'].includes(c.status) &&
          (!c.last_contacted_at || (now - new Date(c.last_contacted_at).getTime()) > 14 * 86400000)
        )
        .map(c => ({
          id: c.id, type: 'contact' as const, name: c.name,
          detail: c.last_contacted_at
            ? `Last contact ${Math.floor((now - new Date(c.last_contacted_at).getTime()) / 86400000)}d ago`
            : 'Never contacted',
        })),
    },
    {
      key: 'no_next_action',
      label: 'No next action set',
      description: 'Active contacts missing a next action — easy wins to define',
      items: (contacts as Contact[])
        .filter(c => c.status === 'active' && !c.next_action)
        .map(c => ({
          id: c.id, type: 'contact' as const, name: c.name,
          detail: c.program ?? 'no program set',
        })),
    },
    {
      key: 'booked_upgrade',
      label: 'Booked leads to activate',
      description: 'Leads marked "booked" — consider moving them to active contacts',
      items: (leads as Lead[])
        .filter(l => l.status === 'booked')
        .map(l => ({
          id: l.id, type: 'lead' as const, name: l.name,
          detail: l.session_type ?? 'session booked',
        })),
    },
  ]

  return (
    <>
      <ClientBanner orgName={org.name} />
      <ClientWorkspace
        orgId={oid}
        contacts={contacts as Contact[]}
        leads={leads as Lead[]}
        opportunities={opportunities}
      />
    </>
  )
}

function ClientBanner({ orgName }: { orgName: string }) {
  return (
    <div style={{
      position: 'sticky', top: 52, zIndex: 90,
      background: 'rgba(99,102,241,.10)',
      borderBottom: '1px solid rgba(99,102,241,.20)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 24px', fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#818cf8', boxShadow: '0 0 8px rgba(129,140,248,.70)',
        }} />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', letterSpacing: '.01em' }}>Viewing</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd' }}>{orgName}</span>
      </div>
      <Link href="/clients" style={{
        fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.38)',
        textDecoration: 'none', letterSpacing: '.04em',
        padding: '3px 10px', borderRadius: 6,
        border: '1px solid rgba(255,255,255,.10)',
      }}>
        ← Exit to clients
      </Link>
    </div>
  )
}
