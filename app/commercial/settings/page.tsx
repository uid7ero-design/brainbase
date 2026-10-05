'use client';
import { useEffect, useState } from 'react';
import { Field } from '../_components/CustomerForm';
import {
  Field as AppField,
  FormError,
  PageHeader,
  TableContainer,
  buttonProps,
  fieldControlClassName,
  tableStyles,
} from '@/components/ui/app';

const SECTION: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' };

type Profile = { tradingName: string | null; address: string | null; email: string | null; phone: string | null; abn: string | null };
type TaxCode = { id: string; code: string; name: string; rate: string; is_default: boolean; active: boolean };

// Phase C3-POLISH-R §1/§4 — minimal Commercial → Settings screen. Two
// small, self-contained sections (Business Profile, Tax Codes) rather
// than a bigger settings framework — the brief's own §4 instruction
// ("if a simple CRUD screen is small and clean, include it") is the bar
// this stays under; there is no navigation, tabs, or generic settings
// registry here, just the two things this phase actually needs
// configurable.
export default function CommercialSettingsPage() {
  const [profile, setProfile] = useState<Profile>({ tradingName: null, address: null, email: null, phone: null, abn: null });
  const [orgName, setOrgName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [taxError, setTaxError] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [profileRes, taxRes] = await Promise.all([
      fetch('/api/commercial/settings/business-profile'),
      fetch('/api/commercial/tax-codes'),
    ]);
    if (profileRes.ok) {
      const data = await profileRes.json();
      setProfile(data.profile);
      setOrgName(data.organisationName);
    }
    if (taxRes.ok) setTaxCodes((await taxRes.json()).taxCodes ?? []);
  }
  useEffect(() => { load(); }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true); setProfileSaved(false);
    const res = await fetch('/api/commercial/settings/business-profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
    });
    setSavingProfile(false);
    if (res.ok) setProfileSaved(true);
  }

  async function seedDefaults() {
    setSeeding(true); setTaxError('');
    const res = await fetch('/api/commercial/tax-codes/bootstrap', { method: 'POST' });
    setSeeding(false);
    if (!res.ok) { setTaxError('Failed to seed standard tax codes.'); return; }
    load();
  }

  async function createTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim() || !newRate) { setTaxError('Code, name, and rate are required.'); return; }
    setBusy(true); setTaxError('');
    const res = await fetch('/api/commercial/tax-codes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode.trim(), name: newName.trim(), rate: Number(newRate) }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setTaxError(data.error ?? 'Failed to create tax code.'); return; }
    setNewCode(''); setNewName(''); setNewRate('');
    load();
  }

  async function deactivateTaxCode(id: string) {
    setBusy(true);
    await fetch(`/api/commercial/tax-codes/${id}`, { method: 'DELETE' });
    setBusy(false);
    load();
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title="Commercial Settings" />

      <section aria-labelledby="settings-business-profile" style={{ ...SECTION, marginBottom: 24 }}>
        <h2 id="settings-business-profile" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--text-primary)' }}>Business Profile</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Shown as the &ldquo;From&rdquo; details on Quote and Invoice PDFs and emails. Any field left blank falls back to your organisation name ({orgName || '—'}) or is omitted.
        </p>
        <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Trading Name" value={profile.tradingName ?? ''} onChange={e => setProfile(p => ({ ...p, tradingName: e.target.value }))} placeholder={orgName} />
          <Field label="Business Address" value={profile.address ?? ''} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
          <Field label="Business Email" value={profile.email ?? ''} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
          <Field label="Business Phone" value={profile.phone ?? ''} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
          <Field label="ABN" value={profile.abn ?? ''} onChange={e => setProfile(p => ({ ...p, abn: e.target.value }))} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={savingProfile} {...buttonProps('primary')}>
              {savingProfile ? 'Saving…' : 'Save Business Profile'}
            </button>
            <span role="status" style={{ color: 'var(--status-success)', fontSize: 13 }}>{profileSaved ? 'Saved.' : ''}</span>
          </div>
        </form>
      </section>

      <section aria-labelledby="settings-tax-codes" style={SECTION}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 id="settings-tax-codes" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--text-primary)' }}>Tax Codes</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Used on Products and Quote/Invoice lines. Deactivating a code never affects quotes or invoices already issued with it (their tax rate is snapshotted).</p>
          </div>
          {taxCodes.length === 0 && (
            <button type="button" onClick={seedDefaults} disabled={seeding} {...buttonProps('primary')}>
              {seeding ? 'Seeding…' : 'Seed Standard Australian Tax Codes'}
            </button>
          )}
        </div>

        {taxCodes.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <TableContainer label="Tax codes" minWidth={480}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col" className={tableStyles.num}>Rate</th>
                    <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {taxCodes.map(t => (
                    <tr key={t.id}>
                      <td className={tableStyles.primary}>{t.code}{t.is_default && <span className={tableStyles.muted} style={{ fontWeight: 400 }}> · default</span>}</td>
                      <td>{t.name}</td>
                      <td className={tableStyles.num}>{t.rate}%</td>
                      <td className={tableStyles.actions}>
                        <button type="button" onClick={() => deactivateTaxCode(t.id)} disabled={busy} className={tableStyles.link} style={{ color: 'var(--status-danger)' }} aria-label={`Deactivate tax code ${t.code}`}>Deactivate</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableContainer>
          </div>
        )}

        <form onSubmit={createTaxCode} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 100px' }}>
            <AppField label="Code">
              {control => <input {...control} value={newCode} onChange={e => setNewCode(e.target.value)} className={fieldControlClassName} placeholder="e.g. GST" />}
            </AppField>
          </div>
          <div style={{ flex: '2 1 160px' }}>
            <AppField label="Name">
              {control => <input {...control} value={newName} onChange={e => setNewName(e.target.value)} className={fieldControlClassName} placeholder="e.g. GST 10%" />}
            </AppField>
          </div>
          <div style={{ width: 90 }}>
            <AppField label="Rate %">
              {control => <input {...control} value={newRate} onChange={e => setNewRate(e.target.value)} className={fieldControlClassName} inputMode="decimal" placeholder="10.00" />}
            </AppField>
          </div>
          <button type="submit" disabled={busy} {...buttonProps('secondary')}>
            Add Tax Code
          </button>
        </form>
        {taxError && <div style={{ marginTop: 12 }}><FormError>{taxError}</FormError></div>}
      </section>
    </div>
  );
}
