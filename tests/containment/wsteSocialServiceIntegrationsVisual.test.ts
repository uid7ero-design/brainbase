import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Remaining visual islands pass (worker B) — WSTe (overview, ServiceTimeline,
// property detail), Service Requests, Social Intelligence and Integrations.
//
// These were dark-only islands (#07080B / #06070F / #0a0a0f / #13131a slabs,
// white-alpha text and borders, old violet chrome, radial/linear gradient
// ambience and glows, local Inter font stacks, Tailwind text-white /
// bg-white/10 / focus:outline-none, raw status hues as text). They now follow
// <html data-theme> through tokens, the shared components/ui/app primitives
// and the theme-aware chart palette.
//
// Source-text guard, comments stripped first. The ONLY raw hues allowed are
// the WSTe service-type identity shades and bin lid swatches in
// Wste.module.css (data encodings, icon/swatch only, text always written).

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (f: string) => stripComments(read(f));

const WSTE = 'app/dashboard/wste/WSTEClient.tsx';
const TIMELINE = 'app/dashboard/wste/components/ServiceTimeline.tsx';
const PROPERTY = 'app/dashboard/wste/property/[id]/PropertyClient.tsx';
const SR = 'app/dashboard/service-requests/ServiceRequestsClient.tsx';
const SOCIAL = 'app/dashboard/social/SocialClient.tsx';
const INTEGRATIONS = 'app/dashboard/integrations/IntegrationsClient.tsx';
const TSX = [WSTE, TIMELINE, PROPERTY, SR, SOCIAL, INTEGRATIONS];
const CSS = [
  'app/dashboard/wste/Wste.module.css',
  'app/dashboard/service-requests/ServiceRequests.module.css',
  'app/dashboard/social/Social.module.css',
  'app/dashboard/integrations/Integrations.module.css',
];
const FILES = [...TSX, ...CSS];

// Data encodings (Wste.module.css only): service-type identity shades for
// dark + light, and physical bin lid colours. Nothing else.
const WSTE_DATA_HUES = new Set([
  '#2dd4bf', '#60a5fa', '#fb923c', '#e879f9', '#94a3b8', '#facc15', '#f87171', '#fb7185', '#c084fc', '#fdba74',
  '#0f766e', '#2563eb', '#c2410c', '#a21caf', '#64748b', '#a16207', '#dc2626', '#be123c', '#9333ea', '#9a3412',
  '#ca8a04', '#16a34a',
]);

describe('Worker B islands — theme-following visual contract', () => {
  it('guards every file in the surface (and all of them exist)', () => {
    for (const f of FILES) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it.each(FILES)('%s: no white/black-alpha neutrals, rgba literals or dark slabs', f => {
    const s = src(f);
    expect(s).not.toMatch(/rgba?\(/);
    expect(s).not.toMatch(/#(07080B|06070F|08090C|0a0a0f|0d0f14|0e1014|13131a|1a1d24|F5F7FA|F4F4F5)\b/i);
    expect(s).not.toMatch(/(["'])#fff(fff)?\1/i);
  });

  it.each(FILES)('%s: no dark-only Tailwind, local fonts, blur, glow, gradients, colorScheme, outline suppression', f => {
    const s = src(f);
    expect(s).not.toMatch(/\b(text-white|bg-white|border-white|bg-\[#|text-gray-|bg-blue-|hover:bg-|placeholder-gray|focus:outline-none|bg-red-900|text-red-400|text-green-400|text-yellow-400)/);
    expect(s).not.toMatch(/font-inter|"Inter"|-apple-system|BlinkMacSystemFont|system-ui|fontFamily\s*[:=]\s*["'{]?\s*["']?(monospace|sans-serif)|\bFONT\b/);
    expect(s).not.toMatch(/backdrop(Filter|-filter)|blur\(/i);
    expect(s).not.toMatch(/(linear|radial|conic)-gradient/);
    expect(s).not.toMatch(/colorScheme|color-scheme/);
    expect(s).not.toMatch(/outline:\s*['"]?none|outline:\s*0\b|outline-none/);
    expect(s).not.toMatch(/boxShadow|box-shadow|drop-shadow|textShadow|text-shadow/);
  });

  it.each(FILES)('%s: no old violet chrome', f => {
    const s = src(f);
    expect(s).not.toMatch(/#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b/i);
  });

  it.each(TSX)('%s: no raw hex colours in components (tokens / palette only)', f => {
    expect(src(f).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it.each(CSS)('%s: only allow-listed data hues; everything else is a token', f => {
    const hexes = src(f).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    if (!f.endsWith('Wste.module.css')) { expect(hexes).toEqual([]); return; }
    for (const h of hexes) expect(WSTE_DATA_HUES.has(h.toLowerCase()), `${f}: ${h}`).toBe(true);
    // …and each is only ever used by the service-type or lid rules.
    for (const line of src(f).split('\n')) {
      if (!/#[0-9a-fA-F]{6}/.test(line)) continue;
      expect(/\.svcHue\[data-type='\w+'\] \{ color: #[0-9a-f]{6}; \}|\.lid\[data-lid='\w+'\] \{ background: #[0-9a-f]{6}; \}/.test(line), line.trim()).toBe(true);
    }
    // Light shades are scoped to the light theme.
    expect(src(f)).toMatch(/:global\(:root\[data-theme='light'\]\) \.svcHue\[data-type='bin_collection'\]/);
  });

  it.each(CSS)('%s: animations respect prefers-reduced-motion', f => {
    const s = src(f);
    if (/animation:/.test(s)) expect(s).toMatch(/prefers-reduced-motion: no-preference\)\s*\{[^}]*\{[^}]*animation:/);
    if (/transition:/.test(s)) expect(s).toMatch(/prefers-reduced-motion/);
  });

  it('selected states use border/background, not outline (focus ring stays intact)', () => {
    for (const f of CSS) expect(src(f), f).not.toMatch(/\[aria-(pressed|selected|checked)='true'\][^{]*\{[^}]*outline/);
  });

  it('pages adopt the shared primitives (single PageHeader h1 each)', () => {
    for (const f of [WSTE, PROPERTY, SR, SOCIAL, INTEGRATIONS]) {
      const s = src(f);
      expect(s, f).toContain("from '@/components/ui/app'");
      expect(s, f).toMatch(/<PageHeader\b/);
      expect(s, f).not.toMatch(/<h1\b/);
    }
  });
});

describe('Worker B islands — preserved behaviour pins', () => {
  it('WSTe: property route, simulated lookup, exception filter and tab state', () => {
    const s = src(WSTE);
    expect(s).toContain("return `/dashboard/wste/property/${encodeURIComponent(address.toLowerCase().replace(/\\s+/g, '-'))}`;");
    expect(s).toContain('}, 800);');
    expect(s).toContain('const found = Math.random() > 0.25;');
    expect(s).toContain('? exceptions\n    : exceptions.filter(e => !e.resolved);');
    expect(s).toMatch(/role="tab"[\s\S]*aria-selected=\{tab === t\}/);
    expect(s).toContain('onChange={e => setShowResolved(e.target.checked)}');
    expect(s).toMatch(/r\.completion_pct >= 98 \? undefined : r\.completion_pct >= 90 \? 'warning' : 'danger'/);
  });

  it('ServiceTimeline: exports, filter semantics and expand toggle unchanged', () => {
    const s = src(TIMELINE);
    for (const t of ['ServiceType', 'EvidenceType', 'VerificationStatus', 'Evidence', 'ServiceEvent']) expect(s).toMatch(new RegExp(`export type ${t}\\b`));
    expect(s).toContain("export default function ServiceTimeline({ events, title = 'Service Timeline' }");
    expect(s).toContain(': events.filter(e => activeFilters.has(e.service_type));');
    expect(s).toContain('aria-pressed={active} onClick={() => toggleFilter(t)}');
    expect(s).toContain('onClick={() => setExpanded(v => !v)}');
    expect(s).toContain('aria-expanded={expanded}');
  });

  it('Property detail: back link, engine-over-static status precedence, timeline title', () => {
    const s = src(PROPERTY);
    expect(s).toContain('href="/dashboard/wste"');
    expect(s).toContain('const displayStatus = engineResult?.status ?? data.verification.status;');
    expect(s).toContain('const displayConfidence = engineResult?.confidence ?? data.verification.confidence;');
    expect(s).toContain('<ServiceTimeline events={data.service_events} title="Service & Evidence Timeline" />');
    for (const scenario of ["'route_pass'", "'route_bypass'", "'gps_gap'"]) expect(s).toContain(`scenario === ${scenario}`);
  });

  it('Service Requests: Helena prompt, insight banner, filters, 80-row cap and theme-aware series', () => {
    const s = src(SR);
    expect(s).toContain("useAppStore.getState().fireHelena('Analyse the current service requests — which suburbs and request types are generating the most open items? Are there any resolution time concerns?')");
    expect(s).toContain('{!isDemo && <HlnaInsightBanner dashboardType="service_requests" />}');
    expect(s).toContain("if (statusFilter   !== 'All' && r.status   !== statusFilter)   return false;");
    expect(s).toContain('filtered.slice(0, 80)');
    expect(s).toContain('const chart = useDashboardChart();');
    expect(s).toContain('<Bar dataKey="Closed"  fill={chart.palette.success}');
    expect(s).toContain('<Bar dataKey="Pending" fill={chart.palette.info}');
    expect(s).toContain('<Bar dataKey="Open"    fill={chart.palette.warning}');
    expect(s).toContain('<Cell key={i} fill={chart.series[i % chart.series.length]} />');
    expect(s).toMatch(/<Tooltip \{\.\.\.chart\.tooltip\} \/>/);
    expect(s).toContain('aria-pressed={statusFilter === st}');
  });

  it('Social: endpoints, methods, connect redirect and report export unchanged', () => {
    const s = src(SOCIAL);
    expect(s).toContain("fetch('/api/social/posts?limit=25')");
    expect(s).toContain("fetch('/api/social/insights')");
    expect(s).toContain("fetch('/api/social/sync', { method: 'POST' })");
    expect(s).toContain("fetch('/api/social/analyse', { method: 'POST' })");
    expect(s).toContain("window.location.href = '/api/social/connect';");
    expect(s).toContain('const html = generateReportHTML({');
    expect(s).toContain('onClick={handleSync} disabled={syncing}');
    expect(s).toContain('onClick={handleAnalyse} disabled={analysing}');
  });

  it('Integrations: sync / toggle / delete / create contracts and optimistic updates unchanged', () => {
    const s = src(INTEGRATIONS);
    expect(s).toContain("fetch(`/api/integrations/${id}/sync`, { method: 'POST' })");
    expect(s).toContain("last_sync_status: 'success', last_synced_at: new Date().toISOString(), last_sync_count: data.recordsSynced");
    expect(s).toContain("i.id === id ? { ...i, last_sync_status: 'error' } : i,");
    expect(s).toMatch(/fetch\(`\/api\/integrations\/\$\{integration\.id\}`, \{\s*method:\s*'PATCH',[\s\S]*?body:\s*JSON\.stringify\(\{ enabled: !integration\.enabled \}\)/);
    expect(s).toContain("if (!confirm('Delete this integration? Synced data will not be removed.')) return;");
    expect(s).toContain("await fetch(`/api/integrations/${id}`, { method: 'DELETE' });");
    expect(s).toContain("const res = await fetch('/api/integrations', {");
    expect(s).toContain("if (form.connector_id === 'rest') {");
    expect(s).toContain('if (form.financial_year.trim()) config.financial_year = form.financial_year.trim();');
    expect(s).toContain('if (form.month.trim()) config.month = form.month.trim();');
    expect(s).toContain('disabled={syncing[integration.id] || !integration.enabled}');
    expect(s).toMatch(/role="switch"\s+aria-checked=\{!!integration\.enabled\}/);
    expect(s).toContain('<form id="integration-add-form" onSubmit={handleAdd}');
  });
});
