import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase C.2C — /dashboard's generic tenant fallthrough now renders
// OrganisationDashboard instead of <BrainBase />. Static source-text
// containment, not a claim of proven rendering behaviour — this repo has
// no jsdom/React Testing Library harness (same caveat as every other
// containment test in this suite).
//
// OrganisationDashboard is deliberately NOT a copy of app/dashboard/
// overview/OverviewClient.tsx (left untouched this phase — it has real
// consumers: DashboardShell's breadcrumb and OnboardingWizard both link to
// it directly). That page's 6 metric cards, Waste/Fleet trend chart, and
// hardcoded "Service Dashboards: Waste/Fleet/Water/Roads/Parks/Labour"
// quick-nav all render unconditionally regardless of whether the
// underlying table has any real rows for the organisation — exactly the
// "waste dashboard shown to a non-waste tenant" problem this phase exists
// to avoid, even though no individual number there is fabricated.
// OrganisationDashboard reuses the same real, organisation-scoped SQL
// shape but only renders a metric group when its own table genuinely has
// rows, and carries no hardcoded municipal quick-nav at all.

const root = path.resolve(__dirname, '../..');
function read(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

const pageSource = read('app/dashboard/page.tsx');
const dashSource = read('components/dashboard/OrganisationDashboard.tsx');
const cardSource = read('components/dashboard/ModuleAccessCard.tsx');
// Nav consolidation update (feat/authenticated-nav-consolidation): module
// keys/routes/gates now live in the shared pure nav model.
const navModelSource = read('components/nav/navModel.ts');

describe('Phase C.2C — /dashboard routing matrix', () => {
  it('brainbase-hq + super_admin still redirects to /admin/founder', () => {
    expect(pageSource).toMatch(/if \(variant === 'brainbase-hq'\) \{\s*redirect\('\/admin\/founder'\)/);
  });

  it('ld-tennis still renders TennisDashboard, untouched', () => {
    expect(pageSource).toMatch(/if \(variant === 'ld-tennis'\) \{/);
    expect(pageSource).toMatch(/<TennisDashboard/);
  });

  it('the generic tenant fallthrough now renders OrganisationDashboard, not <BrainBase />', () => {
    const fallthroughStart = pageSource.indexOf("// Generic tenant fallthrough");
    expect(fallthroughStart, 'expected a comment marking the fallthrough branch').toBeGreaterThan(-1);
    const fallthroughBody = pageSource.slice(fallthroughStart);
    expect(fallthroughBody).toMatch(/<OrganisationDashboard/);
    expect(fallthroughBody).not.toMatch(/return <BrainBase \/>/);
  });

  it('BrainBase is still imported — retained for the pre-session-resolution auth-failure fallback only, not deleted', () => {
    expect(pageSource).toMatch(/import BrainBase from '@\/components\/BrainBase'/);
    // D.2.3 reconciliation: the fallback now explicitly passes an empty
    // enabledCapabilities array (BrainBase.jsx's own prop signature
    // requires it, see the containment describe block below) rather than
    // relying on a default-props render with zero props at all.
    expect(pageSource).toMatch(/catch \{ return <BrainBase enabledCapabilities=\{\[\]\} \/> \}/);
  });

  it('the fallthrough derives orgId strictly after the brainbase-hq and ld-tennis branches have already returned/redirected — it cannot swallow either', () => {
    const brainbaseIdx = pageSource.indexOf("variant === 'brainbase-hq'");
    const tennisIdx = pageSource.indexOf("variant === 'ld-tennis'");
    const fallthroughIdx = pageSource.indexOf('<OrganisationDashboard');
    expect(brainbaseIdx).toBeGreaterThan(-1);
    expect(tennisIdx).toBeGreaterThan(brainbaseIdx);
    expect(fallthroughIdx).toBeGreaterThan(tennisIdx);
  });
});

describe('Phase C.2C — OrganisationDashboard: no HLNA embedding, no mock content', () => {
  it('does not import or render HelenaOrbital / HelenaWorkspace / ChatPanel — HLNA is a link, not an embedded conversation', () => {
    for (const forbidden of ['HelenaOrbital', 'HelenaWorkspace', 'ChatPanel', 'HelenaMic']) {
      expect(dashSource, `OrganisationDashboard must not import/render ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('links to /hlna rather than duplicating the conversation UI', () => {
    expect(dashSource).toMatch(/href="\/hlna"/);
  });

  it('does not import the mock BrainBase.jsx briefing components', () => {
    for (const forbidden of ['MorningBriefing', 'RecommendedActions', 'CommandSuggestions']) {
      expect(dashSource, `OrganisationDashboard must not import ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not import the mock waste/department data modules', () => {
    for (const forbidden of ['wasteIntelligence', 'departmentConfigs', 'getDeptConfig']) {
      expect(dashSource, `OrganisationDashboard must not reference ${forbidden}`).not.toContain(forbidden);
      expect(pageSource, `app/dashboard/page.tsx must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('does not import BrainGraphPanel (no Three.js mock graph presented as tenant operations)', () => {
    expect(dashSource).not.toContain('BrainGraphPanel');
  });

  it('every operational metric group is gated on its own genuine data flag (hasWasteData/hasFleetData/hasSRData), never rendered unconditionally', () => {
    expect(dashSource).toMatch(/const hasWasteData = wasteCost > 0 \|\| totalTonnes > 0;/);
    expect(dashSource).toMatch(/const hasFleetData\s*= fleetCost > 0 \|\| vehicleCount > 0;/);
    expect(dashSource).toMatch(/const hasSRData\s*= openCount > 0 \|\| closedCount > 0 \|\| pendingCount > 0;/);
    expect(dashSource).toMatch(/\{hasWasteData && \(/);
    expect(dashSource).toMatch(/\{hasFleetData && \(/);
    expect(dashSource).toMatch(/\{hasSRData && \(/);
  });

  it('shows a neutral empty state, not demo numbers, when there is no operational data at all', () => {
    expect(dashSource).toMatch(/No operational metrics available yet/);
  });

  it('the empty state is reached via a genuine hasOperationalData branch, not always-rendered or dead code', () => {
    const combinedFlag = /const hasOperationalData = hasWasteData \|\| hasFleetData \|\| hasSRData;/;
    expect(dashSource).toMatch(combinedFlag);

    const ternaryStart = dashSource.indexOf('{hasOperationalData ? (');
    expect(ternaryStart, 'the Operational Overview card and the empty-state card must be the two branches of a hasOperationalData ternary, not two independently-rendered blocks').toBeGreaterThan(-1);

    const emptyStateIdx = dashSource.indexOf('No operational metrics available yet');
    expect(emptyStateIdx).toBeGreaterThan(ternaryStart);

    const between = dashSource.slice(ternaryStart, emptyStateIdx);
    const elseBranch = between.lastIndexOf(') : (');
    expect(elseBranch, 'the empty state must sit in the ") : (" else-branch of the hasOperationalData ternary, not the same branch as the metric cards').toBeGreaterThan(-1);
  });

  it('contains no hardcoded municipal quick-nav strip (Waste/Fleet/Water/Roads/Parks/Labour links)', () => {
    expect(dashSource).not.toMatch(/href="\/dashboard\/waste"/);
    expect(dashSource).not.toMatch(/href="\/dashboard\/fleet"/);
    expect(dashSource).not.toMatch(/href="\/dashboard\/water"/);
    expect(dashSource).not.toMatch(/href="\/dashboard\/roads"/);
    expect(dashSource).not.toMatch(/href="\/dashboard\/parks"/);
    expect(dashSource).not.toMatch(/href="\/dashboard\/labour"/);
  });

  it('renders its title as "Dashboard", not Command Centre or HLNA', () => {
    expect(dashSource).toMatch(/Dashboard/);
    expect(dashSource).not.toContain('Command Centre');
    expect(dashSource).not.toMatch(/>HLNA<|>HLNΛ</); // not used as the page's own identity heading
  });
});

describe('Phase C.2C — real, organisation-scoped data only', () => {
  it('app/dashboard/page.tsx queries the real tables with WHERE organisation_id, same shape as app/dashboard/overview (untouched)', () => {
    const fallthroughStart = pageSource.indexOf('const oid = session.organisationId');
    const fallthroughBody = pageSource.slice(fallthroughStart);
    expect(fallthroughBody).toMatch(/FROM waste_records WHERE organisation_id = \$\{oid\}/);
    expect(fallthroughBody).toMatch(/FROM fleet_metrics WHERE organisation_id = \$\{oid\}/);
    expect(fallthroughBody).toMatch(/FROM service_requests WHERE organisation_id = \$\{oid\}/);
  });

  // Visual-convergence update (authenticated visual-completion pass): this
  // used to assert OverviewClient.tsx was "byte-for-byte untouched" and
  // pinned a quick-nav colour literal (`color: '#22C55E'`). The user
  // approved converting /dashboard/overview to theme tokens (decision B), so
  // the freeze is replaced by stronger behavioural / containment pins: the
  // server data shape and queries, every computed field and threshold, the
  // HLNΛ prompts, the series toggles, and the full quick-nav information
  // architecture (labels + routes, in order). Colour is guarded separately
  // in tests/containment/dashboardShellVisual.test.ts.
  describe('/dashboard/overview — behaviour and information architecture preserved', () => {
    const overviewPage = read('app/dashboard/overview/page.tsx');
    const overviewClient = read('app/dashboard/overview/OverviewClient.tsx').replace(/\r\n/g, '\n');

    it('the page still renders OverviewClient from organisation-scoped queries, failing closed', () => {
      expect(overviewPage).toContain("import OverviewClient from './OverviewClient';");
      expect(overviewPage).toMatch(/if \(!session\) redirect\('\/login'\);/);
      expect(overviewPage).toMatch(/FROM waste_records WHERE organisation_id = \$\{oid\}/);
      expect(overviewPage).toMatch(/FROM fleet_metrics WHERE organisation_id = \$\{oid\}/);
      expect(overviewPage).toMatch(/FROM service_requests WHERE organisation_id = \$\{oid\}/);
      expect(overviewPage).toMatch(/WHERE organisation_id = \$\{oid\} AND upload_status = 'complete'/);
      expect(overviewPage).toMatch(/return query\.catch\(\(\) => fallback\);/);
      for (const prop of ['waste={wasteRow}', 'fleet={fleetRow}', 'serviceRequests={srByStatus', 'trend={trend}', 'alerts={alerts}', 'uploadSummary={uploadSummary}']) {
        expect(overviewPage).toContain(prop);
      }
    });

    it('keeps the client props contract and every computed field', () => {
      expect(overviewClient).toContain('export default function OverviewClient({ waste, fleet, serviceRequests, trend, alerts, uploadSummary = [] }: Props)');
      expect(overviewClient).toContain("const openCount    = serviceRequests.find(r => r.status === 'Open')?.count    ?? 0;");
      expect(overviewClient).toContain("const closedCount  = serviceRequests.find(r => r.status === 'Closed')?.count  ?? 0;");
      expect(overviewClient).toContain("const pendingCount = serviceRequests.find(r => r.status === 'Pending')?.count ?? 0;");
      expect(overviewClient).toContain("const avgDays      = serviceRequests.find(r => r.status === 'Open')?.avg_days ?? 0;");
      expect(overviewClient).toContain('const fleetCost  = Number(fleet.total_fuel  ?? 0) + Number(fleet.total_maintenance ?? 0) + Number(fleet.total_wages ?? 0);');
      expect(overviewClient).toContain('const totalSpend = wasteCost + fleetCost;');
      expect(overviewClient).toContain('const hasData = totalSpend > 0 || openCount > 0 || trend.length > 0;');
      expect(overviewClient).toContain('if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;');
    });

    it('keeps the same alert thresholds (now expressed as semantic tones)', () => {
      expect(overviewClient).toContain("avgContam > 10 ? 'danger'");
      expect(overviewClient).toContain("openCount > 20 ? 'warning'");
      expect(overviewClient).toContain("totalDefects > 10 ? 'danger' : totalDefects > 5 ? 'warning'");
      expect(overviewClient).toContain("tone: avgDays > 7 ? 'danger' : undefined");
      expect(overviewClient).toMatch(/HIGH:\s*'danger',\s*\n\s*MED:\s*'warning',\s*\n\s*LOW:\s*'success',/);
    });

    it('keeps the headings, sections and metric labels (information architecture)', () => {
      for (const text of ['Command Overview', 'Monthly Cost Trend', 'Service Requests', 'Alerts & Anomalies', 'Service Dashboards', 'No anomalies detected', 'No trend data yet',
        'Total Spend', 'Waste Cost', 'Fleet Cost', 'Contamination', 'Open SRs', 'Fleet Defects']) {
        expect(overviewClient, text).toContain(text);
      }
      expect(overviewClient).toContain("<h1 className={styles.title}>");
    });

    it('keeps the HLNΛ actions, their prompts and the series toggles', () => {
      expect(overviewClient).toContain('useAppStore.getState().fireHelena(q);');
      expect(overviewClient).toContain("askHlna('Give me a full executive briefing on operational performance — cover waste, fleet, and service requests. Highlight any risks or anomalies.')");
      expect(overviewClient).toContain("askHlna('Analyse the current alerts and anomalies in operational data. What are the root causes and what actions should I take?')");
      expect(overviewClient).toContain('Ask HLNΛ for briefing');
      expect(overviewClient).toContain('Ask HLNΛ to investigate');
      expect(overviewClient).toContain('onClick={() => setActiveLines(p => ({ ...p, [key]: !p[key] }))}');
      expect(overviewClient).toContain('aria-pressed={activeLines[key]}');
    });

    it('keeps the full quick-nav (labels and routes, in order)', () => {
      const nav = overviewClient.slice(overviewClient.indexOf('const QUICK_NAV'), overviewClient.indexOf('];', overviewClient.indexOf('const QUICK_NAV')));
      const pairs = [...nav.matchAll(/label: '([^']+)',\s*href: '([^']+)'/g)].map(m => `${m[1]}=${m[2]}`);
      expect(pairs).toEqual([
        'Waste=/dashboard/waste', 'Fleet=/dashboard/fleet', 'Water=/dashboard/water', 'Roads=/dashboard/roads',
        'Parks=/dashboard/parks', 'Labour=/dashboard/labour', 'Integrations=/dashboard/integrations',
      ]);
      expect(overviewClient).toContain('<a href={d.href}');
    });
  });

  it('enabled capabilities use the CORRECT existing join (m.key = om.module_key), never the known-broken m.id = om.module_id enabledModules query', () => {
    // D.2.3 reconciliation: the generic fallthrough no longer re-queries
    // enabledCapabilities locally — it reuses the SAME m.key = om.module_key
    // projection already computed once, near the top of the function, for
    // the /api/me-parity capability block every branch (including
    // TennisDashboard) shares. Checking the whole file (rather than
    // slicing from the fallthrough onward) still proves the correct join
    // is the one in effect for the fallthrough, since it's the only
    // capability query in the file at all now.
    expect(pageSource).toMatch(/JOIN modules m ON m\.key = om\.module_key/);
    expect(pageSource).not.toMatch(/JOIN modules m ON m\.id = om\.module_id/);
  });

  it('every fallthrough query fails closed to an empty/zero fallback (never throws, never blocks the dashboard render)', () => {
    const fallthroughStart = pageSource.indexOf('const [orgRow, wasteRows');
    expect(fallthroughStart, 'expected the generic-fallthrough Promise.all destructure').toBeGreaterThan(-1);
    const fallthroughBody = pageSource.slice(fallthroughStart);
    const qCalls = fallthroughBody.match(/q\(sql`/g) ?? [];
    // org name, waste, fleet, service requests — capabilities is no
    // longer re-queried here (deduplicated against the top-of-function
    // projection asserted above), so the floor drops from 5 to 4.
    expect(qCalls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Phase C.2C — Events & Ticketing / module discoverability', () => {
  it('OrganisationDashboard renders ModuleAccessCard, gated on genuinely enabled capabilities', () => {
    expect(dashSource).toMatch(/import \{ ModuleAccessCard \} from '\.\/ModuleAccessCard'/);
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // card now also receives the real role so role-gated modules (Organiser:
    // manager+) mirror their route guard; still the same capability list.
    expect(dashSource).toMatch(/<ModuleAccessCard enabledCapabilities=\{enabledCapabilities\} role=\{role\} \/>/);
    expect(pageSource).toMatch(/<OrganisationDashboard[\s\S]{0,400}role=\{session\.role\}/);
    expect(dashSource).toMatch(/\{hasAnyCapability && \(/);
  });

  it('ModuleAccessCard covers every real capability key that exists in modules today (events, crm, organiser) — verified real routes, not guessed', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // key→route rows moved from ModuleAccessCard's MODULE_ENTRIES to the
    // navModel WORK_ITEMS descriptors, which the card consumes via
    // workModuleCards(). Same keys, same real routes, each capability-gated.
    expect(cardSource).toMatch(/workModuleCards\(/);
    expect(navModelSource).toMatch(/id: 'events'[\s\S]*?href: '\/events'[\s\S]*?gate: \{ anyCapability: \['events'\] \}/);
    expect(navModelSource).toMatch(/id: 'crm'[\s\S]*?href: '\/crm'[\s\S]*?gate: \{ anyCapability: \['crm'\] \}/);
    expect(navModelSource).toMatch(/id: 'organiser'[\s\S]*?href: '\/organiser'[\s\S]*?gate: \{ anyCapability: \['organiser'\], minRole: 'manager' \}/);
  });

  it('ModuleAccessCard renders nothing when no configured capability is enabled', () => {
    expect(cardSource).toMatch(/if \(entries\.length === 0\) return null;/);
  });

  // Originally: "this dashboard-local Events card does not itself solve
  // the global missing TopNav Events entry — that remains C.2D scope",
  // asserting TopNav/LeftSidebar had zero /events reference. Phase C.2D
  // has now landed that global entry, so this is updated to confirm it
  // arrived correctly rather than pinning the pre-C.2D gap.
  it('the global TopNav Events entry landed in C.2D, capability-gated, alongside this dashboard-local card', () => {
    const topNav = read('components/nav/TopNav.tsx');
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // '/events' literal and the local hasEvents flag moved into the navModel
    // 'events' descriptor (capability-gated); TopNav renders it through
    // resolveNav() inside the Work menu.
    expect(topNav).toMatch(/resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\)/);
    expect(topNav).toMatch(/entries=\{nav\.work\}/);
    expect(navModelSource).toMatch(/href: '\/events'[\s\S]{0,200}gate: \{ anyCapability: \['events'\] \}/);
  });
});

describe('Phase C.2C — HLNA discoverability from the dashboard', () => {
  it('the HLNA shortcut points to /hlna and nowhere else', () => {
    const hlnaLinkMatch = dashSource.match(/<a\s+href="\/hlna"[\s\S]{0,400}?>/);
    expect(hlnaLinkMatch).not.toBeNull();
  });
});

describe('Phase C.2C — containment', () => {
  it('TopNav.tsx is untouched this phase', () => {
    const topNav = read('components/nav/TopNav.tsx');
    expect(topNav).not.toContain('OrganisationDashboard');
    expect(topNav).not.toContain('ModuleAccessCard');
  });

  it('LeftSidebar.jsx is untouched this phase', () => {
    const sidebar = read('components/layout/LeftSidebar.jsx');
    expect(sidebar).not.toContain('OrganisationDashboard');
  });

  it('components/BrainBase.jsx is not deleted and remains importable — no longer byte-for-byte untouched as of the D.2.3 origin/main reconciliation, which legitimately threaded an isSuperAdmin prop through it into LeftSidebar (see navPersonaCoverage.test.ts\'s LeftSidebar describe block), but it still never imports/renders OrganisationDashboard', () => {
    const brainBase = read('components/BrainBase.jsx');
    expect(brainBase).toMatch(/export default function BrainBase\(\{ enabledCapabilities = \[\], isSuperAdmin = false \}\)/);
    expect(brainBase).not.toContain('OrganisationDashboard');
  });

  it('/hlna files (HelenaWorkspace, HelenaMic, lib/helena/visualState, app/hlna/page) are untouched this phase', () => {
    const workspace = read('components/helena/HelenaWorkspace.jsx');
    const mic = read('components/helena/HelenaMic.jsx');
    const visualState = read('lib/helena/visualState.js');
    const hlnaPage = read('app/hlna/page.tsx');
    for (const src of [workspace, mic, visualState, hlnaPage]) {
      expect(src).not.toContain('OrganisationDashboard');
      expect(src).not.toContain('ModuleAccessCard');
    }
  });

  it('app/api/chat/route.ts (Phase C.2B.3 tenant-aware prompt) is untouched this phase', () => {
    const chatRoute = read('app/api/chat/route.ts');
    expect(chatRoute).toMatch(/let s = buildTenantIdentity\(orgName, enabledCapabilities \?\? \[\]\);/);
  });

  it('/command (WorkspaceShell) is not renamed, replaced, or pulled into /dashboard', () => {
    expect(fs.existsSync(path.join(root, 'app/command/page.tsx'))).toBe(true);
    expect(dashSource).not.toContain('WorkspaceShell');
    expect(pageSource).not.toContain('WorkspaceShell');
  });

  it('no auth/middleware/session model changes — app/dashboard/page.tsx still uses getAuthSession() as its only auth primitive', () => {
    expect(pageSource).toMatch(/getAuthSession\(\)/);
    // the file's own pre-existing comment legitimately references
    // middleware.ts in prose ("middleware.ts already guarantees...") —
    // the guard is that no NEW middleware-touching import/call was added.
    expect(pageSource).not.toMatch(/from ['"].*middleware['"]/);
    expect(pageSource).not.toMatch(/requireCapability|requireSession/);
  });
});
