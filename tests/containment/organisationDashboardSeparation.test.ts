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
    expect(pageSource).toMatch(/catch \{ return <BrainBase \/> \}/);
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

  it('app/dashboard/overview/page.tsx and OverviewClient.tsx are byte-for-byte untouched this phase', () => {
    // Spot-check a few distinctive, unmodified lines rather than a full
    // snapshot — proves the file wasn't touched without pinning its
    // entire content.
    const overviewPage = read('app/dashboard/overview/page.tsx');
    const overviewClient = read('app/dashboard/overview/OverviewClient.tsx');
    expect(overviewPage).toContain("import OverviewClient from './OverviewClient';");
    expect(overviewClient).toContain('Command Overview');
    expect(overviewClient).toContain("{ label: 'Waste',    href: '/dashboard/waste',    color: '#22C55E' }");
  });

  it('enabled capabilities use the CORRECT existing join (m.key = om.module_key), never the known-broken m.id = om.module_id enabledModules query', () => {
    const fallthroughStart = pageSource.indexOf('const oid = session.organisationId');
    const fallthroughBody = pageSource.slice(fallthroughStart);
    expect(fallthroughBody).toMatch(/JOIN modules m ON m\.key = om\.module_key/);
    expect(fallthroughBody).not.toMatch(/JOIN modules m ON m\.id = om\.module_id/);
  });

  it('every fallthrough query fails closed to an empty/zero fallback (never throws, never blocks the dashboard render)', () => {
    const fallthroughStart = pageSource.indexOf('const [orgRow, capRows');
    const fallthroughBody = pageSource.slice(fallthroughStart);
    const qCalls = fallthroughBody.match(/q\(sql`/g) ?? [];
    expect(qCalls.length).toBeGreaterThanOrEqual(5); // org name, capabilities, waste, fleet, service requests
  });
});

describe('Phase C.2C — Events & Ticketing / module discoverability', () => {
  it('OrganisationDashboard renders ModuleAccessCard, gated on genuinely enabled capabilities', () => {
    expect(dashSource).toMatch(/import \{ ModuleAccessCard \} from '\.\/ModuleAccessCard'/);
    expect(dashSource).toMatch(/<ModuleAccessCard enabledCapabilities=\{enabledCapabilities\} \/>/);
    expect(dashSource).toMatch(/\{hasAnyCapability && \(/);
  });

  it('ModuleAccessCard covers every real capability key that exists in modules today (events, crm, organiser) — verified real routes, not guessed', () => {
    expect(cardSource).toMatch(/key: 'events'[\s\S]*?href: '\/events'/);
    expect(cardSource).toMatch(/key: 'crm'[\s\S]*?href: '\/crm'/);
    expect(cardSource).toMatch(/key: 'organiser'[\s\S]*?href: '\/organiser'/);
  });

  it('ModuleAccessCard renders nothing when no configured capability is enabled', () => {
    expect(cardSource).toMatch(/if \(entries\.length === 0\) return null;/);
  });

  it('this dashboard-local Events card does not itself solve the global missing TopNav Events entry — that remains C.2D scope', () => {
    // Documentation guard: confirms this phase did not touch TopNav/
    // LeftSidebar as a side effect of adding dashboard-local discovery.
    const topNav = read('components/nav/TopNav.tsx');
    const sidebar = read('components/layout/LeftSidebar.jsx');
    expect(topNav).not.toMatch(/['"]\/events['"]/);
    expect(sidebar).not.toMatch(/['"]\/events['"]/);
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

  it('components/BrainBase.jsx is byte-for-byte untouched this phase (still not deleted, still importable)', () => {
    const brainBase = read('components/BrainBase.jsx');
    expect(brainBase).toMatch(/export default function BrainBase\(\)/);
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
