import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import sql from '@/lib/db'
import { buildSystemPrompt } from '@/lib/hlna/prompt'
import { getCurrentOrgId } from '@/lib/org'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'

async function getLeadContext() {
  try {
    const [totals] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS this_week
      FROM leads
    `
    const recent = await sql`
      SELECT name, email, created_at
      FROM leads
      ORDER BY created_at DESC
      LIMIT 5
    `
    return {
      total: totals.total as number,
      thisWeek: totals.this_week as number,
      recent: recent as Array<{ name: string; email: string; created_at: string }>,
    }
  } catch {
    return undefined
  }
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json()

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const orgId = getCurrentOrgId()
  const leads = await getLeadContext()
  const systemPrompt = buildSystemPrompt(orgId, { leads })

  const stream = await client.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  })

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(event.delta.text))
        }
      }
      controller.close()
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
    },
  })
}
