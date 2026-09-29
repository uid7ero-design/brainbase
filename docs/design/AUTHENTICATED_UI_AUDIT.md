# Brainbase Authenticated UI Audit

| | |
|---|---|
| Date | 2026-09-26 |
| Branch | `feat/app-visual-system-convergence` (local, not pushed) |
| Base | `origin/feat/brand-alignment-broken-orbit` @ `b9b0583d58e70abfe6cd280b83b07e38875a9146` |
| Type | Audit only — no application code changed |
| Method | Static source audit of every authenticated surface (five parallel read-only module audits plus direct inspection of the shared foundation), with targeted spot-verification of high-impact claims. Contrast ratios computed from token values. |
| Visual review | **Not performed.** See [Blockers to visual verification](#blockers-to-visual-verification). Every finding here is from source, not from rendered screens. |

Line references (`file:line`) are against `b9b0583` and are indicative; re-confirm before editing.

---

## Executive summary

Brainbase's inside is **half-converged**. The brand-alignment commit (`b9b0583`) moved the CRM, People, Commercial and Data Hub page surfaces onto theme tokens, fixed the People outline buttons and the CRM/Commercial active sidebar item, and introduced the broken-orbit mark and the locked palette into `app/globals.css`, `components/dashboard/ui/tokens.ts` and `components/ops/theme.ts`.

What it did not do is give the application a **system**. The authenticated product today is a collection of modules that each hand-build their own buttons, tables, drawers, status maps, sidebars and menus, styled with inline objects and hard-coded values tuned for the dark theme. The result:

1. **Five parallel colour systems** — CSS variables (`app/globals.css`), the public `--bb-*` tokens, dashboard JS tokens (`tokens.ts`), the ops `ink()/paper()` palette, and a private slate/Tailwind set inside `DashboardShell` (plus a sixth in `app/dashboard/waste/_dark.tsx`). They disagree on neutrals, status colours and focus.
2. **Light theme is not safe for authenticated users.** Dark is the default, but light is reachable (theme toggle in the ops sidebar; persisted `bb-theme`). In light mode large parts of Dashboard, Admin, Operations drawers/widgets, Events, Reports/Briefings, Portal, Clients, Onboarding, Settings/Branding and the TopNav Operations/Admin menus render near-white text on the warm off-white background or drop in black slabs. Roughly **2,170 `rgba(255,255,255,…)` literals across 99 authenticated files** and ~470 legacy-violet literals (`#A78BFA`, `#C4B5FD`, `rgba(139,92,246,…)`, `rgba(124,58,237,…)`) never adapt.
3. **There is no application focus style.** No `:focus-visible` rule exists for authenticated surfaces (the only one is scoped to public `.bb-public`/`.bb-semantic`), `--border-focus` is still the pre-brand violet `rgba(124,58,237,.45)`, and ~60 inline `outline: none` declarations remove the browser default.
4. **Muted text fails WCAG AA in both themes** — `--text-muted` is 2.98:1 (light) and 2.55:1 (dark) — and it carries every label, empty state and "—".
5. **No shared work-surface primitives.** Zero shared table, button, form-field, drawer, menu, status or sidebar components in the app. The existing, accessible, theme-aware `components/ui/semantic/*` (Badge, Banner, Alert, StatusDot, LiveRegion) is used **only by public pages**.
6. **The shell does not scale down.** No responsive AppNav or sidebars; the TopNav right cluster alone exceeds a 390px viewport; module sidebars are fixed 200–220px.
7. **The dashboard over-frames and in places fabricates.** `/command` uses glass, glows and hover lifts, mixes hard-coded KPI values and invented sparklines with live ones, and reuses status colours as category colours — the opposite of "communicate operational state".

None of these block the product from working in its default dark theme, so there are **no P0 blockers** on that basis (see the light-theme caveat under P0). The highest-value work is a **foundation phase** (one token source, semantic aliases, focus ring, status/surface tokens, a small primitive set) followed by chrome and work-surface convergence. Because almost all remaining debt is presentational inline style, functional risk is generally **Low–Medium**, provided edits stay literal-for-token and leave hooks, handlers and data flow alone.

---

## Target direction

**HLNA Labs** — "Practical software for real-world problems."
**Brainbase** — Operational Platform — "A connected operating platform for people, work and information."

Brainbase should feel mature, technical, operational, calm, precise, deliberate, highly usable and information-dense where useful, and consistent across modules. It must not feel like generic SaaS, an admin template, glassy, neon, over-rounded, card-heavy, bundled-together apps, or an AI-generated kit.

Locked product colours:

| | Light | Dark |
|---|---|---|
| Background | `#F5F3EE` | `#0B0B0C` |
| Primary line / text | `#15171B` | `#F3EEE6` |
| Brainbase accent | `#6D4CD6` | `#9B7BFF` |
| Secondary neutral | `#8A8580` | `#8A8580` |

- **Purple is selective:** active navigation, selected states, primary actions, focus, key highlights, product identity. Never a major surface.
- **Cyan is semantic:** sync, provenance, data movement, information relationships. Not a second brand colour.
- **Status colours stay semantically distinct** (success / warning / error / info / neutral), and never carry meaning by colour alone.
- **Broken-orbit geometry is locked** (`components/brand/BrokenOrbitMark.tsx`): orbit and satellite neutral, only the core takes the accent.

Contrast facts for the locked palette (computed):

| Pair | Ratio | Use |
|---|---|---|
| `#15171B` on `#F5F3EE` | 16.2 | primary text ✓ |
| `#F3EEE6` on `#0B0B0C` | 17.0 | primary text ✓ |
| `#6D4CD6` on `#F5F3EE` | 5.18 | accent text ✓ |
| `#9B7BFF` on `#0B0B0C` | 6.25 | accent text ✓ |
| `#FFFFFF` on `#6D4CD6` | 5.75 | primary button label ✓ |
| `#0B0B0C` on `#9B7BFF` | 6.25 | dark primary button label ✓ |
| `#8A8580` on `#F5F3EE` | 3.29 | **large text / non-text only** |
| `#8A8580` on `#0B0B0C` | 5.38 | body text ✓ |

The secondary neutral is AA-safe for body text in dark but **not in light**; light needs a darker derived muted value (see Token audit).

---

## Existing design-system foundation

### What is already centralised

| Asset | Location | State |
|---|---|---|
| App theme variables | `app/globals.css` `:root` / `:root[data-theme='light']` | Locked backgrounds, primary text and accent values present. Structure is sound. |
| Theme switching | `components/theme/ThemeProvider.tsx`, pre-paint init script in `app/layout.tsx` | Works; `data-theme` on `<html>`, persisted as `bb-theme`. Provider initial state is `'dark'`, so client consumers get one dark frame before storage is read. |
| Header offset | `lib/layout/headerOffset.ts` (`TOP_NAV_HEIGHT_PX`, `--app-header-offset`) | Consistently used by sidebars and shells. A contract to preserve. |
| Broken-orbit mark | `components/brand/BrokenOrbitMark.tsx`, `public/Brand/brainbase-broken-orbit.svg` | Correct per rule (neutral orbit/satellite via `--brand-line`, accent core). Guarded by `tests/containment/brokenOrbitBrandAlignment.test.ts`. |
| Semantic state components | `components/ui/semantic/*` + `--bb-{success,warning,error,info,active,inactive,syncing}-*` tokens in `styles/brainbase-tokens.css` | Accessible (shape + text, correct live-region semantics), theme-aware, tested (`tests/components/semantic/*`). **Unused in the authenticated app.** |
| Public design tokens | `styles/brainbase-tokens.css` (`--bb-*`) | Full light/dark set incl. spacing, radius, focus, status. Scoped in practice to public pages. |
| Dashboard JS tokens | `components/dashboard/ui/tokens.ts` | `LIGHT_TOKENS`/`DARK_TOKENS` match the locked warm palette. `COLORS`/`STATUS_COLORS` are Tailwind hexes with no light variants. |
| Ops palette | `components/ops/theme.ts` (`useOpsTheme`, `ink()`, `paper()`, `OPS_PALETTE`) | Genuinely theme-aware; the ops shell (Sidebar, OpBar, IntelRail) works in both themes. `ink()` bases on pure white / `rgba(15,17,23)` rather than the locked text colours. |
| Tokenised modules | CRM, People, Commercial, Data Hub page surfaces | Mostly on `--bg-*`/`--text-*`/`--border` since `b9b0583`, with leftovers (below). |

### What is duplicated

| Pattern | Copies |
|---|---|
| Slide panel / drawer | `app/crm/_components/SlidePanel.tsx`, `app/people/_components/SlidePanel.tsx`, `app/commercial/_components/SlidePanel.tsx` (byte-identical apart from comments); `app/people/_components/PersonDrawer.tsx`; `components/ops/DrilldownDrawer.tsx` and `components/ops/maintenance/MaintenanceJobDrawer.tsx` (near-identical); Organiser item drawer (`app/organiser/page.tsx`) |
| Modal | `components/ops/maintenance/CreateJobModal.tsx`, `app/admin/orgs/AdminClient.tsx`, `app/admin/users/UsersClient.tsx`, founder page (×3), sessions dialogs (`app/dashboard/sessions/page.tsx` — the only ones with `role="dialog"`), Organiser column-options, legacy `/data` report modal |
| Module sidebar | `CrmSidebar.tsx` ≈ `CommercialSidebar.tsx` (differ only in items); `components/admin/AdminAside.tsx`; `components/ops/Sidebar.tsx`; `components/organiser/OrganiserRail.tsx`; People has none |
| Dropdown / menu button | TopNav `OpsDropdown` ≈ `AdminDropdown` (~280 lines duplicated, `TopNav.tsx:180-504` vs `:541-786`); `components/admin/OrgSwitcher.tsx`; Events `FilterDropdown` (`app/events/_components/ui.tsx:225`); Organiser `AssigneeDropdown` (`app/organiser/page.tsx:216-330`, self-described copy) |
| KPI / metric tile | **16** implementations — `components/dashboard/ui/KpiCard.tsx`, `OrganisationDashboard.tsx:46`, `OverviewClient.tsx:38`, `ServiceRequestsClient.tsx:50`, `SocialClient.tsx:92`, `WasteClient.tsx:127`, `waste/_dark.tsx:47`, `WSTEClient.tsx:30`, `FleetClient.tsx:53`, six `StatCard`s (construction, facilities, logistics, parks, roads, water), `TennisDashboard.tsx:101`, Command `KpiStrip` |
| Status / badge maps | Five Commercial `_status` files; `PaymentStateBadge` and the quote delivery map; People `StatusBadge` + restricted-cases `Status`; CRM `ClassificationBadge`; CRM `STAGE_COLORS` ×3; Events `StatusBadge`; Command `S` map; `HlnaBriefingWidget` severity; `IntelRail` `PRIORITY_COLOR`; admin pipeline/portal booking status (duplicated verbatim, and **disagreeing**: `reschedule_requested` is amber in Portal, red in Admin) |
| Table cell styles | `th`/`td`/`empty` re-declared in ~25 pages (e.g. `app/crm/contacts/page.tsx:127-129`, `app/people/page.tsx:176-178`, Commercial list and detail pages, every Data Hub panel) |
| Form field styles | `inp`/`sel`/`lbl` copied across CRM forms (4), `PersonForm`, Commercial forms (3, `CustomerForm` exports `sel`), People teams/administrators, Commercial detail pages, admin clients, onboarding steps, both profile pages, Portal, Data Hub Sources |
| Button styles | `btn()`/`actionBtn()`/`outlineBtn()`/`dangerBtn()` redefined in nearly every CRM/People/Commercial page with signature drift; three destructive styles in Commercial alone |
| Capability-denied screen | `app/crm/layout.tsx:36-58`, `app/people/layout.tsx:30-52`, `app/commercial/layout.tsx:39-61`, hard-coded `app/organiser/layout.tsx:64-70`, `app/events/page.tsx:19-27` |
| Clock / profile chip | TopNav and ops `OpBar` each have one (two clocks, two profile chips and two logos on `/command`) |
| Chart theme | `DashboardShell` `th`, `tokens.ts`, `waste/_dark.tsx` (`GRID`/`TICK`/`DTT`), `insights/tabs/constants.ts` (pins `DARK_TOKENS`), 24 navy `#1a1a2e` tooltips |
| Global CSS injection | `components/ops/WorkspaceShell.tsx:71-80` and `components/organiser/OrganiserShell.tsx:29` each inject `body { overflow: hidden !important }` (+ box-sizing/scrollbar rules in WorkspaceShell) |

### What is inconsistent

- Active navigation: **eight different treatments** (see Shell module) and no `aria-current` anywhere in the app shell or module sidebars.
- Radius: 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20 and 999 all in use; no scale in the app (the public `--bb-radius*` exists but is unused inside).
- Neutrals: `--text-secondary` is cool zinc `#A1A1AA`/`#52525B`; `tokens.ts` uses warm `#aaa6a0`/`#77736e`; `ink()` uses pure white/near-black alpha; the locked `#8A8580` is not a token.
- Status colours: Tailwind 400s in dark (`#4ADE80`, `#FBBF24`, `#F87171`, `#60A5FA`) reused in light where they fail contrast; `tokens.ts` `#ef4444`/`#10b981` differ again from CSS `--green`/`--red`.
- Two HLNA accents: `--brand-hlna-accent: #E06C23` exists while HLNA UI uses violet `#A78BFA`.

### What should become shared (and what should not)

| Shared primitive / token | Module-specific (keep local) |
|---|---|
| Semantic colour aliases, focus ring, status fg/soft/border, surface/elevation, radius, shadow, scrim, chart tokens | Domain status vocabularies (the *labels* and lifecycle mapping stay in each module's `_status`/lib files — only the tone→token mapping is shared) |
| `Button` variants (primary, secondary, outline, ghost, destructive, link) | Organiser user-chosen label palette (validated per theme, but module-owned) |
| `DataTable` styles (header, row rhythm, numeric column, row action, overflow wrapper, empty row) | Waste/recycling bin colours (`BIN_COLOR`) — semantic to the domain |
| `Field` / `Input` / `Select` / `Textarea` + label/helper/error wiring | Check-in camera viewport (`#000`) and QR white background |
| `SlidePanel` / `Drawer` / `Modal` with dialog semantics | Stateful HLNA / Helena visuals (`HlnaOrb`, `HelenaOrbital`, `HelenaWorkspace`) — deliberately expressive |
| `ModuleSidebar` + `SidebarNavItem`; `MenuButton` / `DropdownPanel` | Public event ticket (`components/events/TicketCard.tsx`), dark by design |
| `MetricTile`, `Panel` (header + hairline), `EmptyState`, `Notice` (adopt `components/ui/semantic`) | Tenant-branded public event themes (`publicEvents`) |
| `CapabilityDenied` screen | Tennis public app (`app/tennis`) — separate surface |

Do not abstract beyond this list. Page layouts, domain forms and module information architecture should stay where they are.

---

## Cross-application findings

### P0 — genuine blocker only

**None in the default (dark) theme.** Every module functions and is broadly legible in dark.

**Conditional P0 — decision needed:** if light theme is a supported mode for authenticated users (it is reachable today via the ops sidebar toggle and persisted `bb-theme`), the following are blockers, because content becomes invisible, not merely off-style:

- `app/portal/page.tsx:51-53` — typed input text `#F5F7FA` on a near-transparent field (invisible in light); H1 `#F5F7FA` at `:209`.
- `app/clients/page.tsx:119`, `app/settings/**/BrandingSettingsClient.tsx:239` — H1 `#F5F7FA`/`#f9fafb` on a transparent wrapper.
- TopNav **Operations** and **Admin** menus — inactive triggers `rgba(255,255,255,.45)`, panels always `rgba(7,5,16,.98)` (`components/nav/TopNav.tsx:281-296`, `:344-352`, `:620-636`, `:683-691`): super_admin / HQ navigation unreadable in light.
- Commercial "+ New Customer / + New Supplier" — `#15171B` text on `#1f2937` (`app/commercial/quotes/new/page.tsx:70`, `invoices/new/page.tsx:94`, `purchasing/purchase-orders/new/page.tsx:82`).

Recommendation: treat light as supported (the brand defines it) and schedule these first inside Phase A/B.

### P1 — major convergence issues

1. **Fragmented token systems** (five-plus sources; see Token audit). Everything downstream depends on collapsing these to one CSS-variable source with semantic aliases.
2. **Light-theme failure across un-tokenised modules** — Dashboard pages (`OverviewClient.tsx:103-118`, `ServiceRequestsClient.tsx:15,174`, `bin-maintenance/page.tsx` with 108 white-alpha literals and 0 `ink()` calls), ops drawers/modals/widgets (`DrilldownDrawer.tsx:275,297`, `MaintenanceJobDrawer.tsx:222-240`, `CreateJobModal.tsx:110-121`, `ops/widgets/Widget.tsx:28-30`, `HlnaBriefingWidget.tsx:70,169-231`), Admin (0 theme variables, `#07080B` base), Events KPI cards forced `theme="dark"` (14 instances) and `FilterDropdown` panel (`app/events/_components/ui.tsx:287-328`), Reports/Briefings, Onboarding header, both profile pages, `app/dashboard/loading.tsx` (dark flash in light).
3. **No application focus style.** No `:focus-visible` rule for authenticated surfaces; `--border-focus` off-brand and unused; ~60 inline `outline: none` (CRM 9, People 6, Commercial 5, Dashboard/Command 20, Admin/settings/onboarding/portal 22, Events partially covered by `.bb-evt-input` using old violet).
4. **`--text-muted` fails AA in both themes** (2.98:1 light, 2.55:1 dark), plus low-alpha labels such as `ink(.22)`/`rgba(255,255,255,.25)` at ~2:1.
5. **Status colours fail contrast in light and are inconsistent**: Tailwind-400 status text across Commercial `_status` files, People `StatusBadge` (`#6ee7b7` ≈ 1.5:1 on white), Events `GREEN/RED/YELLOW` (`ui.tsx:25-27`) and `#FCA5A5` errors (20+), Data Hub warnings `#fbbf24` (~1.7:1, 11 sites). Same state, different colours across modules (`SENT`, `APPROVED`/`ACCEPTED`, `reschedule_requested`).
6. **Keyboard access gaps in core navigation and work surfaces**: TopNav Operations/Admin menus are hover-only (no click, no `aria-expanded`, no Escape); OrgSwitcher trigger has no `aria-expanded`/Escape/arrow keys and no scroll for long lists; Organiser boards, kanban cards and item names are `div`/`span onClick` with hover-only actions; `/command` ribbon cells and alert cards are clickable `div`s.
7. **Drawers, panels and modals lack dialog semantics** — no `role="dialog"`/`aria-modal`, no Escape, no focus trap/return, unlabeled `×` close buttons, fixed widths (440/480/520/420px) that overflow a 390px viewport. Applies to all three `SlidePanel`s, ops drawers and modal, admin modals, Organiser drawer.
8. **Active navigation is inconsistent across 8 surfaces** and never exposes `aria-current`.
9. **Shell is not responsive**: fixed 150px spacer, 185px logo box and `flexShrink: 0` right cluster in AppNav (`TopNav.tsx:1122-1128`, `:1566-1576`); at 1024px the centre nav scrolls with a hidden scrollbar; at 390px the page overflows horizontally. Sidebars fixed 200/220px with fixed `36px 40px` main padding; ops Sidebar 220 + IntelRail 260 leave ~544px at 1024.
10. **Dashboard framing and honesty**: glassmorphism and glow shadows on `/command` (`app/command/page.tsx:216-220,370,384,407,480-508,521,559,582`); hard-coded or invented KPI values next to live ones without a strip-level demo label (`completion ?? 81`, static "Fleet Avail. 88%", invented trend labels and sparklines — `page.tsx:182-199`); static `IntelRail` health rows (`IntelRail.tsx:42-66`); status colours used as category colours (`page.tsx:841-843,876`; insights `KpiCard accentColor`).
11. **No theme toggle in AppNav** — signed-in users outside `/command` and bin-maintenance cannot change theme.

### P2 — polish / consistency

- Leftover dark-tuned literals in tokenised modules: `#1a1d24` borders (31 in CRM/People/Commercial forms and panels), near-white text greys (`#d1d5db`, `#e5e7eb`, `#f3f4f6`), `#1f2937` "secondary" slabs (~20 in Commercial), off-brand confirm-panel blue `rgba(26,106,255,…)`.
- Numbers and currency left-aligned with no `tabular-nums` (repo-wide zero outside a few Data Hub tables); inconsistent row padding (11/13, 8/10, 12px).
- Tables without horizontal overflow wrappers (CRM, People) are crushed at 390px; Commercial lists do it right (`overflowX:auto` + `minWidth`).
- Unassociated labels (0 `htmlFor` in CRM/People forms, profile pages, onboarding, Portal); search/filter inputs without labels; Portal inputs placeholder-only.
- Radius and type-size drift (124 font sizes ≤10px in Admin; 9–9.5px section labels in ops/Organiser rails).
- Legacy violet and indigo as accents (`#7c3aed`, `#8a4dff`, `#8B5CF6`, `#a5b4fc`, `#6366F1`, `rgba(99,102,241,…)`); purple used as a data colour (CRM stages/KPIs, Events totals, Clients counts); cyan used decoratively (Fleet Cost `#08a9cb`, Events "Ticket Capacity", LeftSidebar "work" mode) while Data Hub — where cyan belongs — uses none.
- Double chrome on `/command` and bin-maintenance: TopNav (52px) above OpBar (44px) with duplicated clock, profile and logo; OpBar `backdrop-filter: blur(24px)`.
- Global CSS leakage from `WorkspaceShell` and `OrganiserShell` injected styles (relies on unmount to clear).
- People has no module sidebar (the only business module without one); CRM detail pages and several dashboards have no `<h1>`.
- `app/dashboard/loading.tsx` ambient violet glows and glass cards.
- Emoji used as status or KPI icons (Portal statuses, `OrganisationDashboard.tsx:160-173`).
- Impersonation bar in OrgSwitcher is solid brand purple — brand colour used as an alert state (needs review; a semantic "viewing as" treatment is more appropriate).

### P3 — optional refinement

- Delete dead UI (evidence of no importers): `components/*_legacy/**`, `components/Sidebar.jsx`, `components/BrainBase_legacy.jsx`, `ChatInput.jsx`, `ResponsePanel.jsx`, `Orb.jsx`, `layout/MetricsStrip.jsx`, `app/admin/orgs/OrgsClient.tsx`.
- Retire or re-theme the legacy `/data` uploader (`app/data/DataClient.tsx`, dark-only, still linked from TopNav and the ops Sidebar) once Data Hub covers it.
- `/dashboards` rainbow catalogue (13 hues), no h1.
- AdminAside `<a>` vs `<Link>` (full reloads); six local `FONT` constants.
- `<meta name="theme-color">` fixed to `#0B0B0C`; add light/dark `media` variants.
- Reduced-motion guard for `/command` blink/pulse/heartbeat animations.
- Pagination for unbounded CRM/People/Commercial lists (functional, see below).

---

## Module audit

### MODULE: Application shell & TopNav (`components/nav/TopNav.tsx` AppNav, `app/layout.tsx`, `lib/layout/headerOffset.ts`)

Current strengths:
- AppNav bar is on tokens (`--bg-base`, `--border`, 52px from `TOP_NAV_HEIGHT_PX`); `NavItem`/`HlnaItem`/`SquadItem` use `--purple-300`/`--text-secondary` and adapt.
- `--app-header-offset` contract used consistently by every sticky consumer.
- Pre-paint theme script prevents a theme flash at the document level.
- Menu panels are portaled out of the clipped nav row.

Visual inconsistencies:
- Active nav across surfaces:

  | Surface | Active text | Active bg / border | Radius | Size |
  |---|---|---|---|---|
  | TopNav NavItem `:58-68` | `--purple-300` | rgba(155,123,255,.10) / .24 | 7 (HLNA/Squad 6) | 13 |
  | Ops/Admin triggers `:281-296`, `:620-636` | `#C4B5FD` | rgba(139,92,246,.10) / .22 | 7 | 13 |
  | Profile chip `:1596-1608` | – | rgba(167,139,250,.10) / .22 | 20 (pill) | 13 |
  | Branding `:1713` | `--purple-400` | none | 7 | 13 |
  | Crm/CommercialSidebar | `--brand-brainbase-accent` | color-mix 10% | 7 | 14 |
  | ops Sidebar `:104-106` | `accentText` | rgba(139,92,246,.12) + 2px rule | 8 | 12.5 |
  | OrganiserRail `:118-119` | `accentText` | rgba(139,92,246,.14) | 8 | 12.5 |
  | AdminAside `:17-22` | `#e5e7eb` (neutral) | rgba(255,255,255,.06) | 7 | 14 |

- Section label styles drift (11/700/.08em, 9/.16em, 9.5/.12em, 10/.1em `#374151`).
- Wordmark sits at the far right after a blank 150px left spacer — unusual reading order.

Shared-system issues:
- No `:focus-visible` for the shell; `--border-focus` off-brand and unused.
- No theme toggle in AppNav.
- Operations/Admin dropdowns duplicate ~280 lines and are dark-only.
- Clock date `rgba(255,255,255,.22)` (`:950`) and profile hover `rgba(255,255,255,.05)` (`:1620`) dark-only.

Module-specific issues:
- Hover-only menus: no click, keyboard, Escape or `aria-expanded` (`:267-305`, `:606-644`).
- No mobile nav; right cluster overflows at 390px; hidden-scrollbar centre row at 1024px.
- Two unnamed `<nav>` landmarks per page; no skip link; avatar `alt="avatar"`.
- `components/nav/Breadcrumb.tsx:11-33` is light-only (`#0f172a` text invisible in dark) — the inverse bug.

Recommended changes:
- One `SidebarNavItem`/`NavPill` primitive with token-driven active state (accent text, `--accent-soft` fill, optional 2px rule, radius 6) and `aria-current="page"`.
- One `MenuButton`/`DropdownPanel` (click + keyboard, `aria-expanded`/`aria-haspopup`/`aria-controls`, Escape + focus return, arrow keys) replacing OpsDropdown/AdminDropdown.
- App-level `:focus-visible` ring from `--focus-ring`.
- Move theme toggle into AppNav.
- Responsive AppNav: collapse secondary items into a menu below ~1100px; remove fixed spacers.

Risk to functionality: **Medium** — restyling is low-risk, but TopNav is 1,919 lines with role/capability gating (`TopNav.tsx:982-1091`) and the header-offset contract; both must be preserved exactly. Recommend extracting primitives without touching gating logic.

### MODULE: Organisation switcher (`components/admin/OrgSwitcher.tsx`)

Current strengths:
- In-flow bar on tokens (`--bg-surface`, `--border`, `--bg-raised`, `--text-*`).
- Measures and publishes its own height to the header offset; closes on outside click; disables while busy.

Visual inconsistencies:
- Impersonation state turns the whole bar solid `--purple-600` with `#fff` text (`:199-201`, `:231-234`, `:249`) — brand purple as an alert state (E).
- Active org marked with `--purple-400`, which is not remapped in light (≈3.1:1 on white) (`:277`, `:283`).

Shared-system issues:
- `rgba(226,232,240,.6)` (`:295`) dark-only (B → `--text-secondary`); heavy `rgba(0,0,0,.5)` shadow (`:263`) (C → `--shadow-popover`).

Module-specific issues:
- No `aria-expanded`/`aria-haspopup`/`aria-controls`; no Escape, arrow keys or focus return; list has no role/`aria-current`; no max-height/scroll (`overflow: hidden`, `:263`) so long org lists are cut off; no search.

Recommended changes:
- Semantic "viewing as" treatment (warning tone + text, not brand fill).
- Listbox/menu semantics with keyboard support, `max-height: 60vh` + scroll, optional filter input.
- Longer term: fold into AppNav's right cluster as a menu button, removing the extra header band.

Risk to functionality: **Medium–High** — it drives impersonation and `--app-header-offset`, which every sticky/fixed consumer depends on. Style-only changes first; structural merge only with explicit offset tests.

### MODULE: Dashboard / Command (`/dashboard`, `/command`, `/dashboards`, `app/dashboard/*`, `components/dashboard/*`)

Real vs static:
- **Real**: `/dashboard` (→ `OrganisationDashboard` or `TennisDashboard`; HQ → `/admin/founder`), overview, service-requests, bin-maintenance (+ insights), sessions, leads, contacts, pipeline, blog, social, integrations, wste.
- **Mixed**: `/command` (live KPI strip and analytics tabs; static alerts, system status, changes, `IntelRail`, `HlnaBriefingWidget`).
- **Static (sampleData via `DashboardShell`)**: construction, depot, environment, facilities, labour, logistics, parks, roads, supply, water; fleet partly.
- **Static mockups**: `app/dashboard/waste/*`.

Current strengths:
- `OrganisationDashboard.tsx` uses CSS variables, renders only metric groups with real rows, has an honest empty state (`:178-187`) and an `h1` (`:111`).
- `ModuleAccessCard` is fully token-driven.
- `/command` labels demo content ("Demo Environment", DEMO tags).
- `tokens.ts` light/dark sets already match the locked palette.

Visual inconsistencies:
- 16 KPI/metric implementations; radius 9/10/11/12/14/16; glass (`backdropFilter` 12–16px) and coloured glow shadows on `/command`; hover lift on non-interactive tiles (`KpiCard.tsx:199`).
- Status colours as category colours; rainbow palettes (`/dashboards` 13 hues, `CAT_COLORS` 8 hues, briefing agent colours); indigo as a second purple; cyan as decoration (Fleet Cost `#08a9cb`).
- Card-in-card: `MetricCard`s inside a `Card` with dark-only `rgba(255,255,255,0.025)` (`OrganisationDashboard.tsx:75,153-177`); every Command panel repeats the same header strip.

Shared-system issues:
- `DashboardShell` has a private slate/Tailwind token set (`DashboardShell.tsx:219-254`) despite `tokens.ts` claiming to mirror it; all consumers pass `theme="dark"`; `components/dashboard/ui` defaults to `theme='dark'` (`KpiCard.tsx:156`, `Section.tsx:252`).
- 24 navy `#1a1a2e` chart tooltips; insights constants pin `DARK_TOKENS`.
- `app/dashboard/loading.tsx` dark-only skeleton with violet glows (flashes dark in light).

Module-specific issues:
- Fabricated/hard-coded KPI values mixed with live ones without strip-level labelling (`app/command/page.tsx:182-199`).
- `react-grid-layout` 12 fixed columns with no breakpoints (`page.tsx:765-771`); fixed `1fr 252px` / `1fr 320px` grids.
- Missing `h1` on `/command`, `/hlna`, `/dashboards`; clickable `div`s; no reduced-motion guard on blink/pulse animations.

Recommended changes:
- One theme-aware `MetricTile` (tokens, no hover lift, no gradient) and one `Panel` (header row + hairline; typography instead of boxes).
- Remove `backdropFilter` and glow shadows; neutral ink for category values; status colours only for status; one accent plus a neutral ramp for series.
- `DashboardShell` and `components/dashboard/ui` read the theme (CSS variables) instead of a hard-coded prop.
- Label any static/sample metric at the strip or panel level; never mix unlabelled invented values with live ones.
- Token-based loading skeleton.
- Reduce framing on `OrganisationDashboard`: "Your Tools" as a typographic list, one level of container.

Risk to functionality: **Medium** — mostly inline-style edits, but `DashboardShell` theming touches ~10 pages and the persisted grid layout (`LAYOUT_KEY`) must stay compatible. Do not change data loading or the demo/live selection logic.

### MODULE: Operations workspace (`components/ops/*`; used by `/command` and `/dashboard/bin-maintenance`)

Current strengths:
- Calm 32px engineering grid instead of glows (`WorkspaceShell.tsx:93-98`); Sidebar, OpBar and IntelRail are `ink()`/`paper()` driven and theme-aware.

Visual inconsistencies:
- Dark-only drawers, modal and widgets inside the theme-aware shell (`DrilldownDrawer.tsx` has 0 `useOpsTheme` refs; `MaintenanceJobDrawer.tsx:222-240`; `CreateJobModal.tsx:110-121`; `widgets/Widget.tsx:28-30`; `WeatherWidget.tsx:49`; `MapWidget.tsx:52`; `RequestsMap.tsx:95`; `HlnaBriefingWidget.tsx:70`).
- OpBar glass blur and purple-tinted shadow; gradient avatar `#6D28D9→#A78BFA` vs flat accent in TopNav; blinking "Systems Live" dots not bound to data; blue upload colour `rgba(96,165,250,…)` where cyan is the semantic fit.

Shared-system issues:
- Global CSS injection (`body{overflow:hidden!important}`, `*{box-sizing}`, 3px scrollbars) from `WorkspaceShell.tsx:71-80`.
- Double chrome (TopNav + OpBar).

Module-specific issues:
- Drawers fixed 480px, modal 520px, no `maxWidth: 100vw`; no dialog semantics/Escape/focus trap; unlabeled close buttons; heavy `0 32px 80px` shadows and blurred backdrops.
- Fixed Sidebar 220/56 and IntelRail 260 with no breakpoints; collapse toggle and theme button use `title` only.

Recommended changes:
- Route every ops widget, drawer and modal through `useOpsTheme` (or CSS variables).
- Replace both drawers with the shared `Drawer` primitive (preserving assign/escalate state).
- Scope injected CSS to the shell container; resolve the double header (hide TopNav inside the shell, or fold OpBar into TopNav).

Risk to functionality: **Medium** — drawer workflow state (assign/escalate) and layout persistence must be preserved.

### MODULE: CRM (`app/crm/**`)

Current strengths:
- Sidebar active state now correct (`--brand-brainbase-accent` on a 10% tint, `CrmSidebar.tsx:76-77`) — the pale `#C4B5FD` issue is fixed.
- Consistent list-table grammar (11px uppercase `th`, 13px `td`); `ClassificationBadge` pairs dot + text.

Visual inconsistencies:
- `#1a1d24` borders on every input/select and outline button (`CompanyForm.tsx:66,72`, `ContactForm.tsx:94,100`, `DealForm.tsx:120-127`, `ActivityForm.tsx:40-48`, detail pages) — near-black lines in light.
- Near-white text `#d1d5db`/`#e5e7eb` (detail pages, `deals/page.tsx:75`, every `events-backfill` cell).
- Purple as data colour (pipeline total, Contacts KPI, `proposal` stage, activity types); pink classification tones.

Shared-system issues:
- `STAGE_COLORS` duplicated ×3; `th`/`td`/`btn` re-declared per page; SlidePanel copy.

Module-specific issues:
- Detail pages have no `h1`; fixed `1fr 320px` detail grid and `repeat(5,1fr)` KPIs break at 390px; list tables lack overflow wrappers; money left-aligned and coloured by stage; native `confirm()` for deletes.

Recommended changes:
- Literal→token swap (`#1a1d24`→`--border`, greys→text tokens); stages and classifications mapped to semantic/neutral tones (off purple); overflow wrappers; responsive stacking for detail grids; adopt shared `DataTable`, `Field`, `Button`, `SlidePanel`.

Risk to functionality: **Low** — style-only literals; grid changes need visual QA.

### MODULE: People / HR (`app/people/**`)

Current strengths:
- Outline buttons "Restricted Cases", "Manage Teams", "Manage Administrators" now legible (`var(--text-primary)` + `var(--border)`, `page.tsx:78,87,94`) — previously-reported regression fixed.
- Context-aware empty states; inline confirms instead of `window.confirm`; every page has an `h1`.

Visual inconsistencies:
- Pastel status colours `#6ee7b7`/`#93c5fd`/`#fbbf24` (`page.tsx:163-165`, repeated in teams/restricted-cases) ≈1.5–1.9:1 on white.
- Off-system link blue `#8fb3ff` (restricted-cases); `rgba(255,255,255,.06)` + `#1a1d24` Edit button (`PersonDrawer.tsx:102`); `#d1d5db` secondary button (`restricted-cases/[id]:304`).
- Outline border at `--border` (10% alpha) is faint (E: may need `--border-strong`).

Shared-system issues:
- Verbatim SlidePanel copy; `#1a1d24` input borders (`PersonForm.tsx:276,282`, teams, administrators).

Module-specific issues:
- No module sidebar (sub-navigation lives in header buttons); Teams/Administrators lack a back link; header row (h1 + 3 links + search + Add) does not wrap and overflows at 390px; table has no overflow; pill radius 999 vs 4 elsewhere.

Recommended changes:
- Add a People `ModuleSidebar` (People, Teams, Administrators, Restricted Cases) matching CRM/Commercial; tokenise status and borders; wrap the header row.

Risk to functionality: **Low–Medium** — adding a sidebar changes layout width; keep permission gating on Restricted Cases untouched.

### MODULE: Commercial (`app/commercial/**`)

Current strengths:
- Five `_status` files share one pill grammar (4px radius, 11px uppercase, text label — never colour-only); purchasing statuses sourced from lifecycle libs.
- Best table responsiveness of the three business modules (`overflowX:auto` + `minWidth` 640–860).
- Inline confirm panels for destructive flows.

Visual inconsistencies:
- **Illegible in light**: "+ New Customer/Supplier" (`#15171B` on `#1f2937`).
- `btn('#1f2937')` "secondary" slabs (~20) read as heavy black blocks in light.
- Three destructive styles; off-brand blue confirm panels `rgba(26,106,255,…)`; Tailwind-400 status colours fail on white; `SENT` blue in one map and green in another; `APPROVED` `#34d399` vs `ACCEPTED` `#4ade80`; `PaymentStateBadge` 999 radius vs 4px pills.

Shared-system issues:
- Detail pages re-declare `btn`/`sel`/`th` (PO detail is 1,047 lines); `sel` border `#1a1d24` in some, `var(--border)` in others.

Module-specific issues:
- Numeric/currency columns left-aligned without `tabular-nums` (`invoices/[id]:476-488`, `quotes/[id]:308`, `invoices/page.tsx:103`); row padding varies (11/13, 8/10, 12).

Recommended changes:
- Button variants (secondary, destructive) and status tokens; remove the blue confirm panel; right-align + `tabular-nums` for money; adopt shared `DataTable`/`Field`.

Risk to functionality: **Low–Medium** — very large files; edits must be literal-only and must not touch lifecycle conditionals or document generation.

### MODULE: Data Hub (`app/data-hub/**`, legacy `app/data/**`)

Current strengths:
- Previously-reported light-mode copy issues fixed (`FileSelector.tsx:89-205`, `ImportHistoryPanel.tsx:24-70` on tokens).
- Good table accessibility in places (focusable scroll wrappers with `aria-label`, `scope="col"`, some `tabular-nums`); `role="progressbar"`; consistent `role="alert"`/`aria-live`.
- An `h1` exists on the select step (`FileSelector.tsx:89`).

Visual inconsistencies:
- Buttons: native unstyled buttons in schema/XLSX/worksheet panels vs purple-600 primary vs Sources' own `ACCENT = "#8a4dff"` (old violet).
- Status text uses dark Tailwind shades that fail on light (`#fbbf24` ≈1.7:1 at 11 sites; `#4ADE80`, `#F87171`, `rgba(52,211,153,.85)`), although theme-aware `--bb-*-fg` tokens already exist.
- Radius 8/10/12.

Shared-system issues:
- No shared Button/Table/Notice/Field; duplicated amber and red notice boxes.

Module-specific issues:
- **Cyan never used** — mapping arrows, governed-schema binding, upload/processing progress are exactly its semantic domain.
- No stepper/step indicator; `h1` only on step 1; entire wizard inside one `aria-live="polite"` region (`ImportClient.tsx:72`) so each step re-announces the whole screen.
- `maxWidth: 720` (`ImportClient.tsx:71`) too narrow for data review at 1440.
- Weak drop zone: 1px dashed 10%-alpha border, no drag-over state.
- Sources admin: lists as cards not tables; unlabeled edit inputs; placeholder-only mapping inputs.
- Legacy `/data` (`DataClient.tsx`) dark-only, keyboard-inaccessible drop zone, modal without dialog semantics, still linked from TopNav and the ops Sidebar.

Recommended changes:
- Shared Button/Notice/Table; status text to `--bb-*-fg`; stepper + per-step `h1`/heading; widen review/preview steps (~1100px); stronger drop zone with drag-over state; cyan for mapping/lineage/progress; narrow the live region to status messages only; decide the fate of `/data`.

Risk to functionality: **Low** — presentational; preserve `role`/`id`/`aria-describedby`/`data-*` hooks and all phase-guard/reducer logic.

### MODULE: Events & Ticketing (authenticated: `app/events/**`, `components/events/**`)

Current strengths:
- `app/events/_components/ui.tsx` is a de-facto primitive library (Panel, SectionHeader, EmptyState, StatusBadge, buttons, Field, FilterDropdown) with tokenised layout constants.
- `StatusBadge` always shows text; `FilterDropdown` handles Escape and returns focus; large touch targets in check-in; every page has an `h1`.

Visual inconsistencies:
- Dark-only status constants `GREEN '#4ADE80'`, `RED '#F87171'`, `YELLOW '#FBBF24'` (`ui.tsx:25-27`) used as text on light; `#FCA5A5` errors (20+).
- `VIOLET = var(--purple-400)` not remapped for light and used decoratively on calendar/map icons.
- KPI cards forced `theme="dark"` (14 instances) with translucent-white gradients, accent-coloured values (amber/green/purple/cyan totals) and hover lift.
- `FilterDropdown` panel hard-coded dark (`ui.tsx:287,308-309,325,328`); focus ring old violet (`ui.tsx:356-360`); ~10 of 37 `inputStyle` uses lack the focus class.
- Radius 8/9/10/999.

Shared-system issues:
- `KpiCard` shared with dashboards; `FilterDropdown`/`inputStyle` spread via `triggerStyle` so changes ripple.

Module-specific issues:
- Event list rows and meta pills use `rgba(255,255,255,.02/.06)` (invisible in light); registrations rendered as wrapping "RegField" cards with 6+ actions each rather than a table (poor density, no column alignment, amounts not right-aligned).
- Resend feedback uses `role="alert"` for non-critical warnings.
- Dark-literal fallback states in `events/page.tsx`, `payments/page.tsx`, `[id]/page.tsx`, `check-in/page.tsx`.

Recommended changes:
- Retokenise `ui.tsx` first (status → `--bb-*`, dropdown → overlay tokens, focus → `--focus-ring`), then consider promoting it into the shared app primitive layer.
- Theme-aware metric strip instead of dark KPI cards; registrations as a table; error token for `#FCA5A5`; polite status for resend feedback.

Risk to functionality: **Low–Medium** — ripple through `triggerStyle`/`KpiCard`; do not change registration, payment, refund or check-in logic.

### MODULE: Organiser (`app/organiser/**`, `components/organiser/**`)

Current strengths:
- Uses `useOpsTheme()` so most neutrals flip; drawer portaled correctly; `AssigneeDropdown` has Escape + focus return; rail collapse/options buttons labelled.

Visual inconsistencies:
- Dark-only purple/indigo literals: `#C4B5FD` on `rgba(139,92,246,.24)` for selected/today/recommended; `#a5b4fc` selected option and file links; `rgba(139,92,246,…)` borders ×10.
- Date inputs forced `colorScheme: "dark"` (`page.tsx:749,1523`); selected swatch marker `2px solid #fff` invisible in light; "saving" indicator in purple (a sync state → cyan).
- User label palette (`:106-126`) is a Tailwind set not validated for light (A, but needs per-theme validation).

Shared-system issues:
- `AssigneeDropdown` re-implements Events' `FilterDropdown`; hand-rolled scrims and shadows; dark-literal denied screen (`layout.tsx:64-70`); injected `body{overflow:hidden!important}`.

Module-specific issues:
- **Not keyboard operable** for core tasks: rail boards (`OrganiserRail.tsx:108-121`), kanban cards (`page.tsx:909-911`) and item names (`:712-715`) are `div`/`span onClick`; rename/delete appear on hover only (`:719,771`).
- Drawer lacks dialog semantics, Escape, focus trap; close button unlabeled; drawer title is not a heading; no headings on the page or rail.
- Table view is a fixed-column CSS grid of `div`s (`:134-137`) with no table/grid roles; unusable at 390px.
- No drag-and-drop exists (status changes go through a per-card `<select>`), so there is no drag-without-keyboard gap.

Recommended changes:
- Button/link semantics for boards, cards and names; show actions on `:focus-within`; drawer to shared `Drawer`; retokenise purple literals through `t.accent*`; theme-aware date `colorScheme`; real table (or `role="grid"`) with overflow wrapper.

Risk to functionality: **Medium** — 2,432-line single file with inline-edit / open-drawer click coupling (`page.tsx:698-705`); changing click targets can double-fire rename vs open. Needs focused interaction tests.

### MODULE: Admin (super_admin; `app/admin/**`, `components/admin/AdminAside.tsx`)

Current strengths:
- Dense operational layouts; Founder OS has a local token object `T` (`founder/page.tsx:149-169`) with a sensible 8px radius and mono accent; honest empty states.

Visual inconsistencies:
- Zero theme variables (the only `var(--…)` uses are the font); three base backgrounds (`#07080B`, `#0e1014`, `#0d0f14`), none the locked `#0B0B0C`.
- Off-brand purples (`#8B5CF6`, `#7C3AED`, `#A78BFA`, `#C4B5FD`) in 11 files; indigo `#6366F1` as a status colour; glows on status dots; status-coloured gradients; glass blur (`web-services:495`, `sessions:118`); radius 3–20.
- 124 font sizes ≤10px; 9px labels in `Lbl`/`StagePill`.

Shared-system issues:
- `AdminAside.tsx` all literals; section labels `#374151` on `#07080B` (~1.9:1); active item grey not purple; no `aria-current`; mixes `<a>` and `<Link>` (full reloads).

Module-specific issues:
- Fixed 220px aside + 40px padding, no breakpoint (≈90px content at 390); founder page cancels layout padding with `margin:-40px`, hides the aside, has no `h1`; fixed 420/380px modals overflow at 390; fixed-column grid tables without overflow wrappers; zero `aria-*`; `confirm()` for deletes.

Recommended changes:
- Map `T` onto CSS variables first, then the rest of Admin follows; shared Modal, status map and sidebar; remove glows/gradients/blur; radius to the scale; minimum 11px type.

Risk to functionality: **Medium** — very large inline-style files; founder's `-40px` coupling to the layout padding breaks if padding changes. Purely presentational otherwise; super_admin gating must remain untouched.

### MODULE: Settings / Account / Profile (`app/settings/**`, `app/account/**`, `app/profile/**`)

Current strengths:
- Branding settings has properly associated labels, helper text and inline validation (`BrandingSettingsClient.tsx:32-54,138`) — the best form in the app and a good base for the shared `Field`.

Visual inconsistencies:
- Branding uses off-brand blue primary `#1a6aff` and accent `#8a4dff`; `/account/profile` uses base `#0D0D15`, purple→blue avatar gradient, gradient hero; both profile pages share a role/module rainbow map.

Shared-system issues / light-dark:
- Branding: transparent wrapper with `#f9fafb` H1 (invisible in light) and dark card islands; both profile pages force their own dark background.

Module-specific issues:
- `/account/profile` has no `h1`, unassociated labels, removed focus outline, 10px labels; `/profile` labels unassociated.

Recommended changes:
- Converge both profile pages onto one token-based form kit; keep Branding's form structure, restyle with tokens.

Risk to functionality: **Low–Medium** — see the functional note on the two profile pages (below) before touching either.

### MODULE: Onboarding (`app/onboarding/**`)

Current strengths:
- The only non-core module using `var(--bg-base)`; clear 7-step progress; steps 2/6 reflow with `auto-fill minmax`.

Issues:
- Mixed theming: token background but hard-coded dark header/progress (`rgba(7,8,11,.92)`) and `#F5F7FA`/`#F4F4F5` text — in light a light page with a dark bar and invisible headings.
- Gradient progress fill, glow on active step, gradient submit (`#7C3AED`/`#6D28D9`).
- Own sticky header at `top:0` while the global TopNav also renders — likely double/overlapping header (E).
- Step labels 10px uppercase, clipped at 390px; unassociated labels; removed focus outlines; colour-only required marker.

Recommended changes: tokenise header/progress, remove gradients and glow, resolve the double header, associate labels, text required markers.

Risk to functionality: **Low** — wizard state is separate from presentation.

### MODULE: Clients (super_admin; `app/clients/**`)

Current strengths: reflowing card grid; clear "Viewing <org>" impersonation banner.

Issues:
- Transparent wrapper with `#F5F7FA` H1 and white-alpha muted text (fails in light).
- Indigo accent (`rgba(99,102,241,.14)`/`#a5b4fc` CTA, `#4f46e5→#7c3aed` avatar gradient, `#818cf8` banner dot with glow, blurred banner).
- Health/lifecycle as coloured dots/text, sometimes a 6px dot alone (colour-only); Tailwind-400 status duplicated in two files; cyan-ish `#60a5fa` for a plain count; 14px card radius, 20px pills.

Recommended changes: tokens, shared status map with text labels, remove glow/blur/gradients. CLAUDE.md's rule stands: Clients stays a read-only projection linking to admin tools — do not add controls.

Risk to functionality: **Low**.

### MODULE: Portal (authenticated, `app/portal/page.tsx`)

Issues:
- Transparent wrapper, `#F5F7FA` H1 and typed input text invisible in light (conditional P0).
- Placeholder-only inputs (0 `<label>`), no focus outline; emoji statuses; low-contrast loading/empty text (~2:1).
- Status maps duplicated from `admin/pipeline/page.tsx:23-47` and **disagree** on `reschedule_requested` (amber vs red).

Recommended changes: tokens, labels, shared status map (resolve the disagreement with product), text statuses.

Risk to functionality: **Low**. Note: no navigation entry points to `/portal` (functional note below).

### Out of scope / excluded surfaces

- **Public, not authenticated** (per `middleware.ts:13-62`): `/tennis`, `/connect`, `/t`, `/b`. Treat with public/marketing surfaces. The authenticated tennis experience is `components/dashboard/TennisDashboard` (Dashboard module).
- **Dev only**: `app/dev/helena-orbital` (`notFound()` in production, `.vercelignore`d).
- **Live but orphaned**: `app/app/page.tsx` ("Ask HLNΛ", dark-only), `/profile`, `/portal` — see functional notes.
- **Live fallback**: `components/BrainBase.jsx` + `components/layout/LeftSidebar.jsx` render when `/dashboard`'s session lookup throws (`app/dashboard/page.tsx:22`); dark-only, 196 rgba literals in LeftSidebar, blur, cyan misused for a "work" mode.
- **Dead** (no importers): listed under P3.

---

## Shared-component opportunities

Ordered by leverage (breadth × risk reduction). All should live under one app primitive layer (proposed `components/ui/app/`), styled only through CSS variables, with no functional props changed at call sites.

| # | Primitive | Replaces / consolidates | Notes |
|---|---|---|---|
| 1 | **Focus ring + semantic tokens** (not a component) | ~60 `outline:none`, old-violet focus in Events | Foundation for everything else |
| 2 | **`Button`** (primary, secondary, outline, ghost, destructive, link; sizes sm/md) | `btn()`/`actionBtn()`/`outlineBtn()`/`dangerBtn()` across CRM/People/Commercial, Data Hub native buttons, Events button styles, Admin/onboarding gradient buttons | Visual only; keep `type`, `onClick`, `disabled`, `form` exactly |
| 3 | **`StatusBadge` / `StatusDot`** via `components/ui/semantic` + a shared `tone → token` map | 5 Commercial `_status` files' colours, People/CRM/Events/Clients/Portal/Admin/Command status colours | Domain labels and lifecycle mapping stay in module files; only tone resolution is shared |
| 4 | **`DataTable` styles** (header, row rhythm, `numeric` column with right align + `tabular-nums`, `rowAction`, focusable overflow wrapper, empty row, optional hover) | ~25 `th`/`td` re-declarations; Data Hub panels; Organiser table view; Events registrations | Style layer first (CSS module/classes), not a data-grid rewrite |
| 5 | **`Field` / `Input` / `Select` / `Textarea` / `Checkbox`** with label association, helper, error (`aria-describedby`, `aria-invalid`) | CRM/People/Commercial forms, Sources, onboarding, profile pages, Portal, Admin | Base on `BrandingSettingsClient`'s pattern |
| 6 | **`SlidePanel` / `Drawer` / `Modal`** with dialog semantics, Escape, focus trap/return, labelled close, `min(width, 100vw)`, token surfaces, footer slot | 3 identical `SlidePanel`s, `PersonDrawer`, ops drawers + modal, Admin modals, Organiser drawer + column modal, legacy `/data` modal | Highest a11y leverage; preserve each caller's open/close state ownership |
| 7 | **`ModuleSidebar` + `SidebarNavItem`** with `aria-current` | `CrmSidebar`, `CommercialSidebar`, `AdminAside`, ops `Sidebar`, `OrganiserRail`; new People sidebar | Items and capability filtering stay in each module |
| 8 | **`MenuButton` / `DropdownPanel` / `Listbox`** | TopNav Ops/Admin dropdowns, `OrgSwitcher`, Events `FilterDropdown`, Organiser `AssigneeDropdown` | Keyboard model once |
| 9 | **`MetricTile` + `Panel`** | 16 KPI implementations; Command panel headers; `ops/widgets/Widget`; `ui/Section`; `OrganisationDashboard` `Card` | Theme-aware, no hover lift, no glass |
| 10 | **`ChartTheme`** (grid, tick, tooltip, series ramp from CSS variables) | `DashboardShell` `th`, `tokens.ts`, `waste/_dark.tsx`, insights constants, `#1a1a2e` tooltips | Recharts reads computed values |
| 11 | **`EmptyState` / `Notice`** (adopt `components/ui/semantic` Banner/Alert) | Data Hub amber/red boxes, Events EmptyState, module empty rows | Also fixes filtered-empty copy where applicable |
| 12 | **`CapabilityDenied`** screen | 5 copies | Keep gating logic where it is |

---

## Token audit

### Existing tokens

`app/globals.css` (authenticated app):

| Group | Tokens | Assessment |
|---|---|---|
| Surfaces | `--bg-base`, `--bg-surface`, `--bg-raised`, `--bg-overlay` | Correct locked bases. **Light `--bg-surface` = `--bg-raised` = `#FFFFFF`** → no elevation step in light. Dark steps are fine (`#111113`, `#151517`, `#1B1B1E`). |
| Borders | `--border`, `--border-light`, `--border-focus` | Light `--border` (10% ink) is faint for control boundaries (outline buttons, drop zones). **`--border-focus` is legacy `rgba(124,58,237,.45)` in both themes and unused.** |
| Accent | `--purple-600/500/400/300/200`, `--purple-glow`, `--brand-brainbase-accent` | Two names for the accent. Light `--purple-300`/`-200` both `#6D4CD6` (tint scale collapsed); light `--purple-400`/`-500` not remapped (`#9B7BFF` ≈3.1:1 on white) yet used for light-mode active text. |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` | Primary correct. Secondary is cool zinc (`#A1A1AA` / `#52525B`), not the warm system. **Muted fails AA: 2.98:1 light, 2.55:1 dark.** |
| Status | `--green`, `--yellow`, `--red`, `--cyan` | Single value per theme, used as text/fill interchangeably. Light values fail as text on `#F5F3EE`: green 2.97, amber 2.87, cyan 3.32, red 4.36. No soft/border variants. |
| Brand | `--brand-line`, `--brand-brainbase-accent`, `--brand-hlna-accent` | Correct and used by `BrokenOrbitMark`. |
| Layout | `--app-header-offset` | Contract; keep. |
| Legacy | `--background`, `--foreground` | Tailwind compat. |

`styles/brainbase-tokens.css` (`--bb-*`): complete light/dark system (surfaces, text, border/strong, grid, accent/soft/border/contrast, signal (cyan), focus, seven semantic states × fg/dot/soft/border, spacing, radius, cells). Validated contrast. Used by public pages and `components/ui/semantic` only.

JS token sets: `components/dashboard/ui/tokens.ts` (`LIGHT_TOKENS`/`DARK_TOKENS` — warm and correct; `COLORS`/`STATUS_COLORS`/`PRIORITY_COLORS` — Tailwind hexes, no light variants), `components/ops/theme.ts` (`OPS_PALETTE` correct hexes; `ink()`/`paper()` alpha helpers on off-palette bases; `accentText` light `#5E3FC4` — a third accent-text value), `DashboardShell.tsx:219-254` private slate set, `app/dashboard/waste/_dark.tsx` constants.

### Missing tokens

Semantic aliases the app should consume (values derived from the locked palette; final values to be validated in Phase A):

| Token | Light | Dark | Why |
|---|---|---|---|
| `--accent` | `#6D4CD6` | `#9B7BFF` | One name for the accent (alias; retire duplicates later) |
| `--accent-hover` | derived darker (e.g. `#5E3FC4`) | derived lighter (e.g. `#B09AFF`) | Consistent hover |
| `--accent-soft` | ~8–10% accent on base | ~10–12% accent on base | Active/selected fills (replaces ad-hoc rgba tints ×10+) |
| `--accent-border` | ~25% accent | ~28% accent | Active/selected outlines |
| `--on-accent` | `#FFFFFF` | `#0B0B0C` | Text on accent fills (~50 `#fff` literals) |
| `--focus-ring` | `#6D4CD6` | `#9B7BFF` | Replace `--border-focus`; 2px solid, offset 2px |
| `--text-muted` (revised) | ≥4.5:1 on `#F5F3EE` (derived from `#8A8580`, e.g. ~`#6B6660`) | `#8A8580` (5.38:1) | Fix AA; adopt the locked secondary neutral |
| `--text-subtle` / `--text-disabled` | ~3:1, non-essential only | ~3:1 | Disabled and decorative text, explicitly not for content |
| `--border-strong` | ~20–22% ink | ~16% ink | Control boundaries, drop zones, outline buttons |
| `--surface-raised` step in light | e.g. `#FBFAF7` | existing | Restore elevation hierarchy in light |
| `--surface-sunken` | e.g. `#EFEBE4` | e.g. `#08080A` | Table headers, input wells |
| Status sets `--status-{success,warning,danger,info,neutral}-{fg,soft,border}` | AA-valid fg on light | AA-valid fg on dark | Alias to `--bb-{success,warning,error,info,inactive}-*` rather than duplicating |
| `--status-awaiting` (orange) | validated | validated | Used ad hoc (`#fb923c`, `#F97316`) in pipeline/portal/founder |
| `--signal` / `--signal-soft` / `--signal-border` (cyan) | alias `--bb-signal*` | alias | Sync/provenance/data-movement only |
| `--scrim` | `rgba(21,23,27,.35)` | `rgba(0,0,0,.5)` | Drawer/modal backdrops (hand-rolled everywhere) |
| `--shadow-popover`, `--shadow-overlay` | soft, low | minimal | Menus, drawers (replace `0 32px 80px`) |
| `--radius-sm/md/lg` | 4 / 6 / 8 | same | One scale (retire 9–20px) |
| `--chart-grid`, `--chart-tick`, `--chart-tooltip-bg/-border`, `--chart-series-1..n` | neutral ramp + one accent | same | Replace per-page chart palettes |
| `--font-mono`, type scale (`--text-xs` 11px minimum …) | – | – | Retire six local `FONT` constants and ≤10px labels |

Recommended structure: keep `app/globals.css` as the **single source**; define the aliases there (or import a shared section from `styles/brainbase-tokens.css`) so both app and public resolve from the same values. JS consumers (`tokens.ts`, `ops/theme.ts`, charts) should read `var(--…)` strings rather than duplicate hexes.

### Tokens to retire

| Token / constant | Replace with | When |
|---|---|---|
| `--border-focus` | `--focus-ring` | Phase A |
| `--purple-glow` | `--accent-soft` | Phase A (then remove uses) |
| `--purple-200..600` as direct UI references | `--accent*` aliases (keep scale internally if needed) | Gradually, Phases B–D |
| `--brand-brainbase-accent` in UI (not in the logo) | `--accent` | Phase B |
| `glowPulse` keyframe (`app/globals.css`) | none (calm) | Phase E |
| `COLORS`, `STATUS_COLORS`, `PRIORITY_COLORS` hexes (`tokens.ts`) | status tokens | Phase A/E |
| `DashboardShell` private `th` set | `ChartTheme` + CSS variables | Phase E |
| `app/dashboard/waste/_dark.tsx` constants | – (static mockups; low priority) | Phase E or never |
| `ink()`/`paper()` bases | re-base on `#F3EEE6`/`#15171B` and `#0B0B0C`/`#F5F3EE` | Phase A (visual review) |

---

## Hard-coded style findings

### Volume by area (all `.ts/.tsx/.jsx`; counts are raw matches, including a small number of comment false positives)

| Area | Files | Hex | rgb/rgba | Shadows | Radius | Gradients | Theme-var refs |
|---|---|---|---|---|---|---|---|
| `app/dashboard` | 68 | 1,282 | 1,891 | 11 | 510 | 16 | 3 |
| `app/admin` | 19 | 484 | 568 | 6 | 278 | 4 | 0 |
| `components/ops` | 13 | 188 | 443 | 31 | 112 | 14 | 1 |
| `components/dashboard` | 18 | 183 | 370 | 35 | 125 | 19 | 31 |
| `app/commercial` | 33 | 178 | 69 | 0 | 120 | 0 | 383 |
| `app/command` | 2 | 101 | 129 | 16 | 56 | 1 | 0 |
| `app/onboarding` | 9 | 97 | 89 | 1 | 27 | 2 | 2 |
| `app/crm` | 16 | 85 | 20 | 0 | 59 | 0 | 189 |
| `app/events` | 14 | 62 | 35 | 3 | 22 | 0 | 14 |
| `app/organiser` | 2 | 46 | 32 | 5 | 48 | 0 | 0 (via `useOpsTheme`) |
| `app/data` (legacy) | 2 | 46 | 8 | 0 | 10 | 0 | 0 |
| `app/people` | 9 | 43 | 9 | 0 | 27 | 0 | 97 |
| `app/reports` | 3 | 40 | 4 | 0 | 9 | 0 | 0 |
| `app/data-hub` | 34 | 29 | 15 | 0 | 46 | 0 | 139 |
| `app/portal` | 1 | 24 | 76 | 1 | 18 | 0 | 0 |
| `app/clients` | 2 | 24 | 24 | 1 | 10 | 1 | 0 |
| `app/dashboards` | 1 | 21 | 61 | 10 | 14 | 6 | 0 |
| `app/settings` / `account` / `profile` | 6 | 68 | 32 | 1 | 38 | 4 | 0 |
| `app/briefings` | 2 | 12 | 53 | 0 | 9 | 1 | 0 |
| `components/nav` | 3 | 11 | 42 | 2 | 14 | 0 | 23 |

Dark-only literal patterns across authenticated code:

| Pattern | Hits | Files |
|---|---|---|
| `rgba(255,255,255,…)` | 2,171 | 99 |
| `rgba(139,92,246,…)` | 208 | 23 |
| `#F5F7FA` | 144 | 37 |
| `#A78BFA` | 127 | 51 |
| `#0xxxxx` near-black bases | 112 | 57 |
| `rgba(124,58,237,…)` | 76 | 21 |
| `#C4B5FD` | 56 | 28 |
| `#8B5CF6` / `#7C3AED` | 33 / 33 | 23 / 16 |
| `rgba(245,247,250,…)` | 32 | 9 |
| `#F9FAFB` | 27 | 14 |
| `rgba(226,232,240,…)` | 10 | 5 |

Heaviest single files: `app/dashboard/fleet/FleetClient.tsx` (163 hex / 157 rgba), `app/dashboard/sessions/page.tsx` (100 / 260), `app/command/page.tsx` (73 / 73, 16 shadows, 9 blurs), `components/dashboard/DashboardShell.tsx` (68 / 47), `app/dashboard/bin-maintenance/page.tsx` (59 / 212), `app/dashboard/wste/property/[id]/PropertyClient.tsx` (63 / 160), `components/ops/DrilldownDrawer.tsx` (40 / 111), `components/ops/maintenance/MaintenanceJobDrawer.tsx` (31 / 104), `components/ops/IntelRail.tsx` (43 / 49), `app/admin/founder/page.tsx` (2,728 lines).

### Classification

| Class | Meaning | Representative examples |
|---|---|---|
| **A** | Valid semantic / module-specific — keep (maybe tokenise the value) | `OPS_PALETTE` hexes (`ops/theme.ts`); waste `BIN_COLOR`; cyan provenance chips (`app/briefings/BriefingsClient.tsx:80,101`); severity map (`HlnaBriefingWidget.tsx:52-55`, needs light variants); Organiser user label palette (needs per-theme validation); check-in camera `#000`; ticket QR white; Branding's user-chosen accent preview; `BrokenOrbitMark` brand variables; red alert badge on OpBar |
| **B** | Should use an existing token | `#F5F7FA`/`#f9fafb`/`#F4F4F5`/`#EEEEF0` → `--text-primary`; `#9ca3af`/`#6b7280`/`#d1d5db`/`#e5e7eb` → `--text-secondary`/`--text-muted`; `#1a1d24` and `rgba(255,255,255,.06–.07)` borders → `--border`; `#07080B`/`#0e1014`/`#0d0f14`/`#0D0D15`/`#08090C` → `--bg-*`; `#C4B5FD`/`#A78BFA`/`#7c3aed`/`#8a4dff` accents → accent tokens; `rgba(7,5,16,.98)` menu panels → `--bg-overlay`; `#22C55E`/`#EF4444`/`#F59E0B` → status tokens; Data Hub/Events status text → existing `--bb-*-fg` |
| **C** | Needs a new token | Accent tints `rgba(155,123,255,.10/.24)` and `rgba(139,92,246,.10–.14)` → `--accent-soft`/`--accent-border`; status soft/border pairs (hand-written `rgba(x,.10)`/`rgba(x,.25)` everywhere); scrim; popover/overlay shadows; radius scale; chart grid/tick/tooltip/series; `--on-accent`; `--border-strong`; orange "awaiting" status; `#1f2937` secondary-button slabs → secondary button tokens |
| **D** | Remove | `backdropFilter` glass on `/command`, OpBar, Admin web-services/sessions, Clients banner; glow shadows and glow hovers; `KpiCard` gradient backgrounds and hover lift; `loading.tsx` ambient violet glows; status-coloured and avatar gradients; blinking "Systems Live" dots not bound to data; emoji status icons; off-brand confirm-panel blue `rgba(26,106,255,…)`; injected global `body{overflow:hidden!important}`; dead `_legacy` folders |
| **E** | Needs visual review before changing | OrgSwitcher impersonation purple bar; profile chip pill radius; right-side wordmark placement; pulsing/ring-animated status dots and `IntelRail` halo; HLNA briefing card gradient; onboarding double header; founder `-40px` full-bleed; 7-column sessions grid at 1024; outline-button border weight in People; purple used decoratively on Events icons |

Do not bulk-replace. The same literal can be A in one file and B in another (for example, `#000` is correct in the check-in viewport and wrong as a panel background).

---

## Light/dark findings

- **Default theme is dark** (`ThemeProvider.tsx:11` and the init script). Light is reachable via the ops Sidebar toggle and persists — so light failures are real user-facing defects, not hypothetical.
- **Fully theme-aware today**: CRM, People, Commercial, Data Hub (with status-colour exceptions), the ops shell chrome, `OrganisationDashboard`, `ModuleAccessCard`, AppNav bar and primary nav items.
- **Broken in light (dark-only)**: TopNav Operations/Admin menus and clock/profile hover; `AdminAside` and all of Admin; ops drawers/modal/widgets; `/command` panels; most `app/dashboard/*` pages (only 13 of 67 files reference the theme at all); `DashboardShell` consumers (forced `theme="dark"`); Events KPI cards, list rows and `FilterDropdown`; Reports, Briefings, `/dashboards`; Onboarding header; Settings/Branding, both profile pages; Clients; Portal; `app/dashboard/loading.tsx`; legacy `/data`; `LeftSidebar` fallback.
- **Broken in dark (light-only)**: `components/nav/Breadcrumb.tsx`.
- **Status colours** need per-theme values; dark Tailwind-400s are reused in light across Commercial, People, Events, Data Hub, Clients and the dashboards.
- **Charts**: tooltips, grids and ticks are pinned to dark tokens or navy `#1a1a2e`.
- **Native controls**: Organiser date inputs force `colorScheme: "dark"`; `<meta name="theme-color">` fixed to dark.
- **First-frame flash**: `ThemeProvider` starts `'dark'`, so `useOpsTheme` consumers without a mount guard (`OrganiserShell`, `OrganiserRail`) render one dark frame in light.

---

## Responsive findings

Assessed from code (fixed widths, grid templates, overflow handling); not visually verified.

| Viewport | Finding |
|---|---|
| **1440** | Generally fine. Data Hub capped at 720px (cramped for previews). `/command` fine. |
| **1024** | AppNav centre row shrinks to ~150–200px and scrolls with a hidden scrollbar (items undiscoverable). Ops Sidebar 220 + IntelRail 260 leave ~544px canvas. Admin `1fr 340px` layouts tight; 7-column sessions grid needs review. |
| **390** | AppNav right cluster alone exceeds viewport → horizontal page overflow; no mobile menu. Module sidebars fixed 200/220px with fixed `36px 40px` main padding. Admin leaves ~90px for content. `SlidePanel` (440), ops drawers (480), modal (520), Admin modals (420/380) overflow. CRM/People tables crushed (no overflow wrapper); Organiser table view unusable; `react-grid-layout` KPI strip and ribbon crushed; People header row overflows; onboarding step labels clipped. Commercial list tables and Events/Data Hub flows behave acceptably. |

Recommendation: authenticated mobile is not currently a designed experience. Phase F should decide the supported minimum (suggest: 1024 fully supported, 390 "usable for key read/triage flows" — Events check-in, Organiser items, CRM contacts) rather than retrofitting every dense surface.

---

## Accessibility findings

| Area | Finding | Priority |
|---|---|---|
| Focus | No app `:focus-visible`; `--border-focus` off-brand/unused; ~60 `outline:none`; hover styles set via `onMouseEnter` with no focus equivalent | P1 |
| Contrast | `--text-muted` 2.98 (light) / 2.55 (dark); light status text 1.5–2.9:1 in several modules; low-alpha labels ~2:1; Admin section labels ~1.9:1 | P1 |
| Keyboard | Hover-only TopNav menus; OrgSwitcher without keyboard model; Organiser boards/cards/names not focusable, actions hover-only; `/command` clickable divs; legacy `/data` drop zone | P1 |
| Dialogs | No `role="dialog"`/`aria-modal`/Escape/focus trap on slide panels, drawers, modals (except sessions dialogs); unlabeled `×` close buttons | P1 |
| Navigation semantics | No `aria-current`; unnamed duplicate `<nav>` landmarks; no skip link; `title`-only icon buttons | P1/P2 |
| Headings | Missing `h1`: `/command`, `/hlna`, `/dashboards`, CRM detail pages, founder page, `/account/profile`; Data Hub `h1` only on step 1; Organiser has no headings; duplicate `h1` inside report markdown (`ReportView.tsx:41` + `:180`) | P2 (deferred — not structural work for the visual pass unless code is already being touched) |
| Forms | Unassociated labels in CRM/People forms, profile pages, onboarding, Portal, Sources; placeholder-only inputs; colour-only required markers; `confirm()` for deletes in CRM/Admin/legacy `/data` | P2 |
| Colour-only state | Clients health dots; founder dots; Data Hub severity as text colour only; sparkline trend colour + arrow only | P2 |
| Live regions | Whole Data Hub wizard inside one `aria-live` region; Events resend warnings as `role="alert"` | P2 |
| Motion | No reduced-motion guard on `/command` blink/pulse/heartbeat | P3 |
| Positive | Commercial/Events/CRM badges carry text; Data Hub tables well labelled; Events FilterDropdown and Organiser AssigneeDropdown handle Escape + focus return; `components/ui/semantic` is exemplary and ready to adopt | – |

---

## Functional issues found (documented only — not fixed)

1. **Password change and Secure Mode are unreachable.** `updatePassword` / `setSecureModeOptimistic` are only rendered by `app/profile/ProfileClient.tsx`, but every navigation link targets `/account/profile` (`TopNav.tsx:1585`, `ops/OpBar.tsx:130`, `ops/Sidebar.tsx:63`, `BrainBase.jsx:410`, `HelenaWorkspace.jsx:196`). *Verified.*
2. **`/portal` has no navigation entry**; reachable only by URL.
3. **OrgSwitcher `switchOrg` ignores POST/DELETE failures** and still navigates to `/dashboard` (`OrgSwitcher.tsx:150-182`).
4. **OrgSwitcher measures its height only on role change** (`:137-143`); a wrapped bar on narrow screens leaves content under the header. Sticky module sidebars also leave a gap for super_admin after scrolling.
5. **Dual active nav states**: `/data-hub/import` highlights both "Data Hub Import" and "Data" (`startsWith`, `TopNav.tsx:1536-1541`); ops Sidebar "Day Job" active on every `/dashboard/*`; CRM "Event Contacts" can never be active (query ignored, `CrmSidebar.tsx:12-21`).
6. **Fabricated values**: `/command` `completion ?? 81`, static "Fleet Avail. 88%", invented trends/sparklines (`app/command/page.tsx:182-199`); `DrilldownDrawer` `buildFallback` invents a timeline and `confidence: 65`, hard-coded `OPERATORS`; `WorkspaceShell` default `alertCount = 4`; static `IntelRail` health rows.
7. **Stubs**: `/command` "Monthly Report"/"Export Data" call `alert("Coming soon.")`; `handleAlertAction` swallows errors; `ACTIVE_FY="2025-26"` hard-coded.
8. **Persisted grid layout** is not validated against `DEFAULT_LAYOUT` keys (`app/command/page.tsx:298-303`); a stale layout can hide new widgets.
9. **Global side effects**: `WorkspaceShell` (used by `/command` and `/dashboard/bin-maintenance` only) and `OrganiserShell` inject `body{overflow:hidden!important}`, relying on unmount to clear.
10. **Organiser item delete has no confirmation** (unlike group/column/board deletes).
11. **Status disagreement**: booking `reschedule_requested` is amber in Portal and red in Admin pipeline; Commercial `SENT` blue in one map and green in another.
12. **Empty-state copy misleads when filtered** (CRM contacts, Commercial invoices say "No X yet").
13. **No pagination** on CRM/People/Commercial lists (client-side filtering will degrade with volume).
14. **`AdminClient.tsx:12` `ROLES` omits `analyst`** although the enum includes it.
15. **Branding settings** state in their own copy that they are "not yet used anywhere" (`BrandingSettingsClient.tsx:241`).
16. **Onboarding success links to `/dashboard/overview`** — confirm that is the intended landing page.

---

## Implementation plan

Principles for every phase: presentation-only diffs; literal-for-token replacements; never change handlers, data loading, gating, routes, payloads or state; keep `role`/`id`/`data-*`/`aria-*` hooks tests rely on; one module per PR where possible; both themes verified before merge.

### Phase A — Foundation (tokens, focus, status, primitives scaffold)

- **Areas/files**: `app/globals.css`, `styles/brainbase-tokens.css` (shared values), `components/dashboard/ui/tokens.ts`, `components/ops/theme.ts`, new `components/ui/app/*` (Button, StatusBadge adapter over `components/ui/semantic`, DataTable styles, Field set, SlidePanel/Drawer/Modal, MenuButton, SidebarNavItem, MetricTile, Panel, EmptyState).
- **Intended changes**: add semantic aliases (`--accent*`, `--on-accent`, `--focus-ring`, `--border-strong`, light elevation step, `--surface-sunken`, status fg/soft/border aliasing `--bb-*`, `--signal*`, `--scrim`, shadows, radius, chart tokens, type scale); fix `--text-muted` AA in both themes; replace `--border-focus`; add one app-wide `:focus-visible` rule; re-base `ink()`/`paper()`; point `tokens.ts` values at CSS variables. Primitives built but **not yet adopted**.
- **Risk**: Low for additive tokens; **Medium** for changing existing `--text-muted`/`--border` values (global visual shift — review across modules in both themes).
- **Verification**: contrast unit test over token pairs (both themes); containment test that `--border-focus` is gone and `:focus-visible` exists; rendered tests (jsdom + axe) for each primitive incl. keyboard/dialog behaviour; `tsc`, eslint, full suite, build.

### Phase B — Navigation and application chrome

- **Areas/files**: `components/nav/TopNav.tsx` (AppNav part only), `components/admin/OrgSwitcher.tsx`, `CrmSidebar.tsx`, `CommercialSidebar.tsx`, new People sidebar, `AdminAside.tsx`, `components/ops/{Sidebar,OpBar,WorkspaceShell}.tsx`, `components/organiser/OrganiserRail.tsx`, capability-denied screens, `Breadcrumb.tsx`.
- **Intended changes**: shared `SidebarNavItem` with `aria-current`; `MenuButton` replacing Ops/Admin dropdowns (click + keyboard); theme-aware menu panels; theme toggle in AppNav; responsive AppNav (secondary items into a menu below ~1100px); OrgSwitcher keyboard model, scroll, semantic "viewing as"; resolve `/command` double chrome; scope injected global CSS.
- **Risk**: **Medium** (TopNav gating, header-offset contract, impersonation).
- **Verification**: existing containment tests for header offset and nav gating must pass unchanged; new rendered tests for menu keyboard behaviour and `aria-current`; authenticated visual review of every role (member, manager, super_admin, impersonating) in both themes at 1440/1024/390.

### Phase C — Core work surfaces (tables, forms, panels, buttons, statuses)

- **Areas/files**: CRM, People, Commercial, Data Hub, Events forms/tables/panels; the three `SlidePanel`s + `PersonDrawer`; Commercial `_status` files (tone mapping only); People/CRM/Events status maps.
- **Intended changes**: adopt `Button`, `Field`, `DataTable` styles (numeric right-align + `tabular-nums`, overflow wrappers), shared `SlidePanel` with dialog semantics, `StatusBadge` tone map; swap `#1a1d24`/grey literals; fix light-mode illegible buttons; unify destructive/secondary styles; remove blue confirm panels.
- **Risk**: **Low–Medium** (large files; must not touch lifecycle conditionals, submissions or validation).
- **Verification**: existing module containment/rendered tests; new tests per shared primitive adoption (labels associated, dialog Escape/focus return, numeric alignment); screenshot review of list/detail/form/drawer per module in both themes.

### Phase D — Module convergence (remaining module-specific debt)

- **Areas/files**: Events (`ui.tsx` retokenise, KPI strip, registrations table, FilterDropdown), Organiser (keyboard semantics, drawer, table view, purple literals, date `colorScheme`), Data Hub (stepper, headings, cyan semantics, drop zone, live-region scope, width), Admin (map `T` to variables, AdminAside, modals, glows), Settings/Account/Profile, Onboarding, Clients, Portal, Reports/Briefings.
- **Intended changes**: bring each module onto tokens and primitives; remove glass/glow/gradients; module-local status maps resolved through the shared tone map.
- **Risk**: **Medium** for Organiser (click coupling) and Admin (founder layout coupling); **Low** elsewhere.
- **Verification**: focused interaction tests for Organiser (open vs rename, keyboard), Data Hub wizard phase tests unchanged, Events registration/payment tests unchanged; visual review per module.

### Phase E — Dashboard and high-level surfaces

- **Areas/files**: `components/dashboard/*` (`KpiCard`, `Section`, `DashboardGrid`, `DashboardShell`, `OrganisationDashboard`), `app/command/page.tsx`, `components/ops/{IntelRail,DrilldownDrawer,maintenance/*,widgets/*}`, `app/dashboard/*` real pages, `app/dashboard/loading.tsx`, `/dashboards`, chart theming.
- **Intended changes**: `MetricTile` + `Panel` replacing 16 KPI variants; remove glass/glows/hover lifts; status colours only for status, neutral ink for categories; `ChartTheme` from CSS variables; `DashboardShell` theme-aware; label all static/sample metrics; token skeleton; reduce framing on `OrganisationDashboard`. Leave HLNA/Helena stateful visuals as they are.
- **Risk**: **Medium** (≈10 `DashboardShell` consumers; persisted grid layout compatibility; demo/live data selection must not change).
- **Verification**: layout persistence test; containment tests for demo labelling; chart rendering in both themes; visual review of `/dashboard`, `/command`, bin-maintenance, representative `DashboardShell` pages.

### Phase F — Responsive, accessibility and polish

- **Areas/files**: cross-cutting.
- **Intended changes**: agreed mobile support level; sidebar collapse/drawer below 768px; fixed-width removals; heading hierarchy (deferred `h1` items); reduced-motion guards; `theme-color` media variants; dead-code removal (`*_legacy`, dead components) in a separate, clearly-labelled PR; decide `/data` retirement.
- **Risk**: **Low–Medium**.
- **Verification**: axe across representative authenticated pages; keyboard walkthroughs; 390/1024/1440 screenshots in both themes; `git grep` guards for reintroduced dark-only literals.

**Sequencing note**: Phase A must land before anything else. Phases B and C can overlap once A's primitives exist. Phase E should follow C (it reuses `Panel`/`StatusBadge`/`DataTable`). Consider a lightweight lint/containment guard (e.g. no new `rgba(255,255,255` / `#C4B5FD` / `outline: 'none'` in authenticated directories) introduced in Phase A to stop regression while convergence proceeds.

---

## Blockers to visual verification

- No `.env`/database in this checkout, so the authenticated app cannot be signed into locally; no credentials were invented or used, and no production or tenant data was viewed.
- A safe authenticated review needs either a local seeded database with test accounts per role (member, manager, super_admin), or a Preview deployment reviewed via a disposable seeded organisation. Until then, all findings are source-based.

---

## Do-not-change list

- Routes, route parameters, middleware and redirects.
- APIs, server actions, API payloads and response handling.
- Database access, raw SQL, Prisma client usage and schema.
- Authentication, sessions, `requireSession`/`requireRole`, permissions, capability gates (`requireCapability`, layout gating), super_admin checks, tenant boundaries and organisation switching / impersonation behaviour.
- Business rules and lifecycle logic (Commercial statuses, purchasing lifecycle, Events registrations/payments/refunds/check-in, HR restricted-case access, Data Hub import phases and governance).
- Form submission behaviour, validation rules, state management, event handlers and data loading.
- `--app-header-offset` / `TOP_NAV_HEIGHT_PX` contract and OrgSwitcher height publication.
- Persisted client state keys (`bb-theme`, `bb-analytics-consent`, grid `LAYOUT_KEY`, sidebar collapse keys).
- Stateful HLNA/Helena assistant visuals (`HlnaOrb`, `HelenaOrbital`, `HelenaWorkspace`) — note only.
- `BrokenOrbitMark` geometry and colour rule.
- Generated transactional documents (quote/invoice/PO PDFs, emails) and their logos.
- Public site (`components/public/**`, public routes) and tenant-branded public event themes.
- Unrelated refactors and unrelated lint warnings (existing `react-hooks/set-state-in-effect` findings).

---

## Proposed visual acceptance criteria

A module is "converged" when, in **both themes** at **1440 and 1024** (and at 390 for designated mobile flows):

1. **Colour**: no raw hex/rgba in the module except class-A exceptions listed in a module allow-list; all surfaces, text, borders and statuses resolve from CSS variables; no `#F5F7FA`, `#C4B5FD`, `#A78BFA`, `rgba(255,255,255,…)`, `rgba(139,92,246,…)`, `rgba(124,58,237,…)` remain.
2. **Accent discipline**: purple appears only for active navigation, selection, primary actions, focus and key highlights; no purple surfaces or data-series colours; cyan only for sync/provenance/data-movement/relationships.
3. **Status**: every status uses the shared tone map, shows text (or text + shape), and meets 4.5:1 for text / 3:1 for non-text in both themes; the same state has the same tone across modules.
4. **Contrast**: body and muted text ≥ 4.5:1; large text and UI boundaries ≥ 3:1; verified by token tests and spot-checked with axe.
5. **Focus**: every interactive element shows the shared `--focus-ring` on `:focus-visible`; no `outline: none` without a replacement.
6. **Keyboard**: all navigation, menus, drawers, modals, table row actions and module core tasks are operable by keyboard; menus and dialogs support Escape and return focus; dialogs trap focus and are labelled.
7. **Structure**: one `h1` per page; `aria-current` on active navigation; labelled landmarks.
8. **Tables**: shared table styles; numeric/currency right-aligned with `tabular-nums`; horizontal overflow wrapper where needed; empty row copy distinguishes "none yet" from "no matches".
9. **Forms**: shared field styles; every control has an associated label; helper/error wired with `aria-describedby`/`aria-invalid`; visible disabled state.
10. **Surfaces**: no glassmorphism, glow shadows, decorative gradients or hover lifts on non-interactive elements; radius from the scale (4/6/8); at most one level of container nesting for dashboard content.
11. **Layout**: no horizontal page overflow at 1024 or at the designated 390 flows; drawers/modals never exceed the viewport.
12. **Honesty**: every static or sample metric is labelled at the point of display; no unlabelled invented values next to live data.
13. **No regressions**: dark theme unchanged except intended corrections; functional containment/rendered tests unchanged and passing; `tsc`, eslint (no new errors), full suite and production build pass.

---

## Phase A implementation note — authenticated design foundation

| | |
|---|---|
| Date | 2026-09-26 |
| Branch / base | `feat/app-visual-system-convergence` @ `b9b0583` (uncommitted, for review) |
| Scope | Token contract, focus foundation, semantic-status fitness, three unconsumed primitives. **No module, layout, navigation or behaviour changes.** |

### Product decisions recorded

- **Light mode is officially supported** for the authenticated application. The light-mode failures in this audit are **P0 visual defects** (supersedes the "conditional P0" framing above). Phase A fixes the token contract they depend on; the defects themselves are consumer-side (hard-coded literals) and are fixed module by module in Phases B–E.
- **Functional issues stay out of the visual phases.** The `/profile` vs `/account/profile` reachability issue and the other items under "Functional issues found" are documented only; Phase A did not touch them.

### Token decisions (`app/globals.css`)

The existing `:root` / `:root[data-theme='light']` blocks remain the single authoritative app token layer; names were reused/bridged rather than duplicated. The public `--bb-*` system is unchanged in structure (one value group adjusted — see semantic components).

| Group | Token | Dark | Light | Notes |
|---|---|---|---|---|
| Surfaces | `--bg-base` / `--bg-surface` / `--bg-raised` | unchanged | unchanged | `--bg-raised` stays `#FFFFFF` in light: 26 files use it as the input-field background, so changing it is a later-phase decision |
| | `--bg-sunken` **(new)** | `#080809` | `#EFEBE4` | table headers, input wells |
| | `--bg-overlay` | `#1B1B1E` | `#EFEBE4` → **`#FFFFFF`** | floating surfaces; had zero consumers |
| Borders | `--border` | `rgba(255,255,255,.07)` → `rgba(243,238,230,.08)` | `rgba(15,17,23,.10)` → `rgba(21,23,27,.10)` | re-based on the locked line colours; decorative separator |
| | `--border-light` | → `rgba(243,238,230,.045)` | → `rgba(21,23,27,.06)` | |
| | `--border-strong` **(new)** | `#6F6B66` (3.72:1) | `#8A8580` (3.29:1; 3.65:1 on white) | meets 3:1 for control / drop-zone boundaries |
| | `--border-focus` | `rgba(124,58,237,.45)` → **accent** | same → **accent** | legacy violet removed |
| Text | `--text-primary` | unchanged `#F3EEE6` | unchanged `#15171B` | |
| | `--text-secondary` | `#A1A1AA` → `#AAA6A0` (8.12:1) | `#52525B` → `#5F5B55` (6.08:1) | cool zinc → warm neutral family; still well above AA |
| | `--text-muted` | **`#52525B` (2.55:1) → `#8A8580` (5.38:1)** | **`#8B8D98` (2.98:1) → `#67625C` (5.44:1)** | see contrast rationale |
| | `--text-subtle` **(new)** | `#6F6B66` (3.72:1) | `#8A8580` (3.29:1) | disabled / placeholder / decorative only — not for content |
| Product | `--brand-brainbase-accent` | unchanged `#9B7BFF` | unchanged `#6D4CD6` | |
| | `--brand-brainbase-accent-hover` **(new)** | `#B09AFF` | `#5E3FC4` | |
| | `--brand-brainbase-accent-muted` **(new)** | `rgba(155,123,255,.10)` | `rgba(109,76,214,.08)` | active/selected fill — replaces ad-hoc tints later |
| | `--brand-brainbase-accent-border` **(new)** | `rgba(155,123,255,.30)` | `rgba(109,76,214,.28)` | |
| | `--brand-brainbase-on-accent` **(new)** | `#0B0B0C` (6.25:1) | `#FFFFFF` (5.75:1) | label colour on accent fills |
| Status | `--status-{success,warning,danger,info}` + `-muted` + `-border`, `--status-inactive` + `-muted` **(new)** | bridged to `--bb-{success,warning,error,info,inactive}-*` | same | one validated source shared with `components/ui/semantic`; info covers sync (cyan) |
| Focus | `--focus-ring-color` / `-width` / `-offset` **(new)** | accent / 2px / 2px | accent / 2px / 2px | |
| Radius | `--radius-sm` / `-md` / `-lg` **(new)** | 4 / 6 / 8px | same | |
| Elevation | `--shadow-menu` / `--shadow-popover` / `--shadow-dialog` / `--scrim` **(new)** | black-based + 1px line ring | ink-based, soft | floating surfaces only; no card shadows |

Deliberately **unchanged** (legacy, migrated by consumers later): `--purple-*` (incl. the collapsed light 300/200 steps and un-remapped light 400/500), `--purple-glow`, `--green`/`--yellow`/`--red`/`--cyan`, `--brand-hlna-accent`, `--app-header-offset`, `--background`/`--foreground`, scrollbars.

### Muted-text contrast rationale

`--text-muted` carries labels, captions, empty states and "—" placeholders at 11–13px, so it must meet the **4.5:1** normal-text threshold, not the 3:1 large-text one.

- **Dark**: old `#52525B` = 2.55:1 on `#0B0B0C` (2.22:1 on overlay). New `#8A8580` is the locked secondary neutral: 5.38:1 on base, ≥4.70:1 on every dark surface including `--bg-overlay`.
- **Light**: old `#8B8D98` = 2.98:1 on `#F5F3EE`. The locked neutral `#8A8580` only reaches 3.29:1 in light, so a darker member of the same warm family was derived: `#67625C` = 5.44:1 on base, 6.04:1 on white, ≥5.08:1 on `--bg-sunken`.
- The previous "muted" role for genuinely de-emphasised, non-essential text moves to `--text-subtle` (≥3:1, explicitly not for content).
- Effect on existing consumers: the 107 current `var(--text-muted)` uses (39 files, mostly CRM/People/Commercial/Data Hub) become more legible; hierarchy between secondary (≈6–8:1) and muted (≈5.4:1) is preserved.

All ratios are enforced by `tests/containment/appDesignTokens.test.ts`, which resolves the real `var()` chains per theme and computes contrast against every app surface.

### Focus decisions

- One global rule in `app/globals.css`: `:where(:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset); }`.
- **Product purple** ring: 5.18:1 (light) / 6.25:1 (dark) against the base, ≥3:1 on every surface; the 2px offset shows a band of surface between the ring and accent-filled buttons, so the ring stays distinct on primary buttons.
- **`:focus-visible` only** — no rings on mouse clicks for buttons/links (text inputs still show focus on click, which is standard and expected).
- **Zero specificity** via `:where()`: every component that already styles its own focus (the public `.bb-public`/`.bb-semantic` rule, Events `.bb-evt-input`, module-specific rules) keeps precedence, so no existing accessible treatment is overridden.
- Nothing suppresses focus globally (guarded by test).
- **Not changed in Phase A**: inline `outline: 'none'` declarations still win over the global rule. Current inventory — **94 sites in 66 authenticated files** (plus legacy chat/panel files), including: `app/organiser/page.tsx` (6), `components/layout/LeftSidebar.jsx` (5), `app/admin/web-services/page.tsx` (4), `components/panels/InboxPanel.jsx` (4), two each in `components/ops/DrilldownDrawer.tsx`, `app/people/restricted-cases/page.tsx`, `app/crm/contacts/page.tsx`, `app/crm/_components/{DealForm,ActivityForm}.tsx`, `app/command/financial.tsx`, `app/dashboard/{contacts/ContactsClient,blog/page,bin-maintenance/page}.tsx`, `app/admin/web-services/LeadMessages.tsx`, `app/account/profile/ProfileClient.tsx`, `components/BrainBase.jsx`, `components/panels/ContactsPanel.jsx`, and one each across CRM/People/Commercial forms and lists, Admin, onboarding steps, dashboards, Portal, Data Hub `ImportClient`, Events `ui.tsx`, ops drawer/modal, `CommandDemo`, `LockScreen`, auth pages (`forgot-password`, `reset-password`, `verify-email`, `trial`). Each is removed or replaced with the token ring as its module is converged (Phases B–E); the Phase F guard should then forbid new ones.

### Semantic component decisions (`components/ui/semantic/`)

Evaluated StatusDot, Badge, Banner, Alert and LiveRegion against the authenticated requirements. **Adopted as the canonical application status primitives** (re-exported from `components/ui/app`); no rewrite was needed:

| Requirement | Result |
|---|---|
| Colour never the sole signal | ✓ each state has a distinct dot shape / icon plus visible text |
| Active ≠ success | ✓ separate states and tokens |
| Info/sync ≠ product purple | ✓ info and syncing are cyan; syncing adds a distinct (motion-safe) icon |
| Success/warning/error/info/inactive distinct | ✓ asserted by test |
| Both themes accessible | ✓ every state foreground ≥4.5:1 on base, surface and its own soft fill (test) |
| Live-region discipline | ✓ static by default; polite opt-in; assertive only for `error` |

Two foundation-level changes made them fit for the signed-in app:

1. **Active state now uses the locked product accent.** `--bb-active-*` previously pointed at the older public purple scale (`--bb-purple-300` / `-700`, i.e. `#c3a6ff` / `#5f31c7`). Now `#9b7bff` / `#6d4cd6` with matching muted/border values. This also aligns the few public "active" badges (e.g. pricing "Most popular") with the brand accent; verified visually on the public site.
2. **Typeface inherits.** `.stateful` forced `var(--bb-font-sans)` (Geist); it now uses `font-family: inherit`, so status components render in Inter inside the app and still in Geist on public pages (which set Geist on the page). Badge keeps its own mono face.

### Primitives created (`components/ui/app/`, not yet consumed)

| Primitive | Contract | Why now |
|---|---|---|
| `Button` | variants `primary` / `secondary` / `ghost` / `danger`, sizes `sm` / `md`; all native props and handlers pass through; defaults to `type="button"`; global focus ring | repeated `btn()` helpers in every business module; fixes the dark-slab secondary and three destructive styles when adopted |
| `Field` + `fieldControlClassName` | label ↔ control association, visible "Required" text, helper and error wired via `aria-describedby`, `aria-invalid` on error; caller owns value/change/validation/submission; caller-supplied `id` preserved | unassociated labels across CRM/People/Commercial/profile/onboarding/Portal; low risk because it never owns behaviour |
| `Panel` | bordered surface, optional title (caller-chosen heading level, labelled region) and actions slot, `padding="md" \| "none"`; no shadow/gradient/glass | replaces card/glass framing in later phases; trivial behaviour |
| Re-exports | `StatusDot`, `Badge`, `Banner`, `Alert`, `LiveRegion`, `SEMANTIC_STATES` | canonical status set for the app |

Deferred by design (behaviour differs across call sites; build them in the phase that adopts them): **DataTable, Drawer, Modal, SlidePanel, ModuleSidebar, MenuButton/DropdownPanel, MetricTile, ChartTheme, CapabilityDenied.**

### What changed (files)

- `app/globals.css` — semantic token layer, contrast-corrected text tokens, global focus rule.
- `styles/brainbase-tokens.css` — `--bb-active-*` values (both themes) only.
- `components/ui/semantic/semantic.module.css` — `.stateful` typeface inherits.
- `components/ui/app/{Button,Field,Panel}.tsx` + `.module.css`, `components/ui/app/index.ts` — new primitives.
- `tests/containment/appDesignTokens.test.ts` — token-contract / contrast / focus / semantic-fitness invariants.
- `tests/components/app/{Button,Field,Panel}.test.tsx` — rendered axe + keyboard + wiring tests.
- This note.

### Deliberately deferred

- All consumer migrations: the ~2,170 `rgba(255,255,255,…)` literals, legacy violet literals, dark-only modules (the P0 light-mode defects), status-colour maps, 94 inline `outline: none` sites.
- `components/dashboard/ui/tokens.ts` and `components/ops/theme.ts` — not re-pointed at CSS variables yet: recharts and inline SVG attributes cannot resolve `var()`, and `ink()`/`paper()` re-basing shifts the ops shell visually; both belong with the chrome/dashboard phases and need visual review.
- Light `--bg-raised` elevation step (input-background consumers).
- Legacy tokens (`--purple-*`, `--green`/`--yellow`/`--red`/`--cyan`, `--purple-glow`) — retire once unused.
- A lint/containment guard against *new* dark-only literals and `outline: none` in authenticated directories — add when Phase B starts converting, so it does not fail on existing debt.
- All TopNav, OrgSwitcher, sidebar, module and dashboard work (Phases B–F); all documented functional issues.

### Verification performed

- Token contract, contrast, focus and semantic-fitness tests plus rendered primitive tests; each mutation-checked (deliberately broken source fails the intended test, restored source passes).
- Public-site visual check on a production build at 1440px, light and dark: `/`, `/login`, `/signup`, `/demo` — unchanged appearance, no horizontal overflow; token values and the shipped `:where(:focus-visible)` rule confirmed in the browser. **Signed-in visual verification was not performed** (no safe authenticated environment yet); it is scheduled after the chrome phase with a disposable test organisation.

---

## Phase B implementation note — authenticated application chrome

Scope: global application chrome only — `components/nav/TopNav.tsx` (AppNav, its Operations/Admin menus, lockup, clock, theme control, profile/Branding/Sign out) and `components/admin/OrgSwitcher.tsx`. Module sidebars, CRM/People/Commercial/Data Hub/Events/Organiser layouts, dashboard content, tables, forms and drawers were not touched. Uncommitted on `feat/app-visual-system-convergence`.

### Audit claims re-verified against current code

- Confirmed: hover-only Ops/Admin menus with no `aria-expanded`/Escape; dark-only menu panels (`rgba(7,5,16,.98)`), white-alpha trigger/item text, `#C4B5FD` / `rgba(139,92,246,…)` active states; clock date `rgba(255,255,255,.22)`; profile hover `rgba(255,255,255,.05)`; 150px left spacer + 185px right-side logo box; `alt="avatar"`; no theme control in AppNav; OrgSwitcher solid `--purple-600` impersonation bar, `rgba(226,232,240,.6)`, `rgba(0,0,0,.5)` shadow, `overflow: hidden` list with no scroll, no `aria-expanded`/Escape/arrows.
- **Corrected**: the audit summary described the TopNav wordmark as a dark-only image. At HEAD `b9b0583` `BrainBaseWordmark` already delegates to the theme-aware `BrainbaseLockup` / `BrokenOrbitMark`; the lockup itself needed no change.
- Not present in the chrome files: inline `outline: none` (the 94 suppression sites are all outside TopNav/OrgSwitcher). There was no chrome outline suppression to remove; focus is supplied by the Phase A global `:where(:focus-visible)` ring, with inset offsets where the scrolling nav row would otherwise clip it.

### Chrome changes

- New `components/nav/AppChrome.module.css` holds all AppNav visual treatment on semantic tokens; inline styles in TopNav are now layout-only. JS `onMouseEnter/onMouseLeave` colour swaps were replaced by CSS `:hover` so hover, focus and theme all resolve from one rule set.
- Hierarchy: page `--bg-base` → chrome `--bg-surface` (was `--bg-base`) → `--border` → `--text-primary/secondary/muted` → product accent only on the current destination.
- Lockup moved to the leading edge (compact 136px `BrainBaseWordmark`; mark-only `BrokenOrbitMark` below 1200px). The dead 150px spacer and the 185px logo box are gone. No geometry change, no second logo system.
- Centre row left-aligned (centred overflow made the left end unreachable) and given a thin themed scrollbar instead of a hidden one, so overflow is discoverable.
- Clock uses `--text-secondary/--text-muted`, tabular numerals, `aria-hidden` (a per-second ticking string is not useful to screen readers); date hidden below 1600px, clock hidden below 1280px.
- Theme control added to the right cluster: same `ThemeProvider` (`bb-theme` persistence and the pre-paint script unchanged), `aria-label="Switch to {next} theme"`, icon chosen by CSS from `<html data-theme>` so it is correct on first paint.
- Profile: radius-md chip (was a 20px pill), 26px avatar with accent-muted initials fallback (was `--purple-600` + `#fff`), avatar `alt=""` beside the visible name, role shown as muted metadata (`Super admin`, `Admin`, …) at ≥1200px; name kept as the link's accessible name (visually hidden below 768px). `/account/profile` target unchanged (the `/profile` vs `/account/profile` issue remains documented only).
- Branding and Sign out use the same item treatment; Branding is hidden below 768px (see deferrals). Sign out logic unchanged.
- `<nav aria-label="Primary">` for AppNav; each open menu is its own labelled `nav` (`Operations`, `Admin`).

### Active / hover language

One global-nav language: accent text (`--brand-brainbase-accent` = #6D4CD6 light / #9B7BFF dark), weight 600 and a flat 2px inset baseline, plus `aria-current="page"` — not colour alone, no pill fill, no glow. Menu triggers containing the current route get `data-active` with the same treatment (kept while expanded). Hover everywhere: `--bg-sunken` + `--text-primary`. Menu items: current item gets a 2px accent left edge + `--brand-brainbase-accent-muted` tint + accent label.

### Menus / dropdowns

- OpsDropdown and AdminDropdown remain two functions (pinned by `dropdownPanelPortal` / `founderNavDropdownRegression`), still portaled to `document.body` with `position: fixed` coordinates from `getBoundingClientRect()`. Shared behaviour was factored into `useMenuDismissal`, `handleMenuKeyDown`, `menuLinks`, `clampMenuLeft` and `Chevron` — a full MenuButton primitive was not introduced (it would not have removed more duplication without rewriting the pinned structure).
- Disclosure pattern: `<button type="button" aria-expanded aria-controls>`; opens on hover (mouse pointers only), click, Enter/Space (focus moves to the first item), ArrowDown/ArrowUp (first/last item). Inside: ArrowUp/Down, Home/End; Tab from the last item continues after the trigger, Shift+Tab from the first returns to it.
- Dismissal: Escape (focus returns to trigger), second click, press outside, focus moving elsewhere, window resize or scroll. Closing on scroll/resize returns focus to the trigger if it was inside the menu (found in visual review: focus was otherwise stranded on `<body>`).
- **Behaviour fix found in testing**: with a mouse, hover opened the menu and the subsequent click toggled it shut. A click on a hover-opened menu now pins it open; pinned menus ignore pointer-leave.
- Panels: `--bg-overlay`, `--border`, `--radius-lg`, `--shadow-menu`; no arrow notch; width 264px clamped to the viewport (8px gutter) — verified at 390px.

### OrgSwitcher

- New `components/admin/OrgSwitcher.module.css`. Normal state: neutral `--bg-surface` bar, muted uppercase "Organisation" label, bordered trigger. Impersonating: `--brand-brainbase-accent-muted` bar tint, accent-border bottom rule, 3px inset accent edge and a solid "Viewing as" badge — prominent in text and shape, confined to the 30px bar, never a whole-app fill. (The audit had suggested a warning tone; the accent was kept so "operator context" is not confused with system warnings — open for review.)
- Trigger: `aria-expanded`, `aria-controls`, `aria-busy` while switching, accessible name "Viewing as: {org}. Switch organisation" / "Organisation: {org}. …"; org name truncates with ellipsis; single line at every width so the measured header offset stays valid.
- List: heading + `ul aria-labelledby`, `max-height: min(60vh, 420px)` with scroll (was `overflow: hidden`), overlay tokens, current org marked `aria-current="true"` with a visible check mark + tint (not colour alone). Keyboard: opens onto the current org, arrows/Home/End, Escape returns focus to the trigger, closes when focus moves to another element (not on window blur).
- "Return to Brainbase" keeps its accessible name at 390px while showing "Return".
- Unchanged exactly: `/api/me`, `/api/admin/impersonate` GET/POST/DELETE, `/api/admin/orgs`, `switchOrg` (including its ignored failures — still documented only), `window.location.href = '/dashboard'`, `initialRole` seeding, the `useLayoutEffect` offset publication, `position: relative` + `zIndex: 110`, and the outside-mousedown close.

### Light-mode P0s resolved (chrome)

Operations menu, Admin menu, profile chip and hover, clock date, OrgSwitcher list ("Return" item, active org `--purple-400` ≈3.1:1), dropdown surfaces, active and hover states — all now resolve from semantic tokens with ≥4.5:1 text (Phase A verified values). Reviewed visually at 1440 light.

### Regression tests added / changed

- `tests/containment/authenticatedChromeVisualSystem.test.ts` (32 tests), scoped to the four chrome files: no white-alpha neutrals, no retired violet hex/rgba or `--purple-*` refs, no backdrop-filter/blur/gradient/text-shadow/drop-shadow, no outline suppression, CSS modules token-only (no raw hex/rgb/hsl), TSX string literals free of colour literals; active rule uses accent + weight + baseline; items expose `aria-current`; menu triggers have `aria-expanded`/click/keyboard handlers; dismissal handles Escape/outside/focus; viewport clamp; theme control; decorative avatar; approved lockup only; OrgSwitcher distinct impersonation state, `aria-current`, overlay tokens.
- `tests/components/nav/AppChrome.test.tsx` (14) and `tests/components/nav/OrgSwitcher.test.tsx` (9): axe light/dark, keyboard open/arrows/Home/End/Escape focus return, hover-then-click pinning, outside press, destinations and CRM capability gating preserved, `aria-current`, theme toggle, identity/role/initials, Branding admin-only, focus return on scroll-close, blur semantics.
- Mutation-checked: 11 mutations to source (white-alpha, violet hex, blur, gradient, outline none, solid-purple bar, colour-only active, missing `aria-expanded`, Escape, hover-click toggle, keyboard focus on open) plus the two later fixes (scroll focus return, blur) each fail the intended test; sources restored.
- Existing anchors updated: `clientNavOwnership` (4), `eventsDiscoverability` (2), `navPersonaCoverage` (1) located the end of the nav branches via the removed `width: 185,` logo box; with it gone `indexOf` returned −1 and the regions silently widened to the whole file. Re-anchored on `className={styles.rightCluster}`. (Several of those suites never assert the anchor exists — a pre-existing weakness, noted not fixed.)

### Visual verification actually performed

No safe authenticated local method exists (no local database or `.env`, no test account; credentials were not invented and production was not touched). Instead, in a throwaway scratch worktree only (never in the repo), a fixture page rendered the real `TopNav` and `OrgSwitcher` components with fake session props and a stubbed `fetch` for the org endpoints, served by a local production build. Reviewed in iframes at exact widths:
- 1440 light/dark (HQ super_admin; normal and impersonating), 1024 light (client admin) and dark (HQ), 390 light (impersonating) and dark (client admin).
- Operations and Admin menus open in light and dark; org list open in light (impersonating) and dark (normal); Admin menu at 390px (clamped); real keyboard Tab focus ring on the org trigger and nav items.
- No page-level horizontal overflow at any width; controls do not collide; organisation context, theme, profile and Sign out reachable at 390.
This is a component harness review, **not** an authenticated review of Dashboard/CRM/People/Commercial/Data Hub routes — that remains **pending** until a safe test account exists.

### Remaining chrome debt / deferrals

- **Nav density**: a fully-entitled HQ super_admin has 16 top-level items (~1256px) — the row scrolls even at 1440 (≈807px available), at 1024 and at 390. The scrollbar is now visible, but real relief needs an IA decision (e.g. grouping secondary items behind a "More" menu) — not made here.
- Branding link hidden below 768px (still reachable by URL / settings); no mobile menu was invented.
- No skip link (needs a stable `#main` target across layouts).
- Two different header bands for super_admin (OrgSwitcher + TopNav) remain; folding the switcher into AppNav is a structural change deferred with offset tests.
- In the normal (non-impersonating) state no org is marked current because the component only knows the home org's name, not its id.
- `/command` and bin-maintenance double chrome (TopNav + OpBar), `Breadcrumb.tsx` light-only colours, `/data` dual-active state — out of Phase B scope, still documented.
- Harness artefact noted for reviewers: the fixture path `/crmharness` makes CRM (and Operations, which contains `/crm`) appear active.

### Phase B addendum — Branding reachability check

The note above said the Branding link was hidden below 768px. Checked: `components/nav/TopNav.tsx` is the only authenticated UI that links to `/settings/branding` (no ops Sidebar, OpBar, profile page or other chrome link; the profile chip is a direct link to `/account/profile`, not a menu). Before Phase B the link rendered at every width (no media queries), so hiding it made Branding unreachable from narrow-screen chrome — a regression. Fixed by removing the `display: none` rule; below 768px Branding now uses the same compact padding as Sign out and the scrollable centre row absorbs the width. No IA change, no new route, no new menu. Guarded by a new assertion in `tests/containment/authenticatedChromeVisualSystem.test.ts` (mutation-checked). The "Branding link hidden below 768px" deferral above no longer applies.

---

## Phase C implementation note — shared authenticated work surfaces

Scope: shared primitives + representative migrations in CRM, People, Commercial and Data Hub. No module was fully converged; module sidebars, Events, Organiser, Admin, Dashboard/Command and Ops were not touched. Uncommitted on `feat/app-visual-system-convergence`.

### What the current code actually showed (verified before abstracting)

- CRM, Commercial, People and Data Hub use **only inline `style={{}}`** — zero CSS modules, zero `className`, and zero consumers of the Phase A primitives or `components/ui/semantic`. Style constants (`btn`, `th`, `td`, `empty`, `lbl`, `sel`, `CARD`/`BORDER`) are re-declared per file (~20 copies of `btn()`).
- Repeated, genuinely shared patterns: list header (22/700 h1 + count line + right-hand action cluster), 200px search input, status `<select>` filter, list table (11px uppercase `th`, 13px `td`, `colSpan` loading/empty rows), `#1a1d24` input borders, full-width purple submit, `#f87171` error `<p>`.
- The three `SlidePanel`s are **byte-identical code** (only header comments differ): same API, inline mount, 440px, scrim + × close, no dialog semantics, no Escape, no focus handling, `#1a1d24` border.
- No sorting, pagination or bulk actions exist anywhere in these modules — so none were abstracted.
- 0 of the audit's `#1f2937` "secondary slab" claims apply to People/Data Hub (only CRM/Commercial use it); confirmed per file.

### Primitives created / changed (`components/ui/app/`)

| Primitive | Purpose | Notes |
|---|---|---|
| `PageHeader` (new) | title (h1 default), eyebrow, meta, description, actions | typography + spacing only, no card; actions wrap below the title on narrow screens |
| `WorkToolbar`, `ToolbarSearch`, `toolbarControlClassName` (new) | search / filters / count / actions row | flat wrapping row; search has a real (visually hidden) label; count is a polite status; actions pushed to the end |
| `Table` contract: `TableContainer`, `TableStateRow`, `tableStyles` (new) | visual contract, not a data grid | focusable named scroll region; 32px header / ~40px rows / 13px; `num` = right + `tabular-nums`; hover `--bg-sunken`; `aria-selected` rows accent-tinted with 2px inset edge; `primary`/`meta`/`actions`/`link`/`muted` cell roles; loading = status row, error = alert row |
| `StateMessage` (new) | empty / loading / error for a region or page | small: title, optional body, optional action; error is semantic danger + `role="alert"`, loading `role="status"`, empty not live |
| `SlidePanel` (new, shared) | the one CRM/People/Commercial panel shell | see drawer comparison below |
| `Field` (changed) | + `FormActions` (action row; `align="stretch"` for drawer forms), `FormError` (form-level `role="alert"`), textarea sizing, `box-sizing` | value/validation/submission still owned by callers |
| `Button` (changed) | + `buttonProps(variant, size)` | same contract on a native `<Link>`/`<button>` whose markup tests or callers depend on; no second primary style |
| `Panel` (validated, unchanged) | selective grouping | fits as-is (flat, token border, optional header actions); used in the harness only — no representative page needed a new grouping |

Button validation: primary / secondary / ghost / danger cover every real use found (primary create, outline secondaries, text row actions, destructive). Loading state is expressed through existing `disabled` + label text ("Saving…"); no spinner added. Link-vs-button: navigation stays `<Link>` with `buttonProps`, actions stay `<button>`.

### Representative migrations

| Module | Surface | What changed |
|---|---|---|
| CRM | `app/crm/companies/page.tsx` | PageHeader, WorkToolbar + labelled search, TableContainer/table contract, numeric Contacts/Deals/Pipeline right-aligned, TableStateRow loading/empty, primary Button |
| CRM | `app/crm/_components/CompanyForm.tsx` | shared Field for every control (label↔control association, visible "Required"), FormError, FormActions + primary Button; `#1a1d24` and `outline: 'none'` removed |
| People | `app/people/page.tsx` | PageHeader (all links/actions preserved and still `canManage`-gated), WorkToolbar search, table contract, TableStateRow loading/error/empty (copy unchanged), employment status → semantic Badge, drawer-opening names/"View" as real buttons |
| People | `app/people/_components/PersonForm.tsx` | shared Field for all inputs/selects (local `Field` API kept: `label="Start Date" type="date" …` pins intact), FormError, FormActions |
| People | `app/people/_components/PersonDrawer.tsx` | loading/error → StateMessage; dark-only `rgba(255,255,255,.06)`/`#1a1d24` Edit button → secondary `buttonProps` |
| Commercial | `app/commercial/invoices/page.tsx` | PageHeader, WorkToolbar status filter (now has an accessible name), table contract, Total right-aligned tabular, invoice number no-wrap, TableStateRow |
| Commercial | `invoices/_status.tsx`, `quotes/_status.tsx`, `purchasing/_status.tsx` | local colour maps → semantic Badge tone maps (component names/exports used by callers unchanged) |
| Commercial | `invoices/[id]/page.tsx` | loading/not-found → StateMessage (with a "Back to invoices" action); `PaymentStateBadge` → semantic Badge |
| Data Hub | `import/_components/FileSelector.tsx` | PageHeader (eyebrow "Data Hub"), source select on the Field control style, warnings `#fbbf24` → `--status-warning`, stronger drop zone border/surface, Start import → primary `buttonProps` (native `<button>` kept for the pinned `disabled={!pendingFile}` block) |
| Data Hub | `sources/SourcesAdminClient.tsx` | Active/Inactive `Badge` → semantic `active` / `inactive` (local `<Badge active>` API kept) |

Tables migrated: CRM Companies, People, Commercial Invoices. Data Hub verified against the contract, not migrated: `ReviewPanel` preview already has a focusable, labelled `overflowX:auto` wrapper, `scope="col"` and `tabular-nums` (pinned inline by `dataHubImportContainment`); it differs only in padding (8/10) and sentence-case headers — left for Phase D.

Forms migrated: CRM CompanyForm, People PersonForm; Data Hub control surface: FileSelector (source select + upload + start action).

Filter/action bars migrated: CRM Companies (search), People (search), Commercial Invoices (status filter).

### Status migration

Tone mappings (domain word always stays the visible label — text + colour + shape):
- success: People `active`, Quotes `ACCEPTED`, PO `APPROVED`, invoice `PAID`
- warning: People `inactive`, Quotes `EXPIRED`, PO `PENDING_APPROVAL`, invoice `PARTIALLY_PAID`, invoice Overdue
- error: Quotes `REJECTED`, Invoices `VOID`, PO `CANCELLED`
- info: People `onboarding`, Quotes `SENT`, Invoices `ISSUED`, PO `ISSUED`
- inactive: People `ended`, every `DRAFT`, invoice `UNPAID`, Data Hub source Inactive
- active (product state): Data Hub source/mapping Active (a configuration switched on — deliberately not `success`)

Exceptions (not forced into generic semantics): CRM `ClassificationBadge` (categories, not states — CLIENT/LEAD/SUPPLIER/PARTNER…), CRM `STAGE_COLORS` (pipeline stages), CRM activity `TYPE_COLORS`, Data Hub `SEVERITY_COLOR` and import-history statuses, `_billStatus`/`_receiptStatus` and PO delivery status (same pattern as the migrated PO badge — next candidates).

### Drawer / slide-panel comparison outcome

| Implementation | Width | Mount | Escape | Focus | Dialog ARIA | Close | Mobile |
|---|---|---|---|---|---|---|---|
| CRM / People / Commercial `SlidePanel` (before) | 440 fixed | inline, z200 | no | none | none | scrim, × | overflowed <440px |
| People `PersonDrawer` | wraps People SlidePanel | — | — | — | — | — | — |
| Organiser ItemDrawer | 400 / max 92vw | portal | no | no | no | scrim, × | partial |
| Founder ClientDrawer | 360 below header | inline | no | no | no | ×, scrim | none |
| Admin web-services drawer | 480, glass | always mounted | no | no | no | scrim | none |
| Ops Drilldown / MaintenanceJob | 480, blur scrim | inline | no | no | no | footer Close | none |
| CreateJobModal | 520 centred | inline, owns form | no | no | no | Cancel | none |

CRM, People and Commercial were **behaviourally identical** (same props, same close paths, children own forms), so they were consolidated: `components/ui/app/SlidePanel` is the single shell and each module's `_components/SlidePanel.tsx` is now a one-line re-export (call sites and module import paths unchanged; no cross-module `_components` import). Behaviour kept: `open` gates rendering, scrim click and × call `onClose`, no unsaved-changes guard. Added: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape → `onClose`, initial focus on the first control in the body (panel itself if none), Tab containment, focus return to the opener, named `type="button"` close, full width ≤480px, tokens (`--scrim`, `--border`, `--shadow-dialog`) instead of `rgba(0,0,0,.6)`/`#1a1d24`. Organiser, Admin and Ops drawers differ in mounting, width, animation and form coupling — **not merged**; they are the Phase D targets for the same shell or its tokens.

### Focus migration

Removed in touched files: 4 `outline: 'none'` sites (CRM Companies search, CompanyForm input, People search, PersonForm input); every replacement control uses the global `:focus-visible` ring (inset where clipped). Remaining (tracked files, same regex): 124 matching lines in 73 files, of which 17 are in CRM (7), Commercial (5), People (4) and Data Hub (1 — `ImportClient.tsx` programmatic-focus heading target, pinned by tests). No Phase C primitive suppresses outlines (guarded).

### Regression guards

- `tests/containment/appWorkSurfaces.test.ts` (55): Phase C CSS token-only (no hex/rgb/hsl, no `--purple-*`), no gradient/glass/blur/glow, no outline suppression, box-shadows limited to flat inset rules or `--shadow-dialog`, radii from the token scale; table density contract (32px header, 40px rows, 13px, right/tabular numerics, overflow region, hover/selected); converted surfaces free of colour literals/legacy purple/outline suppression; list pages use PageHeader/WorkToolbar/TableContainer/TableStateRow; forms use Field + FormActions; Commercial/People/Data Hub statuses use the semantic Badge; one SlidePanel shell with dialog semantics and unchanged close paths.
- `tests/components/app/WorkSurfaces.test.tsx` (25): axe light/dark (page, loading table, empty table, StateMessage, open SlidePanel), PageHeader heading levels, labelled search + polite count, table region/numeric classes, state-row and StateMessage roles, `buttonProps` parity, SlidePanel dialog/Escape/focus return/scrim/close/Tab containment/initial focus.
- Mutation-checked: 14 mutations (white-alpha, card shadow, gradient, outline none, oversized radius, density drift, numeric left-align, `#1a1d24` back in CompanyForm, local status colours, dialog role removed, Escape broken, focus return removed, loading row not a status, search label detached). All caught; the dialog-role mutation initially slipped past the guard (a comment contained the string) — fixed by stripping comments before asserting.
- Existing tests: no existing assertion needed changing for Phase C.

### Visual verification actually performed

No safe authenticated account exists (unchanged). A throwaway harness page in a scratch worktree (never in the repo, deleted afterwards) rendered the **real** migrated module pages — CRM Companies, People, Commercial Invoices, invoice detail, CompanyForm in the shared SlidePanel, Data Hub FileSelector — plus Panel/StateMessage/Badge examples, with fixture data from a stubbed `fetch`. Captured with headless Chrome: lists at 1440 light/dark and 1024 light/dark, states at 1440 light/dark, form at 1440 light/dark; 390 light/dark captured through exact 390px iframes (headless enforces a ~500px minimum window, which made the first 390 captures misleadingly clipped — discarded).
Findings fixed during review: unstyled page-state action link; invoice numbers wrapping at the hyphen; SlidePanel initial focus on the close button (moved to the first field).
Observed OK: no page overflow at 1440/1024/390; wide tables scroll inside their container; header actions and toolbar wrap; forms full width in the panel at 390; light warm/low-noise with dark text, dark near-black without blue drift.
Not performed: authenticated route review with real layouts/sidebars (pending a safe test account). Harness pages render without module layouts, and show the public header above the content (harness artefact).

### Deferred abstractions / remaining debt

- No `DataTable`, sorting, pagination or bulk-action primitives (no shared behaviour exists to abstract).
- Detail pages (CRM company/contact, Commercial quote/invoice/PO/receipt/bill) still carry local `btn`/`th`/`td`/`sel`, `#1f2937` slabs, three destructive styles and blue confirm panels; PO detail (1,047 lines) untouched.
- Remaining CRM/Commercial list pages (contacts, activities, customers, products, suppliers, quotes, POs, receipts, bills) and People sub-pages (teams, administrators — whose `style={empty}` rows are test-pinned — restricted cases) not yet on the contract.
- Data Hub: stepper, per-step headings, narrowed live region, wider review step, drag-over state, cyan for mapping/progress, `ImportError`/amber notice boxes, Sources lists-as-cards.
- The semantic Badge is pill-shaped with a mono label; Commercial previously used 4px uppercase pills — accepted as the single status look; review in Phase D if density suffers in wide tables.
- Pre-existing `react-hooks/set-state-in-effect` lint error on the untouched `useEffect(() => { load(); }, [])` line in CRM Companies (identical at HEAD) — left unchanged per the standing rule.
- Module sidebars: target contract noted only (CRM/Commercial accent + 10% tint); convergence is Phase D.

---

## Phase D1 implementation note — module navigation, Events, Admin, Ops

Scope: shared module-navigation language, Events & Ticketing, Admin/settings, and the Ops workspace shell and drawers. Dashboard/Command content, Organiser, and the remaining CRM/People/Commercial/Data Hub pages were not touched. Uncommitted on `feat/app-visual-system-convergence`.

### What current code showed (verified before changing)

- Module navs: CRM and Commercial sidebars were byte-identical except for their item lists and titles (Commercial builds its list from capability props). AdminAside had hard-coded greys and white-alpha (`#e5e7eb`, `rgba(255,255,255,.06)`). The Ops Sidebar used `rgba(139,92,246,.12)` / `rgba(124,58,237,.10)`, JS hover and a "tactical" bolt-polygon logo. None of them used `aria-current` or named their `<nav>`. People and Events have no sidebar (header links / back links only) and still don't.
- Events was already mostly on tokens; the real blockers were forced-dark `KpiCard theme="dark"` (14 cards), the `rgba(7,5,16,.98)` dropdown panel, hard-coded `GREEN/RED/YELLOW`, about 20 copies of `#FCA5A5` error text, `#e5e7eb` "module not enabled" fallbacks, and one `outline: none` with a violet glow. There are no Events drawers or modals, and no tables (lists are row cards by design).
- Admin used no colour tokens at all; the layout painted `#07080B`. Pages relying on the layout background (Pipeline, Planner/Sessions, Agent Runs, Agent Test) would have become unreadable in light mode once the layout was tokenised, so they were converted in the same phase. `app/admin/orgs/OrgsClient.tsx` is dead code (not imported).
- Ops: the shell was theme-aware through `useOpsTheme()` (JS values). The drawers and CreateJobModal were hard-coded dark (60–77 white-alpha literals each) with glass blur, glows and violet gradients. `Widget.tsx` is used only by the dashboard insights tabs.

### A. Module navigation

- New `components/ui/app/ModuleNav.tsx` + `.module.css`: `ModuleSidebar` (title/subtitle identity, labelled `<nav>`, optional footer), `ModuleNavItem`, `ModuleNavSection`, `moduleNavItemProps(active)` for hand-written links, and `moduleNavFooterItemClassName`.
- The active language matches the global chrome: accent text, weight 600, 2px inset rule, accent-muted tint, keyed on `aria-current="page"`. Hover uses `--bg-sunken`, focus the global ring (inset). Below 768px the sidebar becomes a horizontal scrolling strip above the content (via `:has()`; browsers without it keep the desktop layout).
- Migrated: CrmSidebar and CommercialSidebar (items, gating, active rule and the `const navItems =` builder unchanged), and AdminAside (items, order, `<a>` vs `<Link>`, `HIDDEN_ROUTES` and the startsWith rule unchanged; `link()` now returns module-nav props).
- The Ops Sidebar shares the CSS contract only (`components/ops/OpsSidebar.module.css`), because its collapse, icons and shell-owned state differ. It now has `aria-current`, CSS hover, a named nav, collapse/theme buttons with `aria-label`/`aria-expanded`, and alert text for screen readers. The approved broken-orbit mark replaces the bolt-polygon logo (the bolt remains only as the Command Centre nav icon). "Systems Live" and the alert dot lose their glow and blinking; the entrance fade was removed after it was found leaving labels at opacity 0 in background/virtual-time rendering. The `SECTIONS` array is untouched (whitespace-pinned by tests).
- Test updated: `implementationsApi.test.ts` pinned `style={link('/admin/implementations')}`; it now pins `{...link('/admin/implementations')}` (same entry, link, href and label).

### B. Events

- `app/events/_components/ui.tsx` is token-only. `VIOLET*` map to the product accent; `GREEN/RED/YELLOW` map to status tokens. `StatusBadge` keeps its `{label, tone}` API and renders the semantic Badge (success→success, danger→error, warning→warning, neutral→inactive). Primary/secondary/danger buttons use the shared Button colours. The `FilterDropdown` panel uses `--bg-overlay` / `--border` / `--shadow-menu`, with a sunken hover. The scoped CSS drops `outline: none` and the violet glow.
- Forced-dark KPI cards were replaced by the new `MetricStrip` / `Metric` primitive (`components/ui/app/Metric.tsx`): one bordered surface, hairline-divided cells, `<dl>` label/value pairing, tabular figures, placeholder + `aria-busy` while loading, and colour only for state (capacity full, event status, pending payments). `KpiCard` itself is unchanged (dashboard insights still use it).
- The list and Payments headers moved to `PageHeader` (the Events CapabilityIcon identity is kept). White-alpha row/meta-pill surfaces, `#FCA5A5` errors and the `#e5e7eb` fallbacks are now tokens. The check-in result banner uses status tokens; the camera viewport stays `#000`.
- Test updated: `eventsRegistrationFilterDropdowns.test.ts` pinned the dark-only `rgba(7,5,16,.98)` panel; it now pins the overlay tokens.
- Unchanged by design: row-card lists (not tables), native `confirm()` for destructive actions, and inline registration expansion.

### C. Admin

- The layout is on `--bg-base` / `--text-primary`. AdminAside uses the shared module nav.
- Users (`UsersClient`): PageHeader, table contract, shared Buttons (Delete = semantic danger), shared `Field` + `FormActions` / `FormError`, and the new shared `Dialog`. Role colours are tokens; super_admin uses the accent instead of `#a78bfa`. All option JSX pinned by tests is unchanged.
- Orgs (`AdminClient`): PageHeader, table contract with labelled sections, shared buttons (`PrimaryBtn` name kept for its pin, now the shared primary Button), `Modal` delegates to `Dialog`, tokenised tabs (`aria-pressed`), and tables and create forms wrap on narrow screens. Founder CRM stage colours (`STAGE_C`) are kept as a data encoding shared with Founder OS.
- Implementations (list and detail), Client Events (event status → semantic Badge), Pipeline, Planner/Sessions (indigo selection states → product accent; "New" status → info), Agent Runs and Agent Test (confidence thresholds → status tokens; agent/route colour maps kept as encodings): all neutrals, surfaces, errors and buttons are tokens, with no blur or outline suppression.
- Branding settings: CARD/BORDER/TEXT/RED/GREEN constants are tokens and buttons use the accent. The tenant preview keeps a fixed dark palette because it mirrors the always-dark customer ticket, and `ACCENT` stays the tenant default brand colour (data).
- New shared primitive: `components/ui/app/Dialog.tsx` (centred counterpart of SlidePanel). Both now share `components/ui/app/useDialogFocus.ts`: first body control focused, Tab contained, Escape → `onClose`, focus returned to the opener.

### D. Ops

- Shell: OpBar is a flat token surface. The no-op `backdrop-filter`, purple shadow, gradient avatar, violet literals and blinking Live dot are gone. The alert link has an accessible name with its count, and "HLNΛ active" becomes "HLNA active" (plain wordmark in status prose). WorkspaceShell drops the gradient grid, scopes its `box-sizing` and scrollbar rules to `.ws-shell` (they were document-wide), keeps `body { overflow: hidden }` (layout behaviour), and hides OpBar secondary status below 768px.
- Drawers (MaintenanceJobDrawer, DrilldownDrawer) and CreateJobModal: every neutral / surface / border is a token; scrims use `--scrim` without blur, panel shadows `--shadow-dialog`, confidence bars a flat accent fill; glows, `outline: none` and forced `colorScheme: 'dark'` are removed; the select chevron is a neutral grey that works in both themes. They gain `role="dialog"`, `aria-modal`, labels, named close buttons, Escape and focus handling via `useDialogFocus` (content marked `data-dialog-body`).
- Operational encodings preserved: severity (CRITICAL/HIGH/MEDIUM/LOW), maintenance status (including violet SCHEDULED and orange ESCALATED), workflow states, timeline and activity types, and risk and priority colours. Only their white-alpha "Closed" entries became a mid-grey (`#8A8580`), which reads in both themes and stays safe for hex-alpha concatenation.
- Not converted: `components/ops/widgets/*` (Widget is only used by the dark-only dashboard insights tabs, so converting it alone would put light cards on a dark page), IntelRail, and the Command/bin-maintenance page content (Dashboard/Command phase).

### E. Status badge decision

In dense authenticated tables the rounded mono pill read as decorative and repeated pills competed with the data. Decision: one Badge in two contexts. In the signed-in app (default) it is a compact 4px tag (20px high, surrounding face, weight 600); on the public site (`.bb-public`) the original rounded mono pill is unchanged. States, colours, dot shapes, text, API and accessibility are identical, so no second badge system was created. Commercial's previous 4px grammar is effectively restored.

### Focus cleanup

11 `outline: none` sites removed in D1-touched files: UsersClient, AdminClient, Pipeline, Sessions, Agent Runs, Agent Test, Events `ui.tsx`, MaintenanceJobDrawer, DrilldownDrawer (2) and CreateJobModal. Remaining (tracked files, same regex): 113 matching lines in 63 files. In the D1 areas the remainder is in unconverted Admin pages (Deployments 1, Web Services 4 + LeadMessages 2, dead OrgsClient 1).

### Responsive review (harness)

- Module navs collapse to a horizontal strip below 768px. Admin tables and the Users table scroll inside their containers, and Admin create forms wrap below their tables.
- The Events metric strip reflows (a partial last row shows plain surface). A mid-word break in the "PUBLISHED" metric was fixed by raising the cell minimum to 148px and using `break-word`.
- The Ops shell has no page overflow (fixed, clipped workspace). OpBar secondary items hide below 768px; the Ops Sidebar remains desktop-first (collapsible to 56px); no mobile IA was invented.
- Drawers and modal are capped at the viewport width.

### Visual review actually performed

No safe authenticated account (unchanged). A throwaway scratch worktree (never in the repo, deleted afterwards) rendered the real components with fixture data behind a stubbed `fetch`: EventsListClient, EventDetailClient (including RegistrationsPanel and QuestionsPanel), AdminAside + UsersClient, AdminAside + AdminClient, CrmSidebar, a ModuleSidebar sample, OpsSidebar (expanded and collapsed), WorkspaceShell + OpBar, MaintenanceJobDrawer and CreateJobModal. It was captured with headless Chrome at 1440 / 1024 / 390 × light / dark (48 captures); the FilterDropdown panel was checked open in a real browser in both themes.
Findings fixed during review: metric strip grid painting empty cells; "PUBLISHED" mid-word break; near-white `rgba(230,237,243,…)` text missed by the first pass (invisible in light); dialog focus ring falling on the whole panel; Ops labels hidden by an entrance animation. Harness artefacts (not product bugs), called out for reviewers: headless virtual time froze CSS animations and occasionally painted before the theme applied, and the harness path means no Admin/CRM item is active.
Not performed: authenticated route review with real layouts, sessions and data.

### Regression guards

- `tests/containment/moduleSurfacesD1.test.ts` (45): module-nav CSS token-only with the shared `aria-current` active rule; CRM/Commercial/Admin render `ModuleSidebar` with no private active colours; the Ops sidebar has `aria-current`, class hover and the approved mark in its brand links; Events files have no white-alpha / near-white, retired violet, glass, gradient or outline suppression, a token-only kit, the semantic Badge and no `KpiCard` / `theme="dark"`; converted Admin files have no dark-only surfaces or white-alpha (documented encoding maps excluded by line), with a token layout, semantic danger deletes, table contract and Dialog; the Ops shell and drawers are tokenised with dialog semantics and encodings preserved; badge decision (app 4px tag, public pill).
- `tests/components/app/ModuleSurfaces.test.tsx` (23): ModuleSidebar axe light/dark, labelled nav and `aria-current`; the real CrmSidebar and CommercialSidebar (items, gating, active); the real Ops Sidebar (`aria-current`, collapse `aria-expanded`, theme button name, alert text, axe); Dialog (labelled, first-field focus, Escape, focus return, scrim/close, axe); MetricStrip (`dt`/`dd` pairing, loading busy/no fake values, axe); Events StatusBadge → semantic states.
- Mutation-checked: 16 mutations (inset rule dropped, private color-mix active, dark dropdown panel, forced-dark KPI, dark admin surface, non-danger delete, OpBar blur, drawer dialog role, pill badge, Ops JS hover, `aria-current` removed, Escape broken, metric fake value, Events tone mis-map, collapse `aria-expanded` removed, pinned dropdown shadow). All were caught; sources restored.

### Deferred / remaining debt

- Admin dark islands (paint their own dark background, still readable): Founder OS (2,728 lines, `T` tokens heavily test-pinned), Web Services + LeadMessages, Deployments. Dead `OrgsClient.tsx`.
- Ops: `Widget.tsx` + dashboard insights tabs (recharts colours from `DARK_TOKENS`), IntelRail (decorative glows, HLNA orb — must not be redesigned), and the Command and bin-maintenance page content. The "Day Job" dual-active item (startsWith on every `/dashboard/*`) is a documented functional issue.
- Events: row cards inside a Panel (card-in-card), native `confirm()` destructive flows, FilterDropdown without arrow-key navigation, and long option labels scrolling horizontally within the 260px cap.
- Documented colour encodings kept as literals: Founder CRM stages, agent/route colours, Ops severity / status / priority / timeline maps, and the tenant branding default accent.
- Pre-existing lint errors left unchanged (identical at HEAD): `set-state-in-effect` (Agent Runs, Implementations, CRM Companies, WorkspaceShell), components-during-render and impure-render (Drilldown / MaintenanceJob drawers), and AdminAside's `<a href="/">` (kept as a full-page navigation).

## Phase D2 implementation note — Dashboard, Command and intelligence surfaces

Scope: the generic organisation dashboard (`/dashboard` fallthrough), its loading state and trial banner, `/command` (page, Financial tab, widgets) and the shared intelligence rail. Routing, variant resolution, capability logic, org scoping, queries, APIs, metric/alert calculations, refresh intervals, assistant state, chat, command actions and permissions are unchanged. Organiser, the remaining CRM/People/Commercial/Data Hub work and the Founder OS redesign were not started.

### What current code showed (verified before changing)

- `/dashboard` resolves three variants: Brainbase HQ is redirected to `/admin/founder`, LD Tennis gets `TennisDashboard`, and everyone else gets `OrganisationDashboard`. The generic dashboard had no charts. It showed six private `MetricCard`s inside a translucent card, decorative accent top borders and emoji icons, with module access above the metrics.
- `/command` uses no recharts. Its charts are hand-drawn SVG: KPI sparklines, a Heartbeat line, the IntelRail radar and the map widget. Its KPI strip, status ribbon, alert cards and seven tab tile sets were private inline tiles with blur, glow, gradient lines and pulsing dots. `financial.tsx` was forced dark (white-alpha text, `colorScheme: 'dark'`, clickable `<td>`s, two `outline: none`).
- The widgets (HlnaBriefing, Weather, Map) and IntelRail are imported only by `/command` (the rail through `WorkspaceShell intelRail`). `Widget.tsx` and `components/dashboard/ui/*` (`KpiCard`, `tokens.ts`, etc.) are used only by the `DashboardShell` sub-routes and `bin-maintenance/insights`, so they were left alone (see debt).

### Dashboard changes

- `OrganisationDashboard` now uses `PageHeader` (title "Dashboard", the org name as description, "Open HLNA" as a secondary button-link to `/hlna`), then Operational Overview, then Your Tools.
- Operational Overview: an exceptions list ("Needs attention") comes first, then one `MetricStrip`, with no card-in-card. The empty state is `Panel` + `StateMessage` with the same copy.
- The three thresholds that previously only coloured tiles (contamination > 10, defects > 5, open requests > 20) are now named constants. They drive both the metric tone and a written exception line with a semantic `Badge`. The values, data flags and query shapes are unchanged, and every pinned literal is preserved.
- Removed as decoration: emoji icons, accent top borders, the always-green "Closed Requests", the purple Waste Cost and the cyan Fleet Cost colours.
- `ModuleAccessCard` (shared with `TennisDashboard` and `BrainBase.jsx`, same props) is now a compact bordered list: a small capability icon, name, purpose and a direct "Open …" action, one row per module. JS hover state, large tiles and colour-mix hover are gone. Copy, destinations, gating, `return null` and the `MODULE_ENTRIES` shape are unchanged.
- `TrialBanner` uses tokens only: expired is the danger status, an active trial is the restrained accent (product state), and three days or fewer shows the warning colour on the written "N days remaining". `app/dashboard/loading.tsx` is replaced by a token skeleton that mirrors the new page (header, metric strip, two panels). It has no ambient violet glow, blur or shimmer, is announced once as busy, and respects reduced motion.

### Command changes

- Shell and header:
  - The toolbar is flat tokens.
  - "Demo Environment" and the panel "DEMO" tag use the warning tokens; the text is unchanged.
  - Breadcrumb links are muted text.
  - "Edit workspace" and "Reset layout" use the shared `Button`; the edit toggle has `aria-pressed`.
  - The react-grid-layout overrides use tokens: accent-muted placeholder, `--shadow-popover` while dragging, no blur, reduced-motion aware.
- Tabs:
  - The 8 view tabs and the 5 Financial sub-tabs are real `tablist` / `tab` / `tabpanel` with `aria-selected`, roving `tabIndex` and Arrow / Home / End keys.
  - URL syncing (`?tab=`) is unchanged.
  - The active tab is shown by an accent underline with primary text; it no longer uses a violet fill.
- Panels: every widget shares one surface (`--bg-surface`, 1px `--border`, `--radius-lg`, a 36px header with an uppercase muted title). There is no blur, glow, gradient, edge light or ambient animation.
- Status ribbon: cells are `<button aria-expanded>` (previously clickable divs). The dot is a static status token next to the written note. Pulse and ring animations are gone.
- Alerts:
  - Each alert card shows its status as a semantic `Badge`, a 3px status-coloured left rule and a status-coloured metric.
  - Details open from a real `<button aria-haspopup="dialog">`; a mouse click anywhere on the card still opens the drawer.
  - The action link is a secondary button. Lift, glow and translate hovers are removed.
  - Client Requests use the info status in place of indigo.
- Actions: one neutral row style for links and buttons. The red/amber/blue per-action tints are gone; the "Coming soon." `alert()` behaviour is unchanged.
- Changes: rows with ▲/▼ glyphs, a status-coloured delta and "up"/"down" text for screen readers. The decorative Heartbeat is removed.
- Analytics tabs: each tab is a heading plus a `MetricStrip`, with a Phase C `TableContainer` + `tableStyles` table where rows exist. Loading uses `StateMessage`, and statuses (debtor OPEN, CRM Active) are semantic `Badge`s.
- Financial:
  - Theme-aware.
  - `MetricStrip` summary (Net Variance tone plus "Within/Over budget").
  - Labelled range and date inputs.
  - Phase C tables with right-aligned tabular figures.
  - Variance colour on the signed value.
  - The manual-override marker is accent with a title and screen-reader text.
  - Edit cells are keyboard-operable buttons that open a labelled input.
  - The PATCH calls, the 600ms multiplier debounce and every calculation are unchanged.
- Layout fixes (pre-existing defects; the same code is at HEAD):
  - Grid width: the page measured its grid with a `[]` effect, but `WorkspaceShell` renders a placeholder on first mount. The `ResizeObserver` never attached, so the grid stayed at its 900px default (half-width on wide screens, clipped and unreachable on narrow ones). It now uses a callback ref.
  - Minimum width: the grid keeps a 720px minimum, and the canvas scrolls horizontally inside itself below that (Command keeps its desktop density).
  - KPI columns: the KPI strip is fixed at 5 columns so it fits its fixed-height grid cell.

### Metric convergence

- Inventory, with 16+ implementations recorded:
  - The generic dashboard `MetricCard`, the Command `KpiStrip`, the six Command tab tile sets and the Financial tiles were visual duplicates.
  - `StatusRibbon` and the alert cards are different interactions: interactive status controls, not metrics.
  - The shared `components/dashboard/ui/KpiCard` is not reachable from `/dashboard` or `/command`.
- The duplicates on D2 surfaces moved onto the D1 `Metric`, extended once (not per dashboard type):
  - `change` adds a change line. Direction is shown by a ▲/▼/– glyph (hidden from screen readers) and written in the label; its tone is independent of direction (a rise can be bad).
  - `visual` adds an optional decorative graphic (sparkline), hidden from assistive tech.
  - Both are suppressed while loading. The `visual` branch keeps valid `<dl>` structure: the row itself is the `<dd>`, a defect caught by axe during D2.
- Not converted: `KpiCard` / `DashboardShell` / insights / waste sub-page tiles, `OverviewClient`, Tennis `StatCard`, Founder snapshot tiles (debt).

### Panels / widgets

Briefing, Weather, Map, Alerts, Actions, Changes, Assistant and IntelRail share one panel treatment (`widgets.module.css`, `command.module.css`, `IntelRail.module.css`). All information and controls are retained. Removed:

- blur, ambient radial blobs, gradient header washes, edge lighting and inset/outer glows
- glowing or blinking dots, pulse and ring animations
- the map scan line and `feGaussianBlur` filters
- the radar sweep, gradient load and confidence bars, and the forced-black map and radar canvases

The map's invalid hover `rgba` string is now a fill-opacity change.

### Assistant visuals (A brand / B functional state / C decorative)

- **A — kept or introduced (identity):** the HlnaBriefing header now uses the approved `BrokenOrbitMark` (context `hlna`) plus "HLNA" text, replacing the legacy `/assets/brand/hlna-wordmark.svg` image. The "HLN<span>Λ</span>" lambda treatment in the Assistant panel, the placeholder and IntelRail is plain "HLNA".
- **B — retained unchanged:**
  - `HlnaOrb` in the Command Assistant panel (real chat state: idle → thinking) and in IntelRail (its simulated flash on AI events). Only their extra drop-shadow / `ir-glow` wrappers were removed; the orb component itself is untouched.
  - The chat "thinking" indicator (three dots, token colour, `role="status"` with "HLNA is thinking…", reduced-motion aware).
  - The briefing typing reveal (the full sentence is exposed once to assistive tech).
  - The rail's "Processing analysis… / Monitoring operations" text and its load bar (now a flat accent fill).
  - `HelenaOrbital`, `HelenaWorkspace`, `MicButton` and `HlnaAssistantWrapper` were not touched.
- **C — removed or simplified:**
  - the green blinking "online" dots and "Live" dot animations (the "Live" text is kept)
  - the orb glow and breathing keyframes, the ambient orb blob and the gradient confidence bar
  - the MiniRadar sweep (now a static, theme-aware plot)
  - the IntelRail edge light and header gradient
- Not touched in D2: InsightBanner (DashboardShell sub-routes), `CommandCentreHero` (`/dashboards`) and the TennisDashboard idle orb (Tennis surface). The orphans `HlnaAssistant`, `HlnaStatusBar`, `HeroOrbitMark` and `BrandLogo` / `GlassHeader` are unchanged and remain debt.

### Chart palette decisions

- `components/ui/app/chartPalette.ts` adds `CHART_PALETTE` (dark and light), `chartPalette(theme)` and `useChartPalette()`. These are concrete colours for SVG attributes and chart libraries that cannot resolve CSS variables.
- Roles: primary (accent), secondary (accent tint), comparison and neutral (warm greys), success / warning / danger / info (status "dot" strength), grid, axis and tooltip background/border/text.
- Values mirror theme tokens. Two light values were adjusted because they fell below 3:1 on white: secondary is `#8B70DE`, and warning uses `--bb-warning-fg` `#87500a`, since `--bb-warning-dot` is 2.8:1.
- No rainbow palettes. The IntelRail activity categories went from six hues to neutral, with only alerts (danger) and HLNA/AI (accent) coloured; the category is also written in each row.
- Applied to the KPI sparklines (danger/success by the existing `trendBad`), the Map widget (zones, routes, markers, grid, labels, compass) and the IntelRail radar.
- Checked in both themes in the harness: sparklines, map fills, strokes and labels, radar. There are no D2 recharts surfaces to check tooltips on; the tooltip roles exist for the next phase.

### Hard-coded KPI / data findings (left unchanged — do not treat as real)

`app/command/page.tsx`:

- `ALERTS` (L30), `SYS_STATUS` (L39), `CHANGES` (L48) and `SUGGESTED` (L55) are static demo arrays. `ALERTS` is tagged DEMO in the panel; `CHANGES` is intentionally untagged (pinned by a test).
- The initial assistant message "Good morning… 2 alerts need your attention today." (L280) is static.
- `KpiStrip`:
  - "Fleet Avail." is `88%` with `−4% wk` (L191). It is entirely static and looks like presentation data.
  - The completion fallback `?? 81` (L182) is a fabricated value used when the API has no data.
  - The On-Time trend labels `+2%` / `−6%` (L188) are invented from a threshold.
  - "Active Alerts" shows the illegal-dumping `totalIncidents`, labelled as alerts.
  - The `sparks` histories (L194) are fabricated except for their final point.
- `LiveAgo` counts seconds since mount ("Demo · Ns ago").

Widgets (static presentation data, some presented as live):

- `HlnaBriefingWidget`: `WHAT_CHANGED` / `RECOMMENDED` / `AFFECTED` (L16–31), `CONFIDENCE = 87` (L33), "· Live Analysis", "HIGH RISK", and the 87,400km narrative.
- `WeatherWidget`: `FORECAST`, `OPERATIONAL_IMPACTS`, 19°, 8mm tonight.
- `MapWidget`: `ZONES` / `INCIDENTS` / `ROUTES`, plus a "Live" footer label.

`IntelRail`:

- `ACTIVITY_POOL` and `INITIAL_ACTIVITY` are simulated as a live feed every 5s.
- `PULSE_INSIGHTS` rotates every 7s.
- `TASKS`, `HEALTH`, the "2 critical" counts, the `65%` / `32%` load and "Intelligence v2.4 · Live" are static.

`OrganisationDashboard`: the thresholds 10 / 5 / 20 are hard-coded presentation rules (now named), and "Avg across suburbs" is fixed copy. Every value there comes from real org-scoped queries.

### Status / alert changes

- One semantic mapping per surface:
  - Command `S`: critical → danger / error "Critical"; warning → warning; stable and ok → success; warn → warning.
  - IntelRail priority: critical → danger, high → warning, medium → info.
  - Weather impact: high → danger, medium → warning, low → success.
  - Briefing priority: critical → error, high → warning, medium → info, low → inactive.
- Purple appears only for product state: the HLNA/AI activity, "HLNA Core Active", the active tab, the edit toggle, the Financial override marker and accent actions. It never marks a warning or critical state (guarded).
- Every coloured status also carries text or a glyph: badges, written notes, ▲/▼, "(manual override)", and screen-reader priority prefixes.

### Focus cleanup

- Removed 3 `outline: none` in D2 files: the Command assistant input, and the Financial edit input and date input.
- Every touched interactive element has a `:focus-visible` rule or the global ring: tabs, ribbon cells, alert buttons, action rows, suggestions, edit buttons and inputs, rail task links, briefing recommendation links and module rows.
- Remaining (tracked files, same regex): 110 matching lines in 61 files (down from 113 in 63).

### Responsive findings (harness)

- **Dashboard:** usable at 1440, 1024 and 390. The metric strip reflows to 2 columns at 390, exception badges wrap above their text, module rows wrap the action, and there is no page overflow.
- **Command:** no page-level overflow at any width.
  - At 1024 the canvas (about 540px beside the sidebar and rail) scrolls horizontally inside itself around a 720px-minimum grid. The toolbar wraps and the tab row scrolls internally.
  - At 390, when the rail is present, `WorkspaceShell` stacks the rail under the canvas in one vertical scroll (scoped to `.ws-body--rail`, so rail-less `bin-maintenance` is unchanged); nothing is hidden. With the D1 desktop-first Ops sidebar expanded, the canvas is about 170px wide; collapsed, about 330px.
- Chart graphics keep their aspect or scroll inside their panels. No new mobile IA was introduced.

### Visual review coverage (harness verification, not authenticated-route verification)

- No safe authenticated account, so a throwaway scratch worktree (never in the repo, removed afterwards) rendered the real components with fixture data behind a stubbed `fetch`. It was served by `next start` on `/d2harness`, whitelisted in the scratch copy's middleware only.
- Headless Chrome (24 captures, 1440/1024/390 × light/dark):
  - generic dashboard: normal with exceptions and module access, calm low-data, empty, loading skeleton
  - also captured headless but not used: the briefing, rail and Command views came out blank or with frozen timers
- Real Chrome, via an exact-width iframe (headless left `/command` blank and froze its timers, a harness artefact):
  - Command main workspace at 1440 dark and light, including the lower half (alerts, actions, changes, assistant, map)
  - 1024 dark
  - 390 dark with the rail stacked (and 390 light before the fix, which exposed the 32px canvas)
  - the side rail in idle and thinking states
  - the assistant thinking state (the pending chat request)
  - the Financial tab (light)
  - the expanded HLNA briefing (light)
- Fixed during the review:
  - the grid-width defect and the 390 canvas squeeze described above
  - KPI strip clipping
  - status badges stretching to full card or row width in alert cards and briefing recommendations
- Not performed: authenticated routes with real layouts, sessions and data.

### Regression guards

- `tests/containment/dashboardCommandD2.test.ts` (40):
  - Across the 10 D2 TSX and 7 CSS files: no glass or blur, gradients, glow shadows, white-alpha, retired violet, forced dark or outline suppression, and no raw colour literals at all.
  - `:focus-visible` rules for the interactive classes.
  - The dashboard reading order and shared primitives, the named thresholds and the compact module list.
  - Status tones mapped to status tokens (never the accent); the Command / IntelRail status maps; the KPI change contract.
  - `HlnaOrb` unwrapped with its state prop, the approved mark in the briefing, and no lambda wordmark.
  - The chart palette mirrors named tokens, every series is ≥3:1 on the surface in both themes, the themes differ in grid, axis and tooltip, and the SVGs use the palette hook.
  - Command tablist, ribbon buttons, labelled chat, and Financial edit buttons.
- `tests/components/app/DashboardCommand.test.tsx` (27):
  - `Metric` change/visual semantics and axe
  - `OrganisationDashboard` header, link, written exceptions, tones, order, empty state and axe (light/dark)
  - `ModuleAccessCard` null state
  - Briefing expand state and meter, map description and palette use, rail priority text, and axe on briefing, weather, map and rail (light/dark)
  - `useChartPalette` following the theme
  - Financial edit button → labelled input, sub-tab arrows, axe
  - The full Command page: roving tabs, ribbon expand, live KPI values and demo markers, labelled assistant, alert badge and dialog button, axe (light/dark)
- Mutation-checked with 16 mutations, all caught, sources restored:
  - rail blur, violet tab, `outline: none`, critical → accent, orb glow wrapper
  - light warning below 3:1, module access above metrics, white text in Weather
  - legacy wordmark, `:focus` instead of `:focus-visible`, danger tone → accent
  - gradient meter, hard-coded sparkline hex, clickable `<td>`, unlabelled chat input, forced-dark loading

### Remaining D2 debt

- The `DashboardShell` verticals, `bin-maintenance/insights` (`KpiCard` + `tokens.ts` `DARK_TOKENS` + recharts), the waste sub-page mock-ups, `OverviewClient` and every `/dashboard/*` recharts chart are still forced dark with local palettes. They should move to `CHART_PALETTE` and `Metric` in a later phase. `tokens.ts` still claims to mirror `DashboardShell` and does not.
- `components/dashboard/ui/InsightCard` and `Section` are imported but never rendered. `OpportunityCard`'s "Assign →" has no handler (functional issue, documented).
- TennisDashboard (`StatCard` glow and "LIVE" chip, `LeadsChart` and `WeatherPanel` with forced-dark tooltips, idle orb) is a Tennis surface and not converted. `CommandCentreHero` and InsightBanner are also not converted.
- Command:
  - The Ops sidebar is still desktop-first at 390, per the D1 decision.
  - The briefing / map / rail content is static demo data presented with "Live" wording (listed above, unchanged by instruction).
  - Alert cards keep a whole-card mouse click alongside the real button.
  - "Coming soon." uses native `alert()`.
- Pre-existing lint errors left unchanged (identical at HEAD):
  - `set-state-in-effect`: Command page ×3, Financial ×1, `WorkspaceShell`, and the briefing `useTyping`
  - Financial unused `fy` / `updateRiseAndFall` warnings

## Phase D3 implementation note — Organiser convergence

Scope: `/organiser` (`app/organiser/page.tsx`), `components/organiser/OrganiserShell.tsx`, `components/organiser/OrganiserRail.tsx`, plus one compatibility change to the shared `useDialogFocus`. Workflow logic is unchanged: routes, board/group/item/column data, the coalescing mutation queue, save-state keys, the notes autosave, imports, API calls, tenant scoping, assignment, due dates and the Helena context wiring. The final CRM / People / Commercial / Data Hub convergence was not started.

### Architecture audit (verified before changing)

**Page map**

| Area | What it is |
|---|---|
| Shell | `OrganiserShell`: fixed below the app header, rail + canvas. |
| Navigation | `OrganiserRail`: board list, create, rename/delete menu, collapse. |
| Toolbar | Inline-editable board name, a 4-way view switch (table / board / calendar / activity), + New group, Import CSV/XLSX. |
| Table view | `GroupSection` → a CSS-grid pseudo-table (`ItemRow`, `AddItemRow`, `ColumnHeaderCell` menus, `AddColumnButton` popover, `CustomCell`). |
| Board view | `KanbanView`: one column per status; status changes via a `<select>`. **There is no drag-and-drop anywhere in Organiser.** |
| Calendar view | Month grid with due items. |
| Activity view | Keyset-paginated feed. |
| Overlays | `ItemDrawer` (portalled side panel), `ColumnOptionsEditor` (centred modal), `SheetPicker` (inline import banner), import / error notices. |
| Forms | Board / group / item / column creation, inline rename, the drawer fields (status, priority, due date, owner, assignee, notes, files, updates). |

**Keyboard problems found**

- Click-only `<div>`/`<span>` targets: rail board rows, click-to-edit text, table item names, kanban cards, calendar entries, activity summaries.
- Hover-only row actions: rename and delete rendered only while `hover` was true.
- Unnamed icon buttons: collapse, delete, ⋯ menus, ×, calendar ‹ ›.
- No dialog role, Escape handling or focus management on the drawer and the options modal.
- Menus with no Escape handling or `aria-expanded`.
- 7 `outline: none`.
- Selects and date inputs without names.

**Reuse decisions**

- Shared primitives reused: `PageHeader` (board toolbar), `buttonProps` (every button), `fieldControlClassName` (every form control), `StateMessage` (loading and activity states), `useDialogFocus` (drawer + options dialog). The D1 module-nav active-state language is reused in the rail.
- Organiser-specific (kept bespoke): the grid table (user-defined columns), inline rename (`InlineText` dirty-draft logic), the kanban, calendar and activity views, the save-state indicators and the custom `AssigneeDropdown` listbox.
- Ops styling shared: only the JS palette in `components/ops/theme.ts` (no Ops components).
- Must remain behaviourally bespoke: the drawer. It keeps its pinned portal/overlay/z-index/animation, does not reuse `SlidePanel`, and gains only the shared focus behaviour and dialog semantics.

### Organiser structure migrated

- New stylesheets `components/organiser/Organiser.module.css` and `OrganiserRail.module.css`. A test requires `app/organiser/` to contain only `layout.tsx` and `page.tsx`, so styles live beside the shell and rail. Tokens only.
- **Shell:** `var(--bg-base)` and `--text-primary`; no longer reads the ops JS palette.
- **Rail:**
  - A `<nav aria-label="Organiser boards">` with real `<button aria-current>` board rows.
  - D1 active language: accent text, accent tint, inset 2px rule.
  - The options menu button is a sibling (`aria-haspopup="menu"`, `aria-expanded`). Its menu closes on Escape or outside click and Escape returns focus.
  - The collapse button carries `aria-expanded`. The new-board input is labelled and keeps its focus ring.
- **Toolbar:** `PageHeader` with "Organiser" eyebrow, the board name as h1 (inline rename), a pressed-toggle view switch (`aria-pressed`), and `buttonProps` actions. It wraps at narrow widths.
- **Loading:** `StateMessage`. The first-board empty state is a heading plus a labelled input.
- **Notices:** import messages are `role="status"` with info tokens; mutation errors are `role="alert"` with danger tokens. Both have named dismiss buttons.

### Board / list treatment

- Groups are `<section aria-label>` panels: surface, 1px border, `--radius-lg`. The header tint wash was removed; the group colour is shown only as a swatch.
- Column header row on `--bg-sunken`. Dense rows (6px vertical padding) with hairline separators and a row-hover wash.
- Wide boards scroll horizontally inside each group (`min-width: 760px` grid), never the page.
- Kanban: status columns are labelled `<section>`s with h2 headers and a count, cards are flat bordered surfaces (radius `--radius-md`, no shadow), and card titles are real buttons. The card surface keeps its mouse click, the status select is named, and the priority pill is semantic.
- Calendar: a flat grid. Today is marked with the accent ring and number plus a "today" label. Due items are buttons with a status-coloured left rule, and the status is also announced as text. The grid scrolls internally below 640px.
- Activity: a list of flat event rows with `<time>`. Live-item summaries are buttons; deleted items stay plain text.

### Forms

- Every control now uses the shared field control (`fieldControlClassName`) or the compact Organiser cell input, and every input, select and textarea has a name:
  - "Status for …", "Due date for …", column names, "Add item", "Group name", "Board name", "Column name / type", "Option N label", "Notes", "Post an update"
- The drawer's `Field` became a labelled group (`role="group"` + `aria-labelledby`). Save state is written as text next to the label ("Saving…", "Saved", or the error, which is `role="alert"`).
- Errors (create item/group, files, updates) are `role="alert"` in danger tokens.
- Forced `colorScheme: 'dark'` and the dark-only `invert(1)` date-picker filter are removed; the theme's own `color-scheme` handles native pickers.
- Buttons use `buttonProps` (primary/secondary, sm). Form logic, submit guards and copy are unchanged.

### Keyboard / accessibility changes

- **Click targets:** click-to-edit text (`InlineText`), table item names, kanban card titles, calendar entries, live activity summaries and rail boards are all native buttons. The only remaining click handlers on non-controls are two `aria-hidden` scrims and the kanban card surface (a mouse convenience next to its title button). This is guarded.
- **Row actions:** rename and delete are always in the DOM and the tab order, revealed by row hover or `:focus-within` / `:focus-visible` (was a JS hover flag, mouse-only).
- **Icon buttons:** every icon button has an accessible name (guarded). Collapse toggles carry `aria-expanded`.
- **Menus:** column and board menus have `role="menu"` / `menuitem`, `aria-expanded`, Escape and focus return. The add-column popover closes on Escape and returns focus.
- **Drawer:** `role="dialog"`, `aria-modal`, `aria-label="Item details: …"` and `useDialogFocus`. Focus lands on the first field, Tab is contained, Escape closes, and focus returns to the item that opened it. The close button is named.
- **Escape layering:** an Escape consumed inside the drawer (cancelling a title edit, closing the assignee listbox) no longer also closes it. This needed one compatibility change to the shared `useDialogFocus`: it ignores an Escape whose `defaultPrevented` is set. That is safe for its other consumers (Dialog, SlidePanel and the Ops drawers), which do not consume Escape internally.
- **Column options editor:** a real dialog (role, name, `useDialogFocus`). Swatches are named buttons with `aria-pressed`, and the remove button is named.
- **Headings:** the board name is h1; drawer and kanban sections are h2 (axe heading-order).
- **Colour is never the only signal:** save dots carry screen-reader text; calendar items announce their status; kanban columns and priority pills are written.
- **Not changed (functional, documented):** native `prompt()` / `confirm()` for rename/delete/create (rail, columns, groups); the grid table is not exposed with table semantics.

### Overlay changes

- The `ItemDrawer` keeps its portal, its pinned overlay style (`position: fixed; zIndex: 200`) and its `drawer-in` animation. It now has token surfaces, a `--scrim` backdrop, `--shadow-dialog`, and dialog semantics with shared focus.
- `ColumnOptionsEditor` is a centred token dialog with shared focus.
- Neither was forced onto `SlidePanel` / `Dialog`: the drawer's behaviour differs (autosave flush on close, nested listbox, pinned z-index and portal), so only the focus behaviour and visual tokens are shared.

### Status / priority decisions

| Colour | Class | Decision |
|---|---|---|
| Status (Not Started / Working on it / Stuck / Done) | A semantic | muted / warning / danger / success tokens; the word is always shown |
| Priority (Low / Medium / High / Critical) | A semantic | muted / info / warning / danger. Medium was indigo `#818CF8` — **purple removed from priority** |
| Save state (saving / saved / error) | A semantic | neutral / success / danger, with text |
| Import message / mutation error | A semantic | info / danger notice |
| Board, group and column-option colours; `SWATCH_COLORS` | B user category | Preserved as data. Swatch palette kept as-is (it includes a violet the user can pick). The default fallback changed from violet `#8B5CF6` to neutral `--text-subtle`. |
| Active board, active view, today, recommended import sheet, selected assignee | C selection / product | accent tokens |
| Group header tint wash, violet default dot, glowing borders, indigo file links | D decorative | Removed. File links use the accent link style. |

Pills tint via `color-mix` on a `--pill` custom property, so tokens and user hex colours both work (no hex-alpha concatenation).

### Ops-theme dependency

- `components/ops/theme.ts` is unchanged (API intact; Command, bin-maintenance and Organiser consumers are unaffected).
- Organiser now uses it only in `AssigneeDropdown`, whose `t.menuBg` / `t.ink(` styling is pinned by `organiserItemDrawerPortalAndAssigneeTheme.test.ts`. Its violet selected colour became `t.accentText` and its shadow `--shadow-menu`.
- The shell and rail no longer use it (guarded).
- Remaining debt: the assignee picker still takes its surfaces from the JS palette. That helper's `ink()` / `paper()` alphas are theme-aware but not the app tokens. Moving it needs the pin updated deliberately.

### Focus cleanup

7 `outline: none` removed in D3 files (6 in the page — inline editor, add-item, add-column name, option label, new group, new board — and 1 in the rail). All touched controls rely on the global `:focus-visible` ring or an explicit `:focus-visible` rule. Remaining repo-wide (same regex): **103 lines in 59 files** (was 110 in 61).

### Responsive findings

- **1440 and 1024:**
  - The PageHeader toolbar wraps its actions and the pressed-toggle view switch.
  - Groups keep a 220px minimum name column; wide boards (custom columns) scroll horizontally inside each group.
  - The kanban scrolls horizontally inside the view. The calendar keeps a 640px grid with an internal scroller.
  - No page-level overflow at any width.
  - **Fixed during review:** at 1024 the name column collapsed to zero width. The fixed plus custom columns exceeded the grid's minimum width, and the `1fr` track, whose cell had `minWidth: 0`, gave way. The name track is now `minmax(220px, 1fr)` and the group grid is `max-content` inside its own scroller. A cosmetic side effect: each group now sizes its columns independently, so columns no longer line up across groups (logged as debt).
- **390:**
  - Page overflow 0.
  - The item drawer spans the full viewport width (`max-width: 100vw`); the options dialog is capped with a 16px gutter.
  - The view switch and group headers wrap; the group grid and calendar scroll internally.
  - The rail stays desktop-first and collapsible (208px expanded, 56px collapsed), consistent with the D1 Ops-sidebar decision. Expanded, the canvas is about 180px wide; collapsed, about 330px. No new mobile IA.
- **Touch targets:** row icon actions are 20–24px (dense desktop tool). Toolbar and drawer controls use the shared `sm` button (28px+).

### Visual review coverage (harness verification, not authenticated-route verification)

- No safe authenticated account, so a throwaway scratch worktree (never in the repo, removed afterwards) rendered the **real** `/organiser` page (`OrganiserPage` → shell, rail, all views, drawer, dialogs) with fixture boards, groups, items, custom columns, members, files, updates and activity behind a stubbed `fetch`. It was served by `next start` on a scratch route whitelisted only in the scratch copy's middleware.
- Headless Chrome worked only for the light 1440 table (dark stayed on "Loading…", the same harness timing artefact recorded in D2). The review therefore used real Chrome with exact-width iframes:

| View | Captured at |
|---|---|
| Table | 1440 light and dark, 1024 light and dark (before and after the grid fix), 390 dark |
| Board (kanban) | 1440 light |
| Calendar | 1440 dark |
| Item drawer | 1440 dark, 390 light |
| Column options dialog | 1024 dark |
| Filter / action bar (PageHeader toolbar) | every width captured |

- **Not visually captured:** the Activity view, the add-group form, the rail options menu and the first-board empty state. These are covered by jsdom component tests and axe, not by screenshots.
- **Real keyboard walkthrough (real Chrome, keyboard input):**
  - Tab order: rail boards (with an options button each), New board, rail collapse, board title (edit), Table / Board / Calendar / Activity, + New group, Import, group collapse, group title (edit), group delete, column options, Add column, the first item name.
  - Enter on an item opened the drawer as "Item details: …" with focus on Status.
  - In the assignee picker, Enter opened the listbox; the first Escape closed only the listbox (focus back on the Assignee trigger, drawer still open); the second Escape closed the drawer and returned focus to the item name.
  - Tab then revealed that row's rename and delete actions (opacity 1, visible focus ring) while other rows' actions stayed hidden.
- **Fixed during review:** the name-column collapse at 1024; view-switch and group-header clipping at 390; options-dialog rows wrapping their remove button (the dialog is now 380px).
- **Harness artefacts, not product bugs:** headless blank/"Loading…" frames, and the harness auto-open for the options dialog needing a manual click.
- **Not performed:** authenticated routes with real layouts, sessions and data.

### Regression guards

- `tests/containment/organiserD3.test.ts` (16):
  - Page, rail and shell: no glass, gradients, glow, white-alpha, retired violet, forced dark or outline suppression.
  - No colour literals outside the user swatch palette and the pinned assignee picker; the CSS is token-only.
  - Shell and rail are free of the ops palette.
  - The only click handlers on non-controls are the 2 scrims and the kanban card.
  - Rail `aria-current`, menu state and Escape focus return.
  - Row actions revealed on hover or focus-within, never hover-only.
  - Click-to-edit and item names are buttons; every icon button is named.
  - Drawer and options dialog semantics plus `useDialogFocus`; the `useDialogFocus` `defaultPrevented` guard; the assignee Escape consumption.
  - Status/priority → status tokens (no accent, no hex); selection → accent; save state written as text.
- `tests/components/app/Organiser.test.tsx` (15): the real page with fixture data:
  - rail selection by keyboard and `aria-current`
  - rail menu `aria-expanded`, Escape and focus return
  - board title edit and cancel by keyboard, view toggles
  - named row controls
  - drawer opened by keyboard: labelled dialog, focus inside, Escape closes, focus returns
  - Escape in the title editor keeps the drawer open
  - column options dialog
  - kanban regions, card buttons and select names
  - calendar navigation and status-announcing due items
  - axe (light/dark) for the table view, the open drawer and the board view
- Mutation-checked: 16/16 caught (clickable-div rail, `aria-current` removed, violet rail background, inline-editor outline suppression, hover-only reveal, click-to-edit not a button, drawer role removed, drawer focus hook removed, status → purple, priority → indigo hex, unnamed icon button, forced-dark date input, dialog hook ignoring consumed Escape, colour-only save dot, white-alpha text, rail Escape focus return). Sources restored.

### Deferred / remaining D3 debt

- Native `prompt()` / `confirm()` for board/column rename, board/group/column delete and collapsed-rail create. These are functional flows, left unchanged by instruction.
- The table is a CSS grid without table semantics. Column headers are not programmatically associated with cells (each control is individually named instead).
- The kanban card surface keeps a whole-card mouse click alongside its title button.
- Table columns no longer align across groups (each group grid sizes to its own content since the name-column fix).
- `ColumnOptionsEditor` is not portalled (unlike the drawer), so its scrim sits under the global TopNav — pre-existing stacking.
- The `AssigneeDropdown` still uses the ops JS palette (pinned); `theme.ts` is unchanged.
- Pre-existing lint issues, identical at HEAD, left unchanged:
  - `set-state-in-effect` in the page ×2 and the rail ×1
  - the `collapsedParents` expression warning
  - the `activeBoard` exhaustive-deps warning

## Phase D4 implementation note — CRM, People, Commercial and Data Hub convergence

**Scope.** The remaining visual debt in `app/crm`, `app/people`, `app/commercial` and `app/data-hub` (every `.tsx`: 78 files scanned, 71 changed across Phases C and D4).

**Approach.** Targeted and systematic, not a rewrite. Every surface moves onto the Phase A–D1 primitives. The already-converted Phase C reference pages (`crm/companies`, `people/page`, `commercial/invoices/page`, the three `SlidePanel` re-exports, `CompanyForm`, `PersonForm`, `FileSelector`) define the pattern the rest now follow.

**Unchanged by design.**
- Routes, APIs, fetches, data shapes, state and effects.
- Form submission and validation.
- Capability, permission, tenant and people/HR gates.
- Commercial money, tax, quantity and totals logic; status transitions.
- Import, reconciliation, parsing and upload behaviour.
- All user-facing copy (accessible names were added).

**How the work was divided.** CRM, People and Commercial were converted in parallel by delegated agents, each working to one written recipe. Each file's test pins were inventoried first, and every agent re-ran its module's tests. Data Hub, the guards, the tests, the harness and the review were done centrally. Every agent change was re-verified centrally:
- TypeScript
- lint (identical to HEAD per file)
- all module suites
- the D4 guard

### Inventory classification (before editing)

Debt was hand-rolled rather than decorative. There were **no** blur, glass, gradients, glow or click-only `<div>`s in the four modules.

**1. Shared-system migration (done)**
- `var(--purple-600)` primary fills and links (71 uses) with `#fff` text (48)
- dark-only `#f87171` error text (78)
- `#1f2937` / `#1a1d24` slabs and borders (45)
- hard-coded amber / green / blue hexes and rgba tints
- `outline: none` on inputs (17)
- per-page duplicate helpers: `btn()` / `actionBtn()` / `addBtn` / `outlineBtn` / `dangerBtn`, `th` / `td` / `empty` style objects, `sel` / `inp` / `inputStyle` / `labelStyle`, `Section` / `panel` / `card` wrappers
- two one-off status badges (`_billStatus`, `_receiptStatus`)
- unassociated label divs; placeholder-only labels
- radii of 10–16px
- `SourcesAdminClient`'s private `buttonStyle()` / ACCENT / RED / GREEN

**2. Domain encodings (kept, see below)**

**3. Functional behaviour (documented, not changed; see debt)**

**4. Deferred (see debt)**

### CRM

- **Overview:**
  - PageHeader (the pinned `CapabilityIcon` kept in the title).
  - One `MetricStrip` whose labels are links.
  - "Open deals" and "Recent activity" as Panels with `StateMessage`.
  - The grid wraps.
- **Contacts:** PageHeader, WorkToolbar (labelled classification select + `ToolbarSearch`), table contract with a numeric Activities column, and named "View" links.
- **Deals:**
  - PageHeader with the totals.
  - Each kanban column is a `<section>` with an h2.
  - **Each card is a native draggable `<button>`** (named "Edit deal: …"), so it opens from the keyboard. Drag-and-drop and `moveStage` are unchanged, and the stage is also editable by keyboard in the form.
  - The stage colour shows only as a dot and the card's left rule.
- **Activities:**
  - Filter chips are `aria-pressed` buttons in the WorkToolbar (accent tint for the selected chip).
  - List markup; delete is a named ghost button.
- **Company and contact detail:**
  - PageHeader: back link as eyebrow, classification/title as meta or description, Edit (secondary) and Delete (danger).
  - Sections are Panels with h2 titles and count chips; the two columns wrap.
  - Gmail actions use shared buttons; activity icons are `aria-hidden`, with the type as visually hidden text.
- **Events backfill (admin tool):**
  - PageHeader; `MetricStrip` summary; four tables on the contract with `th scope="col"`.
  - Forbidden and not-enabled states use `StateMessage`.
  - Result and status tags are semantic Badges: link → success, create → info, no identity → inactive, ambiguous → warning, failed → error, eligible → success.
  - Preview is secondary and Execute is primary. The pinned `onClick={runClassificationExecute} disabled=` adjacency is kept.
- **Forms:** `ContactForm`, `DealForm` and `ActivityForm` use Field, `fieldControlClassName`, FormActions, FormError and Button.
  - The ActivityForm type picker is an `aria-pressed` group.
  - Subject and Notes gained visible labels (they had been placeholder-only).
- **Layout:** the capability-denied screen uses `StateMessage`.
- **`ClassificationBadge`:** 4px tag, token colours.

### People

- **Teams:**
  - PageHeader; the canManage-gated "Show archived" and "+ Create Team" (primary).
  - Table contract; Active/Archived is a Badge (success / inactive).
  - Row actions: ghost Edit and Archive, danger Confirm, secondary Restore, all named with the team. The action row wraps.
  - TeamForm uses Field, FormError and FormActions.
- **Administrators (management access):**
  - PageHeader; the grant select (labelled) and Grant button sit in a WorkToolbar.
  - Table contract; Revoke is ghost with a danger Confirm.
  - Its loading, error and empty rows are pinned verbatim by `hrAdministratorsUi`, so they keep their `style={empty}` cells (the object is now token-based). The error cell keeps the pinned `'#f87171'` literal; the guard exempts that exact line.
- **Restricted cases list:**
  - PageHeader with a "← People" eyebrow and "+ Open Case".
  - `ToolbarSearch` and the table contract; the open/closed Badge.
  - The create form uses Field (explanatory text as helper).
  - The partial-grant notice is a warning block with `role="status"`.
- **Restricted case detail:**
  - `StateMessage` for loading and error.
  - PageHeader: back link, title, type and status Badges as meta, "Reference · Opened" as description.
  - Participants, access, notes and documents are headed sections with top borders instead of nested cards, using single bordered lists; the grid wraps.
  - Remove, Delete and Revoke are danger buttons. No confirm step was added: that would change behaviour.
- **PersonForm:** grids use `auto-fit` so fields wrap at 390.
- **Layout:** padding clamps to a 16px gutter on phones.
- **Unchanged:** every permission gate, sensitive-data and case-visibility rule, and team/admin logic.

### Commercial

- **Lists** (quotes, purchase orders, purchase receipts, supplier bills, customers, products, suppliers) now match the invoices reference:
  - PageHeader with the primary create action.
  - WorkToolbar with a labelled status select and `ToolbarSearch`.
  - TableContainer, `tableStyles`, `th scope="col"` and TableStateRow.
  - Money and quantity columns are `tableStyles.num` (right-aligned, tabular).
  - Row links are named.
  - Active/inactive is a Badge; inactive rows no longer fade to 50% opacity (a contrast fix).
- **Forms** (Customer, Product and Supplier forms; quotes/invoices/purchase-orders/receipts/bills "new" pages; settings):
  - Every control is a labelled Field.
  - Helper text is wired through `helper`.
  - FormError; full-width primary submit.
  - The settings tax-code table uses the contract.
- **Invoice and quote detail:**
  - PageHeader with status and overdue Badges.
  - Button hierarchy: Download PDF and Send Email secondary; Issue and Record Payment primary; Delete Draft and Void danger.
  - The blue "issue" confirmation is now neutral; void and reversal confirmations use danger tints.
  - Line and payment tables use the contract with numeric Qty, Unit Price, Total and Amount.
  - The Record Payment drawer, add-line and draft fields are Fields.
  - Quote delivery history moved below the totals (secondary information after the work area).
- **Purchase receipt and supplier bill detail:**
  - PageHeader with the "Against Purchase Order" description (accent link).
  - Danger-tint confirmations for delete and cancel; the post confirmation is neutral.
  - Line tables on the contract; the bill has a numeric subtotal/tax/total footer.
  - Controls are Fields; attachments section labelled.
- **Purchase order detail** (1,047 lines; **safe visual layers only**):
  - Every `btn()` call is now `buttonProps`.
  - All colour literals are tokens.
  - Confirmation panels: the four blue panels are neutral, return uses warning, cancel and delete use danger.
  - 17 label `div`s became real `<label htmlFor>` tied to their controls.
  - The lines table is on the contract with numeric columns.
  - `FormError` and `role="status"`; `StateMessage` for loading and not-found.
- **Status badges:** `_billStatus` and `_receiptStatus` now render the semantic Badge (draft → inactive, posted → info, cancelled → error), like the quote, invoice and PO badges.
- **Overview:** StatCards use tokens and tabular figures. Pinned JSX windows were protected by precomputing `buttonProps`.

### Data Hub

- **Buttons:** Confirm import and Start another import use the shared primary button. `SourcesAdminClient`'s private `buttonStyle()` became `buttonProps` at all 18 call sites; each already carries the real `disabled` attribute the shared style keys on.
- **Semantic colour:**
  - Warnings (period detection and selection, mapping errors, worksheet inventory, XLSX preview) use the warning token.
  - Blocking and failed states use danger.
  - Validity uses success.
  - Schema-match severity is BLOCKING → danger, WARNING → warning.
- **Upload progress** now uses the **info (cyan) token**. It is data movement, not product state, so it no longer uses the purple accent. Cyan is used nowhere else as an accent.
- **`SourcesAdminClient`:**
  - Selection uses the accent tint.
  - Inputs are on `fieldControlClassName`.
  - Five unlabelled inputs gained names: the inline edit fields, and the mapping-row source header and target select (the arrow between them is `aria-hidden`).
- **Import history badge:** a compact 4px tag (radius was 999, with a 0.85 opacity fade). It stays a local tag because `const color =` is pinned.
- **Other:** `ImportClient`'s programmatic-focus heading no longer suppresses its outline. `ImportError`'s radius became `--radius-lg`.
- **One test pin updated with justification:**
  - `dataHubReviewEscapeAndHistoryStatus` required `ImportSuccess`'s heading to be the literal `#4ADE80`, which is about 1.9:1 on the light surface.
  - The heading now uses `var(--status-success)` (same meaning: "its own success-green heading").
  - The pin now matches that token, with an explanatory comment. The other assertions in that test are unchanged, including "READY is never success-green".

### Detail pages

These now follow context/back link → title → status/meta/actions → primary work area → secondary information:
- CRM company and contact
- People restricted case
- Commercial invoice, quote, customer, supplier, purchase receipt and supplier bill

They use section borders and headings rather than nested dark slabs, one primary action per region, and no giant radii or decorative shadows.

The purchase-order detail header stays the h1 / badge / button row (see debt).

### Domain-specific styling intentionally retained

A map is exempt from the D4 guard only when it is marked `// Domain category encoding (kept)`. A text label always accompanies the colour.

- **CRM deal pipeline stages** (overview, deals, company and contact detail): lead → inactive, qualified → info, negotiation → warning, closed won → success, closed lost → danger (tokens, meaning matches).
  - **Proposal** keeps its own category hue, `#f472b6`, moved from violet so that purple stays reserved for product and selection state.
- **CRM contact classifications:** Client → success, Lead → warning, Supplier → info, Other → inactive.
  - **Event Contact** (`#3B82F6`, moved from violet) and **Partner** (`#F472B6`) keep distinct category hues, mixed toward the text colour so labels read in both themes.
- **Commercial:**
  - Delivery status is now `Record<string, SemanticState>` through Badge (pending → inactive, sent and delivered → success, failed → error).
  - PO reconciliation: reconciled → success, exception → danger, else warning.
  - Attachment categories are labels only.
  - Invoice `PAYMENT_STATE` already used Badge.
- **Data Hub:** no source-type colour map exists. The import history "FAILED" tag uses the danger token.
- **CRM activity-type tags** (call blue, email violet, meeting green) became **neutral**. Type is carried by the label and icon, so this was not treated as a kept encoding.

### Accessibility and focus

- **Tables:** `th scope="col"` throughout; visually hidden "Actions" headers; loading, empty and error rows announced via `TableStateRow` / `StateMessage`.
- **Form controls:** every one is labelled (Field `htmlFor`, `aria-label` on toolbar selects and inline edits); "Required" is shown as text.
- **Names and roles:**
  - Row and icon actions are named with their record.
  - Toggles use `aria-pressed`; kanban deal cards are native buttons.
  - Success messages have `role="status"`; errors use `role="alert"` via FormError.
- **Focus suppressions:**

| Scope | Count |
|---|---|
| Removed in D4 | 17 |
| Remaining repo-wide (same regex) | 86 lines in 46 files (was 103 in 59 at the end of D3) |

  No `outline: none` remains in the four modules.

### Responsive review (harness)

Every harness view was measured at 1440, 1024 and 390 in light and dark: 72 combinations, recording page-level overflow, whether the page rendered, and whether an expected overlay was open.

The first pass found page-level overflow in most modules at 390, and on two Commercial pages at 1024. Root causes, all fixed:

1. **Shared `TableContainer` (latent Phase C bug).** The container was not a positioned element. The visually hidden "Actions" header text (`.bb-visually-hidden`, `position: absolute`) therefore escaped the container's horizontal scroll clipping and widened the page. This affected every table with a hidden actions header.
   - Fix: `position: relative` on `.container` in `components/ui/app/Table.module.css` (shared primitive, one declaration).
2. **Purchase-order reconciliation rows.** A fixed five-column grid (~790px of minimums) became `repeat(auto-fit, minmax(150px, 1fr))`, so cells wrap.
3. **Data Hub file input.** A fixed-width block got `maxWidth: 100%`.
4. **Data Hub source and mapping rows.** Row actions got `flexWrap: wrap`.

After these fixes: **0px page-level overflow in all 72 combinations.** Every page rendered, and the CRM contact slide panel and People team form opened as dialogs at every width.

Other behaviour:
- Tables scroll horizontally inside `TableContainer`.
- Module navs use the D1 horizontal strip below 768px, with the strip scrolling internally.
- PageHeader actions, toolbars, row actions and form rows wrap.
- People layout padding clamps to a 16px gutter.
- The CRM and Commercial layouts keep `36px 40px` main padding (their `main` scrolls internally); this is deferred.

### Visual review coverage (harness verification, not authenticated-route verification)

No safe authenticated account. A throwaway scratch worktree (never in the repo, removed afterwards; the foreign A01b files were never copied into it) served a scratch `/d4harness` route, whitelisted only in the scratch copy's middleware.

It rendered the **real** pages and components with fixture data behind a stubbed `fetch`. Module layouts are server components with session and capability gates, so the harness reproduced their sidebar + `<main>` shell with the real `CrmSidebar` and `CommercialSidebar`.

| Module | Views |
|---|---|
| CRM | contacts list; contacts list with the Add Contact `SlidePanel` open; company detail |
| People | people list; teams with the Create Team form open; HR administrators (management access) |
| Commercial | invoices list; invoice detail (line items, totals, payment history); purchase-order detail (line items, totals, reconciliation) |
| Data Hub | import upload with history; review preview table (the real `ReviewPanel` fed a `previewReady` fixture and a no-op session); source systems admin |

- **Measured:** all 12 views × 1440/1024/390 × light/dark in real Chrome with exact-width iframes (72 combinations: overflow, render and overlay state; results above).
- **Inspected by eye:** CRM company detail (dark 1440), invoice detail (light 1440), purchase-order detail (dark 1440), Data Hub review (dark 1024), HR administrators (light 390), Data Hub upload (light 1440), CRM contacts (dark 1440).
- **jsdom and axe (both themes):** the quotes list, contacts list, teams page and sources admin (`BusinessModules.test.tsx`).
- **Fixture artefact:** the invoice and PO tax column shows "GST (0.10%)" because the fixture used a fraction where the page expects a percentage string.
- **Not performed:** authenticated routes with real layouts, sessions and data.

### Regression guards

**`tests/containment/businessModulesD4.test.ts` (78 file cases).** Every `.tsx` under the four modules must be free of:
- white-alpha neutrals
- retired violet (including `var(--purple-N)`)
- dark-only slabs and literal white
- glass, gradients and glow
- outline suppression, forced `colorScheme: 'dark'`
- radii ≥ 10
- the duplicate `btn()` / `actionBtn()` / `*Btn` / `*Button` / `th` / `td` style helpers

Documented domain maps and one pinned line are exempt.

The CRM agent found that the first version stripped comments *before* detecting the exemption marker, so no exemption could ever apply. This was fixed: the marker is now detected on raw source.

**`tests/components/app/BusinessModules.test.tsx` (11).** Real Commercial quotes list, CRM contacts list, People teams and Data Hub sources admin in jsdom with fixtures:
- PageHeader, labelled filter and search
- `role="region"` table container
- the Total header right-aligned (`num`)
- semantic status Badge (`data-state`)
- named row actions
- axe in light and dark

**Mutation-checked: 16/16 caught**, sources restored:
- numeric alignment dropped
- `outline: none`
- `--purple-600`
- `#1f2937` slab
- glow
- `btn()` helper
- radius 12
- forced dark date input
- white-alpha text
- unmarked violet map
- gradient
- unlabelled filter
- unlabelled search
- colour-only status Badge
- duplicate `th` style object
- glass

### Unrelated foreign test exclusion

`tests/containment/sharedFoundationsA01bSchema.test.ts` (with `scripts/create-shared-foundations-a01b.sql` and `scripts/tests/verify-shared-foundations-a01b-migration.sh` / `.bak`) is untracked work from another session.
- The normal full-suite discovery would collect it.
- D4 full-suite runs exclude it explicitly, in addition to the three existing CI exclusions, and it is not counted as branch coverage.
- These files were not edited, staged, moved, run or copied into build or harness worktrees.

### Functional issues noticed (documented, not fixed)

- **CRM:**
  - `DealForm` fetches users but never renders an assignee control, so `assigned_to` can't be set.
  - A deal dragged to a new stage updates the screen before the save, with no error handling or rollback.
  - The overview's `Promise.all` has no `catch`, so a failed fetch leaves it loading.
  - "+ Add" contact on a company page doesn't prefill the company.
  - List pages show "No … yet" on fetch failure rather than an error.
- **People:** restricted-case participant removal sends DELETE `/participants/${person_id}`, not the participant row id. Verify against the route.
- **Commercial:**
  - `invoices/new` suggests a due date via `toISOString().slice(0, 10)` (UTC), which can be a day early in Adelaide.
  - The PO detail receipts list shows `received_date` raw, not through `formatCommercialDate`.
  - A purchase-receipts list comment describes a PO column that doesn't exist.

### Deferred / remaining D4 debt

- **Purchase-order detail page:**
  - The header isn't on PageHeader. Indentation-sensitive pins (`'\n          )}'`) and the 600-character Delete Draft window make it risky.
  - Read-only captions and section titles are still `miniLbl` divs rather than headings.
  - Reconciliation per-line rows, linked receipts and bills, delivery history and the timeline are still div lists rather than tables.
- **People:** the Administrators loading, error and empty rows keep pinned inline `style={empty}` cells and one pinned `#f87171`. There is no back link on Teams or Administrators (that would be new navigation), and no confirm step on case document or participant removal (that would be new behaviour).
- **Data Hub:**
  - The import history status is a local tag (its `const color` is pinned), not the semantic Badge.
  - `PeriodSelector` / `ReviewPanel` date and select controls keep inline token styles (pinned attribute and label layouts) rather than `fieldControlClassName`.
- **Layouts:** CRM and Commercial `<main>` padding is unchanged (36px 40px).
- **Pre-existing lint issues left unchanged (identical at HEAD):** 11 `react-hooks/set-state-in-effect` errors on existing load effects, 2 exhaustive-deps warnings and 1 unused-var warning.


## Phase E — Final authenticated acceptance

Scope: review and correction only. No new product concepts, navigation IA, workflows or abstractions were introduced. The Phase A–D4 work was re-read against the current code, a final acceptance matrix was built before changing anything, and only verified acceptance defects were corrected. Functional debt is documented, not fixed. The foreign shared-foundations files (`scripts/create-shared-foundations-a01b.sql`, `scripts/tests/verify-shared-foundations-a01b-migration.sh(.bak)`, `tests/containment/sharedFoundationsA01bSchema.test.ts`) were not edited, staged, moved, executed or copied into scratch worktrees; their hashes are unchanged.

### Final acceptance matrix

Marks: PASS / MINOR (acceptable, documented) / BLOCKER / DEFERRED (documented module debt outside the converged surface). "Found" is the state at the start of E where it differed.

| Area | Light | Dark | 1440 | 1024 | 390 | Overflow | Hierarchy / tokens / active | Buttons / forms / tables | Status | States (empty/loading/error) | Focus / keyboard / overlays | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Global chrome (TopNav, org switcher, theme control, focus ring) | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | n/a | PASS | PASS | PASS |
| Global user area — `/account/profile` (TopNav link) | Found BLOCKER (forced `#0D0D15`, white-alpha text) → PASS | PASS | PASS | PASS | Found overflow (fixed `1fr 280px` grid) → PASS | none | PASS | shared Field / buttons → PASS | n/a | PASS | Found unlabelled fields, `outline: none` → PASS | PASS (fixed in E) |
| Global user area — `/profile` (password / Secure Mode; no inbound link) | Found BLOCKER (forced `#07080B`) → PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | Found unlabelled fields, unnamed-state toggle → PASS | PASS (fixed in E) |
| Dashboard (`/dashboard` generic) | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | PASS | PASS |
| Command (`/command`) | PASS | PASS | PASS | PASS | MINOR (Ops sidebar desktop-first) | none | PASS | PASS | PASS | PASS | PASS | PASS / MINOR |
| CRM | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | PASS | PASS |
| People | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | PASS | PASS |
| Commercial | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS (PO detail structural debt) | PASS | PASS | PASS | PASS / MINOR |
| Data Hub | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | PASS | PASS |
| Events | PASS | PASS | PASS | PASS | Found 35px overflow → PASS | fixed | PASS | PASS | PASS | PASS | MINOR (native `confirm()`, FilterDropdown arrows) | PASS / MINOR |
| Admin (users, orgs, implementations, pipeline, planner, client events, agent runs/test, branding) | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | Found 3 mouse-only rows → PASS | PASS (fixed in E) |
| Admin dark islands (Founder OS, Web Services, Deployments) | DEFERRED (self-contained dark, readable) | PASS | PASS | — | — | — | — | — | — | — | — | DEFERRED |
| Ops — shell, drawers, modal | PASS | PASS | PASS | PASS | MINOR (desktop-first) | none | PASS | PASS | MINOR (encoding hues as text in light) | PASS | PASS | PASS / MINOR |
| Ops — `/dashboard/bin-maintenance` page content | Found BLOCKER (light text on light surface; never scheduled between D1 and D2) → PASS | PASS | PASS | PASS | MINOR (desktop-first dense console) | none | PASS | PASS | PASS | PASS | Found mouse-only rows, `outline: none`, unnamed search/sort → PASS | PASS (fixed in E) |
| Organiser | PASS | PASS | PASS | PASS | PASS | none | PASS | PASS | PASS | PASS | PASS | PASS |
| Organiser capability-denied screen | Found MINOR (forced `#07080B`) → PASS | PASS | PASS | PASS | PASS | none | PASS | — | — | PASS | PASS | PASS (fixed in E) |

No BLOCKER remains open.

### Corrections made in E

1. **`app/dashboard/bin-maintenance/page.tsx`** — the real Onkaparinga operational page (Ops sidebar) was never converted: D1 deferred "Command/bin-maintenance page content" to the Dashboard/Command phase and D2 converted Command only. It renders inside the theme-aware `WorkspaceShell`, so light mode put 93 white-alpha text/border values on a light surface.
   - Colour-only conversion, no layout, data or logic change. White-alpha text → `--text-primary / secondary / muted / subtle` by original weight; white-alpha borders, tracks and dividers → `--border`; tiles and controls → `--bg-raised`; fixed dark bands (`rgba(5,6,9,.7)`, `rgba(6,7,10,.5)`, `rgba(7,8,11,.8)`) → `--bg-surface`; table header and footer → `--bg-sunken`; row hover → a `color-mix` of `--text-primary`.
   - Decorative violet (toolbar, briefing icon, bars, Stock drawer) → accent tokens. The stats strip's gradient hairline, the severity-bar glow, the Stock drawer blur and the blinking "Live" dots are removed. Each stat keeps its hue as a small dot.
   - "New Job" uses the shared primary button. Retry and Load more use the shared secondary button.
   - Kept: the SEV / ST / STREAM operational encodings (the D1 decision; only `CLOSED` moves to `#8A8580`, matching the drawer). The Leaflet control rules and the `dark_all` map tiles are content.
   - Text that carried an encoding hue (status pill label, active severity chip, stream percentage, active filter chip) now uses `--text-primary`. The hue stays on the dot, tint and border, because the hues measure 2.15–2.80:1 on white (see contrast).
   - Accessibility:
     - Job rows are `role="button"` with `tabIndex=0` and Enter/Space, and show a visible focus ring.
     - Filter and severity chips and the Stock toggle expose `aria-pressed`.
     - Search and sort have accessible names. Their `outline: none` and `colorScheme: 'dark'` are removed.
     - The file input is visually hidden rather than `display: none`, so it is keyboard reachable, and a `:has(:focus-visible)` ring is shown on its label.
     - Stock ± buttons are named.
     - Fetch errors are `role="alert"`.
     - Motion respects reduced motion.
2. **`app/account/profile/ProfileClient.tsx`** (TopNav profile link) — the forced-dark constants (`#0D0D15`, white-alpha, gradient avatar, gradient accent bar, violet literals, `#1a1a2e` option background) are replaced by tokens.
   - Sections use `Panel` (h2). The name is the page's single h1. Fields use the shared `Field` and `fieldControlClassName`, so labels are now associated with their controls. Buttons use `buttonProps`.
   - The role pill is a neutral accent pill; role colour was decoration. Module dots keep their category hue (marked domain encoding).
   - The fixed `1fr 280px` grid (horizontal overflow below ~620px) now wraps.
   - The avatar button has an accessible name, and its upload overlay also shows on `:focus-visible`.
   - Save and fetch logic are unchanged.
3. **`app/profile/ProfileClient.tsx`** — forced dark (`#07080B` / `#0e1014`, `#1a6aff` buttons, violet Secure Mode) → tokens and shared `Field` / `FormError` / `buttonProps`. The Secure Mode toggle is `role="switch"` with `aria-checked`, and it is named by its heading. The server actions are unchanged.
4. **`app/organiser/layout.tsx`** — capability-denied screen on `--bg-base` / `--text-primary` / `--text-secondary`, with an h1. The gate logic is unchanged.
5. **`app/events/EventsListClient.tsx`**
   - The E harness scan measured 35px of horizontal page overflow at 390 in both themes. D1 did not catch it; its row-card pass predated the "View public page" action.
   - Cause: the row's right-hand group (session/ticket pills, "View public page", chevron) was `flex: 'none'`.
   - It is now `flex: '0 1 auto'` with `flexWrap: 'wrap'` and `minWidth: 0`. Desktop is unchanged: one row at 1440 and 1024.
6. **Admin keyboard paths** (mouse-only interactions found in the sweep):
   - Planner `SessionCard` is `role="button"`, `tabIndex=0`, `aria-pressed`, with Enter/Space; the forced `colorScheme: 'dark'` on its time input is removed.
   - Pipeline summary row: `role="button"` + `aria-expanded` + Enter/Space.
   - Implementations: the name cell is a real `Link`; the whole-row click is kept.

### Assistant / brand review

- Identity: TopNav and the Ops sidebar render `BrokenOrbitMark` (broken orbit). No old square H or legacy multi-ring mark is used as identity in authenticated chrome. Purple is the Brainbase accent. Cyan appears only as the info status.
- Exceptions (documented, not redesigned):
  - HlnaOrb (Command, IntelRail, MicButton, Tennis, BrainBase.jsx) and HelenaOrbital are protected stateful assistant visuals.
  - `OrbitalBackground` is on `/connect` only.
  - `CommandCentreHero` is on the legacy `/dashboards` only.
  - `HeroOrbitMark` is an orphan.
  - The bin-maintenance "HLNA · Operational Brief" header is text plus an icon, not an assistant mark.

### Status semantics, tables, forms, overlays

- Status: the semantic Badge set (success, warning, error, info, inactive, active, syncing) is used throughout the converged modules. Ops severity / status / stream, Founder CRM stage, agent/route and CRM classification colours are documented data encodings. In light mode they are no longer used alone as small text on the bin-maintenance page, but the MaintenanceJob and Drilldown drawers still use them as text (MINOR, below).
- Tables: no table was converted to cards. Bin-maintenance remains a CSS-grid queue with keyboard-operable rows. Organiser grid semantics and the PO detail div lists are still debt.
- Forms: every E-touched form uses the shared `Field` (label ↔ control association, visible required text).
- Overlays: `Dialog`, `SlidePanel`, the Organiser drawer and the Ops drawers/modal all use `useDialogFocus`.
  - The bin-maintenance Stock drawer is a non-modal bottom sheet (no focus trap, by design; it doesn't block the page). Documented as a structural limit.
  - Native `prompt()` / `confirm()` remain in Events and elsewhere (structural limit, no redesign).

### Accessibility sweep classification

| Finding | Classification |
|---|---|
| Bin-maintenance mouse-only rows, unnamed search/sort, hidden file input, `outline: none` ×2 | fixed in E |
| Profile pages: unassociated labels, `outline: none` ×3, unnamed toggle state, missing h1 on `/account/profile` | fixed in E |
| Admin Planner cards, Pipeline rows, Implementations rows mouse-only | fixed in E |
| Organiser / Dialog / SlidePanel scrim `<div onClick>` | valid implementation (`aria-hidden` scrim, Escape and close button provide the keyboard path) |
| Organiser kanban card `<div onClick>` | valid implementation (card title is a real button; D3) |
| Command alert cards whole-card click | pre-existing debt (the real button exists; D2) |
| Founder OS clickable divs ×8, Web Services ×2 | pre-existing debt (deferred dark islands) |
| `components/ui/app/chartPalette.ts` white-alpha | false positive (dark palette values of the theme-aware palette) |
| `BrandingSettingsClient` dark value | valid implementation (tenant ticket preview) |

### Focus count

The inline `outline: none|0` inventory went from **86 lines in 46 files** (end of D4) to **81 lines in 43 files**. E removed 2 in bin-maintenance, 2 in `/account/profile` and 1 in `/profile`. The remainder are in deferred modules (Founder OS, Web Services, legacy chat/panels, `DashboardShell` verticals, auth pages) plus the D3-accepted Organiser inline editors.

### Contrast (calculated from the token values, WCAG 2.x)

Computed with a script from `app/globals.css` / `styles/brainbase-tokens.css`; alpha tokens composited over `--bg-surface`.

| Pair | Dark | Light |
|---|---|---|
| text-primary / base · surface · raised · sunken · overlay | 17.04 · 16.33 · 15.79 · 17.33 · 14.88 | 16.18 · 17.94 · 17.94 · 15.10 · 17.94 |
| text-secondary / base · surface · raised · sunken · overlay | 8.12 · 7.79 · 7.53 · 8.27 · 7.10 | 6.08 · 6.74 · 6.74 · 5.68 · 6.74 |
| text-muted / base · surface · raised · sunken · overlay | 5.38 · 5.16 · 4.99 · 5.48 · 4.70 | 5.44 · 6.04 · 6.04 · 5.08 · 6.04 |
| text-subtle (non-essential, ≥3) / base · surface · sunken · overlay | 3.72 · 3.57 · 3.79 · 3.25 | 3.29 · 3.65 · 3.08 · 3.65 |
| border-strong / surface (non-text ≥3) | 3.57 | 3.65 |
| accent / base · surface | 6.25 · 5.99 | 5.18 · 5.75 |
| on-accent / accent · accent-hover (primary button) | 6.25 · 8.35 | 5.75 · 7.04 |
| accent / accent-muted (active nav, pills) | 5.30 | 5.14 |
| success fg / soft · surface | 8.87 · 10.21 | 6.17 · 6.71 |
| warning fg / soft · surface | 9.31 · 10.92 | 6.13 · 6.60 |
| danger fg / soft · surface | 7.25 · 8.13 | 6.51 · 7.19 |
| info fg / soft · surface | 10.86 · 12.27 | 7.59 · 7.95 |
| inactive fg / soft · surface | 7.23 · 7.92 | 6.10 · 6.96 |
| placeholder (text-subtle) / raised | 3.45 | 3.65 |
| disabled primary (opacity .55, WCAG-exempt) | 2.67 | 2.38 |

Every token pair meets its threshold in both themes. The Ops encoding hues, measured as text on the surface:

- **Dark:** all ≥ 5.01.
- **Light:**
  - `#EF4444`: 3.76
  - `#F97316`: 2.80
  - `#F59E0B`: 2.15
  - `#22C55E`: 2.28
  - `#60A5FA`: 2.54
  - `#A78BFA`: 2.72

  Hence the E change to label text on bin-maintenance and the remaining drawer MINOR.

### Responsive and light/dark acceptance

At 1440, 1024 and 390, in light and dark, no horizontal page overflow was measured on any harnessed view (see visual coverage). The Ops workspace (Command and bin-maintenance) stays desktop-first at 390 per the D1 decision. Bin-maintenance keeps its dense six-column stats strip and 4-column intelligence grid inside the workspace canvas; the canvas scrolls within itself, so the page does not overflow.

### Intentional dark / deferred surfaces

| Surface | Classification | Preservation |
|---|---|---|
| Founder OS (`/admin/founder`, HQ only, `T` tokens heavily pinned) | deferred module debt; self-contained dark, readable | ACCEPTABLE DEFERRED |
| Web Services + LeadMessages | deferred module debt; self-contained dark | ACCEPTABLE DEFERRED |
| Deployments | deferred module debt; self-contained dark | ACCEPTABLE DEFERRED |
| Ticket / customer previews (Branding) | intentional, content-specific | ACCEPTABLE (not converted) |
| Camera / video, Leaflet map tiles | intentional, media / content | ACCEPTABLE (not converted) |
| `DashboardShell` verticals, waste mock-ups, `OverviewClient` | deferred module debt (forced dark with local palettes) | ACCEPTABLE DEFERRED |
| `bin-maintenance/insights` (`KpiCard`, `DARK_TOKENS`, recharts) | deferred module debt | ACCEPTABLE DEFERRED |
| Tennis, `CommandCentreHero`, InsightBanner | deferred module / legacy surfaces | ACCEPTABLE DEFERRED |
| PO detail structural debt | pinned structure | ACCEPTABLE DEFERRED |
| Organiser grid semantics | D3-documented | ACCEPTABLE DEFERRED |
| Native `prompt()` / `confirm()` | structural limit | ACCEPTABLE DEFERRED |
| Ops desktop-first at 390 | D1 decision | ACCEPTABLE DEFERRED |
| Bin-maintenance page content | was an acceptance defect | fixed in E (no longer deferred) |
| Profile pages, Organiser denied screen | were acceptance defects | fixed in E |

Nothing is classified SHOULD FIX BEFORE PRESERVATION after E.

### Deferred functional issues (documented, not fixed)

- CRM: deal assignee never rendered, drag without rollback, overview fetch without catch, company add-contact without prefill, fetch failures shown as empty.
- People: participant removal by `person_id`.
- Commercial: UTC due-date suggestion, raw receipt date, stale comment.
- Command: static demo data with "Live" wording, and "Coming soon" `alert()`.
- `/profile` vs `/account/profile` duplication. `/profile` holds the password and Secure Mode controls but has no inbound navigation link.
- Bin-maintenance: the Stock drawer is `localStorage`-only demo stock (`DEFAULT_STOCK`), not operational data. The "Live · N records" label shows the last fetch, not a live stream.

### Guard review

- A–D4 guards were re-read.
  - The D4 scanner's `PINNED_LINES` exemption and the D2/D3 exact-string pins are brittle by design (they pin reviewed literals). They are not over-wide: each is scoped to named files.
  - No false positives surfaced during E; every E change passed every earlier guard unmodified.
  - No A–D4 guard was changed in E.
- New `tests/containment/acceptanceE.test.ts` (15 tests).
  - It guards the E fixes. Bin-maintenance: no white-alpha, old violet, dark slabs, blur, glow, `outline: none` or forced scheme outside the kept encoding maps and Leaflet rules; keyboard rows; neutral status text; named controls. Profile pages: no forced palette; shared `Field`; Secure Mode switch. Organiser denied tokens. Admin keyboard paths. Events row wrap.
  - Mutation-checked: 18/18 mutations caught, including restoring the Events `flex: 'none'`. A comment-only violet / white-alpha probe correctly passes (comments are stripped before scanning).
- New `tests/components/app/AcceptanceE.test.tsx` (6 tests): both profile pages rendered in light and dark. It checks one h1, named sections, every edit control labelled, the switch role and state, and axe clean.

### Visual coverage (harness verification, not authenticated-route verification)

- **Setup:**
  - A throwaway scratch worktree held the working-tree diff (no tests, no foreign files, no `app/Loading`), plus seven scratch-only harness routes (Phase B chrome, C work surfaces, D1–D4, and a new E harness for bin-maintenance and both profile pages).
  - Those routes were whitelisted only in the worktree's middleware.
  - Production build: 293/293.
  - Real Chrome was used, with exact-width iframes hosted on a neutral page.
  - Nothing was written to the repository, and the worktree was removed afterwards.
- **Overflow scan:**
  - Grid: 15 views (chrome, dashboard, command, CRM, People, Commercial, Data Hub, Events, Admin, Ops bin-maintenance, Organiser, `/account/profile` view and edit, `/profile`, work surfaces) × light and dark × 1440, 1024 and 390, giving 90 combinations.
  - Result: 89 with 0 overflow. Events at 390 overflowed in both themes; it was fixed and re-measured at 0 / 0.
  - Every frame carried the requested `data-theme`.
- **Screenshots actually inspected:**
  - Desktop light and dark (1440): Dashboard, Command, CRM, People, Commercial, Data Hub, Events, Admin, Ops bin-maintenance, Organiser and `/account/profile`.
  - Light only: `/account/profile` edit and `/profile`.
  - 390: bin-maintenance (light), Events after the fix (dark), Dashboard (light) and CRM (light).
  - The remaining modules at 390 are covered by the numeric overflow scan only, not by a screenshot.
- **Observations:**
  - Bin-maintenance is fully legible in light mode. Its stats, intelligence grid, queue, chips and status pills are all on tokens.
  - The Leaflet `dark_all` tiles show a Carto "API key required" watermark in the local harness. That is an environment artefact (no key locally), not a code change.
  - The Ops shell at 390 remains desktop-first (sidebar plus a narrow canvas), as documented.
- **Not covered:** real authenticated routes with real sessions or production data, Founder OS / Web Services / Deployments (deferred dark islands), Organiser capability-denied screen (a server layout; source- and guard-verified only), and Admin Planner (source- and guard-verified).

### Tests and build

- `npx tsc --noEmit`: clean (outside the excluded foreign/client folders).
- ESLint on the 10 E-touched files (`EventsListClient` 0 / 0): 6 errors, all pre-existing and identical at HEAD. They are `react-hooks/set-state-in-effect` ×4 (bin-maintenance ×3, Implementations ×1) and `static-components` ×2 (the `/account/profile` `AvatarCircle`, which is unchanged). There are 0 new errors and 0 warnings.
- Phase groups (containment plus component files for each phase):
  - A: 41
  - B: 104
  - C: 80
  - D1: 168
  - D2: 77
  - D3: 31
  - D4: 109
  - E: 21
- Module containment (CRM, People/HR, Commercial, Data Hub, Events, Organiser, bin-maintenance, Admin, Command): 6,451 passed, 33 skipped.
- Accessibility and component tests: 326. Design-system tests: 195.
- Full suite: 481 files passed, 4 skipped; 11,370 tests passed, 46 skipped, 0 failed. The 3 CI exclusions plus the explicit `--exclude tests/containment/sharedFoundationsA01bSchema.test.ts` applied (that foreign test remains excluded from this branch's claimed coverage).
- `npm run build` (clean worktree, no harness): 286/286.
- `git diff --check`: clean.

### Remaining visual and accessibility debt

- Ops encoding hues are still used as small text in the MaintenanceJob and Drilldown drawers and the CreateJob modal. In light mode they measure 2.15–2.80:1, but they are always paired with a written label. MINOR; this should follow the bin-maintenance treatment in a later Ops pass.
- The bin-maintenance Stock drawer is a non-modal sheet with no focus management. Its dense 10-column stock grid is desktop-first.
- Inline `outline: none` remains on 81 lines in deferred modules.
- The deferred dark islands and `DashboardShell` verticals listed above.
- The Command alert-card whole-card click, and Events' native `confirm()`.

### Preservation recommendation

READY TO PRESERVE. No BLOCKER is open. Every E correction is colour, semantic or keyboard only. All phase guards pass unmodified, and the new E guard is mutation-checked. The full suite and the build are green. The remaining items are documented as MINOR or ACCEPTABLE DEFERRED.

## Authenticated visual-completion pass (base main e20d0fd)

Gap-closing pass against deployed main e20d0fd, not a redesign. Scope: Founder OS, Helena, the shared client workspace, the LD Tennis tenant surfaces, School Test Organisation (workspace, Events, Ticketing) and future tenants. Visual and accessibility-semantics changes only. Routes, APIs, SQL, auth, tenant boundaries, capability gating, calculations, handlers, assistant prompts/tools and Events/Ticketing behaviour are unchanged. Nothing is committed, pushed or deployed.

### Verification sources (read this first)

| Source | Used | Notes |
| --- | --- | --- |
| Real authenticated production observation | **No** | brainbase.com.au has no DNS; brainbase.app returned Cloudflare 522; the Vercel deployment URL passed SSO but the app was not signed in, and signing in on the user's behalf is prohibited. |
| Preview authenticated rendering | **No** | By instruction, no push and no Preview in this pass. |
| Local authenticated rendering | **Harness only** | Server pages (`/clients`, `/clients/[id]`, `/dashboard/leads`, `/dashboard/leads/[id]`, `/dashboard/contacts/[id]`) rendered by their real code in scratch worktrees with a fixture `sql` tag and a synthetic super_admin session (scratch-only shim; never in the repository). |
| Harness-only rendering | **Yes** | Client surfaces rendered by their real components with a stubbed `fetch`. "Before" = unchanged main e20d0fd; "after" = e20d0fd plus this pass. Same harness, same fixtures, both builds. |

Harness artefacts (not product defects): the harness routes have no session, so the logged-out public top nav appears (its labels are excluded from the counts). Founder OS keeps HEAD's `margin: -40px`, which cancels the admin layout's padding; the harness renders it without that layout, so it overflows by exactly 40px there.

### What changed

- **P1 DashboardShell family:**
  - `DashboardShell` is token-driven. The `theme` / `headerColor` props remain on the API but no longer pick a palette; `accentColor` is an identity swatch. It adds a real tablist (arrows, Home/End) and `MetricStrip`.
  - `components/dashboard/ui/*` (KpiCard, InsightCard, OpportunityCard, ExecutivePanel, ExecutiveSummary, Section, tokens) and a new `chartTheme.ts`.
  - All 13 consumers are converted: 12 shell pages plus the bin-maintenance insights KpiCards.
  - Narrow screens (this pass's harness finding): consumer pages lay out KPI rows with inline `repeat(N, 1fr)` grids, which overflowed at 390px before and after. One scoped rule in `DashboardShell.module.css` lets those tracks shrink and reflow (2 columns ≤720px, 1 column ≤480px).
  - Recharts legend labels now read `--text-secondary` inside the shell. The swatch keeps the data hue; several hues were below 4.5:1 as label text in light.
  - `OverviewClient` is converted (decision B). Its byte-for-byte freeze is replaced by six behavioural pins.
- **P1 Waste sub-module:**
  - Layout frame, `NavTabs` (now a labelled nav with `aria-current`) and `_dark.tsx` are converted. Every export name is kept; neutrals map to tokens and three helpers are added.
  - Ten sub-pages converted: chart chrome from `useWasteChart()`, status text on tokens, `scope="col"` headers.
  - Chart series hues are kept as data.
- **P2 Founder OS:**
  - Token map with `STAGE_FG` kept as data, and MetricStrip.
  - Modals become `Dialog` and the drawer becomes `SlidePanel`.
  - Nav uses buttons/links with `aria-current`; tabs use `aria-pressed`.
  - Stretched-link pipeline rows; the Follow-up action is layered above the row and has the same effect.
  - Narrow-screen safety below 900px.
  - The no-op Btn wrappers are documented, not given behaviour.
- **P3 Helena:**
  - Tokens for HelenaWorkspace, HelenaMic, ChatPanel, MicButton, HlnaWordmark, LeftSidebar and the BrainBase chrome.
  - `visualState.js` changes colours only; labels, state names and transitions are unchanged.
  - `/hlna` keeps HelenaOrbital. The idle HlnaOrb logo in CommandCentreHero and TennisDashboard is replaced by BrokenOrbitMark.
  - Two gaps found during integration are closed here:
    - `FloatingCard`, Helena's action-feedback toast on every `/dashboard/**` and `/organiser` page, drops glass, the gradient and the infinite float, and gets a named Dismiss button.
    - `HlnaInsightBanner`, inside the Fleet, Waste and Service Requests shells, drops old violet and white alpha, and gets a named refresh button.
    - Timers, request, prompt and store calls are identical. HEAD's versions pass the same behavioural tests.
- **P4 shared Clients (the P0 fix):**
  - `ClientWorkspace`, the `/clients` list and the `/clients/[id]` banner are converted. Every fixed near-white or white-alpha foreground moved to tokens (54 text literals measured below 3:1 in light at HEAD, 33 of them at 1.02–1.06:1).
  - Status uses Badge/StatusDot, the contact editor is a `SlidePanel`, tabs are a real tablist, and rows are buttons.
  - Mobile-usable at 390px.
  - SQL and opportunity calculations are byte-identical.
- **P5 LD Tennis:**
  - The TennisDashboard dark island (injected `#08090c` style block) is gone.
  - Tennis children, sessions, blog, pipeline, leads/** and contacts/** use tokens and primitives, with `colorScheme: 'dark'` removed.
  - The tenant's primary action is now product purple (the brief's rule) instead of tennis green. Flagged for confirmation.
- **Selected-segment contrast (harness finding):** accent text on the accent tint measures 4.35:1 in light where the strip is `--bg-sunken` (5.14 on the surface, all dark cases >5).
  - Corrected in ClientWorkspace tabs, Founder tabs and segments, Contacts filters, Leads chips and the Sessions view toggle.
  - Borders are used rather than outline or box-shadow, so the global `:focus-visible` ring still wins.
- **P7 Events (one line):** the QuestionsPanel action row overflowed by 62px at 390, before and after. It now wraps (`flexWrap`). No behaviour change.

### School Test Organisation, Events and Ticketing

- Not seeded locally; verified with synthetic fixtures ("Riverside School Test Organisation"), generic tenant behaviour and structural checks. No production observation (see above).
- Import-graph check: of this pass's changed files, none (other than the one-line QuestionsPanel wrap) is reachable from `app/events/**`, `/e`, `/t/[token]`, `/b/[bookingToken]/tickets`, `TicketCard`, the branding preview, the root layout or middleware. `app/globals.css` and `styles/brainbase-tokens.css` are unchanged.
- Harness: the events list and event detail (paid and free ticket types, sold out, inactive; orders PAID, NOT_REQUIRED, PENDING, expired-pending, REFUNDED and FAILED) show 0 contrast fails in both themes at 1440, 1024 and 390. After the wrap fix, 390 shows 0 overflow.
- The public ticketing exceptions are unchanged, and the public-exception pattern counts are identical before and after.

### Future tenants

- `tests/containment/futureTenantVisualNeutrality.test.ts`: shared presentation (client workspace, clients pages, shell and kit, app primitives, theme) carries no tenant name, slug, or org-id/name literal comparison. `/clients/[id]` renders one `ClientWorkspace` for every org, and tenant dashboards are chosen only by routing. 7/7 mutations caught, 1 control passes.
- `tests/components/app/FutureTenantParity.test.tsx`: coaching, school and synthetic future tenants with identically shaped data render an identical structure/class/inline-style signature in light and dark, with no literal inline colours and axe clean. 3/3 mutations caught, 1 control passes.

### Harness measurements (text contrast vs rendered background; horizontal overflow)

Per page: failing text nodes / text nodes checked. Light and dark are identical across 1440 and 1024 unless shown.

| Surface | Before fails (light · dark) | Before 390 overflow | After fails (light · dark) | After 390 overflow |
| --- | --- | --- | --- | --- |
| Client workspace, coaching tenant (`/clients/[id]` component) | 56/63 · 30/63 | 244px | 0/67 · 0/67 | 0 |
| Client workspace, synthetic future tenant | 35/42 · 19/42 | 227px | 0/44 · 0/44 | 0 |
| `/clients` list (server page) | 56/72 · 23/72 | 0 | 0/69 · 0/69 | 0 |
| `/clients/org_demo_tennis` (server page + banner) | 61/77 · 32/77 | 244px | 0/81 · 0/81 | 0 |
| `/clients/org_northwind` (server page + banner) | 40/56 · 21/56 | 227px | 0/58 · 0/58 | 0 |
| `/dashboard/leads` | 11/27 · 3/27 | 112px (16px at 1024) | 0/78 · 0/78 | 0 |
| `/dashboard/leads/[id]` | 4/22 · 5/22 | 0 | 0/63 · 0/63 | 0 |
| `/dashboard/contacts/[id]` | 4/21 · 4/21 | 0 | 0/48 · 0/48 | 0 |
| Tennis dashboard | 100/214 · 99/214 | 0 | 0/207 · 0/207 | 0 |
| Tennis contacts | 49/62 · 23/62 | 0 | 0/56 · 0/56 | 0 |
| Tennis sessions | 55/62 · 14/62 | 6px | 0/62 · 0/62 | 0 |
| Tennis pipeline | 31/38 · 15/38 | 0 | 0/38 · 0/38 | 0 |
| Tennis blog | 14/21 · 7/21 | 0 | 0/21 · 0/21 | 0 |
| Founder OS | 118/230 · 118/230 | 40px† | 0/229 · 0/229 | 40px† |
| Helena `/hlna` | 7/16 · 7/16 | 0 | 0/16 · 0/16 | 0 |
| Overview | 63/74 · 27/74 | 188px | 0/71 · 0/71 | 0 |
| Roads (shell) | 48/132 · 48/132 | 213px | 0/127 · 0/127 | 0 |
| Water (shell) | 49/125 · 49/125 | 197px | 0/121 · 0/121 | 0 |
| Fleet (shell + Helena banner) | 115/456 · 115/456 | 195px | 0/446 · 0/446 | 0 |
| Waste overview (shell) | 56/188 · 56/188 | 200px | 0/185 · 0/185 | 0 |
| Bin-maintenance insights | 16/99 · 16/99 | 477px | 0/99 · 0/99 | 0 |
| Events list (synthetic school tenant) | 0/49 · 0/49 | 0 | 0/49 · 0/49 | 0 |
| Event detail + ticket types + orders | 0/244 · 0/244 | 62px | 0/244 · 0/244 | 0 |
| `/dashboard/waste/*` sub-pages (10 real routes: bin-lifts, budgeting, commodities, community, complaints, compliance, cost-per-household, diversion, fleet, green-waste) | 23–63 per page, light · dark similar | 147–412px | 0 · 0 on every page | 0 |

- Thresholds: 4.5:1 for normal text, 3:1 for large. Text is composited over the actual rendered background chain; aria-hidden, disabled and form-field text is skipped. The logged-out harness nav is excluded.
- † The harness artefact described above (HEAD's `margin: -40px` without the admin layout).
- Before = unchanged main e20d0fd, after = this pass, same harness and fixtures.
- Rendered via real Chrome in exact-width iframes: 25 routes × light and dark × 1440, 1024 and 390, measured on both builds.
- The Waste sub-pages were first unmeasured: the shim granted a session only to the clients, leads and contacts routes. For the final run, `/dashboard/waste` was added to that list in both scratch worktrees (never the repository), so all 10 sub-pages are measured before and after.
- That final run found two small gaps in this branch's own Compliance conversion, now corrected and re-measured at 0 / 0:
  - Dates in `--text-muted` on the amber-tinted rows measured 4.41:1 in dark; they now use `--text-secondary`.
  - The training rows' fixed 256px label overflowed by 25px at 390; the row now wraps, with desktop unchanged.
- Headings, counted as visible h1s in the live DOM: the Waste Overview had 2 before and has 1 after. Every sub-page has 1.
  - A raw `querySelectorAll('h1')` reports 2, because the dashboard `loading.tsx` streaming boundary leaves a copy of the layout in a `<div hidden id="S:0">` placeholder. That copy is not rendered or exposed to assistive tech, and HEAD has it too.
- Final after-run: 33 routes × light and dark × 1440, 1024 and 390, giving 198 renders and 23,834 text nodes checked. After the Compliance fix, 0 contrast failures. The only overflow is Founder OS's harness-only 40px (unchanged, by decision).
- Screenshots inspected (harness, not authenticated routes):
  - 1440 light: client workspace, Founder OS, Fleet shell, `/hlna` (Helena orbital legible in light), tennis dashboard.
  - 1440 dark: the synthetic-tenant client workspace.
  - 390 light, before and after side by side: client workspace, tennis contacts, event detail, Roads shell.

### Accessibility corrections

- **Dialogs:** Founder modals (Dialog), the Founder drawer, the ClientWorkspace contact editor and the Contacts drawer (SlidePanel) have role, aria-modal, labelled title, Escape, focus trap, initial focus and focus return. Two Sessions modals gained dialog semantics.
- **Controls:**
  - Clickable divs became buttons or links (client rows, Founder pipeline rows, Sessions calendar entries, blog rows, pipeline headers).
  - Real tablists: DashboardShell and ClientWorkspace.
  - `aria-pressed` / `aria-current` / `aria-expanded` where state was colour-only.
  - Named icon buttons: FloatingCard Dismiss, InsightBanner refresh, the SlidePanel close.
- **Labels:**
  - Every input in the converted forms is labelled without changing names or values.
  - LeadMessaging gained visible Subject and Message labels.
  - Implementation health shows its label next to the dot.
  - Waste tables use `scope="col"`.
- **Focus:** no outline suppression in any touched file. Authenticated-scope suppressions went from 62 to 37, and the remaining 37 are all in untouched files.
- **Motion:** every kept animation respects `prefers-reduced-motion`.

### Legacy-pattern counts (authenticated app scope, comments stripped; `app/api/**`, orphans and `*_legacy*` excluded)

| Pattern | e20d0fd | After |
| --- | ---: | ---: |
| White-alpha `rgba(255,255,255,…)` | 2319 | 991 |
| Near-black hex slabs | 173 | 116 |
| `text-white` Tailwind | 85 | 67 |
| Backdrop blur | 42 | 29 |
| Old violet chrome | 906 | 421 |
| `colorScheme: dark` | 9 | 3 |
| Legacy font stacks | 116 | 86 |
| Focus suppression | 62 | 37 |

Public ticketing and marketing exceptions are identical before and after. Changed files still containing an old-violet hex (4) use it only as data: the Founder stage map, the Waste material and complaint categories, and the BrainBase module colour map.

### Tests, pins and mutation checks

- Pins updated (visual literals only, each commented "Visual-convergence update …" and replaced by equal or stronger assertions):
  - `founderImplementationIntelligence`
  - `hlnaWorkspace` (BrainBase mapper now pinned by exact body)
  - `organisationDashboardSeparation` (Overview freeze → queries, computed fields, thresholds, prompts and quick-nav routes)
  - `organiserActionConfirmationUi`
  - `tennisCalendarLayoutStaticCheck`
  - `tennisSessionManagementUiStaticCheck`
- New guards (all mutation-checked; restores hash-verified):
  - `founderOsVisualConvergence` 14/14, plus the semantic-severity assertion (decision 2)
  - `helenaVisualConvergence` 19/19, plus the restrained ambient-glow and Λ-identity assertions (decisions 3–4)
  - `dashboardShellVisual` 18/18, plus the legend rule (drop-`!important` mutation caught) and the Fleet/Water swatch uniqueness + 3:1 assertions (decision 5)
  - `clientWorkspaceVisual` 13/13 with 2 controls
  - `tennisTenantVisual` 14/14 with 2 controls
  - `wasteModuleVisual` 30/30 cases as expected (26 mutations caught, 4 controls pass), including the accessible series-shade map (decision 6) and the route-aware module title (decision 7)
  - `floatingCardVisual` 9/9 with 1 control
  - `helenaInsightBannerVisual` 9/9 with 1 control
  - `futureTenantVisualNeutrality` 7/7 with 1 control, plus tenant-neutral placeholder examples (decision 8; restoring the coaching placeholder is caught)
  - `WasteHeadings` (new render test): one page-level h1 on the Overview and sub-pages in light and dark; always-h1 and never-h1 mutations both caught
- New render tests in light and dark with axe: ClientWorkspace, FutureTenantParity, FounderOs, Helena, DashboardShell, TennisDashboard, TennisTenant, WasteModule, WasteHeadings, FloatingCard, HlnaInsightBanner.
- Full suite (final, after the decisions below): 544 files passed, 4 skipped; 12,339 tests passed, 46 skipped, 0 failed.
  - Earlier full runs that overlapped a harness build had load-only failures: the real-Postgres proofs lost their connection, and the Command axe test hit its 5s timeout.
  - One further full run had a single failure: the Organiser rail keyboard test, whose `waitFor` timed out under load. It passed 3/3 in isolation, 2/2 in the full components project and in the final full run. Its rail files are unchanged by this pass. The 3 CI exclusions and `sharedFoundationsA01bSchema` are excluded. An earlier run had 3 real-Postgres files fail while the disposable database was shutting down; they pass in isolation. Its one flaky new assertion (the banner's relative timestamp) is now awaited.
- `npx tsc --noEmit`: clean (outside the excluded foreign folders).
- ESLint on the 88 changed or new source files: 77 errors at HEAD, 70 after; no file increased.
- `npm run build` in a clean worktree (final tree, no harness): 287/287. The in-repo build fails only on the untracked foreign `Projects/Essio`.
- `git diff --check`: clean.
- The CI-excluded pins show the same 19 failures as at HEAD.

### Documented functional issues (not fixed)

- **Helena:**
  - BrainBase's private `mapHelenaPhaseToVisualState` never emits thinking or speaking.
  - MicButton's alert branch is unreachable.
  - IntelRail uses a fake timer.
  - "Send to manager" only flips a label.
  - InsightBanner's `CONF_CLASS` lookup is undefined for an unknown confidence.
- **Founder OS:**
  - The ProposalModal preselect is always null.
  - AddLead ignores `res.ok`.
  - Upload Dataset and View Lead are toast-only.
  - `mapRawClient` empties email and notes.
  - BookDemo calls setLoading after unmount.
- **Clients:** unknown implementation health reads "On Track", and an unknown lead status reads "New".
- **Sessions:**
  - `InstanceRoster` calls hooks after an early return.
  - Escape in Manage Types also closes the Edit modal underneath.
- **DashboardShell family:**
  - Roads and Facilities sort shared arrays during render.
  - Water KPI mismatch.
  - WasteClient crashes on empty zones.
  - Fleet overtime shows NaN, and its replacement KPIs are hard-coded.
  - The Patterns tab's 17:00 highlight is hard-coded.
  - The "Open" KPI tone is inconsistent.
- **Waste:** the budgeting "Actual" bars use `<rect>` children instead of `<Cell>`, so the variance colour is ignored.
- **Header offset:** the `/clients/[id]` sticky banner shows a gap below the nav after the super_admin org bar scrolls away. The same offset variable is used as at HEAD; the offset logic is out of scope.

### Backlog for the next visual-completion pass (not touched in this branch)

Recorded by decision 9 as the next dedicated pass. It must begin with a fresh inventory, because some of these have distinct functional or branding constraints.


- `/admin/web-services` (+ LeadMessages), `/admin/deployments`, `/admin/agent-runs`, `/admin/orgs`: Founder-adjacent admin pages linked from the admin aside.
- `/dashboard/wste/**`, `/dashboard/social`, `/dashboard/service-requests` client (its Helena banner is converted), `/dashboard/integrations`, `/dashboards`, `/briefings`, `/portal`, `/connect`, `/data`, `/reports/[id]`, `/onboarding/**`.
- The BrainBase no-session fallback panels (`components/panels/*`, MorningBriefing, CommandSuggestions, RecommendedActions) and BrainGraphPanel (three.js demo).
- LockScreen (global session lock overlay).
- Public and pre-auth surfaces (tennis public site, trial, auth pages, CommandDemo) are outside the authenticated scope.

### Reconciliation with main (2026-09-27)

- The branch was fast-forwarded from e20d0fd to `origin/main` 9590c31 (HR-7E1–7E3, PRs #286–#288). No rebase; the pass's changes were carried unchanged.
- Main's 8 HR files had no overlap with this pass, so there were no conflicts. All 135 pass files are byte-identical to the pre-reconciliation backup.
- Re-validated at 9590c31:
  - tsc clean.
  - Full suite: 546 files passed, 4 skipped; 12,355 tests passed, 0 failed (includes main's new HR tests).
  - Clean-worktree build: 287/287.
  - `git diff --check` clean.
  - CI-excluded pins unchanged (19).
- Harness re-run (harness verification only): 27 routes × light and dark × 1440, 1024 and 390, giving 162 renders and 19,976 text nodes checked.
  - Routes: `/clients`, `/clients/[id]` ×2, tennis dashboard, leads, lead detail, contacts, contact detail, sessions, Founder OS, `/hlna`, Roads shell, Waste overview (shell and real route), all 10 Waste sub-pages, Events list/detail, synthetic client workspace.
  - 0 contrast failures and one visible h1 on every Waste route.
  - The only overflow is Founder OS's harness-only 40px.
  - Identical to the pre-reconciliation result.

### Decisions applied (user, 2026-09-27)

1. **LD Tennis primary actions stay Brainbase purple.** Verified: the 15 primary actions on tennis surfaces use the shared purple primary. Green remains only for sport/session/status data and the semantic Activate toggle.
2. **Founder severity is semantic.** High, critical and overdue use `--status-danger`, medium uses `--status-warning`, and low is neutral. Purple is never a severity. The severity text still distinguishes critical from high. Data meanings are unchanged.
3. **HLNΛ wordmark Λ is Brainbase purple inside authenticated UI.** `--brand-hlna-accent` (HLNA Labs orange) is unchanged for its own contexts. BrokenOrbitMark's `hlna` context still uses the HLNA accent; it is outside the Λ decision and flagged for the backlog review.
4. **Helena ambient glow is kept, very faint.** No code change was needed. It is a state-token tint of at most 30% at opacity ≤0.6, extends 25% of the orbital size, is blurred, and its pulses are disabled under reduced motion. State is always also written as text (the aria-live label). These limits are now pinned.
5. **Fleet and Water have distinct identity swatches.** Fleet is `#c2410c` (5.18:1 light / 3.64:1 dark) and Water is `#0891b2` (3.68 / 5.12). They are identity swatches only; chrome, navigation, actions and selection are unchanged.
6. **Waste chart series use accessible theme-aware shades.** `useWasteChart().series(hex)` keeps each hue family. Amber and red use the chart palette's warning and danger colours, and every shade is ≥3:1 in both themes. Series identity, order, data, labels and legends are unchanged.
7. **One page-level h1 per Waste route.** `WasteModuleTitle` is the h1 on sub-pages and a non-heading label on the Overview, where DashboardShell renders the page h1.
8. **Shared editor placeholders are generic:** "e.g. Service or programme name" and "e.g. Tuesday 6:00 pm". There is no tenant branching.
9. **The remaining islands above are deferred** to the next pass, which will start with a fresh inventory.

Also accepted as in scope: the FloatingCard, HlnaInsightBanner and Waste frame convergence, and the Events QuestionsPanel wrap.

Left unchanged by decision:
- Founder OS's harness-only 40px overflow. Verify it on Preview with the real admin layout; do not patch it from harness evidence.
- The pre-existing sticky ClientBanner gap. It stays documented.
- The documented functional issues. They remain out of scope.

## Deferred-issues follow-up (N1–N5) — base main ca3daa6

A small follow-up for the five non-blocking issues recorded during the authenticated Preview acceptance of PR #291. Visual and semantic changes only; behaviour, data, APIs, enums and public route logic are unchanged. The remaining visual-completion backlog is untouched.

- **N1 — Sessions calendar at phone width.**
  - Cause: the page root (a flex child with auto side margins) shrank to fit its content, so the week grid's 700px minimum widened the whole page.
  - Fix: the root is bounded to its container (`width: 100%`, `box-sizing: border-box`). The seven-day grid keeps its 700px minimum and scrolls inside its existing `overflow-x: auto` wrapper.
  - Harness: page overflow 737px → 0 at 390 and 103px → 0 at 1024, in both themes.
- **N2 — Event detail at phone width.**
  - Same shrink-to-fit root; bounded the same way, so the shared `MetricStrip` reflows to its 148px column minimum. `MetricStrip` itself is unchanged.
  - Harness: overflow 23px → 0 at 390. The earlier QuestionsPanel wrap is kept.
- **N3 — Public /e and /t muted text.** The same tint at higher opacity only; the brand treatments (always-dark ticket, institutional burgundy/gold/serif theme, default palette) are unchanged.
  - Institutional theme `textMuted`: .46 → .62 (2.90–2.97:1 → at least 4.5:1 on bg, card and section surfaces).
  - Default theme and ticket `textMuted` / `TICKET_TEXT_MUTED`: .42 → .52 (3.48–3.52:1 → at least 4.5:1). The ticket field labels now use the shared constant.
  - Muted text stays lighter than secondary text.
  - Harness failures: School page 13 → 0, default event page 14 → 0, ticket 4 → 0. (The School "Pay" button on its burgundy gradient reads as a probe artefact; white on #4B001F–#65002B is at least 13:1.)
  - Two default-theme pins were updated from .42 to .52 with the required comment; `publicMutedTextContrast.test.ts` computes the contrast.
- **N4 — Organiser view switch.**
  - Selected state is now a raised segment: `--bg-surface`, an accent-border ring and accent text, instead of accent on the accent tint over the sunken strip.
  - Measured: Table selected 4.35:1 → 5.75:1 (light) and 5.78 → 5.99:1 (dark).
  - A border, not outline or box-shadow, so `:focus-visible` still applies. Verified with real keyboard focus: 2px solid accent ring, 2px offset.
  - PR #248's drag handles are untouched (13 present in the harness).
- **N5 — Headings and copy.**
  - `/hlna`: a visually hidden `<h1>HLNΛ workspace</h1>`; the wordmark stays the visual identity.
  - Bin Maintenance Insights: one visible h1 via the shared `PageHeader`.
  - Lead status badges: display copy via `leadStatusLabel()` (for example `in_progress` → "In Progress", matching the status picker's existing labels). Stored and API values, comparisons and `leadStatusState()` are unchanged.
- **Documented, not fixed:**
  - PR #248's new organiser drag handles (focusable `role="button"`) have no keyboard way to reorder; reordering is native HTML drag only. This is a functional accessibility gap for a separate pass.
  - Out-of-scope observation: the default public event theme's input placeholder is `rgba(226,232,240,.32)`. It was not measured, because placeholders were excluded from the probe.
- **Verification sources:** harness verification only, not authenticated routes. Real components were rendered in a real Chrome in before (main ca3daa6) and after worktrees, with fixtures and a scratch-only SQL/session shim for the leads pages, at 1440, 1024 and 390, light and dark.

## Remaining authenticated visual islands — base main ecb5b03

The follow-up to the backlog recorded under decision 9. It started from a fresh inventory. Visual and accessibility-semantic changes only. Routes, APIs, fetch URLs, methods and payloads, auth, permissions, tenant isolation, state, calculations and visible copy are unchanged, except where decorative emoji glyphs were removed. The shared primitives, tokens, `app/globals.css`, `lib/**` and navigation were not edited.

### Scope and classification

- **Converged (live authenticated consumers):**
  - LockScreen.
  - Admin: `/admin/web-services` (+ LeadMessages), `/admin/deployments`, `/admin/agent-runs` (residue only) and `/admin/orgs` AdminClient (residue only).
  - Operations modules: `/dashboard/wste` (WSTEClient, ServiceTimeline, PropertyClient), `/dashboard/service-requests`, `/dashboard/social` and `/dashboard/integrations`.
  - `/briefings`, `/data`, `/portal`, and the `/reports` list and `/reports/[id]` chrome.
  - `/dashboards` and the `/onboarding` wizard with all seven steps.
  - The BrainBase no-session fallback panels (Activity, Contacts, Inbox, Integrations, Memory, News; MorningBriefing, CommandSuggestions, RecommendedActions).
  - The BrainGraphPanel chrome.
- **Excluded by classification:**
  - `/connect` is PUBLIC. It is listed in the middleware `PUBLIC` array and is a pre-auth marketing conversion page with a fixed dark brand background, the wordmark and an orbital background. It was stopped and classified, not converted.
  - `app/admin/orgs/OrgsClient.tsx` and `components/hlna/SuggestedQuestions.tsx` are orphans with no importers, so they were not touched.
- **Untouched by rule:**
  - Generated report and evidence content inside ReportView. Only the page chrome changed.
  - The BrainGraphPanel three.js engine. `buildScene` is byte-identical and sha256-pinned.
  - `BrainBase.jsx` and `LeftSidebar.jsx`.
  - The unedited server wrappers (`onboarding/page.tsx`, `briefings/page.tsx`, `data/page.tsx`, WSTE pages, `agent-runs/page.tsx`, `orgs/page.tsx`).

### What changed (summary)

- **Styling and theme:**
  - Every converged surface now uses tokens in CSS modules (27 new modules) instead of local dark palettes, white-alpha text and borders, near-black slabs, glass/blur, gradient chrome, glow and local Inter font stacks.
  - Both themes are first-class.
- **Shared primitives are reused where they fit:** PageHeader (one h1), Panel, Button, Field, TableContainer/tableStyles, StateMessage, Dialog, Badge and MetricStrip.
- **Chart colours:**
  - Service Requests reads the shared chart chrome (`useDashboardChart`). The `dashboardShellVisual` guard now lists it as a chart-kit consumer held to every rule.
  - Other JS colours use `chartPalette`.
- **Data encodings are kept but made readable:** hues move to dots, bars, borders and tints, and label text sits on `--text-primary` or status tokens. The encodings are:
  - the Founder CRM stage map (shared with Founder OS STAGE_FG)
  - web-services pipeline stages
  - Briefings agent identity
  - `/dashboards` module identity
  - Service Requests service-type hues (icon only)
  - the WSTE asset status
- **Selected states** are raised segments with a border, never an outline, so the global `:focus-visible` ring still applies.
- **New helper `components/panels/useOverlayFocus.js`:** focus trap, initial focus and focus return for the fallback overlays, *without* owning Escape. The shared `useDialogFocus` stops Escape propagation, which would have changed the existing BrainBase-level Escape behaviour.

### Accessibility corrections

- **Headings:**
  - One page h1 via PageHeader on every converged page.
  - `/dashboards` has a visually hidden h1, because its hero is not a heading.
  - `/onboarding` gains an h1.
  - The Reports pages no longer emit raw h1s outside PageHeader.
- **Overlays:** the fallback panels, the Data report dialog (now the shared Dialog) and the Contacts, Memory and News sheets get `role="dialog"`, `aria-modal`, `aria-labelledby`, initial focus, a Tab trap and focus return.
- **Buttons and controls:**
  - Clickable divs became buttons or links with the same handlers: onboarding upload tiles, recommended actions and panel rows.
  - Icon-only buttons are named. The harness went from 15 unnamed buttons to 0.
  - Inputs are associated with labels (Field or `htmlFor`) with names and values unchanged.
  - Segmented controls and filters expose `aria-pressed`.
  - The LockScreen password visibility toggle is a real button with `aria-pressed` and a name, back in the tab order.
- **Status and motion:**
  - Status is never colour-only: the text label is always present.
  - `prefers-reduced-motion` is honoured for kept animations.

### Tests, pins and mutation checks

- New containment guards (consumer-aware, comments stripped, narrow allow-lists, preserved behaviour pinned):
  - `remainingVisualIslandsA.test.ts`
  - `wsteSocialServiceIntegrationsVisual.test.ts`
  - `remainingVisualIslandsC.test.ts`
  - `dashboardsOnboardingVisual.test.ts`
  - `dashboardFallbackPanelsVisual.test.ts`
- New jsdom and axe render tests, light and dark: `RemainingIslandsA`, `WsteSocialServiceIntegrations`, `RemainingIslandsC`, `DashboardsLibrary`, `OnboardingWizard`, `DashboardFallbackPanels`.
- Pins updated:
  - `reportsReferenceScreen.test.ts`: the superseded A.3 primitives (SectionHeader, Surface, Badge on `--bb-canvas`) were replaced by an equal-or-stronger contract. It now asserts the PageHeader and table contract, StateMessage, no raw h1, no inline colour, font or background, and a `.page` rule on `--bg-base`, `--text-primary` and `--bb-font-sans`.
  - `dashboardShellVisual.test.ts`: the Service Requests chart-kit consumer was registered.
- Mutation checks: 123 of 123 behaved as expected (A 21, B 22, C 21, D 31, E 28). This includes the `main` version of every touched file, which is caught, and at least two passing controls per set. Every restore was hash-verified.

### Harness measurements (harness verification, not authenticated routes)

Real components were rendered in real Chrome from before (`main` ecb5b03) and after scratch worktrees. They used synthetic fixtures and a fetch stub, with 31 surfaces × 1440, 1024 and 390 × light and dark, giving 186 renders per side and 7,626 text nodes checked after. The root layout's public nav, which renders because the harness has no session, is identical on both sides and excluded.

| Per theme (93 renders) | Before light | Before dark | After light | After dark |
| --- | --- | --- | --- | --- |
| Text contrast failures (excl. graph engine labels) | 1,983 | 1,404 | 0 | 0 |
| Backdrop blur | 120 | 120 | 0 | 0 |
| Gradient chrome | 97 | 97 | 0 | 0 |
| Old-violet elements | 600 | 600 | 15 | 15 |
| Dark slabs in light mode | 111 | — | 3 | — |
| Unnamed buttons | 15 | 15 | 0 | 0 |
| Surfaces with a page h1 | 13 | 13 | 21 | 21 |
| Page-level horizontal overflow | 0 | 0 | 0 | 0 |

Every remaining exception is classified:

- The 15 violet elements are the Founder CRM "demo" stage dot on `/admin/orgs` and the Briefings agent-identity icons and dots. Both are kept data encodings: aria-hidden dots or icons whose text label is on `--text-primary`.
- The 3 dark slabs are the BrainGraphPanel well (`#06070b`), a theme-invariant dark canvas.
- The 60 remaining contrast failures (20 per width) are three.js CSS2D node labels. Their colour and opacity (`rgba(210,170,255,.22)`) are set by the untouched engine.

Surfaces without an h1 are components rather than pages: the LockScreen overlay, LeadMessages, the fallback panels and the HLNA fallback cards.

### Documented functional issues (not fixed)

- **Onboarding:**
  - no feedback when submit fails
  - raw IDs in the Step 7 review
  - an unused `userId`
  - native email validation pre-empts the custom message
  - a timeout is not cleared
- **`/dashboards`:** the hero buttons have no handlers.
- **Briefings:**
  - delete has no confirmation or error handling
  - `/briefings` redirects to `/`
- **Data:** silent failures.
- **Portal:**
  - submit has no catch
  - confirm and reschedule are local-only
- **ReportView:**
  - PDF errors only reach the console
  - a markdown `#` produces an h1 inside report content
  - report-type labels are inconsistent
- **WSTE:**
  - address lookup uses `Math.random`
  - PropertyClient has a status mismatch
  - unknown slugs fall back to the default property
- **Social:**
  - it calls `res.json` before checking the response
  - loading can hang
- **Integrations:** it ignores `res.ok`.
- **Index keys:** several lists use array indices as keys.
- **Deployments:**
  - ProposalCard selection is dead
  - there are unused variables
  - the sticky offset is likely wrong inside the admin `<main>`
- **Web-services:**
  - search has no debounce
  - `patchLead` has no catch
- **Fallback panels:**
  - InlineBrainGraph has zero height in LeftSidebar
  - NewsPanel has no Escape handler
  - ActivityPanel buttons have no handlers
  - Inbox suggestions are mouse-only
  - the graph is mouse-only
  - contact delete has no confirmation
  - Escape also closes the chat
  - the Spotify check is quirky

### Remaining live legacy (outside this pass)

- **SessionProvider's WelcomeBackBanner:** violet, blur, glow and a local font.
- **The admin layout chrome:** a local font, and 40px padding that leaves about 310px of content at 390.
- **Data and CSS leftovers:**
  - BrainBase `MODULE_COLORS` `#818CF8` (a data encoding)
  - the `lib/data/activities` `PANEL_SECTIONS` hexes
  - the unused `lockIn` keyframes in `globals.css`
- **Pre-auth pages:** `/connect` and the other public pages are classified as out of the authenticated scope.

### Residue follow-up and independent review (overnight, same branch)

**Residue classification** (A = legacy authenticated chrome, fixed; B = data/category identity, kept; C = dead, removed; D = engine-owned, deferred; E = public, excluded):

| Item | Class | Result |
| --- | --- | --- |
| SessionProvider WelcomeBackBanner | A | On tokens via `WelcomeBackBanner.module.css`: overlay surface, thin border, popover shadow, accent dot and name. Blur, glow, violet and the local font are gone. Everything before the banner function is byte-identical to base (sha256-pinned); copy, placement, z-index, `pointer-events: none`, the 5-minute threshold and the 3.5 s dismiss are unchanged. The entrance uses module-local keyframes identical to the global `fadeIn`, off under reduced motion. |
| Admin layout chrome | A | `AdminLayout.module.css`. The local Inter stack is replaced by `--bb-font-sans`. Content padding stays 40px on desktop and drops to 24px/16px below 768px, where the shared ModuleSidebar already stacks above the content (it was 310px of content at 390). The gate, AdminAside and `overflow: auto` are unchanged. |
| BrainBase `MODULE_COLORS` (`#818CF8` = utilities) | B | Kept. It colours exactly two aria-hidden 6px dots; guarded by occurrence count. |
| `lib/data/activities` `PANEL_SECTIONS` | B | Kept. Type dots only (aria-hidden); guarded. |
| `lockIn` keyframes (globals.css) | C | Removed. Base LockScreen used them; this pass's LockScreen uses module keyframes, so nothing in app/, components/, lib/ or styles/ references them now. The removal is only valid together with the LockScreen change. |
| BrainGraph CSS2D label contrast | D | Deferred. The failing value is the engine's `dim` state (`rgba(210,170,255,.22)`), one of four label states set inside `buildScene`. AA would need about .6, which collapses the dim/bright distinction and edits pinned engine lines. A CSS override cannot tell the states apart. The four state lines are pinned. Correction: `buildScene` is byte-identical to base *except* the single `div.style.cssText` label-style line (the app font, and a dark legibility halo instead of the purple glow). The engine pin excludes exactly that line. |
| `/connect`, public pages | E | Excluded. |
| BrainBase `/dashboard` fallback h1 | — | BrainBase renders only when `getAuthSession()` throws. Neither it, the dashboard layout nor TopNav has an h1, so it now has one visually hidden `<h1>Dashboard</h1>` (absolute, so no layout change). |

**Independent review.** Five fresh reviewers compared every file against ecb5b03 and wrote contract tests whose expected values were derived from the base code:
- `ContractsG1`–`G5` (render)
- `contractsG1`, `G3`, `G5` (source)

They found **no behavioural deltas**: fetch URLs, methods, bodies, server-action arguments, hrefs, calculations, chart inputs, timers, confirm texts, Escape ownership, the report renderer and the PDF sequence all match base. G2 also ran its contract suite against extracted base files (35/35).

Fixed from the review:
- **Overlay focus could escape** (medium). Initial focus could land on a transient control (Integrations' GmailCard "Connect") that unmounts and drops focus to `<body>`. `useOverlayFocus` now re-homes focus to the panel when a focused control unmounts, and Tab from outside the panel is pulled back in.
- **Memory tabs:** a roving tabindex and arrows/Home/End. Initial focus is the selected tab (via `data-initial-focus`), never the destructive "Clear long-term".
- **Dangling `aria-controls`:**
  - Deployments now always renders its tabpanel, with the loading state inside it.
  - WSTE references only the rendered panel.
  - The Integrations add toggle references its form only while it is open.
- **Onboarding dropzones:** a nested `role="status"` inside the dropzone buttons was removed. The button still exposes "Parsing file…" with `aria-busy`.
- **ReportView:** content `h1` is pinned at 2em, the size it had in base's `<div>`, now that it sits in an `<article>`.
- **CSS cleanup:**
  - Unused classes removed: `.metrics` (web-services), `.muted` and `.cardPad` (WSTE), and `.muted` (panel overlay).
  - A className override in the Integrations "more" button was fixed.
- **Documentation:** the `useOverlayFocus` comment now describes Escape ownership accurately.

Accepted and documented (low severity):
- The web-services drawer is now the shared SlidePanel: Escape also closes it, the slide-out animation is gone, and the width is 440px, down from 480px.
- Only the Deployments tab bar is sticky; the rest of the header is no longer sticky.
- Region names are now "Organisations table" and "Users table".
- The Step 1 Field shows "Required" as text in place of `*`.
- Review answers keep their line breaks.
- On phones, the current step label is left-aligned.
- `aria-selected` on table rows comes from the shared table contract.

**Windows-only Data Hub failure** (pre-existing; not changed): `dataHubNormalizedStagingFoundation.test.ts` fails 3 of 72 on Windows.
- The test and its 4 SQL files are byte-identical to origin/main, and nothing this pass touched is read by it.
- On a pristine origin/main worktree it fails the same 3 with the default CRLF checkout, and passes 72/72 once those SQL files are checked out with LF endings.
- Cause: the test slices on `"RETURN NEW;\n"`. CI (Linux, LF) is unaffected.

Also from the second harness round: disclosure toggles (ServiceTimeline events, Social insights and comments) now set `aria-controls` only while their region is rendered. This matches the WSTE tabs and the Integrations toggle.

**Harness round two** (harness verification, not authenticated routes). Real Chrome, a pristine ecb5b03 worktree against the current tree, the same fixtures and fetch stub.
- 38 surfaces: the original 31, the welcome-back banner (driven through SessionProvider's real away-and-return path), the BrainBase fallback, and the five admin surfaces rendered inside the **real** `app/admin/layout.tsx` (AdminAside plus main), using a scratch-only session shim.
- 1440, 1024 and 390 × light and dark, giving 228 renders per side.
- The root layout's public nav, which renders because the harness has no session, is excluded on both sides.
- Focus rings are resolved statically from the `:focus-visible` rules that apply to each control, including inline `outline: none`. This is because `:focus-visible` cannot be triggered in a backgrounded window.

| Per theme (114 renders) | Before light | Before dark | After light | After dark |
| --- | --- | --- | --- | --- |
| Text contrast failures (excl. graph engine labels) | 2,481 | 1,713 | 3 | 0 |
| Backdrop blur | 129 | 129 | 0 | 0 |
| Gradient chrome | 118 | 118 | 6 | 6 |
| Old-violet elements | 738 | 738 | 24 | 24 |
| Dark slabs in light mode | 129 | — | 3 | — |
| Local-font elements | 45 | 45 | 0 | 0 |
| Unnamed buttons | 18 | 18 | 0 | 0 |
| Dialogs (all with aria-modal + a resolvable name) | 0 | 0 | 21 | 21 |
| Focusable controls without a focus-visible ring | 0 / 1,092 | 0 / 1,092 | 0 / 1,185 | 0 / 1,185 |
| Surfaces with exactly one h1 | 18 | 18 | 27 | 27 |
| Page-level horizontal overflow | 0 | 0 | 0 | 0 |

The dangling ARIA references found in this round (9 per theme) were fixed. A re-probe gives 0 at every width in both themes, and each reference resolves once its region is expanded.

Remaining after-exceptions, all classified:
- **Violet:** the Founder CRM "demo" stage dot (admin-orgs, in both render modes), the Briefings agent-identity icons and dots, and the BrainBase fallback's PANEL_SECTIONS "digest" type dot. All are B.
- **Gradients:** the Helena orb on the BrainBase fallback, which an earlier pass classified as a functional state visual.
- **Dark slabs:** the BrainGraph well.
- **The 3 light contrast failures:** all are BrainBase.jsx's own selected "◈ Exec" segment (4.35:1), which is identical on base. It is pre-existing, and BrainBase.jsx is not restyled here.
- **The 60 graph failures:** the engine's dim label state (D).

Other before → after measurements:
- **Admin at 390:** the content box goes from 306px to 354px, with the AdminAside strip present.
- **Welcome-back banner in light mode:** before, `rgba(13,13,21,.95)` glass with `blur(16px)`, a violet border and a violet name. After, `--bg-overlay` (white) with a token border, `--text-primary` copy and an accent name. Placement and `pointer-events: none` are unchanged.

### Current state: Organiser keyboard reordering (update, 2026-09-29)

- **Closed.** The Organiser keyboard-reordering accessibility gap (PR #248's drag handles had no keyboard way to reorder) is closed by PR #293 ("D.4.7F: add accessible keyboard reordering for Organiser"). It is no longer outstanding debt.
- **Current main** includes accessible keyboard reordering for the Organiser.
- **The historical entry above** under the N1–N5 follow-up is intentionally unchanged, because it accurately records the state at that time.
- **PR #294 does not implement this fix.** It only reconciles with a main branch that already contains PR #293, via a normal merge commit. The two changes share no files. The Organiser visual-convergence pins and PR #293's keyboard-reorder tests both pass on the combined tree.
