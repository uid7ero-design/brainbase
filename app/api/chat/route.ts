import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { embed }      from '../../../lib/brain/embedder';
import { search }     from '../../../lib/brain/store';
import { readConfig } from '../../../lib/brain/config';
import { getAuthSession } from '../../../lib/authSession';
import { DB_SCHEMA, executeQuery, formatQueryResult } from '../../../lib/hlna/dataEngine';
import { buildModuleContext } from '../../../lib/hlna/modules';
import { route as routeToAgent } from '@/lib/agents/agentRouter';
import * as insightAgent   from '@/lib/agents/insightAgent';
import * as actionAgent    from '@/lib/agents/actionAgent';
import * as briefingAgent  from '@/lib/agents/briefingAgent';
import * as socialAgent    from '@/lib/agents/socialAgent';
import type { AgentOutput } from '@/lib/agents/types';
import sql from '@/lib/db';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const anthropicClient = new Anthropic();

const LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID ?? '';

// ─── System prompts ───────────────────────────────────────────────────────────

const TENNIS_SYSTEM = `You are an AI assistant for a tennis coaching business.

You ONLY work with:
- leads
- contacts
- bookings

You DO NOT reference:
- waste data
- fleet data
- council operations

Your job is to help the coach manage clients and grow their business.

Examples of what you help with:
- "How many new clients this week?"
- "Who needs follow-up?"
- "Show recent leads"
- "Which session types are most popular?"

Always base answers on available data. If data is missing, say so clearly.`;

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

Notes: when asked to save, create, write, or store a note, document, or file, use note_create. The target MUST be pipe-separated: "TITLE|FOLDER|content". FOLDER is optional (leave blank for root vault). Content is the body of the note — write it in full. NEVER say you saved a file without using note_create.

Confidence-aware language: adapt your certainty of expression based on the data confidence level provided in context.
- High confidence (≥30 rows): use assertive, direct language. "Costs are up 14%." "The main driver is…" "This suburb is the outlier."
- Medium confidence (5–29 rows): use balanced language. "Costs appear to be up around 14%." "The likely driver is…" "This suburb looks like the outlier."
- Low confidence (<5 rows): use cautious language. "With limited data, costs may be trending up." "It's not yet clear — more data would help." Do not make strong claims.
If no confidence level is specified, default to Medium.

DATA RESPONSE RULES — mandatory for all data, operations, and analytics questions:
- NEVER output these phrases: "No data available", "Insufficient input", "No actionable findings", "I cannot access data", "I don't have access to"
- If [Live operational data] is present: always derive specific insights from it — even for vague questions, infer what matters
- If [Live operational data] contains NO_DATA: respond exactly "I don't see any uploaded data yet. Upload a dataset and I'll analyse it immediately."
- Active voice always: "I analysed...", "I found...", "I recommend..." — never passive constructions

Data question response structure (write as flowing speech, no literal section headers):
1. Name the specific entity (suburb name, vehicle ID, service type) and its exact metric
2. Explain the operational implication in one sentence
3. State the risk if unaddressed in one sentence
4. Give a concrete action naming the exact entity
Always reference at least 2 specific named entities from the data. Banned phrases: "multiple areas", "several suburbs", "various locations", "generally speaking", "overall trend".`;

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

const DEPT_QUERY_HINT: Record<string, string> = {
  waste:            `Use table: waste_records (add WHERE department = 'Waste'). Key columns: service_type, suburb, month, tonnes, collections, contamination_rate, cost.`,
  fleet:            `Use table: fleet_metrics. Key columns: vehicle_id, vehicle_type, km, fuel, maintenance, downtime_hours, defects, services, month.`,
  customer_service: `Use table: service_requests. Key columns: request_id, service_type, suburb, status, priority, days_open, cost.`,
  compliance:       `Use table: service_requests (filter service_type or status for compliance items). Also check waste_records and fleet_metrics as needed.`,
  parks:            `Use table: waste_records (filter department = 'Parks & Gardens') or service_requests. Check available data first.`,
  roads:            `Use table: service_requests (filter service_type = 'Roads' or similar). Check available data first.`,
};

function buildSystem(
  memoryContext?: string, spotifyContext?: string, brainContext?: string,
  taskContext?: string, calendarContext?: string, dashboardContext?: string,
  liveDataContext?: string,
  orgId?: string, moduleKey?: string, userContext?: string, viewMode?: string,
  department?: string,
): string {
  const isLDTennis = !!orgId && LD_TENNIS_ORG_ID && orgId === LD_TENNIS_ORG_ID;
  console.log('HLNA orgId:', orgId);
  console.log('Using prompt:', isLDTennis ? 'TENNIS' : 'DEFAULT');

  if (isLDTennis) {
    let s = TENNIS_SYSTEM;
    if (memoryContext?.trim()) s += `\n\n[Memory]\n${memoryContext}`;
    return s;
  }

  let s = SYSTEM;
  if (moduleKey?.trim()) {
    const ctx = buildModuleContext(moduleKey);
    if (ctx) s += `\n\n${ctx}`;
  }
  if (department?.trim()) {
    const deptKey = department.toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');
    const queryHint = DEPT_QUERY_HINT[deptKey] ?? `Check available tables and filter by department = '${department}' where applicable.`;
    s += `\n\n[Active department: ${department}]
The operator is currently viewing the ${department} department dashboard.
CRITICAL — when using query_database, only return data for the ${department} department unless the user explicitly asks for cross-department analysis.
${queryHint}
Do NOT surface metrics or data from other departments in this context (e.g. no contamination rates when viewing Fleet, no vehicle downtime when viewing Waste) unless directly asked.`;
  }
  if (userContext?.trim()) {
    s += `\n\n[Operator profile]\n${userContext}\nAdapt your response focus: super_admin/admin → strategic summary, cost impact, cross-module trends; manager → operational alerts, specific actions, detail; viewer → clear plain-English summary, no jargon.`;
  }
  if (viewMode === 'operational') {
    s += `\n\n[View mode: Operational]\nThe operator is in Operational view. Prioritise: specific vehicle/suburb/asset names, step-by-step actions, granular metrics, who should act and when. Avoid executive summaries — they want drill-down detail.`;
  } else {
    s += `\n\n[View mode: Executive]\nThe operator is in Executive view. Prioritise: headline KPIs, cost impact, cross-module trends, strategic risk. Keep responses concise — lead with the most important finding, follow with one recommendation.`;
  }
  if (memoryContext?.trim())    s += `\n\n[Helena's memory]\n${memoryContext}`;
  if (spotifyContext?.trim())   s += `\n\n[Spotify]\n${spotifyContext}`;
  if (taskContext?.trim())      s += `\n\n[Tasks]\n${taskContext}`;
  if (brainContext?.trim())     s += `\n\n[Relevant notes from your brain]\n${brainContext}`;
  if (calendarContext?.trim())  s += `\n\n[Google Calendar — today's events]\n${calendarContext}`;
  if (dashboardContext?.trim()) s += `\n\n[Current dashboard]\n${dashboardContext}`;

  // Live operational data — always injected from DB, takes precedence for data questions
  if (liveDataContext?.trim()) {
    if (liveDataContext.startsWith('NO_DATA:')) {
      s += `\n\n[Live operational data]\nNO DATA uploaded yet for this organisation. For any question about metrics, costs, performance, or operations, respond exactly: "I don't see any uploaded data yet. Upload a dataset and I'll analyse it immediately."`;
    } else {
      s += `\n\n[Live operational data — answer data questions directly from this]\n${liveDataContext}`;
    }
  }

  if (orgId) s += `\n\n[Organisation ID for database queries]\n${orgId}\nAlways include WHERE organisation_id = '${orgId}' in every SQL query.`;
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
  liveDataContext?: string,
  orgId?: string,
  moduleKey?: string,
  userContext?: string,
  viewMode?: string,
  department?: string,
): Promise<{ text: string; analysis: QueryAnalysis | null }> {
  const systemContent = buildSystem(
    memoryContext, spotifyContext, brainContext,
    taskContext, calendarContext, dashboardContext, liveDataContext,
    orgId, moduleKey, userContext, viewMode, department,
  );
  const tools = (orgId && !(LD_TENNIS_ORG_ID && orgId === LD_TENNIS_ORG_ID)) ? buildDataTools(orgId) : undefined;

  type MsgParam = Anthropic.Messages.MessageParam;
  let msgs: MsgParam[] = messages.slice(-14).map(m => ({
    role: m.role,
    content: m.content,
  }));

  let allTables:   string[]  = [];
  let totalRows    = 0;
  let trendNote:   string | null = null;
  let anomalyNote: string | null = null;
  let usedTool     = false;

  for (let iter = 0; iter < 4; iter++) {
    const resp = await anthropicClient.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     systemContent,
      messages:   msgs,
      ...(tools ? { tools } : {}),
    });

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

// ─── Proactive data preload ───────────────────────────────────────────────────

async function preloadOrgData(orgId: string): Promise<string> {
  try {
    const [wasteAgg, wasteSuburbs, fleetAgg, fleetVehicles, srAgg, srAreas] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS n,
               ROUND(SUM(cost))::bigint AS total_cost,
               ROUND(SUM(tonnes)::numeric,0)::bigint AS total_tonnes,
               ROUND(AVG(contamination_rate)::numeric,1)::float AS avg_contamination
        FROM waste_records WHERE organisation_id = ${orgId}
      `,
      sql`
        SELECT suburb,
               ROUND(SUM(cost))::bigint AS cost,
               ROUND(AVG(contamination_rate)::numeric,1)::float AS contamination
        FROM waste_records WHERE organisation_id = ${orgId}
        GROUP BY suburb ORDER BY cost DESC LIMIT 5
      `,
      sql`
        SELECT COUNT(*)::int AS n,
               ROUND(SUM(fuel+maintenance+wages+repairs))::bigint AS total_cost,
               SUM(defects)::int AS total_defects,
               COUNT(DISTINCT vehicle_id)::int AS vehicle_count
        FROM fleet_metrics WHERE organisation_id = ${orgId}
      `,
      sql`
        SELECT vehicle_id,
               SUM(defects)::int AS defects,
               ROUND(SUM(fuel+maintenance+repairs))::bigint AS cost
        FROM fleet_metrics WHERE organisation_id = ${orgId}
        GROUP BY vehicle_id ORDER BY defects DESC, cost DESC LIMIT 5
      `,
      sql`
        SELECT COUNT(*)::int AS n,
               COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open,
               COUNT(CASE WHEN priority='High' AND status='Open' THEN 1 END)::int AS high_open,
               ROUND(AVG(CASE WHEN status='Open' THEN days_open END)::numeric,1)::float AS avg_days
        FROM service_requests WHERE organisation_id = ${orgId}
      `,
      sql`
        SELECT suburb, COUNT(*)::int AS open
        FROM service_requests WHERE organisation_id = ${orgId} AND status='Open'
        GROUP BY suburb ORDER BY open DESC LIMIT 5
      `,
    ]);

    const wn  = Number(wasteAgg[0]?.n ?? 0);
    const fn  = Number(fleetAgg[0]?.n ?? 0);
    const srn = Number(srAgg[0]?.n ?? 0);

    console.log(`[CHAT] rows found — waste_records: ${wn}, fleet_metrics: ${fn}, service_requests: ${srn}`);
    if (wn  === 0) console.warn(`[CHAT] ⚠ 0 rows in waste_records for org ${orgId}`);
    if (fn  === 0) console.warn(`[CHAT] ⚠ 0 rows in fleet_metrics for org ${orgId}`);
    if (srn === 0) console.warn(`[CHAT] ⚠ 0 rows in service_requests for org ${orgId}`);

    const parts: string[] = [];

    if (wn > 0) {
      const a = wasteAgg[0] ?? {};
      const suburbs = wasteSuburbs as { suburb: string; cost: number; contamination: number }[];
      const contamHot = suburbs.filter(s => Number(s.contamination) > 8)
        .map(s => `${s.suburb} (${s.contamination}%)`).join(', ');
      parts.push(
        `Waste Records (${wn} rows): Total cost $${Number(a.total_cost ?? 0).toLocaleString()}, ` +
        `${Number(a.total_tonnes ?? 0).toLocaleString()} tonnes, avg contamination ${a.avg_contamination ?? 0}% (target ≤8%). ` +
        `Top suburbs by cost: ${suburbs.map(s => `${s.suburb} ($${Number(s.cost).toLocaleString()})`).join(', ')}.` +
        (contamHot ? ` Suburbs exceeding 8% threshold: ${contamHot}.` : ''),
      );
    }

    if (fn > 0) {
      const a = fleetAgg[0] ?? {};
      const vehicles = fleetVehicles as { vehicle_id: string; defects: number; cost: number }[];
      const defectList = vehicles.filter(v => Number(v.defects) > 0)
        .map(v => `${v.vehicle_id} (${v.defects} defects, $${Number(v.cost).toLocaleString()})`).join(', ');
      parts.push(
        `Fleet Metrics (${fn} rows): Total cost $${Number(a.total_cost ?? 0).toLocaleString()}, ` +
        `${a.vehicle_count ?? 0} vehicles, ${a.total_defects ?? 0} defects recorded.` +
        (defectList ? ` Vehicles with defects: ${defectList}.` : ''),
      );
    }

    if (srn > 0) {
      const a = srAgg[0] ?? {};
      const areas = (srAreas as { suburb: string; open: number }[])
        .map(r => `${r.suburb} (${r.open} open)`).join(', ');
      parts.push(
        `Service Requests (${srn} rows): ${a.open ?? 0} open (${a.high_open ?? 0} high-priority), ` +
        `avg ${a.avg_days ?? 0} days open.` +
        (areas ? ` Highest-volume areas: ${areas}.` : ''),
      );
    }

    if (parts.length === 0) return 'NO_DATA: No operational data uploaded for this organisation.';
    return parts.join('\n');
  } catch (err) {
    console.error('[CHAT] preloadOrgData failed:', err);
    return '';
  }
}

// ─── Audit logging ────────────────────────────────────────────────────────────

function logAgentRun(
  organisationId: string,
  userId: string | undefined,
  agentName: string,
  routeType: string,
  inputQuery: string,
  confidence: number,
  sourceRows: number,
): void {
  sql`
    INSERT INTO agent_runs (organisation_id, user_id, agent_name, route_type, input_query, confidence, source_rows)
    VALUES (
      ${organisationId}::uuid,
      ${userId ?? null}::uuid,
      ${agentName},
      ${routeType},
      ${inputQuery},
      ${confidence},
      ${sourceRows}
    )
  `.catch(err => console.warn('[AgentRun log]', (err as Error).message));
}

// ─── Specialist agent dispatch ────────────────────────────────────────────────

function agentOutputToHelena(out: AgentOutput): string {
  const spokenSummary = [
    out.summary,
    out.findings.slice(0, 3).join(' '),
    out.recommendedActions.length
      ? `Recommended: ${out.recommendedActions[0]}`
      : '',
  ].filter(Boolean).join(' ');

  return JSON.stringify({
    response:      spokenSummary.slice(0, 600),
    intent:        'answer',
    action:        'none',
    target:        'none',
    memory_update: null,
    agentName:     out.agentName,
    confidence:    out.confidence,
    findings:      out.findings,
    warnings:      out.warnings,
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth — hard fail, no silent fallback
  let orgId: string;
  let userId: string;
  let userContext: string;
  try {
    const session = await getAuthSession();
    orgId       = session.organisationId;
    userId      = session.userId;
    userContext = `Role: ${session.role}, Name: ${session.name}`;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log('[CHAT] orgId:', orgId);

  const {
    messages, memoryContext, spotifyContext, taskContext, calendarContext, dashboardContext, moduleKey, viewMode, department,
  } = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    memoryContext?: string;
    spotifyContext?: string;
    taskContext?: string;
    calendarContext?: string;
    dashboardContext?: string;
    moduleKey?: string;
    viewMode?: string;
    department?: string;
  };

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';

  // Brain context — capped so it never blocks
  const brainContext = await Promise.race([
    getBrainContext(lastUserMsg),
    new Promise<string>(resolve => setTimeout(() => resolve(''), 150)),
  ]);

  // Proactive data preload — only for non-tennis orgs
  const isLDTennis = LD_TENNIS_ORG_ID && orgId === LD_TENNIS_ORG_ID;
  const liveDataContext = isLDTennis ? '' : await preloadOrgData(orgId);

  // Agent routing — dispatch to specialist agents for data-heavy queries
  if (lastUserMsg && !isLDTennis) {
    try {
      const routeResult = await routeToAgent({ organisationId: orgId, userId, query: lastUserMsg });
      if (routeResult.agent !== 'chat') {
        const agentInput = { organisationId: orgId, userId, department, query: lastUserMsg };
        let agentOut: AgentOutput | null = null;
        if (routeResult.agent === 'insight')  agentOut = await insightAgent.run(agentInput);
        if (routeResult.agent === 'action')   agentOut = await actionAgent.run(agentInput);
        if (routeResult.agent === 'briefing') agentOut = await briefingAgent.run(agentInput);
        if (routeResult.agent === 'social')   agentOut = await socialAgent.run(agentInput);
        if (agentOut) {
          logAgentRun(orgId, userId, agentOut.agentName, routeResult.agent, lastUserMsg, agentOut.confidence, agentOut.sourceRows.length);
          const agentRaw = agentOutputToHelena(agentOut);
          return Response.json({
            ...parseResponse(agentRaw),
            source:     agentOut.agentName,
            agentName:  agentOut.agentName,
            routeType:  routeResult.agent,
            confidence: agentOut.confidence,
            findings:   agentOut.findings,
            warnings:   agentOut.warnings,
            evidence:   agentOut.evidence ?? null,
            analysis:   null,
          });
        }
      }
    } catch (agentErr) {
      console.warn('[Helena] Agent routing failed, falling back to Claude:', (agentErr as Error).message);
    }
  }

  let raw = '';
  let source = 'claude';
  let analysis: QueryAnalysis | null = null;

  try {
    const result = await callClaude(
      messages, memoryContext, spotifyContext, brainContext,
      taskContext, calendarContext, dashboardContext, liveDataContext,
      orgId, moduleKey, userContext, viewMode, department,
    );
    raw      = result.text;
    analysis = result.analysis;
  } catch (err) {
    console.warn('[Helena] Claude unavailable, falling back to Ollama:', (err as Error).message);
    source = 'ollama';
    try {
      const sys = buildSystem(
        memoryContext, spotifyContext, brainContext, taskContext, calendarContext,
        dashboardContext, liveDataContext, undefined, moduleKey, userContext, viewMode, department,
      );
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
