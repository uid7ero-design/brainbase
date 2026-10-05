'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { setAppHeaderExtraOffsetPx } from '@/lib/layout/headerOffset';
import type { Role } from '@/lib/session';
import styles from './OrgSwitcher.module.css';

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
//
// FAILURE MODE THIS FILE ONCE HAD, closed by `initialRole`: every OTHER
// super_admin-gated header element (TopNav's own "Founder OS"/"Clients"
// nav items — see components/nav/TopNav.tsx's isSuperAdmin) gets its
// role from SERVER-SIDE props, computed once by app/layout.tsx's own
// requireSession() call — reliable by construction, no client fetch
// involved. This component, uniquely, used to determine whether to
// render AT ALL purely from its OWN client-side load() effect below,
// with `state.role` starting at plain `null` and NO try/catch anywhere
// in that effect. Promise.all([fetch('/api/me'), fetch('/api/admin/
// impersonate')]) rejects on any genuine network-level failure of
// EITHER call (not a non-2xx response — fetch() doesn't reject for
// those) — since load() was called with no .catch(), that rejection
// went unhandled, state.role stayed null forever, and `role !==
// 'super_admin'` made this component return null permanently, with
// zero visual indication, zero retry, and no other header element
// affected (none of them depend on this fetch). initialRole seeds
// state.role from the exact same server-derived value TopNav already
// trusts, so this component's very existence no longer hinges on one
// unprotected client-side fetch pair succeeding — the fetch is now
// purely a refinement (current org name, org list, active override),
// not the sole source of whether the bar appears.
export default function OrgSwitcher({ initialRole }: { initialRole: Role | null }) {
  const [state, setState] = useState<State>({ role: initialRole, activeOrgId: null, activeOrgName: null, orgs: [] });
  const [homeOrgName, setHomeOrgName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  // Keyboard support only (Phase B chrome): which option to focus when the
  // list opens from the keyboard, and the trigger to return focus to.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'active' | 'last' | null>(null);
  const panelId = useId();
  const headingId = useId();

  useEffect(() => {
    async function load() {
      try {
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
      } catch (err) {
        // A genuine network-level failure here must never silently and
        // permanently hide this bar for the rest of the page's life —
        // initialRole (seeded above from the server) already keeps the
        // bar visible for a real super_admin regardless of this catch;
        // this only stops the fetch's own org-list/active-override
        // refinement from applying for this load, logged so it's
        // diagnosable rather than invisible.
        console.error('[OrgSwitcher] failed to load org context', err);
      }
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

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const options = optionButtons(panelRef.current);
    const target =
      focusOnOpen.current === 'last'
        ? options[options.length - 1]
        : options.find(o => o.getAttribute('aria-current') === 'true') ?? options[0];
    target?.focus();
    focusOnOpen.current = null;
  }, [open]);

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
  const contextLabel = isOverriding ? 'Viewing as' : 'Organisation';

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerClick(e: ReactMouseEvent<HTMLButtonElement>) {
    // detail === 0: activated from the keyboard (Enter / Space).
    if (!open && e.detail === 0) focusOnOpen.current = 'active';
    setOpen(o => !o);
  }

  function handleTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowDown' ? 'active' : 'last';
      if (open) {
        const options = optionButtons(panelRef.current);
        options[e.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
        focusOnOpen.current = null;
      } else {
        setOpen(true);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  function handlePanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const options = optionButtons(panelRef.current);
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAndReturnFocus();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length > 0) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      options[(index + step + options.length) % options.length].focus();
    } else if ((e.key === 'Home' || e.key === 'End') && options.length > 0) {
      e.preventDefault();
      options[e.key === 'Home' ? 0 : options.length - 1].focus();
    }
  }

  return (
    <div
      ref={dropRef}
      className={styles.bar}
      data-impersonating={isOverriding ? 'true' : undefined}
      onBlur={e => {
        // Keyboard dismissal: close once focus moves to another element
        // outside the bar. A null relatedTarget (window blur, press on a
        // non-focusable area) is left to the outside-press handler above.
        const next = e.relatedTarget as Node | null;
        if (open && next && !e.currentTarget.contains(next)) setOpen(false);
      }}
      style={{
        fontSize: 12,
        fontFamily: 'var(--font-inter), -apple-system, sans-serif',
        whiteSpace: 'nowrap',
      }}
    >
      <div
        className={styles.barInner}
        style={{
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
        {isOverriding ? (
          <span className={styles.badge}>{contextLabel}</span>
        ) : (
          <span className={styles.label}>{contextLabel}</span>
        )}

        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${contextLabel}: ${currentLabel ?? ''}. Switch organisation`}
        >
          <span className={styles.triggerText}>{currentLabel}</span>
          <svg className={styles.chevron} width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M1 2l3 3 3-3" />
          </svg>
        </button>

        {isOverriding && (
          <button
            type="button"
            className={styles.returnLink}
            onClick={() => switchOrg(null)}
            disabled={busy}
            aria-label="Return to Brainbase"
          >
            Return<span className={styles.returnSuffix}> to Brainbase</span>
          </button>
        )}

        {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          onKeyDown={handlePanelKeyDown}
          style={{ zIndex: 50 }}
        >
          <p id={headingId} className={styles.panelHeading}>
            Switch organisation
          </p>
          <ul className={styles.list} aria-labelledby={headingId}>
            {state.orgs.map(org => {
              const isCurrent = state.activeOrgId === org.id;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => switchOrg(org.id)}
                    disabled={busy}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <svg className={styles.check} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M2.5 6.2 5 8.6l4.5-5" />
                    </svg>
                    <span className={styles.optionText}>{org.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {isOverriding && (
            <>
              <div className={styles.separator} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.option} ${styles.optionReturn}`}
                onClick={() => switchOrg(null)}
                disabled={busy}
              >
                <svg className={styles.check} viewBox="0 0 12 12" aria-hidden="true" focusable="false" />
                <span className={styles.optionText}>Return to Brainbase</span>
              </button>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function optionButtons(panel: HTMLElement | null): HTMLButtonElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) : [];
}
