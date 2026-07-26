import { requireSession } from '@/lib/org';
import { checkDestination, parseAllowedHosts } from '@/lib/ssrfGuard';
import { checkRateLimit } from '@/lib/rateLimit';

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024; // 256KB — streamed cap, not just Content-Length

function extractPath(obj: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return '—'; // em dash for null/missing
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === null || current === undefined) {
    return '—';
  }

  if (typeof current === 'number') {
    return String(Math.round(current * 100) / 100);
  }

  return String(current);
}

/** Reads a response body up to a hard byte cap, aborting the stream if exceeded. */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { url?: string; path?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url, path } = body;

  if (!url) {
    return Response.json({ error: 'Missing required field: url' }, { status: 400 });
  }

  const rateKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'metrics';
  if (!checkRateLimit(`metrics:${rateKey}`, 60, 15 * 60_000)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '900' } },
    );
  }

  const allowedHosts = parseAllowedHosts(process.env.METRICS_ALLOWED_HOSTS);
  const destinationCheck = await checkDestination(url, allowedHosts);
  if (destinationCheck.blocked) {
    // Deliberately generic — never echo the internal reason/resolved address to the caller.
    return Response.json({ error: 'Destination not permitted' }, { status: 403 });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error', // reject redirect-based bypass of the destination check
    });
  } catch {
    return Response.json({ error: 'Request failed' }, { status: 502 });
  }

  if (!res.ok) {
    return Response.json({ error: 'Request failed' }, { status: 502 });
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return Response.json({ error: 'Unsupported response type' }, { status: 502 });
  }

  const text = await readCapped(res, MAX_RESPONSE_BYTES);
  if (text === null) {
    return Response.json({ error: 'Response too large or empty' }, { status: 502 });
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid response format' }, { status: 502 });
  }

  if (!path) {
    return Response.json({ value: JSON.stringify(data) });
  }

  const value = extractPath(data, path);
  return Response.json({ value });
}
