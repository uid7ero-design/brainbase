import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { embed }      from '../../../lib/brain/embedder';
import { search }     from '../../../lib/brain/store';
import { readConfig } from '../../../lib/brain/config';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const anthropicClient = new Anthropic();

const SYSTEM = `You are Helena — a sophisticated AI assistant for Brainbase, a voice-first executive command centre.

CRITICAL RULE: Respond with a valid JSON object ONLY. No text before or after the JSON. No markdown code blocks.

Required JSON schema (all fields mandatory):
{
  "response": "What you say aloud. Plain speech, no markdown, under 3 sentences.",
  "intent": "answer | command | memory | navigation | error",
  "action": "none | open_chat | close_chat | open_sidebar | close_sidebar | open_panel | close_panel | navigate | clear_chat | show_memory | spotify_control | task_add | task_complete | task_clear | scout_search",
  "target": "none | chat | sidebar | panel | dashboard | memory | analytics | settings | integrations | play | pause | next | prev | status | <task text for task_add/task_complete>",
  "memory_update": null | { "type": "long | short | preference", "key": "string", "fact": "string" }
}

Personality: calm, intelligent, executive-ready. Short confident sentences. Think JARVIS.
Capabilities: Scout (research/leads), Flux (content/digests), Relay (comms/drafts), Inbox (replies).
Scout: when asked to research, find leads, search for companies, or gather intelligence, use scout_search with the search query as target. Scout runs asynchronously — tell the user it's running, don't wait for results.
You can control the dashboard: open/close panels, navigate sections, remember facts about the user.
Spotify: when asked to play, pause, skip, go back, or about what's playing, use spotify_control with target play/pause/next/prev. For status questions, answer from context and use action none.
Tasks: when asked to add a task, use task_add with the task description as target. When asked to complete/mark done, use task_complete with partial text as target. When asked to clear done tasks, use task_clear.

EXAMPLES — match this format exactly:

Input: "What can you do?"
{"response":"I coordinate Scout for research, Flux for content, Relay for communications, and Inbox for replies. What do you need?","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Open the chat"
{"response":"Chat is open.","intent":"command","action":"open_chat","target":"chat","memory_update":null}

Input: "Show me analytics"
{"response":"Navigating to Analytics now.","intent":"navigation","action":"navigate","target":"analytics","memory_update":null}

Input: "Remember I prefer morning briefings"
{"response":"Noted — I'll keep briefings in the morning for you.","intent":"memory","action":"none","target":"none","memory_update":{"type":"preference","key":"briefing_time","fact":"prefers morning briefings"}}

Input: "Show me my memory"
{"response":"Opening your memory manager.","intent":"command","action":"show_memory","target":"memory","memory_update":null}

Input: "Pause the music"
{"response":"Pausing your music.","intent":"command","action":"spotify_control","target":"pause","memory_update":null}

Input: "Skip this song"
{"response":"Skipping track.","intent":"command","action":"spotify_control","target":"next","memory_update":null}

Input: "Go back"
{"response":"Going to previous track.","intent":"command","action":"spotify_control","target":"prev","memory_update":null}

Input: "Play music"
{"response":"Resuming playback.","intent":"command","action":"spotify_control","target":"play","memory_update":null}

Input: "What's playing?"
{"response":"Currently playing Song Name by Artist.","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Scout, find AI consulting leads in London"
{"response":"On it — Scout is searching for AI consulting leads in London now.","intent":"command","action":"scout_search","target":"AI consulting leads in London","memory_update":null}

Input: "Find me SaaS companies hiring engineers"
{"response":"Launching Scout to find SaaS companies hiring engineers.","intent":"command","action":"scout_search","target":"SaaS companies hiring engineers","memory_update":null}`;

type HelenaResponse = {
  response: string;
  intent: string;
  action: string;
  target: string;
  memory_update: { type: string; key: string; fact: string } | null;
};

function parseResponse(raw: string): HelenaResponse {
  const defaults: HelenaResponse = {
    response: "I'm having trouble right now.",
    intent: 'error',
    action: 'none',
    target: 'none',
    memory_update: null,
  };

  if (!raw?.trim()) return defaults;

  // Try direct parse
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

  // Try extracting JSON from surrounding text
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

  // Plain text fallback — treat entire response as spoken text
  return { ...defaults, response: raw.trim().slice(0, 300), intent: 'answer' };
}

function buildSystem(memoryContext?: string, spotifyContext?: string, brainContext?: string, taskContext?: string): string {
  let s = SYSTEM;
  if (memoryContext?.trim())  s += `\n\n[Helena's memory]\n${memoryContext}`;
  if (spotifyContext?.trim()) s += `\n\n[Spotify]\n${spotifyContext}`;
  if (taskContext?.trim())    s += `\n\n[Tasks]\n${taskContext}`;
  if (brainContext?.trim())   s += `\n\n[Relevant notes from your brain]\n${brainContext}`;
  return s;
}

async function callOllama(
  messages: Array<{ role: string; content: string }>,
  memoryContext?: string,
  spotifyContext?: string,
  brainContext?: string,
  taskContext?: string,
): Promise<string> {
  const systemContent = buildSystem(memoryContext, spotifyContext, brainContext, taskContext);

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: [{ role: 'system', content: systemContent }, ...messages.slice(-14)],
      stream:   false,
      format:   'json',
      options:  { temperature: 0.7, num_predict: 300 },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

async function callClaude(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  memoryContext?: string,
  spotifyContext?: string,
  brainContext?: string,
  taskContext?: string,
): Promise<string> {
  const systemContent = buildSystem(memoryContext, spotifyContext, brainContext, taskContext);

  const msg = await anthropicClient.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system:     systemContent,
    messages:   messages.slice(-14),
  });
  return msg.content[0].type === 'text' ? msg.content[0].text : '';
}

async function getBrainContext(query: string): Promise<string> {
  try {
    const cfg = readConfig();
    if (!cfg.vaultPath) return '';
    // Race the Ollama embed call against a 500ms timeout — never block Helena
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('brain-timeout')), 500)
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

export async function POST(req: NextRequest) {
  const { messages, memoryContext, spotifyContext, taskContext } = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    memoryContext?: string;
    spotifyContext?: string;
    taskContext?: string;
  };

  // Query the brain with the latest user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const brainContext = await getBrainContext(lastUserMsg);

  let raw = '';
  let source = 'claude';

  try {
    raw = await callClaude(messages, memoryContext, spotifyContext, brainContext, taskContext);
  } catch (err) {
    console.warn('[Helena] Claude unavailable, falling back to Ollama:', (err as Error).message);
    source = 'ollama';
    try {
      raw = await callOllama(messages, memoryContext, spotifyContext, brainContext, taskContext);
    } catch (ollamaErr) {
      console.error('[Helena] Ollama fallback failed:', ollamaErr);
      return Response.json({
        response: "I'm having trouble connecting right now.",
        intent: 'error', action: 'none', target: 'none', memory_update: null, source: 'error',
      });
    }
  }

  return Response.json({ ...parseResponse(raw), source });
}
