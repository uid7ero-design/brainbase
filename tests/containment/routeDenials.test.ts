import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { NextRequest } from 'next/server';

// ── Brain note route: super_admin-only + path-traversal containment ──────────
const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

const readConfigMock = vi.fn();
vi.mock('../../lib/brain/config', () => ({
  readConfig: () => readConfigMock(),
  writeConfig: vi.fn(),
}));
vi.mock('../../lib/brain/watcher', () => ({
  syncVault: vi.fn(async () => {}),
  startWatcher: vi.fn(),
  getSyncStatus: vi.fn(() => ({ state: 'idle', message: '', indexed: 0 })),
}));

const { POST: brainNotePost } = await import('@/app/api/brain/note/route');

function noteRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/brain/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/brain/note — super_admin-only + path containment', () => {
  let vault: string;

  beforeEach(() => {
    requireRoleMock.mockReset();
    readConfigMock.mockReset();
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-vault-'));
    readConfigMock.mockReturnValue({ vaultPath: vault });
  });

  it('denies an anonymous caller (no session at all)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await brainNotePost(noteRequest({ title: 'x', body: 'y' }));
    expect(res.status).toBe(403);
  });

  it('denies an authenticated non-super_admin caller (role denial)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await brainNotePost(noteRequest({ title: 'x', body: 'y' }));
    expect(res.status).toBe(403);
  });

  it('allows a super_admin to create a note inside the vault', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    const res = await brainNotePost(noteRequest({ title: 'My Note', body: 'hello' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path.startsWith(path.resolve(vault))).toBe(true);
  });

  it('rejects a folder value that attempts to traverse outside the vault, even for a super_admin', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    const res = await brainNotePost(noteRequest({ title: 'Escape', body: 'x', folder: '../../../../etc' }));
    expect(res.status).toBe(400);
  });
});
