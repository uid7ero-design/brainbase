'use client';

import { useState } from 'react';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" disabled={busy} className="text-sm font-medium text-eve-accent"
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.assign('/signin');
      }}
    >
      Sign out
    </button>
  );
}

// super_admin only: lists the organisations entitled to this product and
// switches the session to one. The server decides eligibility.
export function OrganisationSwitcher({ currentId }: { currentId: string }) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div>
      <button type="button" disabled={busy} className="text-sm font-medium text-eve-accent" onClick={async () => {
        setBusy(true); setError(null); setLoaded(false); setOrgs([]);
        try {
          const res = await fetch('/api/auth/organisation');
          const body = await res.json();
          if (!res.ok || !Array.isArray(body.organisations)) throw new Error('Unavailable');
          setOrgs(body.organisations); setLoaded(true);
        } catch { setError('Could not load organisations. Please try again.'); }
        finally { setBusy(false); }
      }}>{busy ? (loaded ? 'Switching organisation…' : 'Loading organisations…') : 'Switch organisation'}</button>
      {loaded && orgs.length < 2 ? <span role="status" className="ml-2 text-xs text-eve-muted">No other organisations available.</span> : null}
      {loaded && orgs.length >= 2 ? <>
      <label htmlFor="org-switch" className="sr-only">Organisation</label>
      <select
        id="org-switch" disabled={busy} className="ml-2 min-h-9 rounded-lg border border-eve-line bg-white px-2 text-sm" value={currentId}
        onChange={async e => {
          setError(null); setBusy(true);
          try {
            const res = await fetch('/api/auth/organisation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organisationId: e.target.value }) });
            if (res.ok) window.location.reload(); else setError('Could not switch organisation.');
          } catch { setError('Could not switch organisation.'); }
          finally { setBusy(false); }
        }}
      >
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      </> : null}
      {error ? <span role="alert" className="ml-2 text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
