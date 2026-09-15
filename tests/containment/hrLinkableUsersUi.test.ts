import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-2 Step 1D1 — static proof of the explicit-account-linking UI:
// (1) PersonForm.tsx's Linked BrainBase Account control exists, is
// gated on the same server-derived canManage flag every other
// management action in this module already uses (never a locally
// re-derived role check), fetches ONLY the dedicated
// /api/hr/linkable-users endpoint (never the broader
// /api/admin/users), and never auto-selects or highlights a candidate
// by matching form.work_email; (2) already-linked-to-another-person
// candidates are rendered but disabled, and an explicit "no linked
// account" (unlink) option exists; (3) PersonDrawer.tsx's own
// management-only linked-account row is gated the same way, not
// broadened merely because the field's own API tier is 'internal'.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('app/people/_components/PersonForm.tsx — explicit account-linking control', () => {
  const src = stripComments(read('app/people/_components/PersonForm.tsx'));

  it('fetches the dedicated /api/hr/linkable-users endpoint, never /api/admin/users', () => {
    expect(src).toMatch(/\/api\/hr\/linkable-users/);
    expect(src).not.toMatch(/\/api\/admin\/users/);
  });

  it('the linkable-users fetch is gated on canManage, not issued unconditionally', () => {
    const fetchIdx = src.indexOf('fetch(url)');
    expect(fetchIdx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, fetchIdx - 300), fetchIdx);
    expect(before).toMatch(/if \(canManage\) \{/);
  });

  it('editing an existing person includes person_id in the linkable-users request', () => {
    const start = src.indexOf('if (canManage) {');
    const end = src.indexOf('fetch(url)', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/initial\?\.id/);
    expect(block).toMatch(/person_id=\$\{initial\.id\}/);
  });

  it('create-person mode (no initial.id) requests the endpoint with no person_id', () => {
    const start = src.indexOf('if (canManage) {');
    const end = src.indexOf('fetch(url)', start);
    const block = src.slice(start, end);
    expect(block).toContain("'/api/hr/linkable-users'");
  });

  it('the Linked BrainBase Account control itself is rendered only inside a canManage-gated block', () => {
    const start = src.indexOf('Linked BrainBase Account');
    expect(start).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, start - 300), start);
    expect(before).toMatch(/\{canManage && \(/);
  });

  it('canManage is a required prop on this component, not a locally re-derived role check', () => {
    expect(src).toMatch(/canManage:\s*boolean/);
    expect(src).not.toMatch(/session\.role\s*===/);
    expect(src).not.toMatch(/role\s*===\s*'super_admin'/);
  });

  it('an explicit "no linked account" (unlink) option exists in the select', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toContain('— No linked account —');
  });

  it('a candidate that is not selectable is rendered but disabled, never silently removed', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/const disabled = !u\.selectable/);
    expect(block).toMatch(/disabled=\{disabled\}/);
  });

  it('disabling comes from the server-computed selectable field, not a client-recomputed already_linked check', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/already_linked && !isCurrentLink/);
  });

  it('the currently-linked account (even if inactive) can still be displayed as a distinct, non-generic label, and remains a visible option rather than being hidden', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/isCurrentLink/);
    expect(block).toMatch(/currently linked \(inactive\)/);
  });

  it('unlink remains available via the explicit "no linked account" option regardless of any candidate\'s selectability', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toContain('<option value="">— No linked account —</option>');
  });

  it('no fuzzy/automatic matching exists — the linking control never reads form.work_email, and no candidate is pre-selected or highlighted by email/name similarity', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/work_email/);
    expect(block).not.toMatch(/match|suggest|similar/i);
  });

  it('the selected linked_user_id value comes only from form state (initial data or an explicit onChange), never derived from any other field', () => {
    const start = src.indexOf('Linked BrainBase Account');
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/value=\{form\.linked_user_id \?\? ''\}/);
    expect(block).toMatch(/onChange=\{set\('linked_user_id'\)\}/);
  });

  it('linked_user_id is part of the submitted EDITABLE_FIELDS allowlist', () => {
    const start = src.indexOf('const EDITABLE_FIELDS');
    const end = src.indexOf('];', start);
    const block = src.slice(start, end);
    expect(block).toContain("'linked_user_id'");
  });
});

describe('app/people/_components/PersonDrawer.tsx — management-only linked-account display', () => {
  const src = stripComments(read('app/people/_components/PersonDrawer.tsx'));

  it('the Linked BrainBase Account row is gated on canManage, not on the field\'s own internal API tier', () => {
    const start = src.indexOf('Linked BrainBase Account');
    expect(start).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, start - 150), start);
    expect(before).toMatch(/\{canManage && /);
  });

  it('does not fetch the broader linkable-users list merely to enrich this read-only row', () => {
    expect(src).not.toMatch(/\/api\/hr\/linkable-users/);
  });

  it('does not display platform role anywhere', () => {
    expect(src).not.toMatch(/\brole\b/);
  });
});

describe('app/people/page.tsx — PersonForm receives canManage explicitly', () => {
  const src = stripComments(read('app/people/page.tsx'));

  it('both the Add and Edit PersonForm instances are passed canManage', () => {
    const matches = [...src.matchAll(/<PersonForm\b[^]*?\/>/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      expect(m[0]).toMatch(/canManage=\{canManage\}/);
    }
  });
});
