const KEYS = {
  shortTerm: 'helena:short',
  longTerm:  'helena:long',
  prefs:     'helena:prefs',
  history:   'helena:history',
};

function safeRead(key, fallback = []) {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function safeWrite(key, data) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

export const memoryManager = {
  // ── Write ────────────────────────────────────────────────────────
  remember(fact, type = 'long') {
    const key = type === 'short' ? KEYS.shortTerm : KEYS.longTerm;
    const items = safeRead(key);
    items.push({ fact, ts: Date.now() });
    safeWrite(key, items.slice(-50));
  },

  forget(query) {
    for (const key of [KEYS.shortTerm, KEYS.longTerm]) {
      safeWrite(key, safeRead(key).filter(i => !i.fact.toLowerCase().includes(query.toLowerCase())));
    }
  },

  setPreference(key, value) {
    safeWrite(KEYS.prefs, { ...safeRead(KEYS.prefs, {}), [key]: value });
  },

  logExchange(userText, assistantText) {
    const history = safeRead(KEYS.history);
    history.push({ user: userText, assistant: assistantText, ts: Date.now() });
    safeWrite(KEYS.history, history.slice(-60));
  },

  // ── Read ─────────────────────────────────────────────────────────
  getLongTerm(n = 50)  { return safeRead(KEYS.longTerm).slice(-n); },
  getShortTerm(n = 20) { return safeRead(KEYS.shortTerm).slice(-n); },
  getPreferences()     { return safeRead(KEYS.prefs, {}); },
  getRecentHistory(n = 8) { return safeRead(KEYS.history).slice(-n); },

  getContext() {
    const long  = safeRead(KEYS.longTerm).slice(-8).map(m => m.fact);
    const short = safeRead(KEYS.shortTerm).slice(-5).map(m => m.fact);
    const prefs = safeRead(KEYS.prefs, {});
    const lines = [];
    if (long.length)  lines.push(`Long-term: ${long.join('; ')}`);
    if (short.length) lines.push(`Recent: ${short.join('; ')}`);
    const pe = Object.entries(prefs);
    if (pe.length)    lines.push(`Preferences: ${pe.map(([k, v]) => `${k}=${v}`).join('; ')}`);
    return lines.join('\n');
  },

  // ── Delete ───────────────────────────────────────────────────────
  forgetLongTerm(ts)  { safeWrite(KEYS.longTerm,  safeRead(KEYS.longTerm).filter(i => i.ts !== ts)); },
  forgetShortTerm(ts) { safeWrite(KEYS.shortTerm, safeRead(KEYS.shortTerm).filter(i => i.ts !== ts)); },

  removePreference(key) {
    const prefs = safeRead(KEYS.prefs, {});
    delete prefs[key];
    safeWrite(KEYS.prefs, prefs);
  },

  clearLongTerm()    { safeWrite(KEYS.longTerm,  []); },
  clearShortTerm()   { safeWrite(KEYS.shortTerm, []); },
  clearPreferences() { safeWrite(KEYS.prefs, {}); },
  clearHistory()     { safeWrite(KEYS.history, []); },

  clearAll() {
    Object.values(KEYS).forEach(k => { try { localStorage.removeItem(k); } catch {} });
  },
};
