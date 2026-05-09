'use client';

import { useEffect, useRef, useState } from 'react';

type Org = { id: string; name: string; slug: string };
type State = {
  role: string | null;
  activeOrgId: string | null;
  activeOrgName: string | null;
  orgs: Org[];
};

export default function OrgSwitcher() {
  const [state, setState] = useState<State>({ role: null, activeOrgId: null, activeOrgName: null, orgs: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const [meRes, impRes] = await Promise.all([
        fetch('/api/me'),
        fetch('/api/admin/impersonate'),
      ]);
      if (!meRes.ok) return;
      const me = await meRes.json();
      if (me.role !== 'super_admin') return;

      const orgsRes = await fetch('/api/admin/orgs');
      const { orgs = [] } = orgsRes.ok ? await orgsRes.json() : {};

      let activeOrgId: string | null = null;
      let activeOrgName: string | null = null;
      if (impRes.ok) {
        const imp = await impRes.json();
        activeOrgId = imp.orgId ?? null;
        activeOrgName = imp.orgName ?? null;
      }

      setState({ role: me.role, activeOrgId, activeOrgName, orgs });
    }
    load();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (state.role !== 'super_admin') return null;

  async function switchOrg(orgId: string | null) {
    setBusy(true);
    setOpen(false);
    if (!orgId) {
      await fetch('/api/admin/impersonate', { method: 'DELETE' });
      setState(s => ({ ...s, activeOrgId: null, activeOrgName: null }));
    } else {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        const { orgName } = await res.json();
        setState(s => ({ ...s, activeOrgId: orgId, activeOrgName: orgName }));
      }
    }
    setBusy(false);
    // Reload to pick up scoped data
    window.location.reload();
  }

  const isOverriding = !!state.activeOrgId;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none">
      {/* Banner shown when overriding */}
      {isOverriding && (
        <div className="pointer-events-auto flex items-center justify-center gap-3 bg-purple-600 text-white text-xs py-1.5 px-4 font-medium tracking-wide">
          <span className="opacity-60 uppercase text-[10px] tracking-widest">Viewing as</span>
          <span className="font-semibold">{state.activeOrgName}</span>
          <span className="opacity-40">·</span>
          <button
            onClick={() => switchOrg(null)}
            disabled={busy}
            className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
          >
            Exit
          </button>
        </div>
      )}

      {/* Switcher pill — always visible for super_admin */}
      <div className="pointer-events-auto absolute top-1 right-4" ref={dropRef}>
        <button
          onClick={() => setOpen(o => !o)}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-md transition-colors disabled:opacity-50 ${
            isOverriding
              ? 'bg-purple-600 text-white'
              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z"/>
            <path d="M8 4a1 1 0 0 1 1 1v2.586l1.707 1.707a1 1 0 0 1-1.414 1.414l-2-2A1 1 0 0 1 7 8V5a1 1 0 0 1 1-1z"/>
          </svg>
          {isOverriding ? state.activeOrgName : 'Orgs'}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M1 2l3 3 3-3"/>
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-56 rounded-lg border border-white/10 bg-neutral-900 shadow-xl overflow-hidden text-xs">
            <div className="px-3 py-2 text-neutral-500 uppercase tracking-widest text-[10px]">Switch org</div>
            {state.orgs.map(org => (
              <button
                key={org.id}
                onClick={() => switchOrg(org.id)}
                disabled={busy}
                className={`w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 disabled:opacity-40 ${
                  state.activeOrgId === org.id ? 'text-purple-400 font-semibold' : 'text-neutral-200'
                }`}
              >
                {state.activeOrgId === org.id && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                )}
                {state.activeOrgId !== org.id && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-transparent shrink-0" />
                )}
                {org.name}
              </button>
            ))}
            {isOverriding && (
              <>
                <div className="h-px bg-white/10 mx-3 my-1" />
                <button
                  onClick={() => switchOrg(null)}
                  disabled={busy}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 text-neutral-400 disabled:opacity-40"
                >
                  Back to my org
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
