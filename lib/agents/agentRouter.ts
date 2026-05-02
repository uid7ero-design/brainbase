import Anthropic from '@anthropic-ai/sdk';
import type { AgentInput } from './types';

const anthropic = new Anthropic();

export type AgentRoute = 'dataIntake' | 'insight' | 'action' | 'briefing' | 'social' | 'chat';

export interface RouterResult {
  agent: AgentRoute;
  confidence: number;
  reason: string;
}

const SYSTEM = `You are a routing classifier for a municipal council AI assistant.

Given a user query, decide which specialist agent should handle it.

Agents:
- dataIntake: User is uploading data, asking about file processing, column mapping, or import validation. E.g. "summarise this upload", "what columns does this have", "check my CSV"
- insight: User wants trend analysis, anomaly detection, outlier investigation, root cause analysis, or "why did/has X happen". E.g. "why did costs spike", "what caused the increase", "why are missed bins increasing", "what's driving this"
- action: User wants recommended actions, prioritised next steps, or "what should we do". E.g. "what should I do about fleet", "what are our next steps", "how can we fix this", "recommend actions"
- briefing: User wants a morning briefing, executive summary, status update, or "what changed". E.g. "brief me", "what changed this week", "catch me up", "give me the morning briefing", "what's the status"
- chat: Everything else — navigation, commands, factual lookups, Spotify, tasks, calendar, general questions

Return valid JSON only:
{ "agent": "dataIntake|insight|action|briefing|chat", "confidence": 0.0-1.0, "reason": "one short phrase" }`;

const ROUTE_KEYWORDS: Record<AgentRoute, RegExp> = {
  dataIntake: /\b(upload|import|csv|xlsx|spreadsheet|column|mapping|file|intake|ingest)\b/i,
  insight:    /\b(trend|anomal|outli|spike|increas|decreas|pattern|detect|analys|insight|correlat)\b|why (is|are|did|has|have|hasn|aren|isn|were|was)|root cause|what caused|what.s causing|cost driver/i,
  action:     /\b(recommend|priorit|resolve)\b|what should (i|we)|next step|what to do|how (do|can|should) (i|we)|what (do|can|should) (i|we) do|fix this/i,
  briefing:   /\b(brief|briefing|morning|overview|digest)\b|what changed|what.s changed|status update|bring me up|catch me up|update me|summarise (today|this week|this month|performance)/i,
  social:     /\b(instagram|social media|social post|engagement|comment|sentiment|follower|reach|impression|hashtag|content strateg|caption)\b|what.?s? people saying|show social|social insight|best.?post|worst.?post|what (should|can) (we|i) post|has sentiment|people.?s? opinion|public (opinion|sentiment|reaction)|social (performance|intelligence|analytic)/i,
  chat:       /.*/,
};

function heuristicRoute(query: string): AgentRoute {
  for (const [route, re] of Object.entries(ROUTE_KEYWORDS) as [AgentRoute, RegExp][]) {
    if (route !== 'chat' && re.test(query)) return route;
  }
  return 'chat';
}

export async function route(input: AgentInput): Promise<RouterResult> {
  const query = input.query?.trim() ?? '';
  if (!query) return { agent: 'chat', confidence: 1, reason: 'no query' };

  // Fast heuristic for obvious cases — skip LLM call
  const heuristic = heuristicRoute(query);
  if (heuristic !== 'chat') {
    return { agent: heuristic, confidence: 0.85, reason: 'keyword match' };
  }

  // LLM classification for ambiguous queries
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 128,
      system: SYSTEM,
      messages: [{ role: 'user', content: query }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as RouterResult;
      if (['dataIntake', 'insight', 'action', 'briefing', 'social', 'chat'].includes(parsed.agent)) {
        return parsed;
      }
    }
  } catch { /* fall through to default */ }

  return { agent: 'chat', confidence: 0.7, reason: 'default' };
}
