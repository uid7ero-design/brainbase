'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setAppHeaderExtraOffsetPx } from '@/lib/layout/headerOffset';

type Org = { id: string; name: string; slug: string };
type State = {
  role: string | null;
  activeOrgId: string | null;
  activeOrgName: string | null;
  orgs: Org[];
};

// Root-cause of this component being invisible in Production (see the
// accompanying report): the previous version rendered BOTH the
// "Viewing as" banner AND the switcher pill inside a `position: fixed,
// top: 0, z-[100]` wrapper. TopNav's own AppNav/PublicNav bars are also
// `position: sticky/fixed, top: 0, zIndex: 100` — an exact z-index tie
// at the same screen region. Since TopNav is mounted immediately AFTER
// this component in app/layout.tsx, it painted on top and completely
// covered both the banner and the pill — the component was mounting,
// fetching its data, and functioning correctly the entire time, just
// never visible.
//
// Fix: render as a normal, non-fixed, full-width bar in the document's
// own flow, positioned BEFORE TopNav (same DOM order as before) — this
// naturally pushes TopNav (and all page content) down by this bar's own
// height, with no z-index or absolute-positioning fight against
// anything TopNav renders (its own dropdowns, avatar, capability icons)
// possible by construction, since the two elements never occupy the
// same screen region at all. Always shown for super_admin (not only
// while impersonating) — a persistent, compact "Organisation" control
// in the header region, matching this phase's own explicit UX request,
// rather than a banner that only appears once already impersonating
// (which is how a super_admin would discover the mechanism exists in
// the first place otherwise).
//
// Reuses 100% of the existing backend: /api/me (role), /api/admin/orgs
// (dynamic org list — never hardcoded), and /api/admin/impersonate
// (GET current override, POST to set it, DELETE to clear it) — no new
// impersonation mechanism, no new route.
export default function OrgSwitcher() {
  const [state, setState] = useState<State>({ role: null, activeOrgId: null, activeOrgName: null, orgs: [] });
  const [homeOrgName, setHomeOrgName] = useState<string | null>(null);
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

      // /api/me's own organisationId (and therefore its `org` field) is
      // now override-aware (see that route's own comment) — when NOT
      // currently impersonating, activeOrgId/organisationId are the
      // same value, so me.org?.name correctly gives the founder's own
      // home organisation name for the default "Organisation: X" label.
      setHomeOrgName(me.org?.name ?? null);
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

  // Phase D.4.5C-W2 — this bar is the ONE source of "extra" height above
  // TopNav that the shared --app-header-offset custom property (see
  // lib/layout/headerOffset.ts) needs to account for. Measures this
  // component's own rendered box (dropRef, already attached below for
  // click-outside detection — no second ref needed) rather than
  // hardcoding a guessed pixel value, since its height depends on font
  // metrics/padding that shouldn't be duplicated as a second literal.
  // Keyed on state.role: that's the only state transition that changes
  // whether this bar renders at all (never/null while role is
  // unresolved or non-super_admin, real content once resolved to
  // 'super_admin') — the label text changing width while
  // impersonating/switching doesn't change this single-line bar's
  // height, so no other dependency is needed and no ResizeObserver is
  // necessary.
  useLayoutEffect(() => {
    if (state.role === 'super_admin') {
      setAppHeaderExtraOffsetPx(dropRef.current?.offsetHeight ?? 0);
    } else {
      setAppHeaderExtraOffsetPx(0);
    }
  }, [state.role]);

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
    // Navigate to /dashboard rather than reloading whatever route the
    // founder happened to be on — a founder switching orgs from, say,
    // /admin/orgs would otherwise land back on an admin-only page inside
    // the newly-active client org's context, with no obvious way to
    // reach that org's own workspace. /dashboard is the SAME existing,
    // generic client-landing route TopNav's own "Dashboard" link already
    // points to for every organisation (components/nav/TopNav.tsx) — not
    // a new route, and not app/clients/[id] (that page is a read-only
    // founder summary, never the impersonated app itself). Its own
    // existing routing logic (app/dashboard/page.tsx, via the equally
    // org_override-aware getAuthSession() in lib/authSession.ts) already
    // resolves the correct destination for whatever organisation is now
    // active: OrganisationDashboard/TennisDashboard for a client org, or
    // a further redirect to /admin/founder for Brainbase itself — which
    // is exactly why the SAME target correctly serves both "switch into
    // a client org" and "Return to Brainbase" without this component
    // needing to know or hardcode either destination itself.
    window.location.href = '/dashboard';
  }

  const isOverriding = !!state.activeOrgId;
  const currentLabel = isOverriding ? state.activeOrgName : (homeOrgName ?? 'Brainbase');

  return (
    <div
      ref={dropRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        padding: '5px 20px',
        fontSize: 12,
        fontFamily: 'var(--font-inter), -apple-system, sans-serif',
        background: isOverriding ? '#7C3AED' : 'rgba(255,255,255,.03)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        color: isOverriding ? '#fff' : 'rgba(226,232,240,.7)',
        position: 'relative',
        // Dropdown layering fix: this bar sits BEFORE TopNav in normal
        // document flow (that's what fixed the original invisibility
        // bug — see the header comment above), but TopNav's own header
        // has an EXPLICIT zIndex: 100, which makes it establish its own
        // stacking context. A position:relative ancestor with no
        // explicit z-index of its own (z-index: auto) does NOT let its
        // descendants (the dropdown below, zIndex: 50) outrank a LATER
        // sibling's higher stacking context — z-index only arbitrates
        // between siblings that both establish one. So the open
        // dropdown, which extends downward past this bar's own height
        // into the screen region TopNav occupies, was being painted
        // UNDER TopNav. Giving THIS wrapper its own explicit z-index
        // above TopNav's 100 makes the whole bar (and everything
        // absolutely positioned inside it) its own higher-ranked
        // stacking context, so the dropdown is no longer clipped —
        // without moving anything back to position: fixed.
        zIndex: 110,
      }}
    >
      <span style={{ opacity: isOverriding ? 0.75 : 0.5, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.08em', fontWeight: 600 }}>
        {isOverriding ? 'Viewing as' : 'Organisation'}
      </span>

      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: isOverriding ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${isOverriding ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.1)'}`,
          borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 600,
          color: isOverriding ? '#fff' : '#F5F7FA', cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.5 : 1,
        }}
      >
        {currentLabel}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }}>
          <path d="M1 2l3 3 3-3" />
        </svg>
      </button>

      {isOverriding && (
        <button
          onClick={() => switchOrg(null)}
          disabled={busy}
          style={{
            background: 'none', border: 'none', color: '#fff', textDecoration: 'underline',
            textUnderlineOffset: 2, fontSize: 12, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.4 : 0.9,
          }}
        >
          Return to Brainbase
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 20, marginTop: 4, width: 240,
            background: '#0e1014', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,.5)', overflow: 'hidden', zIndex: 50, textAlign: 'left',
          }}
        >
          <div style={{ padding: '8px 12px', color: 'rgba(226,232,240,.4)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '.08em', fontWeight: 600 }}>
            Switch organisation
          </div>
          {state.orgs.map(org => (
            <button
              key={org.id}
              onClick={() => switchOrg(org.id)}
              disabled={busy}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '8px 12px', background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                color: state.activeOrgId === org.id ? '#C4B5FD' : '#E2E8F0', fontSize: 12.5,
                fontWeight: state.activeOrgId === org.id ? 600 : 400,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: state.activeOrgId === org.id ? '#C4B5FD' : 'transparent', flexShrink: 0 }} />
              {org.name}
            </button>
          ))}
          {isOverriding && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 12px' }} />
              <button
                onClick={() => switchOrg(null)}
                disabled={busy}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none',
                  color: 'rgba(226,232,240,.6)', fontSize: 12.5, cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Return to Brainbase
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
