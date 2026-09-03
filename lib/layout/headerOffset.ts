// Phase D.4.5C-W2 — single shared source of truth for the app's global
// sticky header height. Before this, TopNav's own `height: 52` and every
// fixed/sticky consumer that needs to render immediately below it
// (OrganiserShell, WorkspaceShell, AdminAside, CrmSidebar, Founder OS,
// the deployments page, client detail, OnboardingWizard) each duplicated
// a bare `top: 52` literal independently. That silently broke for any
// super_admin session once components/admin/OrgSwitcher.tsx started
// rendering a real, non-zero-height bar in normal document flow ABOVE
// TopNav (see the D.4.5C-W1 audit) — TopNav itself is still exactly
// 52px tall, but no longer starts at viewport y=0, so every consumer
// hardcoding `top: 52` rendered its content partially underneath
// TopNav's own lower portion.
//
// TOP_NAV_HEIGHT_PX is TopNav's own real, exact, never-varying height
// (imported and used directly by components/nav/TopNav.tsx itself, not
// duplicated) — safe to treat as a true constant, unlike OrgSwitcher's
// height, which depends on font metrics/padding and is measured at
// runtime instead (see OrgSwitcher's own effect).
//
// APP_HEADER_OFFSET_VAR is the one CSS custom property every fixed/
// sticky consumer should use in place of a bare `top: 52` (or
// `calc(100vh - 52px)`-style height calculations). It defaults to
// exactly TOP_NAV_HEIGHT_PX (see the :root rule in app/globals.css) —
// correct for the overwhelming majority (non-super_admin) case with
// zero JavaScript required, and correct for the very first paint before
// any client effect runs. OrgSwitcher's own effect corrects it upward
// only for a resolved super_admin session, once its real rendered
// height is known.
export const TOP_NAV_HEIGHT_PX = 52;

export const APP_HEADER_OFFSET_CSS_VAR = '--app-header-offset';
export const APP_HEADER_OFFSET_VAR = `var(${APP_HEADER_OFFSET_CSS_VAR})`;

/** Common `calc(100vh - <offset>)` full-height-below-header pattern —
 * several consumers (AdminAside, CrmSidebar, Founder OS) previously
 * duplicated `calc(100vh - 52px)` alongside their own `top: 52`. */
export const APP_HEADER_OFFSET_VH_CALC = `calc(100vh - ${APP_HEADER_OFFSET_VAR})`;

/**
 * Sets the shared --app-header-offset CSS custom property to
 * TOP_NAV_HEIGHT_PX plus the given extra height (e.g. OrgSwitcher's own
 * measured rendered height, or 0 once resolved as non-super_admin).
 * The only writer of this property should be OrgSwitcher's own effect —
 * consumers only ever read APP_HEADER_OFFSET_VAR.
 */
export function setAppHeaderExtraOffsetPx(extraPx: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    APP_HEADER_OFFSET_CSS_VAR,
    `${TOP_NAV_HEIGHT_PX + extraPx}px`,
  );
}
