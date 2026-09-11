import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-1 — static proof that People is a genuine, independently-enableable
// capability, not a hardcoded/unconditional feature: (1) app/people/
// layout.tsx enforces the same checkCapability('people') gate every
// other module-gated page (CRM/Organiser) already uses, and never shows
// its children unless entitled; (2) TopNav.tsx only renders the People
// nav item when 'people' is present in enabledCapabilities, mirroring
// hasCrm/hasOrganiser exactly — no unconditional sidebar item exists.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

describe('app/people/layout.tsx — module gating', () => {
  const src = read('app/people/layout.tsx');

  it('requires an authoritative session before anything else', () => {
    expect(src).toContain("import { requireSession } from '@/lib/org'");
    expect(src).toMatch(/await requireSession\(\)/);
  });

  it('checks the real "people" capability via the canonical capability helper, not a bespoke check', () => {
    expect(src).toContain("import { checkCapability } from '@/lib/capabilities/requireCapability'");
    expect(src).toMatch(/checkCapability\(session\.organisationId,\s*'people'\)/);
  });

  it('does not render children when the capability is not allowed', () => {
    const idx = src.indexOf('capability.allowed');
    expect(idx).toBeGreaterThan(-1);
    const deniedMessageIdx = src.indexOf("isn&apos;t enabled", idx);
    expect(deniedMessageIdx).toBeGreaterThan(idx);
    // children is only referenced once, in the final return, AFTER the
    // early-return denial screen above it in source order.
    const childrenIdx = src.indexOf('{children}');
    expect(childrenIdx).toBeGreaterThan(deniedMessageIdx);
  });
});

describe('components/nav/TopNav.tsx — People nav item is capability-gated, never unconditional', () => {
  const src = read('components/nav/TopNav.tsx');

  it('computes hasPeople from enabledCapabilities, the same projection every other capability flag uses', () => {
    expect(src).toMatch(/const hasPeople\s*=\s*\n?\s*enabledCapabilities\.includes\(\s*\n?\s*'people',?\s*\n?\s*\);/);
  });

  it('the People NavItem is wrapped in {hasPeople && (...)}, matching hasCrm/hasOrganiser/hasCommercial\'s own pattern exactly', () => {
    expect(src).toMatch(/\{hasPeople && \(\s*<NavItem\s*\n\s*href="\/people"/);
  });

  it('there is no unconditional (always-rendered) People/HR nav entry anywhere in the file', () => {
    // Every literal "/people" href in the file must be inside a
    // hasPeople-gated block — approximated by requiring the ONLY
    // occurrences of the href are the ones already matched above.
    const peopleHrefs = [...src.matchAll(/href="\/people"/g)];
    expect(peopleHrefs.length).toBeGreaterThan(0);
    for (const match of peopleHrefs) {
      const before = src.slice(Math.max(0, match.index! - 200), match.index);
      expect(before).toMatch(/hasPeople && \(/);
    }
  });
});

describe('app/people/page.tsx — admin-only UI actions are gated on the server-computed canManage flag, not shown unconditionally', () => {
  const src = read('app/people/page.tsx');

  it('reads canManage from the GET /api/hr/people response and stores it in state', () => {
    expect(src).toMatch(/setCanManage\(Boolean\(data\.canManage\)\)/);
  });

  it('"+ Add Person" is wrapped in {canManage && (...)}, never rendered unconditionally', () => {
    // Anchor on the actual <button> JSX, not any prose mention of
    // "+ Add Person" in a comment elsewhere in the file.
    const btnIdx = src.indexOf('<button onClick={() => setShowAdd(true)}');
    expect(btnIdx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, btnIdx - 100), btnIdx);
    expect(before).toMatch(/\{canManage && \(/);
  });

  it('the empty-state call-to-action text is also conditioned on canManage', () => {
    expect(src).toMatch(/canManage \? 'No people yet\. Add your first person to get started\.' : 'No people to show yet\.'/);
  });
});

describe('components/brand/CapabilityIcon.tsx — people has its own distinct icon/colour, not a fallback', () => {
  const src = read('components/brand/CapabilityIcon.tsx');

  it('CAPABILITY_ICON_MAP has a people entry distinct from crm\'s', () => {
    const mapStart = src.indexOf('const CAPABILITY_ICON_MAP');
    const mapEnd = src.indexOf('};', mapStart);
    const mapSection = src.slice(mapStart, mapEnd);
    expect(mapSection).toMatch(/people:\s*\{\s*Icon:\s*\w+,\s*color:\s*'#[0-9A-Fa-f]{6}'\s*\}/);
    const peopleColor = mapSection.match(/people:\s*\{\s*Icon:\s*\w+,\s*color:\s*'(#[0-9A-Fa-f]{6})'/)?.[1];
    const crmColor = mapSection.match(/crm:\s*\{\s*Icon:\s*\w+,\s*color:\s*'(#[0-9A-Fa-f]{6})'/)?.[1];
    expect(peopleColor).toBeDefined();
    expect(peopleColor).not.toBe(crmColor);
  });
});
