import { loadStore } from '../../../../lib/brain/store';
import { cosine }    from '../../../../lib/brain/embedder';

const LINK_THRESHOLD = 0.50; // minimum similarity to draw an edge
const MAX_LINKS_PER_NODE = 8;

export async function GET() {
  const store = loadStore();

  // Group chunks by file and average their embeddings
  const fileMap = new Map<string, { label: string; embeddings: number[][]; chunks: number }>();
  for (const entry of store.entries) {
    const label = entry.file.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? entry.file;
    if (!fileMap.has(entry.file)) {
      fileMap.set(entry.file, { label, embeddings: [], chunks: 0 });
    }
    const f = fileMap.get(entry.file)!;
    f.embeddings.push(entry.embedding);
    f.chunks++;
  }

  if (fileMap.size === 0) return Response.json({ nodes: [], links: [] });

  // Compute per-file average embedding
  const files = Array.from(fileMap.entries()).map(([id, f]) => ({
    id,
    label: f.label,
    chunks: f.chunks,
    embedding: avgEmbedding(f.embeddings),
  }));

  // Compute pairwise similarities, keep strongest links per node
  const linkCandidates: { source: string; target: string; strength: number }[] = [];
  for (let i = 0; i < files.length; i++) {
    const sims: { j: number; sim: number }[] = [];
    for (let j = i + 1; j < files.length; j++) {
      const sim = cosine(files[i].embedding, files[j].embedding);
      if (sim >= LINK_THRESHOLD) sims.push({ j, sim });
    }
    sims.sort((a, b) => b.sim - a.sim);
    for (const { j, sim } of sims.slice(0, MAX_LINKS_PER_NODE)) {
      linkCandidates.push({ source: files[i].id, target: files[j].id, strength: sim });
    }
  }

  const nodes = files.map(({ id, label, chunks }) => ({ id, label, chunks }));
  return Response.json({ nodes, links: linkCandidates });
}

function avgEmbedding(embeddings: number[][]): number[] {
  if (embeddings.length === 1) return embeddings[0];
  const len = embeddings[0].length;
  const avg = new Array(len).fill(0);
  for (const e of embeddings) for (let i = 0; i < len; i++) avg[i] += e[i];
  for (let i = 0; i < len; i++) avg[i] /= embeddings.length;
  return avg;
}
