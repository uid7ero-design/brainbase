import path from 'path';

export type SafeNotePath =
  | { ok: true; filePath: string; targetDir: string }
  | { ok: false; reason: string };

/**
 * Resolves a note's target directory and file path against the configured
 * vault root, rejecting anything that would resolve outside it (`..`
 * segments, absolute-path injection, or platform-specific separator tricks).
 * Uses the platform-native `path` module deliberately — traversal must be
 * judged by the same resolution rules the eventual `fs` write will use.
 */
export function resolveSafeNotePath(
  vaultPath: string,
  folder: string | undefined,
  fileName: string,
): SafeNotePath {
  const vaultRoot = path.resolve(vaultPath);
  const targetDir = folder ? path.resolve(vaultRoot, folder) : vaultRoot;

  const relDir = path.relative(vaultRoot, targetDir);
  if (relDir.startsWith('..') || path.isAbsolute(relDir)) {
    return { ok: false, reason: 'path_escapes_vault' };
  }

  const filePath = path.resolve(targetDir, fileName);
  const relFile = path.relative(vaultRoot, filePath);
  if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
    return { ok: false, reason: 'path_escapes_vault' };
  }

  return { ok: true, filePath, targetDir };
}
