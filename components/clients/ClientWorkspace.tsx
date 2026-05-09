'use client'

import { useState } from 'react'

const FONT = "var(--font-inter),-apple-system,sans-serif"

export type Contact = {
  id: string; name: string; email: string | null; phone: string | null
  status: string; address: string | null; age: string | null
  program: string | null; session_times: string | null; next_action: string | null
  last_contacted_at: string | null; created_at: string
}

export type Lead = {
  id: string; name: string; email: string; phone: string | null
  session_type: string | null; message: string | null; status: string; created_at: string
}

export type Opportunity = {
  key: string; label: string; description: string
  items: { id: string; name: string; detail: string; type: 'contact' | 'lead' }[]
}

type Tab = 'contacts' | 'leads' | 'opportunities'

// ── Styles ───────────────────────────────────────────────────────────────────

const CONTACT_STATUS: Record<string, { bg: string; color: string; border: string }> = {
  lead:      { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)' },
  contacted: { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.22)' },
  active:    { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)' },
  inactive:  { bg: 'rgba(113,113,122,.10)', color: '#a1a1aa', border: 'rgba(113,113,122,.22)' },
}

const LEAD_STATUS: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:       { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)',   label: 'New' },
  contacted: { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)',  label: 'Contacted' },
  booked:    { bg: 'rgba(167,139,250,.10)', color: '#c4b5fd', border: 'rgba(167,139,250,.22)', label: 'Booked' },
  closed:    { bg: 'rgba(113,113,122,.10)', color: '#a1a1aa', border: 'rgba(113,113,122,.22)', label: 'Closed' },
}

const LEAD_STATUS_ORDER = ['new', 'contacted', 'booked', 'closed']
const CONTACT_STATUS_ORDER = ['lead', 'contacted', 'active', 'inactive']

function badge(style: { bg: string; color: string; border: string }, label: string) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: style.bg, color: style.color, border: `1px solid ${style.border}`,
      letterSpacing: '.04em', textTransform: 'capitalize' as const, whiteSpace: 'nowrap' as const,
    }}>
      {label}
    </span>
  )
}

function inp(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 8, padding: '8px 11px', fontSize: 12, color: '#F5F7FA',
    outline: 'none', fontFamily: FONT, boxSizing: 'border-box', ...extra,
  }
}

function fieldLabel(label: string) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 4 }}>
      {label}
    </div>
  )
}

function ago(ts: string | null) {
  if (!ts) return 'Never'
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

// ── Contact editor ────────────────────────────────────────────────────────────

function ContactEditor({ contact, orgId, onSave, onClose }: {
  contact: Contact; orgId: string
  onSave: (c: Contact) => void; onClose: () => void
}) {
  const [form, setForm] = useState({ ...contact })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(field: keyof Contact, value: string | null) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true); setErr('')
    const res = await fetch(`/api/admin/client-data/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, ...form }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setErr(data.error ?? 'Save failed'); return }
    onSave(data.contact)
  }

  const panelStyle: React.CSSProperties = {
    background: 'rgba(15,15,22,1)', border: '1px solid rgba(255,255,255,.10)',
    borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
    fontFamily: FONT,
  }

  const row2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA' }}>{contact.name}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.35)', fontSize: 16, padding: 0 }}>✕</button>
      </div>

      <div>
        {fieldLabel('Name')}
        <input style={inp()} value={form.name} onChange={e => set('name', e.target.value)} />
      </div>
      <div style={row2}>
        <div>
          {fieldLabel('Email')}
          <input style={inp()} type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value || null)} />
        </div>
        <div>
          {fieldLabel('Phone')}
          <input style={inp()} type="tel" value={form.phone ?? ''} onChange={e => set('phone', e.target.value || null)} />
        </div>
      </div>
      <div style={row2}>
        <div>
          {fieldLabel('Status')}
          <select style={{ ...inp(), cursor: 'pointer' }} value={form.status} onChange={e => set('status', e.target.value)}>
            {CONTACT_STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          {fieldLabel('Age')}
          <input style={inp()} value={form.age ?? ''} onChange={e => set('age', e.target.value || null)} />
        </div>
      </div>
      <div>
        {fieldLabel('Program')}
        <input style={inp()} value={form.program ?? ''} onChange={e => set('program', e.target.value || null)} placeholder="e.g. Adult beginner, Junior squad…" />
      </div>
      <div>
        {fieldLabel('Session times')}
        <input style={inp()} value={form.session_times ?? ''} onChange={e => set('session_times', e.target.value || null)} placeholder="e.g. Tues 6pm, Sat 9am…" />
      </div>
      <div>
        {fieldLabel('Next action')}
        <input style={inp()} value={form.next_action ?? ''} onChange={e => set('next_action', e.target.value || null)} placeholder="e.g. Call to book trial, Send schedule…" />
      </div>
      <div>
        {fieldLabel('Address')}
        <input style={inp()} value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} />
      </div>

      {err && <p style={{ fontSize: 11, color: '#f87171', margin: 0 }}>{err}</p>}

      <button onClick={save} disabled={saving || !form.name.trim()}
        style={{
          width: '100%', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.40)',
          color: '#a5b4fc', cursor: saving ? 'default' : 'pointer', fontFamily: FONT,
          opacity: saving || !form.name.trim() ? .5 : 1,
        }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

// ── Contacts tab ──────────────────────────────────────────────────────────────

function ContactsTab({ contacts: initial, orgId }: { contacts: Contact[]; orgId: string }) {
  const [contacts, setContacts] = useState(initial)
  const [selected, setSelected] = useState<Contact | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const filtered = contacts.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)
  })

  function handleSave(updated: Contact) {
    setContacts(cs => cs.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    setSelected(s => s?.id === updated.id ? { ...s, ...updated } : s)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 360px' : '1fr', gap: 14 }}>
      {/* List */}
      <div>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            style={{ ...inp(), flex: 1, fontSize: 12 }}
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ ...inp({ width: 'auto', paddingRight: 28 }), cursor: 'pointer', fontSize: 12 }}>
            <option value="all">All statuses</option>
            {CONTACT_STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 12 }}>
            {search || filterStatus !== 'all' ? 'No contacts match your filters.' : 'No contacts yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map(c => {
              const st = CONTACT_STATUS[c.status] ?? CONTACT_STATUS.lead
              const isActive = selected?.id === c.id
              return (
                <div key={c.id} onClick={() => setSelected(isActive ? null : c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
                    background: isActive ? 'rgba(99,102,241,.12)' : 'rgba(255,255,255,.025)',
                    border: `1px solid ${isActive ? 'rgba(99,102,241,.30)' : 'rgba(255,255,255,.07)'}`,
                    transition: 'background .12s',
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[c.email, c.phone].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {c.next_action && (
                      <span style={{ fontSize: 10, color: 'rgba(251,191,36,.70)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        → {c.next_action}
                      </span>
                    )}
                    {badge(st, c.status)}
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.20)', width: 52, textAlign: 'right' }}>
                      {ago(c.last_contacted_at)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Editor panel */}
      {selected && (
        <ContactEditor
          key={selected.id}
          contact={selected}
          orgId={orgId}
          onSave={handleSave}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ── Leads tab ─────────────────────────────────────────────────────────────────

function LeadsTab({ leads: initial, orgId }: { leads: Lead[]; orgId: string }) {
  const [leads, setLeads] = useState(initial)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function setStatus(lead: Lead, status: string) {
    setUpdating(lead.id)
    const res = await fetch(`/api/admin/client-data/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, status }),
    })
    setUpdating(null)
    if (res.ok) setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status } : l))
  }

  if (leads.length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 12 }}>No leads yet.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {leads.map(lead => {
        const st = LEAD_STATUS[lead.status] ?? LEAD_STATUS.new
        const isExpanded = expanded === lead.id
        const date = new Date(lead.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

        return (
          <div key={lead.id} style={{
            background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
            borderRadius: 10, overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer' }}
              onClick={() => setExpanded(isExpanded ? null : lead.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2 }}>
                  {lead.email}{lead.session_type ? ` · ${lead.session_type}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.22)', flexShrink: 0 }}>{date}</span>
              {badge(st, st.label)}
            </div>

            {isExpanded && (
              <div style={{
                borderTop: '1px solid rgba(255,255,255,.06)',
                padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                {lead.message && (
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', margin: 0, lineHeight: 1.6 }}>{lead.message}</p>
                )}
                {lead.phone && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>📞 {lead.phone}</div>
                )}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 6 }}>
                    Move to
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {LEAD_STATUS_ORDER.filter(s => s !== lead.status).map(s => {
                      const sty = LEAD_STATUS[s]
                      return (
                        <button key={s} onClick={() => setStatus(lead, s)} disabled={updating === lead.id}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                            background: sty.bg, color: sty.color, border: `1px solid ${sty.border}`,
                            fontFamily: FONT, opacity: updating === lead.id ? .5 : 1,
                          }}>
                          {sty.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Opportunities tab ─────────────────────────────────────────────────────────

function OpportunitiesTab({ opportunities }: { opportunities: Opportunity[] }) {
  const nonempty = opportunities.filter(o => o.items.length > 0)

  if (nonempty.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 12 }}>
        No opportunities flagged — everything looks healthy.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {nonempty.map(opp => (
        <div key={opp.key} style={{
          background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,189,36,.12)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>
              {opp.key === 'cold_leads' ? '🔥' : opp.key === 'no_followup' ? '📋' : opp.key === 'no_next_action' ? '⚡' : '👀'}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>{opp.label}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 1 }}>{opp.description}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>{opp.items.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {opp.items.map((item, i) => (
              <div key={item.id} style={{
                padding: '10px 18px', fontSize: 12,
                borderBottom: i < opp.items.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ flex: 1, color: '#F5F7FA', fontWeight: 500 }}>{item.name}</span>
                <span style={{ color: 'rgba(255,255,255,.35)', flexShrink: 0 }}>{item.detail}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.06em', padding: '2px 7px', borderRadius: 20,
                  background: item.type === 'contact' ? 'rgba(59,130,246,.12)' : 'rgba(34,197,94,.12)',
                  color: item.type === 'contact' ? '#60a5fa' : '#4ade80',
                  border: `1px solid ${item.type === 'contact' ? 'rgba(59,130,246,.25)' : 'rgba(34,197,94,.25)'}`,
                  textTransform: 'uppercase',
                }}>
                  {item.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Root workspace ────────────────────────────────────────────────────────────

export default function ClientWorkspace({ orgId, contacts, leads, opportunities }: {
  orgId: string
  contacts: Contact[]
  leads: Lead[]
  opportunities: Opportunity[]
}) {
  const [tab, setTab] = useState<Tab>('contacts')

  const tabStyle = (t: Tab): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer', fontFamily: FONT, transition: 'background .12s',
    background: tab === t ? 'rgba(99,102,241,.22)' : 'transparent',
    color: tab === t ? '#a5b4fc' : 'rgba(255,255,255,.38)',
  })

  const counts = {
    contacts:      contacts.length,
    leads:         leads.length,
    opportunities: opportunities.filter(o => o.items.length > 0).length,
  }

  function label(t: Tab, name: string) {
    const n = counts[t]
    return `${name}${n > 0 ? ` (${n})` : ''}`
  }

  return (
    <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', padding: '24px 24px 64px', fontFamily: FONT }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        background: 'rgba(255,255,255,.03)',
        border: '1px solid rgba(255,255,255,.07)',
        borderRadius: 12, padding: 4, alignSelf: 'flex-start', width: 'fit-content',
      }}>
        <button style={tabStyle('contacts')}      onClick={() => setTab('contacts')}>      {label('contacts', 'Contacts')}      </button>
        <button style={tabStyle('leads')}         onClick={() => setTab('leads')}>         {label('leads', 'Leads')}            </button>
        <button style={tabStyle('opportunities')} onClick={() => setTab('opportunities')}> {label('opportunities', 'Opportunities')}</button>
      </div>

      {tab === 'contacts'      && <ContactsTab      contacts={contacts}         orgId={orgId} />}
      {tab === 'leads'         && <LeadsTab         leads={leads}               orgId={orgId} />}
      {tab === 'opportunities' && <OpportunitiesTab opportunities={opportunities} />}
    </div>
  )
}
