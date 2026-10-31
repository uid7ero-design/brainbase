'use client';
import { useState } from 'react';

// Eve organiser allow-list — the one control that lets this organisation's
// published events appear on Eve. The server page (page.tsx) and the API
// route both gate at admin+; this component only renders the switch.

const CARD = 'var(--bg-surface)';
const BORDER = 'var(--border)';
const TEXT_PRIMARY = 'var(--text-primary)';
const TEXT_MUTED = 'var(--text-muted)';
const TEXT_SECONDARY = 'var(--text-secondary)';
const RED = 'var(--status-danger)';
const GREEN = 'var(--status-success)';

export default function EveSettingsClient({
  initialEveEnabled,
  eventsEntitled,
}: {
  initialEveEnabled: boolean;
  eventsEntitled: boolean;
}) {
  const [eveEnabled, setEveEnabled] = useState(initialEveEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: boolean) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/organisations/eve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eveEnabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      setEveEnabled(data.eveEnabled === true);
      setSaved(true);
    } catch {
      setError('Save failed. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px', color: TEXT_PRIMARY }}>Eve</h1>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '0 0 24px' }}>
        Eve (eveevents.com.au) is a separate public ticketing site. Your events appear there only if this organisation is enabled for Eve.
      </p>

      <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', color: TEXT_SECONDARY, margin: '0 0 16px' }}>Eve availability</h2>
        <label htmlFor="eve-enabled" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: saving ? 'default' : 'pointer' }}>
          <input
            id="eve-enabled"
            type="checkbox"
            checked={eveEnabled}
            disabled={saving}
            onChange={e => save(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>Enable this organisation on Eve</span>
            <span style={{ display: 'block', fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>
              When on, every published event of this organisation can be viewed and booked on eveevents.com.au. When off, Eve shows them as unavailable. Publishing an event never turns this on. Your BrainBase event pages are not affected either way, and existing Eve tickets and bookings keep working.
            </span>
          </span>
        </label>
        {!eventsEntitled && (
          <p style={{ fontSize: 12.5, color: TEXT_MUTED, margin: '14px 0 0' }}>
            This organisation does not have Events enabled, so nothing appears on Eve even when this is on.
          </p>
        )}
        {saved && !error && (
          <p role="status" style={{ fontSize: 12.5, color: GREEN, margin: '14px 0 0' }}>
            {eveEnabled ? 'Enabled on Eve.' : 'Not enabled on Eve.'}
          </p>
        )}
        {error && <p role="alert" style={{ fontSize: 12.5, color: RED, margin: '14px 0 0' }}>{error}</p>}
      </section>
    </div>
  );
}
