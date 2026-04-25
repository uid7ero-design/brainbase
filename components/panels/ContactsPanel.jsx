'use client';
import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { CYAN } from '../../lib/utils/constants';

const STORAGE_KEY = 'brainbase:contacts';
const GLASS = { background: 'rgba(8,11,20,.92)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' };

function loadContacts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; } catch { return []; }
}
function saveContacts(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  'rgba(0,207,234,.8)', 'rgba(180,130,255,.8)', 'rgba(234,67,53,.8)',
  'rgba(134,239,172,.8)', 'rgba(251,191,36,.8)', 'rgba(96,165,250,.8)',
];

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name ?? '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const BLANK_CONTACT = { id: null, name: '', emails: [''], phones: [''], socials: { twitter: '', linkedin: '', github: '', website: '' } };

function ContactForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({ ...BLANK_CONTACT, ...initial, socials: { ...BLANK_CONTACT.socials, ...(initial?.socials ?? {}) }, emails: initial?.emails?.length ? [...initial.emails] : [''], phones: initial?.phones?.length ? [...initial.phones] : [''] }));

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function setSocial(key, val) { setForm(f => ({ ...f, socials: { ...f.socials, [key]: val } })); }
  function setListItem(key, idx, val) { setForm(f => { const a = [...f[key]]; a[idx] = val; return { ...f, [key]: a }; }); }
  function addListItem(key) { setForm(f => ({ ...f, [key]: [...f[key], ''] })); }
  function removeListItem(key, idx) { setForm(f => { const a = f[key].filter((_, i) => i !== idx); return { ...f, [key]: a.length ? a : [''] }; }); }

  function submit() {
    const contact = {
      ...form,
      id: form.id ?? `c_${Date.now()}`,
      emails: form.emails.filter(Boolean),
      phones: form.phones.filter(Boolean),
    };
    if (!contact.name.trim()) return;
    onSave(contact);
  }

  const inputSx = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.80)', fontSize: 11, outline: 'none', fontFamily: 'inherit' };
  const labelSx = { fontSize: 9, color: 'rgba(255,255,255,.40)', letterSpacing: '.08em', fontWeight: 600, marginBottom: 4, display: 'block' };
  const addBtnSx = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'rgba(0,207,234,.55)', padding: '2px 0', letterSpacing: '.04em' };

  return (
    <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelSx}>NAME</label>
        <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Full name" style={inputSx} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelSx}>EMAIL ADDRESSES</label>
        {form.emails.map((email, i) => (
          <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
            <input value={email} onChange={e => setListItem('emails', i, e.target.value)} placeholder="email@example.com" style={{ ...inputSx, flex: 1 }} />
            {form.emails.length > 1 && (
              <button onClick={() => removeListItem('emails', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.25)', fontSize: 13, padding: '0 4px' }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => addListItem('emails')} style={addBtnSx}>+ Add email</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelSx}>PHONE NUMBERS</label>
        {form.phones.map((phone, i) => (
          <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
            <input value={phone} onChange={e => setListItem('phones', i, e.target.value)} placeholder="+1 555 000 0000" style={{ ...inputSx, flex: 1 }} />
            {form.phones.length > 1 && (
              <button onClick={() => removeListItem('phones', i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.25)', fontSize: 13, padding: '0 4px' }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => addListItem('phones')} style={addBtnSx}>+ Add phone</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelSx}>SOCIALS</label>
        {[
          { key: 'twitter',  placeholder: '@handle or x.com/…',    icon: 'X' },
          { key: 'linkedin', placeholder: 'linkedin.com/in/…',      icon: 'in' },
          { key: 'github',   placeholder: 'github.com/…',           icon: 'gh' },
          { key: 'website',  placeholder: 'https://…',              icon: '🌐' },
        ].map(({ key, placeholder, icon }) => (
          <div key={key} style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 5 }}>
            <div style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'rgba(255,255,255,.40)', flexShrink: 0, fontWeight: 700 }}>{icon}</div>
            <input value={form.socials[key]} onChange={e => setSocial(key, e.target.value)} placeholder={placeholder} style={{ ...inputSx }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: 'rgba(0,207,234,.10)', border: '1px solid rgba(0,207,234,.28)', color: CYAN, fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' }}>
          Save Contact
        </button>
        <button onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 8, background: 'none', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.50)', fontSize: 11, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ContactsPanel() {
  const { contactsOpen, setContactsOpen } = useAppStore();
  const [contacts, setContacts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [editing,  setEditing]  = useState(null); // null=list, 'new'=new form, contact=edit
  const [detail,   setDetail]   = useState(null);
  const searchRef = useRef(null);

  useEffect(() => { if (contactsOpen) setContacts(loadContacts()); }, [contactsOpen]);
  useEffect(() => { if (contactsOpen) setTimeout(() => searchRef.current?.focus(), 80); }, [contactsOpen]);

  useEffect(() => {
    if (!contactsOpen) return;
    function onKey(e) { if (e.key === 'Escape') { if (editing) { setEditing(null); } else if (detail) { setDetail(null); } else setContactsOpen(false); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contactsOpen, editing, detail, setContactsOpen]);

  function saveContact(contact) {
    setContacts(prev => {
      const exists = prev.find(c => c.id === contact.id);
      const next = exists ? prev.map(c => c.id === contact.id ? contact : c) : [...prev, contact];
      saveContacts(next);
      return next;
    });
    setEditing(null);
    setDetail(contact);
  }

  function deleteContact(id) {
    setContacts(prev => { const next = prev.filter(c => c.id !== id); saveContacts(next); return next; });
    setDetail(null);
  }

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    if (!q) return true;
    return c.name?.toLowerCase().includes(q) || c.emails?.some(e => e.toLowerCase().includes(q)) || c.phones?.some(p => p.includes(q));
  }).sort((a, b) => a.name.localeCompare(b.name));

  if (!contactsOpen) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) setContactsOpen(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.60)', backdropFilter: 'blur(4px)' }}
    >
      <div style={{ width: 'min(760px, 94vw)', height: 'min(660px, 88vh)', borderRadius: 16, border: '1px solid rgba(255,255,255,.10)', ...GLASS, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(0,207,234,.10)', border: '1px solid rgba(0,207,234,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.90)', letterSpacing: '-.02em' }}>Address Book</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.42)' }}>{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</div>
          </div>
          <button onClick={() => { setEditing('new'); setDetail(null); }} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: 'rgba(0,207,234,.08)', border: '1px solid rgba(0,207,234,.22)', color: CYAN, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Contact
          </button>
          <button onClick={() => setContactsOpen(false)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.62)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Contact list */}
          <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…" style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.80)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginBottom: 10 }}>{search ? 'No results' : 'No contacts yet'}</div>
                  {!search && <button onClick={() => { setEditing('new'); setDetail(null); }} style={{ fontSize: 10, color: CYAN, background: 'none', border: `1px solid rgba(0,207,234,.22)`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>Add first contact</button>}
                </div>
              ) : filtered.map(c => {
                const isActive = detail?.id === c.id;
                const color = avatarColor(c.name);
                return (
                  <button key={c.id} onClick={() => { setDetail(c); setEditing(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: isActive ? 'rgba(0,207,234,.06)' : 'transparent', border: 'none', borderLeft: isActive ? `2px solid ${CYAN}` : '2px solid transparent', cursor: 'pointer', textAlign: 'left', transition: 'all .15s', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${color.replace('.8)', '.15)')}`, border: `1px solid ${color.replace('.8)', '.35)')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color, flexShrink: 0 }}>
                      {initials(c.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.82)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      {c.emails?.[0] && <div style={{ fontSize: 9, color: 'rgba(255,255,255,.42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{c.emails[0]}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail / Edit pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {editing ? (
              <ContactForm
                initial={editing === 'new' ? BLANK_CONTACT : editing}
                onSave={saveContact}
                onCancel={() => setEditing(null)}
              />
            ) : !detail ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="1.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)' }}>Select a contact</span>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                {/* Avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: avatarColor(detail.name).replace('.8)', '.15)'), border: `2px solid ${avatarColor(detail.name).replace('.8)', '.35)')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: avatarColor(detail.name), flexShrink: 0 }}>
                    {initials(detail.name)}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,.90)', lineHeight: 1.2, letterSpacing: '-.02em' }}>{detail.name}</div>
                    {detail.emails?.[0] && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.48)', marginTop: 3 }}>{detail.emails[0]}</div>}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={() => setEditing(detail)} style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.55)', fontSize: 10, cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => deleteContact(detail.id)} style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(234,67,53,.06)', border: '1px solid rgba(234,67,53,.18)', color: 'rgba(234,67,53,.65)', fontSize: 10, cursor: 'pointer' }}>Delete</button>
                  </div>
                </div>

                {detail.emails?.filter(Boolean).length > 0 && (
                  <Section label="Email" icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.40)" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}>
                    {detail.emails.filter(Boolean).map((e, i) => <CopyRow key={i} value={e} />)}
                  </Section>
                )}

                {detail.phones?.filter(Boolean).length > 0 && (
                  <Section label="Phone" icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.40)" strokeWidth="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.39 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.78a16 16 0 0 0 5.31 5.31l1.6-1.6a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 15l.19 1.92z"/></svg>}>
                    {detail.phones.filter(Boolean).map((p, i) => <CopyRow key={i} value={p} />)}
                  </Section>
                )}

                {Object.values(detail.socials ?? {}).some(Boolean) && (
                  <Section label="Socials" icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.40)" strokeWidth="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>}>
                    {[
                      { key: 'twitter',  label: 'X / Twitter' },
                      { key: 'linkedin', label: 'LinkedIn' },
                      { key: 'github',   label: 'GitHub' },
                      { key: 'website',  label: 'Website' },
                    ].filter(({ key }) => detail.socials?.[key]).map(({ key, label }) => (
                      <CopyRow key={key} label={label} value={detail.socials[key]} link />
                    ))}
                  </Section>
                )}

                {!detail.emails?.filter(Boolean).length && !detail.phones?.filter(Boolean).length && !Object.values(detail.socials ?? {}).some(Boolean) && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', fontStyle: 'italic' }}>No details yet. Click Edit to add.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, icon, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.35)', letterSpacing: '.10em' }}>{label.toUpperCase()}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {children}
      </div>
    </div>
  );
}

function CopyRow({ label, value, link }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
      {label && <span style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', minWidth: 56 }}>{label}</span>}
      {link
        ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 11, color: 'rgba(0,207,234,.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>{value}</a>
        : <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,.70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>}
      <button onClick={copy} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: copied ? 'rgba(134,239,172,.8)' : 'rgba(255,255,255,.28)', flexShrink: 0, fontSize: 10 }}>
        {copied ? '✓' : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
      </button>
    </div>
  );
}

export function useContacts() {
  return { loadContacts };
}
