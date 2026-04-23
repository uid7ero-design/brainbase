'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { memoryManager } from '../lib/memory/memoryManager';
import { getTaskContext } from './useTasks';
import { parseCommand } from '../lib/actions/commandParser';
import { executeCommand, executeStructuredAction } from '../lib/actions/dashboardActions';
import { useAppStore } from '../lib/state/useAppStore';

export function useHelena() {
  const [messages, setMessages]             = useState([]);
  const [responding, setResponding]         = useState(false);
  const [listening, setListening]           = useState(false);
  const [transcript, setTranscript]         = useState('');
  const [wakeActive, setWakeActive]         = useState(false);
  const [conversational, setConversational] = useState(false);
  const [micError, setMicError]             = useState(null);

  const recogRef          = useRef(null);
  const wakeRecogRef      = useRef(null);
  const acRef             = useRef(null);
  const wakeEnabledRef    = useRef(false);
  const conversationalRef = useRef(false);
  const startListeningRef = useRef(null);
  const speechPulseRef    = useRef(null);
  const uttRef            = useRef(null);
  const transcriptRef     = useRef('');
  const spotifyContextRef = useRef('');
  const spotifyControlRef = useRef(null);
  const taskControlRef    = useRef(null);

  function getAC() {
    if (!acRef.current) acRef.current = new AudioContext();
    return acRef.current;
  }
  function unlockAudio() {
    const ac = getAC();
    if (ac.state === 'suspended') ac.resume();
  }

  function showMicError(msg) {
    setMicError(msg);
    setTimeout(() => setMicError(null), 3500);
  }

  // ── TTS ──────────────────────────────────────────────────────────
  // Prime speech synthesis (call synchronously inside a user gesture to keep Chrome happy)
  function primeSpeech() {
    try {
      const p = new SpeechSynthesisUtterance(' ');
      p.volume = 0; p.rate = 10;
      speechSynthesis.speak(p);
    } catch {}
  }

  const browserSpeak = useCallback((text) => {
    if (!text) return;
    function doSpeak() {
      const voices = speechSynthesis.getVoices();
      const voice  = voices.find(v => /sonia|libby|maisie/i.test(v.name))
        ?? voices.find(v => /en[-_]GB/i.test(v.lang))
        ?? voices.find(v => v.lang.startsWith('en'))
        ?? voices[0] ?? null;
      const utt = new SpeechSynthesisUtterance(text);
      if (voice) utt.voice = voice;
      utt.rate  = 0.92;
      utt.pitch = 1.05;
      utt.onerror    = e => console.error('[Helena TTS] error:', e.error);
      utt.onboundary = (e) => { if (e.name === 'word') speechPulseRef.current?.(1.0); };
      utt.onend      = () => {
        uttRef.current = null;
        speechPulseRef.current?.(0);
        setResponding(false);
        if (conversationalRef.current) startListeningRef.current?.();
      };
      uttRef.current = utt;
      // Only cancel if something is actively playing — avoids Chrome stuck-queue bug
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      setTimeout(() => { if (uttRef.current) speechSynthesis.speak(uttRef.current); }, 80);
    }
    const voices = speechSynthesis.getVoices();
    if (voices.length) doSpeak();
    else speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true });
  }, []);

  const speak = useCallback((text) => { if (text) browserSpeak(text); }, [browserSpeak]);

  // ── CLEAR HISTORY — defined before sendMessage ────────────────────
  const clearHistory = useCallback(() => setMessages([]), []);

  // ── CHAT ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    // Fast path: intercept recognised dashboard/memory/task commands locally
    const cmd = parseCommand(text);
    if (cmd) {
      if (cmd.action === 'task_add') {
        const t = cmd.match[1]?.trim();
        taskControlRef.current?.add(t);
        const msg = t ? `Task added: "${t}"` : 'What task should I add?';
        setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: msg }]);
        speak(msg); return;
      }
      if (cmd.action === 'task_complete') {
        const t = cmd.match[1]?.trim();
        taskControlRef.current?.completeByText(t);
        const msg = t ? `Marked done: "${t}"` : 'Which task should I complete?';
        setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: msg }]);
        speak(msg); return;
      }
      if (cmd.action === 'task_clear') {
        taskControlRef.current?.clearDone();
        const msg = 'Cleared completed tasks.';
        setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: msg }]);
        speak(msg); return;
      }
      if (cmd.action === 'task_list') {
        const ctx = getTaskContext();
        setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: ctx }]);
        speak(ctx); return;
      }
      const localResponse = executeCommand(cmd, clearHistory);
      if (localResponse) {
        setMessages(prev => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: localResponse },
        ]);
        speak(localResponse);
        return;
      }
    }

    // Prime speech synthesis NOW (inside user gesture, before any await)
    primeSpeech();

    const userMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setResponding(true);

    const memCtx  = memoryManager.getContext();
    const taskCtx = getTaskContext();

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:       history.map(({ role, content }) => ({ role, content })),
          memoryContext:  memCtx,
          spotifyContext: spotifyContextRef.current,
          taskContext:    taskCtx,
        }),
      });
      const data = await res.json();
      // data = { response, intent, action, target, memory_update, source }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        meta: { intent: data.intent, action: data.action, source: data.source },
      }]);

      speak(data.response);

      // Scout search — fire and forget, push results to activity feed
      if (data.action === 'scout_search' && data.target && data.target !== 'none') {
        (async () => {
          try {
            const scoutRes = await fetch('/api/agents/scout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: data.target }),
            });
            const scout = await scoutRes.json();
            if (scout.error) throw new Error(scout.error);
            const store = useAppStore.getState();
            // Push each lead as an activity item
            if (scout.leads?.length) {
              scout.leads.forEach((lead, i) => {
                store.addItem({
                  id:    Date.now() + i,
                  type:  'scout',
                  title: lead.company || 'Scout lead',
                  sub:   lead.signal ?? '',
                  time:  'now',
                  action: lead.action ?? '',
                });
              });
            } else {
              store.addItem({
                id:    Date.now(),
                type:  'scout',
                title: scout.summary ?? 'Scout complete',
                sub:   `${scout.resultCount ?? 0} sources reviewed`,
                time:  'now',
              });
            }
          } catch (err) {
            console.warn('[Scout] error:', err.message);
            useAppStore.getState().addItem({
              id:    Date.now(),
              type:  'scout',
              title: 'Scout search failed',
              sub:   err.message,
              time:  'now',
            });
          }
        })();
      }

      // Execute any dashboard action Helena chose
      if (data.action && data.action !== 'none' && data.action !== 'spotify_control' && data.action !== 'scout_search') {
        executeStructuredAction(data.action, data.target, clearHistory);
      }
      if (data.action === 'spotify_control') {
        const ctrl = spotifyControlRef.current;
        if (ctrl && data.target && typeof ctrl[data.target] === 'function') ctrl[data.target]();
      }
      if (data.action === 'task_add' && data.target && data.target !== 'none') {
        taskControlRef.current?.add(data.target);
      }
      if (data.action === 'task_complete' && data.target && data.target !== 'none') {
        taskControlRef.current?.completeByText(data.target);
      }
      if (data.action === 'task_clear') {
        taskControlRef.current?.clearDone();
      }

      // Persist memory update if Helena flagged one
      if (data.memory_update?.fact) {
        const { type, key, fact } = data.memory_update;
        memoryManager.remember(fact, type === 'short' ? 'short' : 'long');
        if (type === 'preference' && key) memoryManager.setPreference(key, fact);
      }

      // Track LLM source in store for UI indicator
      useAppStore.getState().setLlmSource(data.source ?? null);

      memoryManager.logExchange(text, data.response);
    } catch (err) {
      console.error('[Helena] sendMessage error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting right now." }]);
      setResponding(false);
    }
  }, [messages, speak, clearHistory]);

  // ── WAKE WORD ────────────────────────────────────────────────────
  const launchWakeRecog = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !wakeEnabledRef.current) return;

    const recog          = new SR();
    recog.lang           = 'en-GB';
    recog.continuous     = true;
    recog.interimResults = false;

    recog.onstart = () => setWakeActive(true);
    recog.onend   = () => {
      if (wakeRecogRef.current === recog && wakeEnabledRef.current) {
        try { recog.start(); } catch {}
      } else { setWakeActive(false); }
    };
    recog.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (wakeRecogRef.current === recog && wakeEnabledRef.current) {
        setTimeout(() => { try { recog.start(); } catch {} }, 800);
      }
    };
    recog.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join(' ').toLowerCase();
      if (/hey\s*helen[ae]?|helena/i.test(t)) {
        wakeRecogRef.current = null;
        try { recog.stop(); } catch {}
        setTimeout(() => startListeningRef.current?.(), 200);
      }
    };
    wakeRecogRef.current = recog;
    try { recog.start(); } catch {}
  }, []);

  // ── MAIN MIC ─────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showMicError('Speech recognition not supported in this browser.'); return; }
    unlockAudio();

    if (wakeRecogRef.current) {
      const wr = wakeRecogRef.current;
      wakeRecogRef.current = null;
      try { wr.stop(); } catch {}
    }

    setTimeout(() => {
      const recog          = new SR();
      recog.lang           = 'en-GB';
      recog.interimResults = true;
      recog.continuous     = false;

      recog.onstart  = () => { setListening(true); setMicError(null); };
      recog.onend    = () => {
        setListening(false);
        setTranscript('');
        transcriptRef.current = '';
        if (!conversationalRef.current && wakeEnabledRef.current) launchWakeRecog();
      };
      recog.onerror  = (e) => {
        if (e.error === 'no-speech') return;
        const errorMap = {
          'not-allowed':   'Microphone access denied. Check browser permissions.',
          'audio-capture': 'No microphone found.',
          'network':       'Network error during recognition.',
        };
        if (errorMap[e.error]) showMicError(errorMap[e.error]);
        setListening(false);
        setTranscript('');
        transcriptRef.current = '';
        if (!conversationalRef.current && wakeEnabledRef.current) launchWakeRecog();
      };
      recog.onresult = (e) => {
        const t = Array.from(e.results).map(r => r[0].transcript).join('');
        setTranscript(t);
        transcriptRef.current = t;
        if (e.results[e.results.length - 1].isFinal) {
          recog.stop();
          sendMessage(t);
        }
      };

      try {
        recog.start();
        recogRef.current = recog;
      } catch (err) {
        console.error('[Helena mic] start failed:', err);
        showMicError('Could not start microphone.');
      }
    }, 150);
  }, [sendMessage, launchWakeRecog]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  const stopListening = useCallback(() => {
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
    setTranscript('');
    transcriptRef.current = '';
  }, []);

  // Push-to-talk: stop mic and send whatever was transcribed
  const stopAndSend = useCallback(() => {
    const t = transcriptRef.current;
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
    setTranscript('');
    transcriptRef.current = '';
    if (t.trim()) sendMessage(t.trim());
  }, [sendMessage]);

  // ── CONVERSATION MODE ────────────────────────────────────────────
  const startConversation = useCallback(() => {
    conversationalRef.current = true;
    setConversational(true);
    try {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0; primer.rate = 10;
      speechSynthesis.speak(primer);
    } catch {}
    startListeningRef.current?.();
  }, []);

  const stopConversation = useCallback(() => {
    conversationalRef.current = false;
    setConversational(false);
    speechSynthesis.cancel();
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
    setTranscript('');
    transcriptRef.current = '';
    if (wakeEnabledRef.current) launchWakeRecog();
  }, [launchWakeRecog]);

  // ── WAKE WORD TOGGLE ─────────────────────────────────────────────
  const enableWakeWord = useCallback(() => {
    wakeEnabledRef.current = true;
    launchWakeRecog();
  }, [launchWakeRecog]);

  const disableWakeWord = useCallback(() => {
    wakeEnabledRef.current = false;
    if (wakeRecogRef.current) {
      try { wakeRecogRef.current.stop(); } catch {}
      wakeRecogRef.current = null;
    }
    setWakeActive(false);
  }, []);

  return {
    messages, responding, listening, transcript, wakeActive, conversational, micError,
    startListening, stopListening, stopAndSend, sendMessage, clearHistory, speak,
    enableWakeWord, disableWakeWord,
    startConversation, stopConversation,
    speechPulseRef, spotifyContextRef, spotifyControlRef, taskControlRef,
  };
}
