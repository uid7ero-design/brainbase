'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import {
  Badge,
  Field,
  FormActions,
  FormError,
  SlidePanel,
  StatusDot,
  buttonProps,
  fieldControlClassName,
  type SemanticState,
} from '@/components/ui/app'
import styles from './ClientWorkspace.module.css'

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

export type PlatformModule = { key: string; name: string; description: string | null }

export type Implementation = {
  id: string; name: string; service_type: string | null
  stage: string; health: string; next_action: string | null
  target_launch_date: string | null; actual_launch_date: string | null
}

// BrainBase account-user visibility — who has access to this account.
// Never the tenant's own CRM/coaching contacts.
export type Person = {
  id: string; name: string; email: string | null; role: string; last_login_at: string | null
}

type Tab = 'contacts' | 'leads' | 'opportunities'
const TAB_ORDER: Tab[] = ['contacts', 'leads', 'opportunities']

// ── Status vocabulary ────────────────────────────────────────────────────────
//
// Each status keeps its own meaning, expressed through the shared semantic
// states (colour + shape + visible text) so it reads in light and dark.

const CONTACT_STATUS: Record<string, SemanticState> = {
  lead:      'info',
  contacted: 'warning',
  active:    'success',
  inactive:  'inactive',
}

const LEAD_STATUS: Record<string, { state: SemanticState; label: string }> = {
  new:       { state: 'info',     label: 'New' },
  contacted: { state: 'warning',  label: 'Contacted' },
  booked:    { state: 'success',  label: 'Booked' },
  closed:    { state: 'inactive', label: 'Closed' },
}

const LEAD_STATUS_ORDER = ['new', 'contacted', 'booked', 'closed']
const CONTACT_STATUS_ORDER = ['lead', 'contacted', 'active', 'inactive']

// Mirrors app/admin/implementations/page.tsx's own STAGE_LABEL/HEALTH_META
// exactly, so an implementation reads identically whether viewed here or
// in the canonical admin tool.
const STAGE_LABEL: Record<string, string> = {
  planning: 'Planning', discovery: 'Discovery', setup: 'Setup', build: 'Build',
  client_review: 'Client Review', testing: 'Testing', ready_to_launch: 'Ready to Launch',
  live: 'Live', on_hold: 'On Hold', cancelled: 'Cancelled',
}
const HEALTH_META: Record<string, { label: string; state: SemanticState }> = {
  on_track: { label: 'On Track', state: 'success' },
  at_risk:  { label: 'At Risk',  state: 'warning' },
  blocked:  { label: 'Blocked',  state: 'error' },
}

function ago(ts: string | null) {
  if (!ts) return 'Never'
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

// ── Contact editor ────────────────────────────────────────────────────────────
//
// Opens in the shared SlidePanel: role="dialog", aria-modal, labelled by the
// contact's name, Escape / × / scrim close, focus trapped and returned.

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

  return (
    <SlidePanel open onClose={onClose} title={contact.name}>
      <div className={styles.editor}>
        <Field label="Name">
          {c => <input {...c} className={fieldControlClassName} value={form.name} onChange={e => set('name', e.target.value)} />}
        </Field>
        <div className={styles.row2}>
          <Field label="Email">
            {c => <input {...c} className={fieldControlClassName} type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value || null)} />}
          </Field>
          <Field label="Phone">
            {c => <input {...c} className={fieldControlClassName} type="tel" value={form.phone ?? ''} onChange={e => set('phone', e.target.value || null)} />}
          </Field>
        </div>
        <div className={styles.row2}>
          <Field label="Status">
            {c => (
              <select {...c} className={fieldControlClassName} value={form.status} onChange={e => set('status', e.target.value)}>
                {CONTACT_STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </Field>
          <Field label="Age">
            {c => <input {...c} className={fieldControlClassName} value={form.age ?? ''} onChange={e => set('age', e.target.value || null)} />}
          </Field>
        </div>
        <Field label="Program">
          {c => <input {...c} className={fieldControlClassName} value={form.program ?? ''} onChange={e => set('program', e.target.value || null)} placeholder="e.g. Service or programme name" />}
        </Field>
        <Field label="Session times">
          {c => <input {...c} className={fieldControlClassName} value={form.session_times ?? ''} onChange={e => set('session_times', e.target.value || null)} placeholder="e.g. Tuesday 6:00 pm" />}
        </Field>
        <Field label="Next action">
          {c => <input {...c} className={fieldControlClassName} value={form.next_action ?? ''} onChange={e => set('next_action', e.target.value || null)} placeholder="e.g. Call to book trial, Send schedule…" />}
        </Field>
        <Field label="Address">
          {c => <input {...c} className={fieldControlClassName} value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} />}
        </Field>

        {err && <FormError>{err}</FormError>}

        <FormActions align="stretch">
          <button type="button" {...buttonProps('primary')} onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </FormActions>
      </div>
    </SlidePanel>
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
    <div>
      {/* Filters */}
      <div className={styles.filters}>
        <input
          type="search"
          aria-label="Search contacts"
          className={`${fieldControlClassName} ${styles.search}`}
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts…"
        />
        <select
          aria-label="Filter contacts by status"
          className={`${fieldControlClassName} ${styles.filterSelect}`}
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {CONTACT_STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>
          {search || filterStatus !== 'all' ? 'No contacts match your filters.' : 'No contacts yet.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map(c => {
            const state = CONTACT_STATUS[c.status] ?? CONTACT_STATUS.lead
            const isActive = selected?.id === c.id
            const meta = [c.email, c.phone].filter(Boolean).join(' · ')
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-selected={isActive ? 'true' : undefined}
                  aria-haspopup="dialog"
                  onClick={() => setSelected(isActive ? null : c)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowName} title={c.name}>{c.name}</span>
                    {meta && <span className={styles.rowMeta} title={meta}>{meta}</span>}
                  </span>
                  <span className={styles.rowSide}>
                    {c.next_action && (
                      <span className={styles.nextAction} title={c.next_action}>
                        → {c.next_action}
                      </span>
                    )}
                    <Badge state={state} className={styles.statusBadge}>{c.status}</Badge>
                    <span className={styles.when}>{ago(c.last_contacted_at)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Editor dialog */}
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
  const baseId = useId()

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
    return <p className={styles.emptyState}>No leads yet.</p>
  }

  return (
    <ul className={styles.list}>
      {leads.map(lead => {
        const st = LEAD_STATUS[lead.status] ?? LEAD_STATUS.new
        const isExpanded = expanded === lead.id
        const date = new Date(lead.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
        const detailId = `${baseId}-lead-${lead.id}`

        return (
          <li key={lead.id} className={styles.leadCard}>
            <button
              type="button"
              className={styles.row}
              aria-expanded={isExpanded}
              aria-controls={detailId}
              onClick={() => setExpanded(isExpanded ? null : lead.id)}
            >
              <span className={styles.rowMain}>
                <span className={styles.rowName} title={lead.name}>{lead.name}</span>
                <span className={styles.rowMeta}>
                  {lead.email}{lead.session_type ? ` · ${lead.session_type}` : ''}
                </span>
              </span>
              <span className={styles.rowSide}>
                <span className={styles.when}>{date}</span>
                <Badge state={st.state} className={styles.statusBadge}>{st.label}</Badge>
              </span>
            </button>

            {isExpanded && (
              <div id={detailId} className={styles.leadDetail}>
                {lead.message && (
                  <p className={styles.message}>{lead.message}</p>
                )}
                {lead.phone && (
                  <div className={styles.phone}>Phone {lead.phone}</div>
                )}
                <div role="group" aria-labelledby={`${detailId}-move`}>
                  <p id={`${detailId}-move`} className={styles.moveLabel}>
                    Move to
                  </p>
                  <div className={styles.moveActions}>
                    {LEAD_STATUS_ORDER.filter(s => s !== lead.status).map(s => {
                      const sty = LEAD_STATUS[s]
                      return (
                        <button key={s} type="button" {...buttonProps('secondary', 'sm')}
                          onClick={() => setStatus(lead, s)} disabled={updating === lead.id}>
                          {sty.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Opportunities tab ─────────────────────────────────────────────────────────

function OpportunitiesTab({ opportunities }: { opportunities: Opportunity[] }) {
  const nonempty = opportunities.filter(o => o.items.length > 0)

  if (nonempty.length === 0) {
    return (
      <p className={styles.emptyState}>
        No opportunities flagged — everything looks healthy.
      </p>
    )
  }

  return (
    <div className={styles.oppList}>
      {nonempty.map(opp => (
        <section key={opp.key} className={styles.oppCard} aria-label={opp.label}>
          <div className={styles.oppHeader}>
            <div>
              <h3 className={styles.oppTitle}>{opp.label}</h3>
              <p className={styles.oppDescription}>{opp.description}</p>
            </div>
            <span className={styles.oppCount}>{opp.items.length}</span>
          </div>
          <ul className={styles.list}>
            {opp.items.map(item => (
              <li key={item.id} className={styles.oppItem}>
                <span className={styles.oppItemName}>{item.name}</span>
                <span className={styles.oppItemDetail}>{item.detail}</span>
                <span className={styles.typeTag}>{item.type}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ── Account overview (Clients 2.0 B2) ───────────────────────────────────────
//
// Read-only account-level context, shown above the existing Contacts/Leads/
// Opportunities tabs rather than as a fourth tab — Products/Implementations
// describe the BrainBase client account itself, not an operational tenant
// dataset the way Contacts/Leads/Opportunities are. No create/update/delete
// controls exist here; management happens in the canonical admin surfaces
// this section links out to.

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', MANAGER: 'Manager', ANALYST: 'Analyst', VIEWER: 'Viewer',
}

// Truthful last-login presentation for the People card — never fabricated
// where last_login_at is null.
function lastSeen(ts: string | null): string {
  if (!ts) return 'Never signed in'
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d <= 0) return 'Last seen today'
  return `Last seen ${d}d ago`
}

function AccountOverview({ modules, implementations, people, peopleTotal }: {
  modules: PlatformModule[]; implementations: Implementation[]; people: Person[]; peopleTotal: number
}) {
  const additionalPeople = Math.max(0, peopleTotal - people.length)

  return (
    <div className={styles.overview}>
      {/* BrainBase Platform */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><span>BrainBase Platform</span></h2>
          <Link href="/admin/orgs" className={styles.cardLink}>
            Manage in Admin →
          </Link>
        </div>
        {modules.length === 0 ? (
          <p className={styles.empty}>No platform modules enabled</p>
        ) : (
          <ul className={styles.tags}>
            {modules.map(m => (
              <li key={m.key} title={m.description ?? undefined} className={styles.tag}>
                {m.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Implementations */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}><span>Implementations</span></h2>
        {implementations.length === 0 ? (
          <p className={styles.empty}>No implementations recorded</p>
        ) : (
          <ul className={styles.stack}>
            {implementations.map(impl => {
              const health = HEALTH_META[impl.health] ?? HEALTH_META.on_track
              return (
                <li key={impl.id}>
                  <Link href={`/admin/implementations/${impl.id}`} className={styles.item}>
                    <span className={styles.itemName}>{impl.name}</span>
                    <StatusDot state={health.state} label={health.label} className={styles.itemHealth} />
                    <span className={styles.itemMeta}>
                      {STAGE_LABEL[impl.stage] ?? impl.stage}
                      {impl.service_type ? ` · ${impl.service_type}` : ''}
                      {impl.next_action ? ` · → ${impl.next_action}` : ''}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* People — read-only account-user visibility. No invite/create/
          delete/deactivate/role-change control exists here; management
          happens at /admin/users. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><span>People</span></h2>
          <Link href="/admin/users" className={styles.cardLink}>
            Manage in Admin →
          </Link>
        </div>
        {people.length === 0 ? (
          <p className={styles.empty}>No users on this account</p>
        ) : (
          <ul className={styles.stack}>
            {people.map(person => (
              <li key={person.id} className={styles.item}>
                <span className={styles.itemName}>
                  {person.name}
                </span>
                <span className={styles.itemMeta}>
                  {person.email ?? 'No email'} · {ROLE_LABEL[person.role] ?? person.role}
                </span>
                <span className={styles.itemMeta}>
                  {lastSeen(person.last_login_at)}
                </span>
              </li>
            ))}
            {additionalPeople > 0 && (
              <li className={styles.more}>+{additionalPeople} more</li>
            )}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Root workspace ────────────────────────────────────────────────────────────

export default function ClientWorkspace({ orgId, contacts, leads, opportunities, modules, implementations, people, peopleTotal }: {
  orgId: string
  contacts: Contact[]
  leads: Lead[]
  opportunities: Opportunity[]
  modules: PlatformModule[]
  implementations: Implementation[]
  people: Person[]
  peopleTotal: number
}) {
  const [tab, setTab] = useState<Tab>('contacts')
  const baseId = useId()
  const panelId = `${baseId}-panel`
  const tabId = (t: Tab) => `${baseId}-tab-${t}`

  // A real tablist: one tab in the Tab order (roving tabindex), arrow keys /
  // Home / End move between tabs and activate them.
  const tabStyle = (t: Tab) => ({
    id: tabId(t),
    role: 'tab' as const,
    type: 'button' as const,
    className: styles.tab,
    'aria-selected': tab === t,
    'aria-controls': panelId,
    tabIndex: tab === t ? 0 : -1,
  })

  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TAB_ORDER.indexOf(tab)
    let next: Tab | null = null
    if (e.key === 'ArrowRight') next = TAB_ORDER[(i + 1) % TAB_ORDER.length]
    else if (e.key === 'ArrowLeft') next = TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length]
    else if (e.key === 'Home') next = TAB_ORDER[0]
    else if (e.key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1]
    if (!next) return
    e.preventDefault()
    setTab(next)
    document.getElementById(tabId(next))?.focus()
  }

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
    <div className={styles.workspace}>
      <AccountOverview modules={modules} implementations={implementations} people={people} peopleTotal={peopleTotal} />

      {/* Tab bar */}
      <div className={styles.tabStrip}>
        <div className={styles.tabList} role="tablist" aria-label="Client data" onKeyDown={onTabKeyDown}>
          <button {...tabStyle('contacts')}      onClick={() => setTab('contacts')}>      {label('contacts', 'Contacts')}      </button>
          <button {...tabStyle('leads')}         onClick={() => setTab('leads')}>         {label('leads', 'Leads')}            </button>
          <button {...tabStyle('opportunities')} onClick={() => setTab('opportunities')}> {label('opportunities', 'Opportunities')}</button>
        </div>
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'contacts'      && <ContactsTab      contacts={contacts}         orgId={orgId} />}
        {tab === 'leads'         && <LeadsTab         leads={leads}               orgId={orgId} />}
        {tab === 'opportunities' && <OpportunitiesTab opportunities={opportunities} />}
      </div>
    </div>
  )
}
