import { NextRequest } from 'next/server';
import { readConfig, writeConfig } from '../../../lib/brain/config';
import { syncVault, startWatcher, getSyncStatus } from '../../../lib/brain/watcher';
import { getStats, clearStore } from '../../../lib/brain/store';

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

async function ensureEmbedModel() {
  try {
    await fetch(`${OLLAMA_URL}/api/pull`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: EMBED_MODEL, stream: false }),
      signal:  AbortSignal.timeout(300000),
    });
  } catch (e) {
    console.warn('[Brain] Could not pull embed model:', e);
  }
}

export async function GET() {
  const cfg    = readConfig();
  const status = getSyncStatus();
  const stats  = getStats();
  return Response.json({ vaultPath: cfg.vaultPath, status, stats });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: string; vaultPath?: string };

  if (body.action === 'configure' && body.vaultPath) {
    writeConfig({ vaultPath: body.vaultPath });
    ensureEmbedModel().then(() => {
      startWatcher(body.vaultPath!);
      syncVault(body.vaultPath!).catch(console.error);
    }).catch(console.error);
    return Response.json({ ok: true });
  }

  if (body.action === 'sync') {
    const cfg = readConfig();
    if (!cfg.vaultPath) return Response.json({ error: 'No vault path set' }, { status: 400 });
    syncVault(cfg.vaultPath).catch(console.error); // non-blocking
    return Response.json({ ok: true });
  }

  if (body.action === 'forget') {
    clearStore();
    writeConfig({ vaultPath: null });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
