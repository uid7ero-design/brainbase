import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { embed }      from '../../../lib/brain/embedder';
import { search }     from '../../../lib/brain/store';
import { readConfig } from '../../../lib/brain/config';
import { requireSession } from '../../../lib/org';
import { DB_SCHEMA, executeQuery, formatQueryResult } from '../../../lib/hlna/dataEngine';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const anthropicClient = new Anthropic();

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are Helena — a sophisticated AI assistant for Brainbase, a voice-first executive command centre for municipal council operations.

CRITICAL RULE: Respond with a valid JSON object ONLY. No text before or after the JSON. No markdown code blocks.

Required JSON schema (all fields mandatory):
{
  "response": "What you say aloud. Plain speech, no markdown. For dashboard explanations or data questions use up to 6 sentences — cover the headline numbers, any risks or flags, and one recommendation. For commands and navigation use 1 sentence.",
  "intent": "answer | command | memory | navigation | error",
  "action": "none | open_chat | close_chat | open_sidebar | close_sidebar | open_panel | close_panel | navigate | clear_chat | show_memory | spotify_control | task_add | task_complete | task_clear | scout_search | calendar_create | note_create",
  "target": "none | chat | sidebar | panel | memory | analytics | settings | integrations | play | pause | next | prev | status | fleet | waste | water | roads | parks | environment | labour | facilities | logistics | supply | depot | construction | <task text for task_add/task_complete> | <TITLE|YYYY-MM-DD|HH:MM|DURATION_MINUTES for calendar_create> | <TITLE|FOLDER|content for note_create>",
  "memory_update": null | { "type": "long | short | preference", "key": "string", "fact": "string" }
}

Personality: calm, intelligent, executive-ready. Short confident sentences. Think JARVIS.
Capabilities: Data Scan (research/intelligence), Weekly Digest (content/summaries), Queue (comms/workflows), Inbox (replies).
Data Scan: when asked to research, find information, scan data, or gather intelligence, use scout_search with the search query as target. Data Scan runs asynchronously — tell the user it's running, don't wait for results.
You can control the dashboard: open/close panels, navigate sections, remember facts about the user.
Spotify: when asked to play, pause, skip, go back, or about what's playing, use spotify_control with target play/pause/next/prev. For status questions, answer from context and use action none.
Tasks: when asked to add a task, use task_add with the task description as target. When asked to complete/mark done, use task_complete with partial text as target. When asked to clear done tasks, use task_clear.

Dashboard navigation: this is a municipal council operations platform with 12 service dashboards. To navigate to one, use action "navigate" with the slug as target. Available dashboards:
fleet, waste, water, roads, parks, environment, labour, facilities, logistics, supply, depot, construction.

Input: "Take me to fleet" or "Open the fleet dashboard" or "Go to vehicles"
{"response":"Opening Fleet dashboard now.","intent":"navigation","action":"navigate","target":"fleet","memory_update":null}

Input: "Show me waste" or "Go to waste management" or "Open waste"
{"response":"Navigating to Waste Management.","intent":"navigation","action":"navigate","target":"waste","memory_update":null}

Dashboard questions: when the user asks about data or metrics on the current dashboard (e.g. "what's our fuel spend?", "which zone has the highest contamination?", "how many vehicles are overdue?"), read the [Current dashboard] context and answer with specific figures. Be concise and cite numbers directly.
CRITICAL: The [Current dashboard] context IS the live data feed. Never say you cannot see, read, or access data — if [Current dashboard] is present, use it and answer directly. If a specific figure is not in the context, say what you do know and flag what is not available.

Data analysis: when you have access to the query_database tool, use it for any question requiring live data beyond what's in the dashboard context — trend analysis, cross-period comparisons, anomaly investigation, cost driver breakdowns, etc. After receiving query results, synthesise the ANALYTICS section into your spoken response. Cite specific numbers. Lead with the headline finding, then 2-3 supporting facts, then a recommendation if relevant.

EXAMPLES — match this format exactly:

Input: "What can you do?"
{"response":"I coordinate Scout for research, Flux for content, Relay for communications, and Inbox for replies. What do you need?","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Open the chat"
{"response":"Chat is open.","intent":"command","action":"open_chat","target":"chat","memory_update":null}

Input: "Show me analytics"
{"response":"Navigating to Analytics now.","intent":"navigation","action":"navigate","target":"analytics","memory_update":null}

Input: "Remember I prefer morning briefings"
{"response":"Noted — I'll keep briefings in the morning for you.","intent":"memory","action":"none","target":"none","memory_update":{"type":"preference","key":"briefing_time","fact":"prefers morning briefings"}}

Input: "Pause the music"
{"response":"Pausing your music.","intent":"command","action":"spotify_control","target":"pause","memory_update":null}

Input: "Why are missed bins increasing?"
{"response":"Based on the data, missed bin collections have risen 18% since January — highest in the Marden and Heathpool zones. The main driver is route capacity: collections per run dropped from 420 to 348 while scheduled lifts stayed flat. I'd recommend a route audit for those two suburbs before the next collection cycle.","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Show cost drivers this month"
{"response":"Fuel is your top cost driver at 34% of fleet spend, followed by wages at 28%. Maintenance jumped 22% month-on-month — TRK-002 and TRK-008 are the outliers there. Total operational cost sits at $412,000 against a $380,000 budget.","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Summarise performance"
{"response":"Fleet availability is at 88%, below the 92% target — TRK-002 extended downtime is the main drag. Waste contamination averages 9.2% across suburbs, with Heathpool at 13.7%, well above the 8% threshold. Service request resolution is on track at 94% closed within SLA. Three actions need your attention: overdue servicing on 6 vehicles, the Heathpool contamination spike, and the fuel overspend.","intent":"answer","action":"none","target":"none","memory_update":null}

Calendar: when asked about today's schedule, read events from [Google Calendar — today's events] context and answer conversationally. When asked to create/add/schedule a calendar event, use calendar_create. The target MUST be pipe-separated: "TITLE|YYYY-MM-DD|HH:MM|DURATION_MINUTES". If date is not specified use today. If time is not specified omit it (leave blank between pipes). Duration defaults to 60 minutes if unspecified.

Notes: when asked to save, create, write, or store a note, document, or file, use note_create. The target MUST be pipe-separated: "TITLE|FOLDER|content". FOLDER is optional (leave blank for root vault). Content is the body of the note — write it in full. NEVER say you saved a file without using note_create.`;

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildDataTools(orgId: string): Anthropic.Tool[] {
  return [{
    name: 'query_database',
    description: `Query the organisation's live operational database. Use this when the user asks about:
- Costs, budgets, or financial performance
- Trends over time (increasing/decreasing metrics)
- Anomalies, spikes, or outliers
- Comparisons between suburbs, vehicles, periods, or service types
- "Why" questions that need data evidence
- Any factual question about operational numbers not in the current dashboard context

Write clean PostgreSQL SELECT queries. Always include WHERE organisation_id = '${orgId}'.
Results will include computed TREND and ANOMALY annotations — use these in your response.
${DB_SCHEMA}`,
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: `A PostgreSQL SELECT query. Must include organisation_id = '${orgId}' in WHERE clause. Use LIMIT 50 unless aggregating. Month values: Jul Aug Sep Oct Nov Dec Jan Feb Mar Apr May Jun.`,
        },
        reasoning: {
          type: 'string',
          description: 'One sentence: what question this query answers.',
        },
      },
      required: ['sql', 'reasoning'],
    },
  }];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type HelenaResponse = {
  response: string;
  intent: string;
  action: string;
  target: string;
  memory_update: { type: string; key: string; fact: string } | null;
};

export type QueryAnalysis = {
  dataSources: string[];
  rowsQueried: number;
  trend: string | null;
  anomaly: string | null;
  confidence: 'High' | 'Medium' | 'Low';
  timestamp: string;
};

// ─── Analysis helpers ─────────────────────────────────────────────────────────

function extractTables(rawSql: string): string[] {
  const fromMatches = rawSql.match(/\bFROM\s+(\w+)/gi) ?? [];
  const joinMatches = rawSql.match(/\bJOIN\s+(\w+)/gi)  ?? [];
  const all = [...fromMatches, ...joinMatches].map(m => m.replace(/\b(FROM|JOIN)\s+/i, '').toLowerCase());
  const skip = new Set(['users','organisations','uploaded_files','dual']);
  return [...new Set(all.filter(t => !skip.has(t)))];
}

function extractAnalytics(content: string, rowCount: number): Pick<QueryAnalysis, 'trend' | 'anomaly' | 'confidence'> {
  const trendLine   = content.match(/TREND: (.+)/)?.[1]?.trim()   ?? null;
  const anomalyLine = content.match(/ANOMALY: (.+)/)?.[1]?.trim() ?? null;
  const confidence  = rowCount >= 30 ? 'High' : rowCount >= 5 ? 'Medium' : 'Low';
  return { trend: trendLine, anomaly: anomalyLine, confidence };
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw: string): HelenaResponse {
  const defaults: HelenaResponse = {
    response: "I'm having trouble right now.",
    intent: 'error', action: 'none', target: 'none', memory_update: null,
  };
  if (!raw?.trim()) return defaults;
  try {
    const p = JSON.parse(raw);
    return {
      response:      typeof p.response === 'string' ? p.response : defaults.response,
      intent:        typeof p.intent   === 'string' ? p.intent   : 'answer',
      action:        typeof p.action   === 'string' ? p.action   : 'none',
      target:        typeof p.target   === 'string' ? p.target   : 'none',
      memory_update: p.memory_update ?? null,
    };
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const p = JSON.parse(match[0]);
      return {
        response:      typeof p.response === 'string' ? p.response : raw.trim().slice(0, 200),
        intent:        p.intent        || 'answer',
        action:        p.action        || 'none',
        target:        p.target        || 'none',
        memory_update: p.memory_update || null,
      };
    } catch {}
  }
  return { ...defaults, response: raw.trim().slice(0, 300), intent: 'answer' };
}

// ─── System builder ───────────────────────────────────────────────────────────

function buildSystem(
  memoryContext?: string, spotifyContext?: string, brainContext?: string,
  taskContext?: string, calendarContext?: string, dashboardContext?: string,
  orgId?: string,
): string {
  let s = SYSTEM;
  if (memoryContext?.trim())    s += `\n\n[Helena's memory]\n${memoryContext}`;
  if (spotifyContext?.trim())   s += `\n\n[Spotify]\n${spotifyContext}`;
  if (taskContext?.trim())      s += `\n\n[Tasks]\n${taskContext}`;
  if (brainContext?.trim())     s += `\n\n[Relevant notes from your brain]\n${brainContext}`;
  if (calendarContext?.trim())  s += `\n\n[Google Calendar — today's events]\n${calendarContext}`;
  if (dashboardContext?.trim()) s += `\n\n[Current dashboard]\n${dashboardContext}`;
  if (orgId)                    s += `\n\n[Organisation ID for database queries]\n${orgId}\nAlways include WHERE organisation_id = '${orgId}' in every SQL query.`;
  return s;
}

// ─── Ollama fallback (no tool use) ────────────────────────────────────────────

async function callOllama(
  messages: Array<{ role: string; content: string }>,
  systemContent: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: [{ role: 'system', content: systemContent }, ...messages.slice(-14)],
      stream:   false,
      format:   'json',
      options:  { temperature: 0.7, num_predict: 400 },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

// ─── Claude with agentic tool-use loop ───────────────────────────────────────

async function callClaude(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  memoryContext?: string,
  spotifyContext?: string,
  brainContext?: string,
  taskContext?: string,
  calendarContext?: string,
  dashboardContext?: string,
  orgId?: string,
): Promise<{ text: string; analysis: QueryAnalysis | null }> {
  const systemContent = buildSystem(
    memoryContext, spotifyContext, brainContext,
    taskContext, calendarContext, dashboardContext, orgId,
  );
  const tools = orgId ? buildDataTools(orgId) : undefined;

  type MsgParam = Anthropic.Messages.MessageParam;
  let msgs: MsgParam[] = messages.slice(-14).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Accumulate analysis across all tool calls
  let allTables:   string[]  = [];
  let totalRows    = 0;
  let trendNote:   string | null = null;
  let anomalyNote: string | null = null;
  let usedTool     = false;

  // Up to 4 iterations: initial call + 3 tool-use rounds
  for (let iter = 0; iter < 4; iter++) {
    const resp = await anthropicClient.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     systemContent,
      messages:   msgs,
      ...(tools ? { tools } : {}),
    });

    // No tool use — return the text response
    if (resp.stop_reason !== 'tool_use') {
      const block = resp.content.find(b => b.type === 'text');
      const text = block?.type === 'text' ? block.text : '';
      const analysis: QueryAnalysis | null = usedTool ? {
        dataSources: allTables,
        rowsQueried: totalRows,
        trend:       trendNote,
        anomaly:     anomalyNote,
        confidence:  totalRows >= 30 ? 'High' : totalRows >= 5 ? 'Medium' : 'Low',
        timestamp:   new Date().toISOString(),
      } : null;
      return { text, analysis };
    }

    // Execute all tool calls in parallel
    const toolUseBlocks = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block): Promise<Anthropic.Messages.ToolResultBlockParam> => {
        let content: string;
        try {
          const { sql: rawSql } = block.input as { sql: string; reasoning: string };
          const result = await executeQuery(rawSql, orgId!);
          content = formatQueryResult(result);
          // Collect analysis data
          usedTool = true;
          allTables = [...new Set([...allTables, ...extractTables(rawSql)])];
          totalRows += result.rowCount;
          const a = extractAnalytics(content, result.rowCount);
          if (a.trend    && !trendNote)   trendNote   = a.trend;
          if (a.anomaly  && !anomalyNote) anomalyNote = a.anomaly;
        } catch (err) {
          content = `Query failed: ${(err as Error).message}`;
        }
        return { type: 'tool_result', tool_use_id: block.id, content };
      }),
    );

    msgs = [
      ...msgs,
      { role: 'assistant', content: resp.content },
      { role: 'user',      content: toolResults },
    ];
  }

  // Fallback: force a final text response if max iterations reached
  const final = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500, system: systemContent, messages: msgs,
  });
  const block = final.content.find(b => b.type === 'text');
  const text = block?.type === 'text' ? block.text : '';
  const analysis: QueryAnalysis | null = usedTool ? {
    dataSources: allTables,
    rowsQueried: totalRows,
    trend:       trendNote,
    anomaly:     anomalyNote,
    confidence:  totalRows >= 30 ? 'High' : totalRows >= 5 ? 'Medium' : 'Low',
    timestamp:   new Date().toISOString(),
  } : null;
  return { text, analysis };
}

// ─── Brain context ────────────────────────────────────────────────────────────

async function getBrainContext(query: string): Promise<string> {
  try {
    const cfg = readConfig();
    if (!cfg.vaultPath) return '';
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('brain-timeout')), 500),
    );
    const qEmbed  = await Promise.race([embed(query), timeout]);
    const results = search(qEmbed, 3);
    if (!results.length) return '';
    const relevant = results.filter(r => r.score > 0.4);
    if (!relevant.length) return '';
    return relevant.map(r => `[${r.heading}]\n${r.text}`).join('\n\n---\n\n');
  } catch {
    return '';
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const {
    messages, memoryContext, spotifyContext, taskContext, calendarContext, dashboardContext,
  } = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    memoryContext?: string;
    spotifyContext?: string;
    taskContext?: string;
    calendarContext?: string;
    dashboardContext?: string;
  };

  // Resolve org for data queries — graceful if unauthenticated
  let orgId: string | undefined;
  try {
    const session = await requireSession();
    orgId = session.organisationId;
  } catch { /* not logged in — HLNA works without DB access */ }

  // Brain context — capped so it never blocks
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const brainContext = await Promise.race([
    getBrainContext(lastUserMsg),
    new Promise<string>(resolve => setTimeout(() => resolve(''), 150)),
  ]);

  let raw = '';
  let source = 'claude';
  let analysis: QueryAnalysis | null = null;

  try {
    const result = await callClaude(
      messages, memoryContext, spotifyContext, brainContext,
      taskContext, calendarContext, dashboardContext, orgId,
    );
    raw      = result.text;
    analysis = result.analysis;
  } catch (err) {
    console.warn('[Helena] Claude unavailable, falling back to Ollama:', (err as Error).message);
    source = 'ollama';
    try {
      const sys = buildSystem(memoryContext, spotifyContext, brainContext, taskContext, calendarContext, dashboardContext);
      raw = await callOllama(messages, sys);
    } catch (ollamaErr) {
      console.error('[Helena] Ollama fallback failed:', ollamaErr);
      return Response.json({
        response: "I'm having trouble connecting right now.",
        intent: 'error', action: 'none', target: 'none', memory_update: null, source: 'error',
      });
    }
  }

  return Response.json({ ...parseResponse(raw), source, analysis });
}
