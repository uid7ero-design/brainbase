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

export async function POST(request: Request) {
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

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      return Response.json(
        { error: `Upstream responded with HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data: unknown = await res.json();

    if (!path) {
      return Response.json({ value: JSON.stringify(data) });
    }

    const value = extractPath(data, path);
    return Response.json({ value });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
