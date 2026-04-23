// Verbs that mean "open"
const OPEN  = '(?:open|show|pull up|bring up|expand|launch|display|go to|take me to|navigate to|switch to)';
// Verbs that mean "close"
const CLOSE = '(?:close|hide|dismiss|shut|collapse|exit|get rid of)';
// Optional filler words
const THE   = '(?:the\\s+|my\\s+|a\\s+)?';

const COMMANDS = [
  // ── Chat ──────────────────────────────────────────────────────────
  { pattern: new RegExp(`\\b${OPEN}\\s+${THE}(?:chat|conversation|messages|text input)\\b`, 'i'), action: 'open_chat' },
  { pattern: new RegExp(`\\b${CLOSE}\\s+${THE}(?:chat|conversation|messages)\\b`, 'i'),           action: 'close_chat' },

  // ── Sidebar ───────────────────────────────────────────────────────
  { pattern: new RegExp(`\\b${OPEN}\\s+${THE}(?:sidebar|side bar|side panel|nav|navigation)\\b`, 'i'), action: 'open_sidebar' },
  { pattern: new RegExp(`\\b${CLOSE}\\s+${THE}(?:sidebar|side bar|side panel|nav|navigation)\\b`, 'i'), action: 'close_sidebar' },

  // ── Activity panel ────────────────────────────────────────────────
  { pattern: new RegExp(`\\b${OPEN}\\s+${THE}(?:activity|panel|right panel|feed)\\b`, 'i'), action: 'open_panel' },
  { pattern: new RegExp(`\\b${CLOSE}\\s+${THE}(?:activity|panel|right panel|feed)\\b`, 'i'), action: 'close_panel' },

  // ── Memory panel ─────────────────────────────────────────────────
  { pattern: new RegExp(`\\b${OPEN}\\s+${THE}(?:memory|memories|memory manager)\\b`, 'i'), action: 'show_memory' },
  { pattern: /\b(?:what do you remember|what have you remembered|show me what you know)\b/i, action: 'show_memory' },

  // ── Navigation ───────────────────────────────────────────────────
  { pattern: /\b(?:go to|show|open|take me to|navigate to|switch to)\s+(?:the\s+)?(?:main\s+)?dashboard\b/i, action: 'nav', target: 'Dashboard' },
  { pattern: /\b(?:go to|show|open|take me to|navigate to|switch to)\s+(?:the\s+)?(?:memory|memories)\b/i,   action: 'nav', target: 'Memory' },
  { pattern: /\b(?:go to|show|open|take me to|navigate to|switch to)\s+(?:the\s+)?analytics\b/i,             action: 'nav', target: 'Analytics' },
  { pattern: /\b(?:go to|show|open|take me to|navigate to|switch to)\s+(?:the\s+)?settings\b/i,              action: 'nav', target: 'Settings' },
  { pattern: /\b(?:go to|show|open|take me to|navigate to|switch to)\s+(?:the\s+)?integrations?\b/i,         action: 'nav', target: 'Integrations' },

  // ── Memory operations ─────────────────────────────────────────────
  { pattern: /\bremember\s+(?:that\s+)?(?:this[:\s]+)?(.+)/i,              action: 'remember' },
  { pattern: /\bmake a note\s+(?:that\s+)?(.+)/i,                          action: 'remember' },
  { pattern: /\bdon't forget\s+(?:that\s+)?(.+)/i,                         action: 'remember' },
  { pattern: /\bforget\s+(?:about\s+|that\s+|everything about\s+)?(.+)/i,  action: 'forget' },
  { pattern: /\bclear\s+(?:your\s+|all\s+)?memory\b/i,                     action: 'clear_memory' },

  // ── Chat management ───────────────────────────────────────────────
  { pattern: /\b(?:clear|reset|wipe|start over)\s+(?:the\s+)?(?:chat|history|conversation|messages)\b/i, action: 'clear_chat' },

  // ── Tasks ─────────────────────────────────────────────────────────
  { pattern: /\b(?:add|create|new)\s+(?:a\s+)?task[:\s]+(.+)/i,                          action: 'task_add' },
  { pattern: /\b(?:make a note|note down|write down|don't forget to)[:\s]+(.+)/i,        action: 'task_add' },
  { pattern: /\b(?:mark|check off|complete|done with|finished|finish)\s+(?:task\s+)?(.+)/i, action: 'task_complete' },
  { pattern: /\bclear\s+(?:completed|done|finished)\s+tasks?\b/i,                        action: 'task_clear' },
  { pattern: /\b(?:show|list|what are)\s+(?:my\s+)?tasks?\b/i,                           action: 'task_list' },
];

export function parseCommand(text) {
  const t = text.trim();
  for (const cmd of COMMANDS) {
    const match = t.match(cmd.pattern);
    if (match) return { ...cmd, match, text: t };
  }
  return null;
}

// Extract entity names from text (agent, section, target)
export function extractEntity(text) {
  const agentMatch = text.match(/\b(scout|flux|relay|inbox)\b/i);
  const navMatch   = text.match(/\b(dashboard|memory|analytics|settings|integrations)\b/i);
  return {
    agent: agentMatch ? agentMatch[1].toLowerCase() : null,
    nav:   navMatch   ? navMatch[1].charAt(0).toUpperCase() + navMatch[1].slice(1).toLowerCase() : null,
  };
}
