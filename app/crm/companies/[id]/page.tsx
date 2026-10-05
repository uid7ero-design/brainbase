'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CompanyForm from '../../_components/CompanyForm';
import ActivityForm from '../../_components/ActivityForm';
import { PageHeader, Panel, StateMessage, buttonProps, tableStyles } from '@/components/ui/app';

const BORDER = 'var(--border)';
// Domain category encoding (kept) — deal pipeline stages. Semantic stages use
// status tokens; "proposal" keeps its own category hue. Drawn only as a dot
// beside the written stage label.
const STAGE_COLORS: Record<string, string> = { lead:'var(--status-inactive)', qualified:'var(--status-info)', proposal:'#f472b6', negotiation:'var(--status-warning)', closed_won:'var(--status-success)', closed_lost:'var(--status-danger)' };
const TYPE_ICONS: Record<string, string>   = { call:'📞', email:'✉️', note:'📝', meeting:'🤝' };

type Company  = { id: string; name: string; website: string|null; industry: string|null; company_size: string|null; phone: string|null; address: string|null; notes: string|null };
type Contact  = { id: string; first_name: string; last_name: string; email: string|null; job_title: string|null };
type Deal     = { id: string; title: string; value: number|null; stage: string; expected_close: string|null };
type Activity = { id: string; type: string; subject: string; body: string|null; activity_date: string; created_by_name: string };

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [company, setCompany]     = useState<Company | null>(null);
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [deals, setDeals]         = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showEdit, setShowEdit]   = useState(false);
  const [deleting, setDeleting]   = useState(false);

  async function load() {
    const res = await fetch(`/api/crm/companies/${id}`);
    if (!res.ok) { router.push('/crm/companies'); return; }
    const data = await res.json();
    setCompany(data.company);
    setContacts(data.contacts);
    setDeals(data.deals);
    setActivities(data.activities);
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);

  async function handleDelete() {
    if (!confirm(`Delete "${company?.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/crm/companies/${id}`, { method: 'DELETE' });
    router.push('/crm/companies');
  }

  if (loading) return <StateMessage kind="loading" size="page" title="Loading…" />;
  if (!company) return null;

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow={<Link href="/crm/companies" className={tableStyles.link}>← Companies</Link>}
        title={company.name}
        actions={
          <>
            <button type="button" onClick={() => setShowEdit(true)} {...buttonProps('secondary')}>Edit</button>
            <button type="button" onClick={handleDelete} disabled={deleting} {...buttonProps('danger')}>{deleting ? 'Deleting…' : 'Delete'}</button>
          </>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
        {/* Left column */}
        <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Contacts */}
          <Section title="Contacts" count={contacts.length} action={<Link href={`/crm/contacts`} className={tableStyles.link} aria-label="Add contact">+ Add</Link>}>
            {contacts.length === 0
              ? <Empty>No contacts linked to this company.</Empty>
              : contacts.map((c, i) => (
                <Link key={c.id} href={`/crm/contacts/${c.id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < contacts.length-1 ? `1px solid ${BORDER}` : 'none', textDecoration: 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                    {c.job_title && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{c.job_title}</div>}
                  </div>
                  {c.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</div>}
                </Link>
              ))}
          </Section>

          {/* Deals */}
          <Section title="Deals" count={deals.length}>
            {deals.length === 0
              ? <Empty>No deals linked to this company.</Empty>
              : deals.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < deals.length-1 ? `1px solid ${BORDER}` : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{d.title}</div>
                    {d.expected_close && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Close {new Date(d.expected_close).toLocaleDateString('en-AU', { day:'numeric', month:'short' })}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {d.value != null && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${Number(d.value).toLocaleString()}</div>}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, textTransform: 'capitalize' }}>
                      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: STAGE_COLORS[d.stage] ?? 'var(--status-inactive)' }} />
                      {d.stage.replace('_',' ')}
                    </div>
                  </div>
                </div>
              ))}
          </Section>

          {/* Log activity */}
          <Section title="Log Activity">
            <ActivityForm companyId={id} onSaved={load} />
          </Section>
        </div>

        {/* Right column — company info + activity feed */}
        <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel title="Details">
            {[
              { label: 'Industry',    value: company.industry },
              { label: 'Size',        value: company.company_size },
              { label: 'Website',     value: company.website },
              { label: 'Phone',       value: company.phone },
              { label: 'Address',     value: company.address },
            ].map(({ label, value }) => value ? (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
              </div>
            ) : null)}
            {company.notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{company.notes}</p>
              </div>
            )}
          </Panel>

          {/* Activity feed */}
          <Section title="Activity" count={activities.length}>
            {activities.length === 0
              ? <Empty>No activity yet.</Empty>
              : activities.map((a, i) => (
                <div key={a.id} style={{ paddingBottom: 12, marginBottom: i < activities.length-1 ? 12 : 0, borderBottom: i < activities.length-1 ? `1px solid ${BORDER}` : 'none' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ fontSize: 14 }}>{TYPE_ICONS[a.type]}</span>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}><span className="bb-visually-hidden">{a.type}: </span>{a.subject}</div>
                      {a.body && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{a.body.slice(0, 120)}{a.body.length > 120 ? '…' : ''}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {new Date(a.activity_date).toLocaleDateString('en-AU', { day:'numeric', month:'short' })} · {a.created_by_name}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </Section>
        </div>
      </div>

      <SlidePanel open={showEdit} onClose={() => setShowEdit(false)} title="Edit Company">
        <CompanyForm initial={company} onSaved={(updated) => { setCompany(updated as Company); setShowEdit(false); }} />
      </SlidePanel>
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {title}
          {count !== undefined && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', background: 'var(--status-inactive-muted)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
        </span>
      }
      actions={action}
    >
      {children}
    </Panel>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{children}</p>;
}
