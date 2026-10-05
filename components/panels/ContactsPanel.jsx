'use client';
import { useState, useEffect, useId, useRef } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { buttonProps } from '../ui/app/Button';
import { useOverlayFocus } from './useOverlayFocus';
import overlay from './PanelOverlay.module.css';
import styles from './ContactsPanel.module.css';

// Visual (remaining visual islands pass): the glass modal, white-alpha
// neutrals, the old violet "CYAN" accent and the per-name rainbow avatar
// tints are replaced by app tokens (PanelOverlay.module.css + this module),
// so the address book reads in light and dark. Dialog semantics, labelled
// form fields, named icon-only controls, aria-current on the open contact
// and focus containment/return were added; the staged Escape handler,
// localStorage persistence and every save/delete effect are unchanged.

const STORAGE_KEY = 'brainbase:contacts';

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

const BLANK_CONTACT = { id: null, name: '', emails: [''], phones: [''], socials: { twitter: '', linkedin: '', github: '', website: '' } };

const SOCIAL_FIELDS = [
  { key: 'twitter',  placeholder: '@handle or x.com/…',    icon: 'X',  label: 'X / Twitter' },
  { key: 'linkedin', placeholder: 'linkedin.com/in/…',      icon: 'in', label: 'LinkedIn' },
  { key: 'github',   placeholder: 'github.com/…',           icon: 'gh', label: 'GitHub' },
  { key: 'website',  placeholder: 'https://…',              icon: '🌐', label: 'Website' },
];

function ContactForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({ ...BLANK_CONTACT, ...initial, socials: { ...BLANK_CONTACT.socials, ...(initial?.socials ?? {}) }, emails: initial?.emails?.length ? [...initial.emails] : [''], phones: initial?.phones?.length ? [...initial.phones] : [''] }));
  const uid = useId();

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

  return (
    <div className={styles.form}>
      <div className={styles.formGroup}>
        <label htmlFor={`${uid}-name`} className={overlay.fieldLabel}>NAME</label>
        <input id={`${uid}-name`} value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Full name" className={overlay.input} />
      </div>

      <div className={styles.formGroup} role="group" aria-labelledby={`${uid}-emails`}>
        <span id={`${uid}-emails`} className={overlay.fieldLabel}>EMAIL ADDRESSES</span>
        {form.emails.map((email, i) => (
          <div key={i} className={styles.inputRow}>
            <input value={email} onChange={e => setListItem('emails', i, e.target.value)} placeholder="email@example.com" aria-label={`Email address ${i + 1}`} className={overlay.input} />
            {form.emails.length > 1 && (
              <button type="button" onClick={() => removeListItem('emails', i)} aria-label={`Remove email address ${i + 1}`} className={overlay.iconButton}>
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => addListItem('emails')} {...buttonProps('ghost', 'sm')}>+ Add email</button>
      </div>

      <div className={styles.formGroup} role="group" aria-labelledby={`${uid}-phones`}>
        <span id={`${uid}-phones`} className={overlay.fieldLabel}>PHONE NUMBERS</span>
        {form.phones.map((phone, i) => (
          <div key={i} className={styles.inputRow}>
            <input value={phone} onChange={e => setListItem('phones', i, e.target.value)} placeholder="+1 555 000 0000" aria-label={`Phone number ${i + 1}`} className={overlay.input} />
            {form.phones.length > 1 && (
              <button type="button" onClick={() => removeListItem('phones', i)} aria-label={`Remove phone number ${i + 1}`} className={overlay.iconButton}>
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => addListItem('phones')} {...buttonProps('ghost', 'sm')}>+ Add phone</button>
      </div>

      <div className={styles.formGroupLast} role="group" aria-labelledby={`${uid}-socials`}>
        <span id={`${uid}-socials`} className={overlay.fieldLabel}>SOCIALS</span>
        {SOCIAL_FIELDS.map(({ key, placeholder, icon, label }) => (
          <div key={key} className={styles.inputRow}>
            <div className={styles.socialIcon} aria-hidden="true">{icon}</div>
            <input value={form.socials[key]} onChange={e => setSocial(key, e.target.value)} placeholder={placeholder} aria-label={label} className={overlay.input} />
          </div>
        ))}
      </div>

      <div className={styles.formActions}>
        <button type="button" onClick={submit} {...buttonProps('primary', 'sm')}>
          Save Contact
        </button>
        <button type="button" onClick={onCancel} {...buttonProps('secondary', 'sm')}>
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
  const panelRef = useRef(null);
  const titleId = useId();

  useOverlayFocus(contactsOpen, panelRef);

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
      className={overlay.root}
      style={{ zIndex: 68 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${overlay.dialog} ${styles.dialog}`}
      >

        {/* Header */}
        <div className={overlay.header}>
          <div className={overlay.headerIcon} aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <h2 id={titleId} className={overlay.title}>Address Book</h2>
            <p className={overlay.subtitle}>{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className={overlay.headerActions}>
            <button type="button" onClick={() => { setEditing('new'); setDetail(null); }} {...buttonProps('primary', 'sm')}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Contact
            </button>
            <button type="button" onClick={() => setContactsOpen(false)} aria-label="Close address book" className={overlay.iconButton}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div className={overlay.split}>

          {/* Contact list */}
          <div className={overlay.listPane} data-width="240" data-dialog-body="">
            <div className={styles.search}>
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…" aria-label="Search contacts" className={overlay.input} />
            </div>
            <div className={styles.list}>
              {filtered.length === 0 ? (
                <div className={overlay.empty}>
                  <span>{search ? 'No results' : 'No contacts yet'}</span>
                  {!search && <button type="button" onClick={() => { setEditing('new'); setDetail(null); }} {...buttonProps('secondary', 'sm')}>Add first contact</button>}
                </div>
              ) : filtered.map(c => {
                const isActive = detail?.id === c.id;
                return (
                  <button type="button" key={c.id} onClick={() => { setDetail(c); setEditing(null); }}
                    aria-current={isActive ? 'true' : undefined}
                    className={overlay.listRow}>
                    <span className={styles.row}>
                      <span className={styles.avatar} aria-hidden="true">
                        {initials(c.name)}
                      </span>
                      <span className={styles.rowText}>
                        <span className={`${styles.rowName} ${overlay.truncate}`}>{c.name}</span>
                        {c.emails?.[0] && <span className={`${styles.rowMeta} ${overlay.truncate}`}>{c.emails[0]}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail / Edit pane */}
          <div className={overlay.detailPane}>
            {editing ? (
              <ContactForm
                initial={editing === 'new' ? BLANK_CONTACT : editing}
                onSave={saveContact}
                onCancel={() => setEditing(null)}
              />
            ) : !detail ? (
              <div className={overlay.empty}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Select a contact</span>
              </div>
            ) : (
              <div className={styles.detail}>
                {/* Avatar + name */}
                <div className={styles.identity}>
                  <div className={`${styles.avatar} ${styles.avatarLarge}`} aria-hidden="true">
                    {initials(detail.name)}
                  </div>
                  <div>
                    <h3 className={styles.name}>{detail.name}</h3>
                    {detail.emails?.[0] && <div className={styles.primaryEmail}>{detail.emails[0]}</div>}
                  </div>
                  <div className={styles.detailActions}>
                    <button type="button" onClick={() => setEditing(detail)} {...buttonProps('secondary', 'sm')}>Edit</button>
                    <button type="button" onClick={() => deleteContact(detail.id)} {...buttonProps('danger', 'sm')}>Delete</button>
                  </div>
                </div>

                {detail.emails?.filter(Boolean).length > 0 && (
                  <Section label="Email" icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}>
                    {detail.emails.filter(Boolean).map((e, i) => <CopyRow key={i} value={e} />)}
                  </Section>
                )}

                {detail.phones?.filter(Boolean).length > 0 && (
                  <Section label="Phone" icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.39 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.78a16 16 0 0 0 5.31 5.31l1.6-1.6a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 15l.19 1.92z"/></svg>}>
                    {detail.phones.filter(Boolean).map((p, i) => <CopyRow key={i} value={p} />)}
                  </Section>
                )}

                {Object.values(detail.socials ?? {}).some(Boolean) && (
                  <Section label="Socials" icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>}>
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
                  <p className={styles.noDetails}>No details yet. Click Edit to add.</p>
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
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        {icon}
        <h4 className={overlay.sectionLabel}>{label.toUpperCase()}</h4>
      </div>
      <div className={styles.sectionRows}>
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
    <div className={styles.copyRow}>
      {label && <span className={styles.copyLabel}>{label}</span>}
      {link
        ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className={`${styles.copyLink} ${overlay.truncate}`}>{value}</a>
        : <span className={`${styles.copyValue} ${overlay.truncate}`}>{value}</span>}
      <button type="button" onClick={copy} title="Copy" aria-label={copied ? `Copied ${label ?? value}` : `Copy ${label ?? value}`} className={`${overlay.iconButton} ${copied ? styles.copied : ''}`}>
        {copied ? <span aria-hidden="true">✓</span> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
      </button>
    </div>
  );
}

export function useContacts() {
  return { loadContacts };
}
