import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const TAVILY_KEY = process.env.TAVILY_API_KEY ?? '';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  if (!TAVILY_KEY) throw new Error('TAVILY_API_KEY not set');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: 'basic',
      max_results: 8,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? []) as TavilyResult[];
}

export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string };
  if (!query?.trim()) {
    return Response.json({ error: 'query required' }, { status: 400 });
  }

  let results: TavilyResult[];
  try {
    results = await tavilySearch(query);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }

  if (!results.length) {
    return Response.json({ summary: 'No results found.', leads: [], insights: [] });
  }

  const snippets = results
    .slice(0, 6)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 300)}`)
    .join('\n\n');

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `You are Scout, a business intelligence agent. Analyse web search results and respond with ONLY valid JSON — no markdown, no prose.

Schema:
{
  "summary": "2-sentence executive summary",
  "leads": [{ "company": "string", "signal": "string", "action": "string" }],
  "insights": ["string"]
}

leads: up to 4 items. signal = why they're relevant. action = recommended next step.
insights: up to 3 strategic observations.`,
    messages: [{
      role: 'user',
      content: `Query: "${query}"\n\nSearch results:\n${snippets}`,
    }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';

  let parsed: { summary: string; leads: { company: string; signal: string; action: string }[]; insights: string[] };
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    parsed = { summary: raw.slice(0, 200), leads: [], insights: [] };
  }

  return Response.json({ ...parsed, query, resultCount: results.length });
}
