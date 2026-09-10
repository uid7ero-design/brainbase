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

// Phase D.4.6C — Organiser-intent guard, checked BEFORE any specialist-
// agent keyword match (including briefing's own "what changed"/"summarise
// today" patterns just below, which would otherwise intercept a genuine
// Organiser question — e.g. "what changed on Founder Tasks today?" — before
// it ever reaches Helena's general Claude tool-use loop, the ONLY place
// Organiser read tools (lib/organiser/helenaTools.ts) are wired in.
// briefingAgent has no Organiser awareness at all, so misrouting there
// silently drops the question instead of answering it.
//
// Deliberately a small, generic LEXICAL guard — organiser/board/item/
// group/task nouns only. Never DB-aware, never capability-aware (that gate
// lives at tool-registration time in app/api/chat/route.ts instead — a
// tenant without the organiser capability just gets Helena's normal
// general-chat answer, no different from any other unmatched query), and
// never board/item-NAME-aware (it cannot recognise "Founder Tasks" as a
// board name — it matches on the generic word "Tasks" instead, which is
// exactly why the word list stays generic rather than growing into a
// giant per-tenant keyword list).
//
// Known trade-off: "task" alone is ambiguous with Helena's own pre-existing
// personal to-do feature (task_add/task_complete — see hooks/useHelena.js's
// parseCommand). In practice this rarely matters: structured phrasings like
// "add a task: X" are intercepted by parseCommand client-side and never
// reach this router at all. For the rare natural-language phrasing that
// does reach here and happens to contain "task", the worst case is routing
// to 'chat' instead of a specialist agent (e.g. actionAgent) — Helena's
// general loop still answers reasonably without that specialist, which is
// a far softer failure than the bug this guard fixes (Organiser questions
// never reaching the tools that can answer them at all).
const ORGANISER_INTENT_RE = /\b(organiser|organizer|boards?|items?|groups?|tasks?)\b/i;

// Phase D.4.6C.1 — named-board routing accuracy. QA proved that a query
// naming a board WITHOUT any ORGANISER_INTENT_RE keyword (e.g. "What
// changed on WORK today?" — no "board"/"item"/"organiser" word) falls
// straight through to the 'briefing' keyword match below ("what changed"),
// which sends it to briefingAgent — an agent with zero Organiser awareness
// — before Helena's general tool-use loop (the only place
// lib/organiser/helenaTools.ts is wired in) ever sees it.
//
// This cannot be fixed with more keywords: "What changed on WORK today?"
// and "What changed across the business today?" are lexically identical
// shapes ("what changed <object> today") — only the semantic content of
// <object> differs, which a generic regex cannot resolve without either a
// hardcoded board-name list (explicitly disallowed) or a DB lookup
// (explicitly disallowed for this router). So this guard does not attempt
// to recognise a board NAME at all.
//
// Instead it reuses one safe, already-existing, non-DB boolean signal:
// input.organiserContext, set by app/api/chat/route.ts. When true, a query
// that would otherwise resolve to 'briefing' is redirected to 'chat'
// instead, since that is the one route demonstrated to misfire; every
// other route (dataIntake/insight/action/social) is left untouched, since
// QA never demonstrated a problem there and this guard does not expand
// beyond the proven gap.
//
// Phase D.4.6D — this boolean now has TWO possible sources, both resolved
// server-side in app/api/chat/route.ts, never here:
//  1. A real, tenant-validated current board/item (resolveHelenaOrganiserContext)
//     — the authoritative case: the operator is genuinely looking at that
//     Organiser location right now (today, only reachable from
//     app/organiser/page.tsx, which publishes it via useAppStore).
//  2. The D.4.6C.1 transitional fallback, moduleKey === 'organiser' — used
//     only when (1) doesn't apply (e.g. BrainBase.jsx's /dashboard module
//     switcher, which has no board/item of its own to resolve).
// This router still only ever sees the flattened boolean OR of the two —
// it remains exactly as narrow as it was in D.4.6C.1 (no DB access, no
// typed context, no board/item awareness of its own). See
// app/api/chat/route.ts's own comment at its organiserContext computation
// for the full precedence/rationale, and lib/organiser/helenaRead.ts's
// resolveHelenaOrganiserContext for the trust boundary.
function shouldOverrideToChat(route: AgentRoute, organiserContext: boolean | undefined): boolean {
  return !!organiserContext && route === 'briefing';
}

// Phase D.4.6M — comment-routing disambiguation guard, checked BEFORE the
// generic keyword heuristic below. Root cause: the `social` entry in
// ROUTE_KEYWORDS matches bare `comment` as one alternation term among many
// platform-specific nouns, with no requirement that an actual social-
// platform noun also be present. Object.entries() iteration order puts
// `social` before `chat`, so ANY message containing the word "comment" —
// including a short Organiser follow-up like "post another comment saying
// hello" once its board/item name has already been established, or a
// fully context-free "post a comment" — used to satisfy that regex and
// route straight to the social agent. shouldOverrideToChat() could not
// help, since it only ever overrides the 'briefing' route, never 'social'.
//
// This guard resolves bare "comment" wording using only signals already
// available to this router, never inventing new state:
//   - a query naming an explicit social-platform noun (instagram, an
//     actual platform name, or an unambiguous social-content phrase) is
//     NOT bare — it falls straight through to the ordinary heuristic
//     below, which still matches `social` exactly as before. Explicit
//     social intent always wins, including over an established Organiser
//     context (see ORGANISER_INTENT_RE's own priority above, and
//     EXPLICIT_SOCIAL_RE's check below — both run before this guard
//     changes anything for a query that also names a board/item, which
//     the ORGANISER_INTENT_RE branch above already routes to 'chat'
//     first).
//   - otherwise the word "comment" alone is genuinely ambiguous between
//     an Organiser comment and a social-media comment. `chat` — Helena's
//     own general tool-use loop, the SAME destination the
//     'organiser intent' guard above already uses — is the correct,
//     already-established safe destination for this: with an established
//     Organiser context (input.organiserContext, resolved server-side in
//     app/api/chat/route.ts — see its own header) the model has enough to
//     continue the Organiser tool flow (still gated by its own
//     auth/proposal/Confirm chain — this router grants no authority);
//     without one, the general loop is free to ask a short clarifying
//     question rather than this router silently guessing a domain, and
//     it can never invent an Organiser mutation target on its own (every
//     Organiser write still requires a real, tenant-scoped item lookup —
//     see proposeOrExecuteOrganiserComment's own item_not_found path).
const EXPLICIT_SOCIAL_RE = /\b(instagram|facebook|linkedin|twitter|tiktok)\b|social media|social post|content strateg|caption|hashtag/i;
const BARE_COMMENT_RE = /\bcomments?\b/i;

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

  // Organiser-intent guard — see the constant's own header above.
  if (ORGANISER_INTENT_RE.test(query)) {
    return { agent: 'chat', confidence: 0.9, reason: 'organiser intent' };
  }

  // Comment-routing disambiguation guard — see EXPLICIT_SOCIAL_RE/
  // BARE_COMMENT_RE's own header above. Only fires for bare "comment"
  // wording with no explicit social-platform noun; a query with both
  // (e.g. "post a comment on our Instagram post") falls through unchanged
  // to the ordinary heuristic below, which still routes 'social'.
  if (BARE_COMMENT_RE.test(query) && !EXPLICIT_SOCIAL_RE.test(query)) {
    return input.organiserContext
      ? { agent: 'chat', confidence: 0.85, reason: 'organiser context — comment routed to organiser' }
      : { agent: 'chat', confidence: 0.5, reason: 'ambiguous comment — routed to general chat for clarification' };
  }

  // Fast heuristic for obvious cases — skip LLM call
  const heuristic = heuristicRoute(query);
  if (heuristic !== 'chat') {
    if (shouldOverrideToChat(heuristic, input.organiserContext)) {
      return { agent: 'chat', confidence: 0.85, reason: 'organiser context — briefing override' };
    }
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
        if (shouldOverrideToChat(parsed.agent, input.organiserContext)) {
          return { agent: 'chat', confidence: parsed.confidence, reason: 'organiser context — briefing override' };
        }
        return parsed;
      }
    }
  } catch { /* fall through to default */ }

  return { agent: 'chat', confidence: 0.7, reason: 'default' };
}
