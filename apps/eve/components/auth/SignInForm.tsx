'use client';

import { useState } from 'react';

type Org = { id: string; name: string };
const input = 'mt-1 block min-h-11 w-full rounded-lg border border-eve-line bg-white px-3 text-sm text-eve-ink';

// Posts to this product's own origin only. The password is sent once to
// /api/auth/login and never stored; the session cookie is set by the
// server and is not readable from this page.
export function SignInForm({ sessionEnded }: { sessionEnded: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, organisationId: orgs ? orgId : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { window.location.assign('/organiser'); return; }
      if (res.status === 409 && Array.isArray(body.organisations)) {
        setOrgs(body.organisations as Org[]);
        setOrgId((body.organisations as Org[])[0]?.id ?? '');
        return;
      }
      setError(typeof body.error === 'string' ? body.error : 'Sign-in failed.');
    } catch {
      setError('Could not reach the service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4" aria-label="Sign in">
      {sessionEnded ? <p role="status" className="rounded-lg bg-eve-surface-alt p-3 text-sm">Your session has ended. Please sign in again.</p> : null}
      <div>
        <label htmlFor="username" className="block text-sm font-medium">Username</label>
        <input id="username" className={input} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <input id="password" type="password" className={input} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      {orgs ? (
        <div>
          <label htmlFor="org" className="block text-sm font-medium">Organisation</label>
          <select id="org" className={input} value={orgId} onChange={e => setOrgId(e.target.value)}>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-eve-muted">Choose which organisation to work in.</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-eve-ink px-6 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Signing in…' : orgs ? 'Continue' : 'Sign in'}
      </button>
    </form>
  );
}
