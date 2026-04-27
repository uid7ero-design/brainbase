import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { embed }      from '../../../lib/brain/embedder';
import { search }     from '../../../lib/brain/store';
import { readConfig } from '../../../lib/brain/config';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const anthropicClient = new Anthropic();

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
Capabilities: Scout (research/leads), Flux (content/digests), Relay (comms/drafts), Inbox (replies).
Scout: when asked to research, find leads, search for companies, or gather intelligence, use scout_search with the search query as target. Scout runs asynchronously — tell the user it's running, don't wait for results.
You can control the dashboard: open/close panels, navigate sections, remember facts about the user.
Spotify: when asked to play, pause, skip, go back, or about what's playing, use spotify_control with target play/pause/next/prev. For status questions, answer from context and use action none.
Tasks: when asked to add a task, use task_add with the task description as target. When asked to complete/mark done, use task_complete with partial text as target. When asked to clear done tasks, use task_clear.

Dashboard navigation: this is a municipal council operations platform with 12 service dashboards. To navigate to one, use action "navigate" with the slug as target. Available dashboards:
fleet, waste, water, roads, parks, environment, labour, facilities, logistics, supply, depot, construction.

Input: "Take me to fleet" or "Open the fleet dashboard" or "Go to vehicles"
{"response":"Opening Fleet dashboard now.","intent":"navigation","action":"navigate","target":"fleet","memory_update":null}

Input: "Show me waste" or "Go to waste management" or "Open waste"
{"response":"Navigating to Waste Management.","intent":"navigation","action":"navigate","target":"waste","memory_update":null}

Input: "Take me to roads" or "Open construction" or "Go to the environment dashboard"
{"response":"Opening Roads dashboard.","intent":"navigation","action":"navigate","target":"roads","memory_update":null}

Dashboard questions: when the user asks about data or metrics on the current dashboard (e.g. "what's our fuel spend?", "which zone has the highest contamination?", "how many vehicles are overdue?"), read the [Current dashboard] context and answer with specific figures. Be concise and cite numbers directly.
CRITICAL: The [Current dashboard] context IS the live data feed. Never say you cannot see, read, or access data — if [Current dashboard] is present, use it and answer directly. If a specific figure is not in the context, say what you do know and flag what is not available.

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
{"response":"Launching Scout to find SaaS companies hiring engineers.","intent":"command","action":"scout_search","target":"SaaS companies hiring engineers","memory_update":null}

Calendar: when asked about today's schedule, read events from [Google Calendar — today's events] context and answer conversationally. When asked to create/add/schedule a calendar event, use calendar_create. The target MUST be pipe-separated: "TITLE|YYYY-MM-DD|HH:MM|DURATION_MINUTES". If date is not specified use today. If time is not specified omit it (leave blank between pipes). Duration defaults to 60 minutes if unspecified.

Input: "What's on my calendar today?"
{"response":"You have three events today: standup at 9am, lunch with Sarah at noon, and a client call at 3pm.","intent":"answer","action":"none","target":"none","memory_update":null}

Input: "Schedule a team meeting tomorrow at 2pm for 90 minutes"
{"response":"Scheduling team meeting tomorrow at 2pm for 90 minutes.","intent":"command","action":"calendar_create","target":"Team Meeting|2026-04-25|14:00|90","memory_update":null}

Input: "Add dentist appointment next Monday at 10am"
{"response":"Adding dentist appointment for Monday at 10am.","intent":"command","action":"calendar_create","target":"Dentist Appointment|2026-04-27|10:00|60","memory_update":null}

Notes: when asked to save, create, write, or store a note, document, or file, use note_create. The target MUST be pipe-separated: "TITLE|FOLDER|content". FOLDER is optional (leave blank for root vault). Content is the body of the note — write it in full. NEVER say you saved a file without using note_create. The file will be saved instantly to the user's vault.

Input: "Save a note about the Q2 strategy"
{"response":"Saving a note about Q2 strategy to your vault now.","intent":"command","action":"note_create","target":"Q2 Strategy||Notes on Q2 strategy.","memory_update":null}

Input: "Create a file called Platform Brief with a summary of what we discussed"
{"response":"Creating Platform Brief in your vault.","intent":"command","action":"note_create","target":"Platform Brief||This document summarises the platform discussion.","memory_update":null}

Input: "Write a note about the meeting in the Projects folder"
{"response":"Writing that note to your Projects folder now.","intent":"command","action":"note_create","target":"Meeting Notes|10-Projects|Notes from the meeting.","memory_update":null}`;

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

function buildSystem(memoryContext?: string, spotifyContext?: string, brainContext?: string, taskContext?: string, calendarContext?: string, dashboardContext?: string): string {
  let s = SYSTEM;
  if (memoryContext?.trim())    s += `\n\n[Helena's memory]\n${memoryContext}`;
  if (spotifyContext?.trim())   s += `\n\n[Spotify]\n${spotifyContext}`;
  if (taskContext?.trim())      s += `\n\n[Tasks]\n${taskContext}`;
  if (brainContext?.trim())     s += `\n\n[Relevant notes from your brain]\n${brainContext}`;
  if (calendarContext?.trim())  s += `\n\n[Google Calendar — today's events]\n${calendarContext}`;
  if (dashboardContext?.trim()) s += `\n\n[Current dashboard]\n${dashboardContext}`;
  return s;
}

async function callOllama(
  messages: Array<{ role: string; content: string }>,
  memoryContext?: string,
  spotifyContext?: string,
  brainContext?: string,
  taskContext?: string,
  calendarContext?: string,
  dashboardContext?: string,
): Promise<string> {
  const systemContent = buildSystem(memoryContext, spotifyContext, brainContext, taskContext, calendarContext, dashboardContext);

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
  calendarContext?: string,
  dashboardContext?: string,
): Promise<string> {
  const systemContent = buildSystem(memoryContext, spotifyContext, brainContext, taskContext, calendarContext, dashboardContext);

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
  const { messages, memoryContext, spotifyContext, taskContext, calendarContext, dashboardContext } = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    memoryContext?: string;
    spotifyContext?: string;
    taskContext?: string;
    calendarContext?: string;
    dashboardContext?: string;
  };

  // Query the brain — cap at 150ms so it never delays the LLM call
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const brainContext = await Promise.race([
    getBrainContext(lastUserMsg),
    new Promise<string>(resolve => setTimeout(() => resolve(''), 150)),
  ]);

  let raw = '';
  let source = 'claude';

  try {
    raw = await callClaude(messages, memoryContext, spotifyContext, brainContext, taskContext, calendarContext, dashboardContext);
  } catch (err) {
    console.warn('[Helena] Claude unavailable, falling back to Ollama:', (err as Error).message);
    source = 'ollama';
    try {
      raw = await callOllama(messages, memoryContext, spotifyContext, brainContext, taskContext, calendarContext, dashboardContext);
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
