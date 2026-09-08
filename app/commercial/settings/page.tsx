'use client';
import { useEffect, useState } from 'react';
import { Field, lbl, sel } from '../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 24px' }}>Commercial Settings</h1>

      <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Business Profile</h2>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
          Shown as the &ldquo;From&rdquo; details on Quote and Invoice PDFs and emails. Any field left blank falls back to your organisation name ({orgName || '—'}) or is omitted.
        </p>
        <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Trading Name" value={profile.tradingName ?? ''} onChange={e => setProfile(p => ({ ...p, tradingName: e.target.value }))} placeholder={orgName} />
          <Field label="Business Address" value={profile.address ?? ''} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
          <Field label="Business Email" value={profile.email ?? ''} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
          <Field label="Business Phone" value={profile.phone ?? ''} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
          <Field label="ABN" value={profile.abn ?? ''} onChange={e => setProfile(p => ({ ...p, abn: e.target.value }))} />
          <div>
            <button type="submit" disabled={savingProfile} style={{ padding: '9px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {savingProfile ? 'Saving…' : 'Save Business Profile'}
            </button>
            {profileSaved && <span style={{ marginLeft: 12, color: '#4ade80', fontSize: 13 }}>Saved.</span>}
          </div>
        </form>
      </section>

      <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Tax Codes</h2>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Used on Products and Quote/Invoice lines. Deactivating a code never affects quotes or invoices already issued with it (their tax rate is snapshotted).</p>
          </div>
          {taxCodes.length === 0 && (
            <button onClick={seedDefaults} disabled={seeding} style={{ padding: '8px 14px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {seeding ? 'Seeding…' : 'Seed Standard Australian Tax Codes'}
            </button>
          )}
        </div>

        {taxCodes.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <tbody>
              {taxCodes.map((t, i) => (
                <tr key={t.id} style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                  <td style={{ padding: '10px 0', fontSize: 13, color: '#f9fafb', fontWeight: 500 }}>{t.code}{t.is_default && <span style={{ color: '#6b7280', fontWeight: 400 }}> · default</span>}</td>
                  <td style={{ padding: '10px 0', fontSize: 13, color: '#9ca3af' }}>{t.name}</td>
                  <td style={{ padding: '10px 0', fontSize: 13, color: '#9ca3af', textAlign: 'right' }}>{t.rate}%</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    <button onClick={() => deactivateTaxCode(t.id)} disabled={busy} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={createTaxCode} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 100px' }}>
            <div style={lbl}>Code</div>
            <input value={newCode} onChange={e => setNewCode(e.target.value)} style={sel} placeholder="e.g. GST" />
          </div>
          <div style={{ flex: '2 1 160px' }}>
            <div style={lbl}>Name</div>
            <input value={newName} onChange={e => setNewName(e.target.value)} style={sel} placeholder="e.g. GST 10%" />
          </div>
          <div style={{ width: 90 }}>
            <div style={lbl}>Rate %</div>
            <input value={newRate} onChange={e => setNewRate(e.target.value)} style={sel} inputMode="decimal" placeholder="10.00" />
          </div>
          <button type="submit" disabled={busy} style={{ padding: '9px 16px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Add Tax Code
          </button>
        </form>
        {taxError && <p style={{ color: '#f87171', fontSize: 13, margin: '12px 0 0' }}>{taxError}</p>}
      </section>
    </div>
  );
}
