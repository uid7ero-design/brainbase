import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR Administrator Management UI — static proof of the minimal
// grant/revoke surface: (1) app/people/administrators/page.tsx sits
// under app/people/'s existing layout (no new capability gate needed);
// (2) it fetches ONLY the dedicated GET /api/hr/administrators
// endpoint, never a broader one; (3) grant is explicit-selection-only
// from that same response's own candidate rows — never auto-matched by
// name/email; (4) grant/revoke call the existing POST/DELETE endpoints
// with no new client-side authorization logic; (5) revoke uses an
// inline confirm/cancel row state, never a blocking native
// window.confirm(), matching app/people/teams/page.tsx's own Archive
// action; (6) loading/empty/error states all render distinctly; (7)
// the entry point on app/people/page.tsx is gated on the same
// server-returned canManage flag as "Manage Teams".

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('app/people/administrators/page.tsx — HR administrator grant/revoke UI', () => {
  const src = stripComments(read('app/people/administrators/page.tsx'));

  it('is a client component', () => {
    expect(read('app/people/administrators/page.tsx').split('\n')[0]).toBe("'use client';");
  });

  it('fetches the dedicated /api/hr/administrators endpoint, never a broader one', () => {
    expect(src).toContain("fetch('/api/hr/administrators')");
    expect(src).not.toMatch(/\/api\/admin\/users/);
  });

  it('derives the candidate/administrator split from the fetched response only, via is_hr_administrator, never a client-only guess or a second endpoint', () => {
    expect(src).toMatch(/administrators\s*=\s*users\.filter\(u => u\.is_hr_administrator\)/);
    expect(src).toMatch(/candidates\s*=\s*users\.filter\(u => !u\.is_hr_administrator\)/);
  });

  it('grant is explicit-selection-only — a <select> populated from candidates, no free-text user id entry, no auto-selection', () => {
    const start = src.indexOf('<select value={selectedUserId}');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('</select>', start);
    const block = src.slice(start, end);
    expect(block).toContain('candidates.map');
    expect(block).toContain('— Select a user to grant —');
  });

  it('no fuzzy/automatic matching exists — the component never reads or compares email/name similarity to pick a candidate', () => {
    expect(src).not.toMatch(/match|suggest|similar|fuzzy/i);
  });

  it('grant() calls the existing POST /api/hr/administrators endpoint with the explicitly selected user_id', () => {
    const start = src.indexOf('async function grant()');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/method:\s*'POST'/);
    expect(block).toMatch(/user_id:\s*selectedUserId/);
  });

  it('revoke() calls the existing DELETE /api/hr/administrators endpoint', () => {
    const start = src.indexOf('async function revoke(');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/method:\s*'DELETE'/);
    expect(block).toMatch(/\?userId=\$\{userId\}/);
  });

  it('revoke uses an inline confirm/cancel row state, never a blocking native window.confirm()', () => {
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).toMatch(/confirmRevokeId === u\.id/);
    expect(src).toMatch(/Revoke access\?/);
    expect(src).toMatch(/>Confirm<\/button>/);
    expect(src).toMatch(/>Cancel<\/button>/);
  });

  it('a successful grant clears the selection and reloads the list', () => {
    const start = src.indexOf('async function grant()');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/if \(res\.ok\) \{/);
    expect(block).toMatch(/setSelectedUserId\(''\)/);
    expect(block).toMatch(/await load\(\)/);
  });

  it('a successful revoke clears the confirm state and reloads the list', () => {
    const start = src.indexOf('async function revoke(');
    const end = src.indexOf('\n  }', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/if \(res\.ok\) \{/);
    expect(block).toMatch(/setConfirmRevokeId\(null\)/);
    expect(block).toMatch(/await load\(\)/);
  });

  it('renders a distinct loading state', () => {
    expect(src).toMatch(/\{loading && <tr><td colSpan=\{3\} style=\{empty\}>Loading…<\/td><\/tr>\}/);
  });

  it('renders a distinct empty state when there are no HR administrators', () => {
    expect(src).toContain('No HR administrators yet.');
  });

  it('renders a distinct error state, styled differently from the empty state', () => {
    expect(src).toMatch(/\{!loading && error && <tr><td colSpan=\{3\} style=\{\{ \.\.\.empty, color: '#f87171' \}\}>\{error\}<\/td><\/tr>\}/);
  });

  it('no new role-based check was introduced anywhere in this file — authorization is left entirely to the API route', () => {
    expect(src).not.toMatch(/role\s*===\s*'super_admin'/);
    expect(src).not.toMatch(/session\.role/);
    expect(src).not.toMatch(/canManage/);
  });

  it('grant/revoke actions do not gate themselves on any client-derived permission flag beyond disabling on empty selection', () => {
    const grantButtonIdx = src.indexOf('<button onClick={grant}');
    expect(grantButtonIdx).toBeGreaterThan(-1);
    const line = src.slice(grantButtonIdx, src.indexOf('>', grantButtonIdx));
    expect(line).toMatch(/disabled=\{!selectedUserId \|\| granting\}/);
  });
});

describe('app/people/page.tsx — Manage Administrators entry point', () => {
  const src = stripComments(read('app/people/page.tsx'));

  it('links to /people/administrators, gated on the same canManage block as Manage Teams', () => {
    const start = src.indexOf('{canManage && (');
    expect(start).toBeGreaterThan(-1);
    const teamsIdx = src.indexOf('Manage Teams', start);
    const adminsIdx = src.indexOf('Manage Administrators', start);
    expect(teamsIdx).toBeGreaterThan(start);
    expect(adminsIdx).toBeGreaterThan(teamsIdx);
    const block = src.slice(start, adminsIdx + 'Manage Administrators'.length);
    expect(block).toContain('/people/administrators');
  });
});
