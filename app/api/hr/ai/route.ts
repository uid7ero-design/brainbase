import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/org';
import { checkRateLimit } from '@/lib/rateLimit';
import { CapabilityAccessError, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { loadAiSafeHrContext } from '@/lib/hr/aiSafeContextLoader';
import { buildHrAiProviderInput, HR_AI_MAX_QUESTION_CHARS } from '@/lib/hr/aiProviderInput';
import { invokeHrAiProvider } from '@/lib/agents/hrAiProviderAdapter';

const MAX_BODY_BYTES = 16_384;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: { error: string } | { answer: string }, status: number, headers = {}) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  });
}

// Bound actual bytes, including chunked requests without Content-Length.
async function readBody(req: NextRequest): Promise<unknown> {
  if (!req.body) throw new Error('Missing body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** HR-8G: authenticated, read-only transport through the reviewed safe chain. */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); }
  catch { return reply({ error: 'Unauthorized' }, 401); }

  if (!checkRateLimit(`hr-ai:${JSON.stringify([session.organisationId, session.userId])}`, 20, 3_600_000)) {
    return reply({ error: 'Too many requests.' }, 429, { 'Retry-After': '3600' });
  }

  let body: unknown;
  try { body = await readBody(req); }
  catch { return reply({ error: 'Invalid HR assistant request.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply({ error: 'Invalid HR assistant request.' }, 400);
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'person_id' && key !== 'question')
    || typeof input.person_id !== 'string' || !UUID_RE.test(input.person_id)
    || typeof input.question !== 'string' || !input.question.trim()
    || input.question.trim().length > HR_AI_MAX_QUESTION_CHARS) {
    return reply({ error: 'Invalid HR assistant request.' }, 400);
  }

  try {
    const result = await loadAiSafeHrContext({ session, personId: input.person_id });
    if (result.outcome === 'not_found') {
      return reply({ error: 'HR record not found.' }, 404);
    }
    const providerInput = buildHrAiProviderInput({ question: input.question, context: result.context });
    const { text } = await invokeHrAiProvider(providerInput);
    return reply({ answer: text }, 200);
  } catch (error) {
    if (error instanceof CapabilityAccessError) {
      return reply({ error: 'HR record not found.' }, 404);
    }
    if (error instanceof CapabilityDatabaseError) {
      return reply({ error: 'HR assistant is temporarily unavailable.' }, 503);
    }
    // Never log raw HR context, questions, or provider/database exception details.
    return reply({ error: 'HR assistant is temporarily unavailable.' }, 502);
  }
}
