import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveSafeNotePath } from '@/lib/brain/pathGuard';

const VAULT = path.resolve('/tmp/test-vault');

describe('brain/pathGuard.resolveSafeNotePath', () => {
  it('accepts a valid nested folder', () => {
    const result = resolveSafeNotePath(VAULT, 'Projects/Notes', 'my-note.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filePath.startsWith(VAULT)).toBe(true);
      expect(result.targetDir).toBe(path.resolve(VAULT, 'Projects/Notes'));
    }
  });

  it('accepts no folder (vault root)', () => {
    const result = resolveSafeNotePath(VAULT, undefined, 'note.md');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targetDir).toBe(VAULT);
  });

  it('rejects a simple ".." traversal', () => {
    const result = resolveSafeNotePath(VAULT, '..', 'note.md');
    expect(result.ok).toBe(false);
  });

  it('rejects a deeper ".." traversal escaping the vault', () => {
    const result = resolveSafeNotePath(VAULT, '../../etc', 'passwd.md');
    expect(result.ok).toBe(false);
  });

  it('rejects an absolute path folder', () => {
    const absoluteElsewhere = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
    const result = resolveSafeNotePath(VAULT, absoluteElsewhere, 'note.md');
    expect(result.ok).toBe(false);
  });

  it('treats a literal percent-encoded traversal string as a harmless folder name (never decoded)', () => {
    // "%2e%2e%2f" is NOT decoded anywhere in this code path, so it is a
    // literal, safe subfolder name — this proves encoded traversal payloads
    // do not bypass the guard by being interpreted as ".." after the fact.
    const result = resolveSafeNotePath(VAULT, '%2e%2e%2f', 'note.md');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filePath.startsWith(VAULT)).toBe(true);
  });

  it('rejects mixed-separator traversal attempts', () => {
    const result = resolveSafeNotePath(VAULT, '..\\..\\..', 'note.md');
    // On POSIX, backslash is not a separator so this resolves to a literal
    // (harmless) folder name; on Windows it resolves via native path rules
    // and must still not escape the vault. Either way the result must never
    // point outside VAULT.
    if (result.ok) {
      expect(result.filePath.startsWith(VAULT)).toBe(true);
    } else {
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a folder that resolves outside the vault via a crafted relative path', () => {
    const result = resolveSafeNotePath(VAULT, 'a/../../b', 'note.md');
    expect(result.ok).toBe(false);
  });
});
