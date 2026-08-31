import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildTenantIdentity } from '../../lib/hlna/tenantIdentity';

// Phase C.2B.3 — root cause found in C.2B.2: app/api/chat/route.ts's
// SYSTEM prompt unconditionally opened with "You are Helena — a
// sophisticated AI assistant for Brainbase, a voice-first executive
// command centre for municipal council operations", regardless of what
// the authenticated tenant's organisation_modules actually enables. A
// read-only audit during this phase confirmed: organisations has no
// industry/classification column at all, and the only real rows in
// `modules` today are crm/events/organiser — there is no reliable signal
// anywhere in the schema for "this org is genuinely a council/waste/fleet
// operator". Per this phase's brief, a missing signal means neutral
// behaviour, not guessed behaviour.
//
// buildTenantIdentity() (lib/hlna/tenantIdentity.ts) is pure and has no
// imports of its own, so it's imported and executed directly here rather
// than tested via source-text containment — the more robust option this
// repo's convention explicitly prefers when a composition helper exists.
// Everything about app/api/chat/route.ts's own wiring (which nothing here
// can execute — it depends on Anthropic/DB clients) is still verified via
// static source-text containment, this repo's established convention for
// files that can't be safely imported into a plain-Node test.

describe('buildTenantIdentity — direct unit tests', () => {
  it('base identity is neutral — no council/municipal/waste/fleet framing', () => {
    const s = buildTenantIdentity(undefined, []);
    expect(s).toContain("You are Helena, BrainBase's intelligent assistant for this organisation.");
    expect(s.toLowerCase()).not.toMatch(/council|municipal|waste|fleet|roads|parks|bins?|contamination/);
  });

  it('includes the organisation name when provided, never a hardcoded client name', () => {
    const s = buildTenantIdentity('School Test Organisation', []);
    expect(s).toContain('Current organisation: School Test Organisation.');
    expect(s).not.toMatch(/emma/i);
  });

  it('omits the organisation-name line entirely when no name is available (fails closed, not with a placeholder)', () => {
    const s = buildTenantIdentity(undefined, []);
    expect(s).not.toContain('Current organisation:');
    const s2 = buildTenantIdentity('', []);
    expect(s2).not.toContain('Current organisation:');
  });

  it('Events-only tenant: lists only Events & Ticketing, no Waste/Fleet/Roads/Parks identity dump', () => {
    const s = buildTenantIdentity('School Test Organisation', [{ key: 'events', name: 'Events & Ticketing' }]);
    expect(s).toContain('Events & Ticketing');
    expect(s.toLowerCase()).not.toMatch(/waste|fleet|roads|parks|bins?|contamination|municipal|council/);
  });

  it('multi-module tenant: lists every genuinely enabled capability, does not arbitrarily pick one as the identity', () => {
    const s = buildTenantIdentity('Multi Co', [
      { key: 'events', name: 'Events & Ticketing' },
      { key: 'crm', name: 'CRM' },
    ]);
    expect(s).toContain('Events & Ticketing');
    expect(s).toContain('CRM');
    // Neither is singled out as the assistant's identity — the base
    // sentence stays the same neutral framing regardless of which/how
    // many capabilities are enabled.
    expect(s).toContain("You are Helena, BrainBase's intelligent assistant for this organisation.");
  });

  it('never invents capabilities beyond what is passed in', () => {
    const s = buildTenantIdentity('Org', [{ key: 'events', name: 'Events & Ticketing' }]);
    expect(s).not.toContain('CRM');
    expect(s.toLowerCase()).not.toContain('reports');
  });

  it('no relevant modules: uses a neutral fallback, not a guessed or empty statement', () => {
    const s = buildTenantIdentity('Org With Nothing Enabled', []);
    expect(s).toMatch(/No BrainBase capability modules are currently enabled/);
    expect(s).toMatch(/Do not claim access to data or tools this organisation has not enabled/);
  });

  it('capability list is not a mandatory response template — instructs the model not to recite it unprompted', () => {
    const s = buildTenantIdentity('Org', [{ key: 'events', name: 'Events & Ticketing' }]);
    expect(s).toMatch(/do not recite this list unprompted/);
  });
});

describe('app/api/chat/route.ts — tenant-aware prompt composition wiring', () => {
  const root = path.resolve(__dirname, '../..');
  const routeSource = fs.readFileSync(path.join(root, 'app/api/chat/route.ts'), 'utf-8');

  it('no unconditional "municipal council operations" identity string remains anywhere in the file', () => {
    expect(routeSource).not.toMatch(/executive command centre for municipal council operations/);
  });

  it('buildSystem composes buildTenantIdentity + SYSTEM_RULES, not the old hardcoded SYSTEM constant', () => {
    expect(routeSource).toMatch(/let s = buildTenantIdentity\(orgName, enabledCapabilities \?\? \[\]\);/);
    expect(routeSource).toMatch(/s \+= `\\n\\n\$\{SYSTEM_RULES\}`;/);
    expect(routeSource).not.toMatch(/let s = SYSTEM;/);
  });

  it('LEGACY_DASHBOARD_CONTEXT (the municipal/fleet/waste vocabulary and examples) is only appended inside the department-truthy branch', () => {
    const deptBlockStart = routeSource.indexOf("if (department?.trim()) {");
    const deptBlockEnd = routeSource.indexOf('\n  }', deptBlockStart);
    const deptBlock = routeSource.slice(deptBlockStart, deptBlockEnd);
    expect(deptBlock).toContain('LEGACY_DASHBOARD_CONTEXT');
    // and nowhere else in buildSystem outside that block
    const buildSystemStart = routeSource.indexOf('function buildSystem(');
    const buildSystemEnd = routeSource.indexOf('\n// ─── Ollama', buildSystemStart);
    const buildSystemBody = routeSource.slice(buildSystemStart, buildSystemEnd);
    const occurrences = buildSystemBody.split('LEGACY_DASHBOARD_CONTEXT').length - 1;
    expect(occurrences).toBe(1);
  });

  it('the C.2B.2 department fix is preserved — no regression to an unconditional Waste default', () => {
    expect(routeSource).not.toMatch(/department: useAppStore/); // this route never reads useAppStore at all (client-only store)
    expect(routeSource).toMatch(/if \(department\?\.trim\(\)\)/);
  });

  it('enabled capabilities are derived server-side from the trusted, auth-resolved orgId — never trusted from client-supplied request body', () => {
    const bodyDestructureStart = routeSource.indexOf('const {\n    messages, memoryContext');
    const bodyDestructureEnd = routeSource.indexOf('};', bodyDestructureStart);
    const bodyDestructure = routeSource.slice(bodyDestructureStart, bodyDestructureEnd);
    expect(bodyDestructure).not.toContain('enabledCapabilities');
    expect(bodyDestructure).not.toContain('orgName');
    // the actual capability query runs before req.json() is even parsed,
    // keyed on the auth-session orgId
    const capQueryIdx = routeSource.indexOf('JOIN modules m ON m.key = om.module_key');
    const reqJsonIdx = routeSource.indexOf('await req.json()');
    expect(capQueryIdx).toBeGreaterThan(-1);
    expect(capQueryIdx).toBeLessThan(reqJsonIdx);
  });

  it('reuses the CORRECT existing join pattern (m.key = om.module_key), never the known-broken m.id = om.module_id enabledModules query', () => {
    expect(routeSource).toMatch(/JOIN modules m ON m\.key = om\.module_key/);
    expect(routeSource).not.toMatch(/JOIN modules m ON m\.id = om\.module_id/);
  });

  it('org name / capability lookups fail closed (try/catch) and never block the chat response', () => {
    const orgNameQueryIdx = routeSource.indexOf('SELECT name FROM organisations');
    const surroundingBlock = routeSource.slice(Math.max(0, orgNameQueryIdx - 200), orgNameQueryIdx + 100);
    expect(surroundingBlock).toContain('try {');
  });

  it('tenant-scoping (WHERE organisation_id) instructions remain intact', () => {
    expect(routeSource).toMatch(/Always include WHERE organisation_id = /);
    expect(routeSource).toMatch(/Must include organisation_id = /);
  });

  it('data-fabrication safety rules remain intact (unchanged by this phase)', () => {
    expect(routeSource).toMatch(/NEVER output these phrases/);
    expect(routeSource).toMatch(/Active voice always/);
  });

  it('the JSON response API contract (schema, field names) is unchanged', () => {
    expect(routeSource).toMatch(/"response": "What you say aloud/);
    expect(routeSource).toMatch(/"intent": "answer \| command \| memory \| navigation \| error"/);
    expect(routeSource).toMatch(/"memory_update": null \| \{ "type": "long \| short \| preference"/);
  });

  it('the dashboard-navigation target enum (functional contract for the existing navigate action) is preserved, not removed', () => {
    expect(routeSource).toMatch(/fleet \| waste \| water \| roads \| parks \| environment \| labour \| facilities \| logistics \| supply \| depot \| construction/);
  });

  it('TENNIS_SYSTEM (already tenant-scoped, already excludes waste/fleet/council) is untouched by this phase', () => {
    expect(routeSource).toMatch(/You are an AI assistant for a tennis coaching business\./);
    expect(routeSource).toMatch(/You DO NOT reference:/);
    expect(routeSource).toMatch(/- waste data/);
    expect(routeSource).toMatch(/- fleet data/);
    expect(routeSource).toMatch(/- council operations/);
  });

  it('no model provider, ElevenLabs, database schema, or auth changes — only prompt/context composition', () => {
    expect(routeSource).not.toContain('elevenlabs');
    expect(routeSource).not.toMatch(/CREATE TABLE|ALTER TABLE/i);
    expect(routeSource).toMatch(/anthropicClient\.messages\.create/); // same Anthropic client, unchanged
  });
});
