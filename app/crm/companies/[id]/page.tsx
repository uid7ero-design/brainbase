'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CompanyForm from '../../_components/CompanyForm';
import ActivityForm from '../../_components/ActivityForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';
const STAGE_COLORS: Record<string, string> = { lead:'#6b7280', qualified:'#60a5fa', proposal:'#a78bfa', negotiation:'#fbbf24', closed_won:'#34d399', closed_lost:'#f87171' };
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

  if (loading) return <div style={{ color: '#4b5563', padding: 32 }}>Loading…</div>;
  if (!company) return null;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Breadcrumb + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#6b7280' }}>
          <Link href="/crm/companies" style={{ color: '#6b7280', textDecoration: 'none' }}>Companies</Link>
          <span>/</span>
          <span style={{ color: '#f9fafb' }}>{company.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowEdit(true)} style={outlineBtn}>Edit</button>
          <button onClick={handleDelete} disabled={deleting} style={dangerBtn}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Contacts */}
          <Section title="Contacts" count={contacts.length} action={<Link href={`/crm/contacts`} style={linkStyle}>+ Add</Link>}>
            {contacts.length === 0
              ? <Empty>No contacts linked to this company.</Empty>
              : contacts.map((c, i) => (
                <Link key={c.id} href={`/crm/contacts/${c.id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < contacts.length-1 ? `1px solid ${BORDER}` : 'none', textDecoration: 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                    {c.job_title && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{c.job_title}</div>}
                  </div>
                  {c.email && <div style={{ fontSize: 12, color: '#4b5563' }}>{c.email}</div>}
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
                    <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{d.title}</div>
                    {d.expected_close && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Close {new Date(d.expected_close).toLocaleDateString('en-AU', { day:'numeric', month:'short' })}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {d.value != null && <div style={{ fontSize: 13, fontWeight: 600, color: STAGE_COLORS[d.stage] }}>${Number(d.value).toLocaleString()}</div>}
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' }}>{d.stage.replace('_',' ')}</div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>{company.name}</h2>
            {[
              { label: 'Industry',    value: company.industry },
              { label: 'Size',        value: company.company_size },
              { label: 'Website',     value: company.website },
              { label: 'Phone',       value: company.phone },
              { label: 'Address',     value: company.address },
            ].map(({ label, value }) => value ? (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, color: '#d1d5db' }}>{value}</div>
              </div>
            ) : null)}
            {company.notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, lineHeight: 1.6 }}>{company.notes}</p>
              </div>
            )}
          </div>

          {/* Activity feed */}
          <Section title="Activity" count={activities.length}>
            {activities.length === 0
              ? <Empty>No activity yet.</Empty>
              : activities.map((a, i) => (
                <div key={a.id} style={{ paddingBottom: 12, marginBottom: i < activities.length-1 ? 12 : 0, borderBottom: i < activities.length-1 ? `1px solid ${BORDER}` : 'none' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14 }}>{TYPE_ICONS[a.type]}</span>
                    <div>
                      <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{a.subject}</div>
                      {a.body && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 1.4 }}>{a.body.slice(0, 120)}{a.body.length > 120 ? '…' : ''}</div>}
                      <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>
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
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f9fafb' }}>{title}</span>
          {count !== undefined && <span style={{ fontSize: 11, color: '#4b5563', background: '#1a1d24', padding: '1px 6px', borderRadius: 10 }}>{count}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: '#4b5563', margin: 0 }}>{children}</p>;
}

const outlineBtn: React.CSSProperties = { padding: '7px 14px', background: 'transparent', color: '#9ca3af', border: '1px solid #1a1d24', borderRadius: 8, fontSize: 13, cursor: 'pointer' };
const dangerBtn:  React.CSSProperties = { padding: '7px 14px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 13, cursor: 'pointer' };
const linkStyle:  React.CSSProperties = { fontSize: 12, color: '#1a6aff', textDecoration: 'none' };
