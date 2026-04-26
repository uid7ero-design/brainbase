'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import ContactForm from '../../_components/ContactForm';
import ActivityForm from '../../_components/ActivityForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';
const STAGE_COLORS: Record<string, string> = { lead:'#6b7280', qualified:'#60a5fa', proposal:'#a78bfa', negotiation:'#fbbf24', closed_won:'#34d399', closed_lost:'#f87171' };
const TYPE_ICONS: Record<string, string>   = { call:'📞', email:'✉️', note:'📝', meeting:'🤝' };

type Contact  = { id: string; first_name: string; last_name: string; email: string|null; phone: string|null; job_title: string|null; company_id: string|null; company_name: string|null; notes: string|null };
type Deal     = { id: string; title: string; value: number|null; stage: string; expected_close: string|null };
type Activity = { id: string; type: string; subject: string; body: string|null; activity_date: string; created_by_name: string };
type GmailMsg = { id: string; subject: string; from: string; time: string; snippet: string; imported?: boolean };

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [contact, setContact]     = useState<Contact | null>(null);
  const [deals, setDeals]         = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showEdit, setShowEdit]   = useState(false);
  const [deleting, setDeleting]   = useState(false);

  // Gmail
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailMsgs, setGmailMsgs]           = useState<GmailMsg[]>([]);
  const [loadingGmail, setLoadingGmail]     = useState(false);
  const [importingId, setImportingId]       = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/crm/contacts/${id}`);
    if (!res.ok) { router.push('/crm/contacts'); return; }
    const data = await res.json();
    setContact(data.contact);
    setDeals(data.deals);
    setActivities(data.activities);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    fetch('/api/integrations/gmail/status').then(r => r.json()).then(d => setGmailConnected(d.connected));
  }, []);

  async function loadGmailThreads(email: string) {
    setLoadingGmail(true);
    const res = await fetch(`/api/crm/gmail-search?email=${encodeURIComponent(email)}`);
    if (res.ok) setGmailMsgs((await res.json()).messages ?? []);
    setLoadingGmail(false);
  }

  async function importEmail(msg: GmailMsg) {
    setImportingId(msg.id);
    await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', subject: msg.subject, body: msg.snippet, contact_id: id }),
    });
    setGmailMsgs(m => m.map(x => x.id === msg.id ? { ...x, imported: true } : x));
    setImportingId(null);
    load();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${contact?.first_name} ${contact?.last_name}"?`)) return;
    setDeleting(true);
    await fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' });
    router.push('/crm/contacts');
  }

  if (loading) return <div style={{ color: '#4b5563', padding: 32 }}>Loading…</div>;
  if (!contact) return null;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Breadcrumb + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#6b7280' }}>
          <Link href="/crm/contacts" style={{ color: '#6b7280', textDecoration: 'none' }}>Contacts</Link>
          <span>/</span>
          <span style={{ color: '#f9fafb' }}>{contact.first_name} {contact.last_name}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowEdit(true)} style={outlineBtn}>Edit</button>
          <button onClick={handleDelete} disabled={deleting} style={dangerBtn}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Deals */}
          <Section title="Deals" count={deals.length}>
            {deals.length === 0
              ? <Empty>No deals linked to this contact.</Empty>
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
            <ActivityForm contactId={id} onSaved={load} />
          </Section>

          {/* Gmail threads */}
          {contact.email && (
            <Section title="Gmail Threads">
              {!gmailConnected ? (
                <div style={{ fontSize: 13, color: '#4b5563' }}>
                  Gmail not connected. <Link href="/api/integrations/gmail/login" style={{ color: '#1a6aff', textDecoration: 'none' }}>Connect Gmail →</Link>
                </div>
              ) : gmailMsgs.length === 0 ? (
                <button onClick={() => loadGmailThreads(contact.email!)} disabled={loadingGmail}
                  style={{ padding: '8px 14px', background: '#111318', color: '#9ca3af', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, cursor: loadingGmail ? 'default' : 'pointer' }}>
                  {loadingGmail ? 'Searching Gmail…' : `Search Gmail for ${contact.email}`}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {gmailMsgs.map(msg => (
                    <div key={msg.id} style={{ padding: '12px 14px', background: '#111318', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{msg.subject}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{msg.from} · {msg.time}</div>
                          <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4, lineHeight: 1.4 }}>{msg.snippet.slice(0, 100)}{msg.snippet.length > 100 ? '…' : ''}</div>
                        </div>
                        <button onClick={() => importEmail(msg)} disabled={!!msg.imported || importingId === msg.id}
                          style={{ flexShrink: 0, padding: '5px 10px', background: msg.imported ? 'rgba(52,211,153,0.1)' : '#1a1d24', color: msg.imported ? '#34d399' : '#9ca3af', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, cursor: msg.imported ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                          {msg.imported ? '✓ Imported' : importingId === msg.id ? '…' : 'Import'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>

        {/* Right — contact info + activity feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{contact.first_name} {contact.last_name}</h2>
            {contact.job_title && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{contact.job_title}</div>}
            {contact.company_name && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Company</div>
                <Link href={`/crm/companies/${contact.company_id}`} style={{ fontSize: 13, color: '#60a5fa', textDecoration: 'none' }}>{contact.company_name}</Link>
              </div>
            )}
            {[
              { label: 'Email', value: contact.email },
              { label: 'Phone', value: contact.phone },
            ].map(({ label, value }) => value ? (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, color: '#d1d5db' }}>{value}</div>
              </div>
            ) : null)}
            {contact.notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, lineHeight: 1.6 }}>{contact.notes}</p>
              </div>
            )}
          </div>

          <Section title="Activity" count={activities.length}>
            {activities.length === 0
              ? <Empty>No activity yet.</Empty>
              : activities.map((a, i) => (
                <div key={a.id} style={{ paddingBottom: 12, marginBottom: i < activities.length-1 ? 12 : 0, borderBottom: i < activities.length-1 ? `1px solid ${BORDER}` : 'none' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{TYPE_ICONS[a.type]}</span>
                    <div>
                      <div style={{ fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{a.subject}</div>
                      {a.body && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 1.4 }}>{a.body.slice(0, 100)}{a.body.length > 100 ? '…' : ''}</div>}
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

      <SlidePanel open={showEdit} onClose={() => setShowEdit(false)} title="Edit Contact">
        <ContactForm initial={contact} onSaved={(updated) => { setContact(updated as Contact); setShowEdit(false); }} />
      </SlidePanel>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#f9fafb' }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 11, color: '#4b5563', background: '#1a1d24', padding: '1px 6px', borderRadius: 10 }}>{count}</span>}
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
