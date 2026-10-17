'use client';

import { useEffect, useState } from 'react';

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
  useEffect(() => {
    let live = true;
    fetch('/api/auth/organisation').then(r => (r.ok ? r.json() : null)).then(b => { if (live && b?.organisations) setOrgs(b.organisations); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (orgs.length < 2) return null;
  return (
    <div>
      <label htmlFor="org-switch" className="sr-only">Organisation</label>
      <select
        id="org-switch" className="min-h-9 rounded-lg border border-eve-line bg-white px-2 text-sm" value={currentId}
        onChange={async e => {
          setError(null);
          const res = await fetch('/api/auth/organisation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organisationId: e.target.value }) });
          if (res.ok) window.location.reload(); else setError('Could not switch organisation.');
        }}
      >
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {error ? <span role="alert" className="ml-2 text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
