import fs   from 'fs';
import path  from 'path';
import { embed }         from './embedder';
import { chunkMarkdown } from './chunker';
import { upsertChunks, removeFile, getMtime } from './store';

// Module-level singleton that survives Next.js hot reloads
const g = global as typeof global & { __brainWatcher?: unknown; __brainSyncing?: boolean };

export type SyncStatus = { state: 'idle' | 'syncing' | 'error'; message: string; indexed: number };
let status: SyncStatus = { state: 'idle', message: 'Not started', indexed: 0 };

export function getSyncStatus() { return status; }

async function indexFile(filePath: string) {
  try {
    const stat    = fs.statSync(filePath);
    const mtime   = stat.mtimeMs;
    if (getMtime(filePath) === mtime) return; // unchanged

    const content  = fs.readFileSync(filePath, 'utf8');
    const chunks   = chunkMarkdown(filePath, content);
    const embedded = [];
    for (const c of chunks) {
      const embedding = await embed(c.text);
      embedded.push({ ...c, embedding, mtime });
    }
    upsertChunks(embedded);
    status.indexed++;
  } catch (err) {
    console.error('[Brain] indexFile error:', filePath, err);
  }
}

export async function syncVault(vaultPath: string) {
  if (g.__brainSyncing) return;
  g.__brainSyncing = true;
  status = { state: 'syncing', message: 'Scanning vault…', indexed: 0 };

  try {
    const files = walkMarkdown(vaultPath);
    status.message = `Embedding ${files.length} files…`;
    for (const f of files) await indexFile(f);
    status = { state: 'idle', message: `Indexed ${files.length} files`, indexed: files.length };
  } catch (err) {
    status = { state: 'error', message: String(err), indexed: status.indexed };
  } finally {
    g.__brainSyncing = false;
  }
}

export function startWatcher(vaultPath: string) {
  if (g.__brainWatcher) {
    (g.__brainWatcher as { close(): void }).close();
  }

  // Lazy-require chokidar to avoid SSR issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chokidar = require('chokidar');
  const watcher = chokidar.watch(path.join(vaultPath, '**/*.md'), {
    ignoreInitial: true,
    persistent:    true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('add',    (f: string) => { indexFile(f).catch(console.error); });
  watcher.on('change', (f: string) => { indexFile(f).catch(console.error); });
  watcher.on('unlink', (f: string) => { removeFile(f); });

  g.__brainWatcher = watcher;
  console.log('[Brain] Watching vault:', vaultPath);
}

function walkMarkdown(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
    }
  }
  walk(dir);
  return results;
}
