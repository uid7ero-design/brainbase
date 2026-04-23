import fs   from 'fs';
import path  from 'path';
import { cosine } from './embedder';
import type { Chunk } from './chunker';

const STORE_DIR  = path.join(process.cwd(), '.brainbase');
const STORE_FILE = path.join(STORE_DIR, 'vectors.json');

type Entry = Chunk & { embedding: number[]; mtime: number };

type Store = { entries: Entry[] };

let cache: Store | null = null;

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

export function loadStore(): Store {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) { cache = { entries: [] }; return cache; }
  try {
    cache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    cache = { entries: [] };
  }
  return cache!;
}

export function saveStore() {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(cache ?? { entries: [] }));
}

export function upsertChunks(chunks: (Chunk & { embedding: number[]; mtime: number })[]) {
  const store = loadStore();
  const fileToRemove = chunks[0]?.file;
  if (fileToRemove) {
    store.entries = store.entries.filter(e => e.file !== fileToRemove);
  }
  store.entries.push(...chunks);
  saveStore();
}

export function removeFile(filePath: string) {
  const store = loadStore();
  store.entries = store.entries.filter(e => e.file !== filePath);
  saveStore();
}

export function getMtime(filePath: string): number {
  const store = loadStore();
  const entries = store.entries.filter(e => e.file === filePath);
  return entries[0]?.mtime ?? 0;
}

export function search(queryEmbedding: number[], topK = 3): (Chunk & { score: number })[] {
  const store = loadStore();
  return store.entries
    .map(e => ({ ...e, score: cosine(queryEmbedding, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getStats() {
  const store = loadStore();
  const files = new Set(store.entries.map(e => e.file));
  return { chunks: store.entries.length, files: files.size };
}

export function clearStore() {
  cache = { entries: [] };
  saveStore();
}
