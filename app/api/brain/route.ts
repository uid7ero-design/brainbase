import { NextRequest } from 'next/server';
import { readConfig, writeConfig } from '../../../lib/brain/config';
import { syncVault, startWatcher, getSyncStatus } from '../../../lib/brain/watcher';
import { getStats, clearStore, isFilesystemAvailable } from '../../../lib/brain/store';

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

const SAFE_STATUS = { state: 'idle' as const, message: 'Not available', indexed: 0 };
const SAFE_STATS  = { chunks: 0, files: 0 };

const instanceStartTime                        = Date.now();
const fallbackCounters: Record<string, number> = {};

const classifyRate = (rate: number) => {
  if (rate > 1)    return 'critical';
  if (rate > 0.1)  return 'high';
  if (rate > 0.01) return 'elevated';
  if (rate > 0)    return 'low';
  return 'none';
};

function recordFallback(reason: string) {
  fallbackCounters[reason] = (fallbackCounters[reason] ?? 0) + 1;
  console.warn('[BRAIN FALLBACK]', { reason, at: new Date().toISOString() });
  if (fallbackCounters[reason] % 10 === 0) {
    const uptimeMs      = Date.now() - instanceStartTime;
    const uptimeSeconds = uptimeMs / 1000;
    const rates    = Object.fromEntries(
      Object.entries(fallbackCounters).map(([r, c]) => [r, uptimeSeconds > 0 ? +(c / uptimeSeconds).toFixed(4) : 0])
    );
    const severity = Object.fromEntries(
      Object.entries(rates).map(([r, rate]) => [r, classifyRate(rate)])
    );
    console.warn('[FALLBACK SUMMARY]', {
      service:       'brain',
      counts:        fallbackCounters,
      rates,
      severity,
      instanceStart: instanceStartTime,
      uptimeMs,
    });
  }
}

export async function GET() {
  try {
    const cfg    = readConfig();
    const status = getSyncStatus();
    const stats  = getStats();

    if (!isFilesystemAvailable()) {
      recordFallback('filesystem_unavailable');
      return Response.json({
        vaultPath: null,
        status:    SAFE_STATUS,
        stats:     SAFE_STATS,
        debug:     { source: 'fallback', reason: 'filesystem_unavailable' },
      });
    }

    return Response.json({ vaultPath: cfg.vaultPath, status, stats });
  } catch (err: unknown) {
    console.error('[BRAIN ERROR]', err);
    recordFallback('exception');
    return Response.json({
      vaultPath: null,
      status:    SAFE_STATUS,
      stats:     SAFE_STATS,
      debug:     { source: 'fallback', reason: 'exception' },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
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
      syncVault(cfg.vaultPath).catch(console.error);
      return Response.json({ ok: true });
    }

    if (body.action === 'forget') {
      clearStore();
      writeConfig({ vaultPath: null });
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[BRAIN ERROR]', err);
    return Response.json({ error: 'Brain unavailable' }, { status: 500 });
  }
}
