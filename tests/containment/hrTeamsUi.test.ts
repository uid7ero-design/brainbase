import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-2 Step 1B — static proof of the minimal Teams management UI:
// (1) app/people/teams/page.tsx sits under app/people/'s existing
// layout (no new top-level module, no new capability gate needed);
// (2) every management action (create/edit/archive/restore/"Show
// archived") is gated on the server-returned canManage flag, never
// shown unconditionally — the real authorization boundary is each API
// route's own ctx.isHrAdministrator check, this is a UX courtesy only,
// exactly like app/people/page.tsx's own "+ Add Person" gating;
// (3) archive uses an inline confirm state, never a blocking native
// window.confirm(); (4) an archived row has no Edit action, only
// Restore; (5) app/people/page.tsx links to /people/teams, itself
// gated on the same canManage flag.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('app/people/teams/page.tsx — sits under the existing People module, no new top-level route', () => {
  const src = stripComments(read('app/people/teams/page.tsx'));

  it('is a client component', () => {
    expect(read('app/people/teams/page.tsx').split('\n')[0]).toBe("'use client';");
  });

  it('fetches the default (active-only) team list from the canonical HR teams endpoint', () => {
    expect(src).toContain("fetch(teamsUrl)");
    expect(src).toMatch(/showArchived\s*\?\s*'\/api\/hr\/teams\?include_archived=1'\s*:\s*'\/api\/hr\/teams'/);
  });

  it('derives canManage from the server response, never a client-only guess', () => {
    expect(src).toMatch(/setCanManage\(Boolean\(data\.canManage\)\)/);
  });

  it('"+ Create Team" and the "Show archived" toggle are both gated on the same canManage block, never rendered unconditionally', () => {
    const start = src.indexOf('{canManage && (');
    expect(start).toBeGreaterThan(-1);
    const createIdx = src.indexOf('+ Create Team', start);
    expect(createIdx).toBeGreaterThan(start);
    const block = src.slice(start, createIdx + '+ Create Team'.length);
    expect(block).toContain('Show archived');
    expect(block).toContain('+ Create Team');
  });

  it('Edit and (the button labeled) Archive are gated on canManage AND only rendered for a non-archived row', () => {
    const start = src.indexOf('{canManage && !archived && (');
    expect(start).toBeGreaterThan(-1);
    // Bounded by the very next sibling gate (the archived-row block) —
    // both are adjacent in source, back-to-back.
    const end = src.indexOf('{canManage && archived && (', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain('>Edit<');
    expect(block).toContain('>Archive<');
  });

  it('an archived row has NO Edit action — only Restore', () => {
    const start = src.indexOf('{canManage && archived && (');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('</td>', start);
    const block = src.slice(start, end);
    expect(block).toContain('Restore');
    expect(block).not.toContain('>Edit<');
    expect(block).not.toContain('setEditingTeam');
  });

  it('archiving uses an inline confirmation state, never a blocking native window.confirm()', () => {
    expect(src).not.toMatch(/window\.confirm\(/);
    expect(src).not.toMatch(/\bconfirm\(/);
    expect(src).toMatch(/confirmArchiveId/);
  });

  it('reads archived state from archived_at, matching the API\'s own null/non-null convention', () => {
    expect(src).toMatch(/const archived = t\.archived_at !== null;/);
  });

  it('does not build an org chart, reporting-line visualisation, or drag/drop hierarchy — no such library or component is referenced', () => {
    expect(src).not.toMatch(/org-?chart/i);
    expect(src).not.toMatch(/dnd|drag.?and.?drop|react-dnd/i);
  });
});

describe('app/people/page.tsx — Manage Teams entry point', () => {
  const src = stripComments(read('app/people/page.tsx'));

  it('links to /people/teams', () => {
    expect(src).toMatch(/href="\/people\/teams"/);
  });

  it('the Manage Teams link is gated on the same canManage flag as "+ Add Person"', () => {
    const linkIdx = src.indexOf('href="/people/teams"');
    expect(linkIdx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, linkIdx - 300), linkIdx);
    expect(before).toMatch(/\{canManage && \(/);
  });
});
