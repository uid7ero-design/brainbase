'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { memoryManager } from '../lib/memory/memoryManager';
import { getTaskContext } from './useTasks';
import { parseCommand } from '../lib/actions/commandParser';
import { executeCommand, executeStructuredAction } from '../lib/actions/dashboardActions';
import { useAppStore } from '../lib/state/useAppStore';
import { getContextForPath } from '../lib/dashboard/registry';

// ─── Phase machine ────────────────────────────────────────────────
// idle → listening → processing → speaking → idle
// Only one phase active at a time. All state derives from phaseRef.

export function useHelena() {
  const [messages,      setMessages]      = useState([]);
  const [listening,     setListening]     = useState(false);
  const [responding,    setResponding]    = useState(false);
  const [orbPhase,      setOrbPhase]      = useState('idle');
  const [transcript,    setTranscript]    = useState('');
  const [conversational,setConversational]= useState(false);
  const [micError,      setMicError]      = useState(null);
  const [wakeActive,    setWakeActive]    = useState(false);

  // ── Core refs ────────────────────────────────────────────────────
  const phaseRef          = useRef('idle');   // 'idle'|'listening'|'processing'|'speaking'
  const recogRef          = useRef(null);
  const wakeRecogRef      = useRef(null);
  const audioRef          = useRef(null);     // AudioContext source node
  const acRef             = useRef(null);     // shared AudioContext
  const transcriptRef     = useRef('');
  const conversationalRef = useRef(false);
  const wakeEnabledRef    = useRef(false);
  const ttsReadyRef       = useRef(false);
  const speakAbortRef     = useRef(null); // cancels any in-flight ElevenLabs fetch
  const silenceCountRef   = useRef(0); // consecutive no-speech cycles in convo mode
  const wakeWatchdogRef   = useRef(null); // interval that restarts dead wake recognizer
  const wakeLastAliveRef  = useRef(Date.now()); // timestamp of last wake recog activity

  // ── Context refs (set by parent) ─────────────────────────────────
  const speechPulseRef     = useRef(null);
  const spotifyContextRef  = useRef('');
  const spotifyControlRef  = useRef(null);
  const taskControlRef     = useRef(null);
  const calendarContextRef = useRef('');
  const calendarControlRef = useRef(null);
  const dashboardContextRef= useRef('');
  const navRef             = useRef(null);  // set by parent: (target: string) => void

  // Forward refs (break circular deps)
  const startListeningRef = useRef(null);
  const launchWakeRef     = useRef(null);
  const sendMessageRef    = useRef(null);

  // ── Phase helpers ─────────────────────────────────────────────────
  function phase() { return phaseRef.current; }
  function setPhase(p) {
    phaseRef.current = p;
    setListening(p === 'listening');
    setResponding(p === 'processing' || p === 'speaking');
    setOrbPhase(
      p === 'listening'  ? 'listening'  :
      p === 'processing' ? 'thinking'   :
      p === 'speaking'   ? 'responding' : 'idle'
    );
  }

  function showMicError(msg) {
    setMicError(msg);
    setTimeout(() => setMicError(null), 4000);
  }

  // ── AudioContext ──────────────────────────────────────────────────
  function getAC() {
    if (!acRef.current) acRef.current = new AudioContext();
    return acRef.current;
  }
  function unlockAC() {
    const ac = getAC();
    if (ac.state === 'suspended') ac.resume();
  }

  // ── Stop everything ───────────────────────────────────────────────
  function stopAll() {
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch {}
      recogRef.current = null;
    }
    if (audioRef.current) {
      const a = audioRef.current;
      audioRef.current = null;
      try {
        if (typeof a.stop === 'function') a.stop(0);          // AudioBufferSourceNode
        else if (typeof a.pause === 'function') {              // Audio element (streaming path)
          const url = a.src;
          a.pause(); a.src = '';
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        }
      } catch {}
    }
    speechSynthesis.cancel();
    speechPulseRef.current?.(0);
    setTranscript('');
    transcriptRef.current = '';
    setPhase('idle');
  }

  // ── TTS unlock (must be called in user gesture) ───────────────────
  function primeTTS() {
    unlockAC(); // AudioContext must be resumed inside a user gesture
    if (ttsReadyRef.current) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0; u.rate = 10;
      speechSynthesis.speak(u);
      ttsReadyRef.current = true;
    } catch {}
  }

  // ── Speak ─────────────────────────────────────────────────────────
  function onSpeakEnd() {
    console.log('[Helena] onSpeakEnd — conversational:', conversationalRef.current);
    audioRef.current = null;
    speechPulseRef.current?.(0);
    setPhase('idle');
    if (conversationalRef.current) {
      setTimeout(() => startListeningRef.current?.(), 300);
    } else if (wakeEnabledRef.current) {
      launchWakeRef.current?.();
    }
  }

  function doSpeakBrowser(text) {
    const voices = speechSynthesis.getVoices();
    const voice  = voices.find(v => /sonia|libby|maisie|zira|samantha/i.test(v.name))
      ?? voices.find(v => /en[-_]GB/i.test(v.lang))
      ?? voices.find(v => v.lang?.startsWith('en'))
      ?? voices[0] ?? null;
    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    utt.rate  = 0.92;
    utt.pitch = 1.05;
    utt.onboundary = (e) => { if (e.name === 'word') speechPulseRef.current?.(0.8); };
    utt.onend   = () => onSpeakEnd();
    utt.onerror = (e) => { if (e.error === 'interrupted') return; console.warn('[Helena TTS]', e.error); onSpeakEnd(); };
    setTimeout(() => speechSynthesis.speak(utt), 60);
  }

  const speak = useCallback((text) => {
    if (!text) return;

    // Cancel any in-flight fetch from a previous speak() call
    speakAbortRef.current?.abort();
    const controller = new AbortController();
    speakAbortRef.current = controller;

    // Stop any currently-playing audio immediately
    if (audioRef.current) {
      const prev = audioRef.current;
      audioRef.current = null;
      try {
        if (typeof prev.stop === 'function') prev.stop(0);
        else if (typeof prev.pause === 'function') {
          const url = prev.src;
          prev.pause(); prev.src = '';
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        }
      } catch {}
    }
    speechSynthesis.cancel();
    speechPulseRef.current?.(0);

    setPhase('speaking');
    silenceCountRef.current = 0;

    (async () => {
      let timer;
      try {
        timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch('/api/speak', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text }),
          signal:  controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
        if (controller.signal.aborted) return;

        // Streaming path: MediaSource plays audio as it arrives (Chrome/Edge)
        if (res.body && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) {
          const ms        = new MediaSource();
          const audioEl   = new Audio();
          const objectURL = URL.createObjectURL(ms);
          audioEl.src     = objectURL;
          audioRef.current = audioEl;

          let rafId;
          function pulse() {
            if (audioRef.current !== audioEl) return;
            speechPulseRef.current?.(0.8);
            rafId = requestAnimationFrame(pulse);
          }

          function streamCleanup() {
            cancelAnimationFrame(rafId);
            URL.revokeObjectURL(objectURL);
            if (audioRef.current === audioEl) { audioRef.current = null; onSpeakEnd(); }
          }

          audioEl.addEventListener('ended', streamCleanup, { once: true });
          audioEl.addEventListener('error', streamCleanup, { once: true });

          ms.addEventListener('sourceopen', async () => {
            const sb     = ms.addSourceBuffer('audio/mpeg');
            const reader = res.body.getReader();
            let started  = false;

            const appendChunk = (chunk) => new Promise((resolve, reject) => {
              const tryAppend = () => {
                if (sb.updating) { sb.addEventListener('updateend', tryAppend, { once: true }); return; }
                try { sb.appendBuffer(chunk); } catch (e) { reject(e); return; }
                sb.addEventListener('updateend', resolve, { once: true });
              };
              tryAppend();
            });

            try {
              while (true) {
                if (controller.signal.aborted || audioRef.current !== audioEl) break;
                const { done, value } = await reader.read();
                if (done) break;
                await appendChunk(value);
                if (!started) { audioEl.play().catch(() => {}); pulse(); started = true; }
              }
            } catch { /* network or append error — fall through to endOfStream */ }

            try { ms.endOfStream(); } catch {}

            // If streaming failed before audio ever started, onSpeakEnd won't
            // come from the 'ended' event — fire it now to unblock Helena.
            if (!started) streamCleanup();
          }, { once: true });

        } else {
          // Fallback: buffer entire audio (Firefox, older Safari)
          const arrayBuffer = await res.arrayBuffer();
          if (controller.signal.aborted) return;

          const ac = getAC();
          if (ac.state === 'suspended') await ac.resume();

          const decoded = await ac.decodeAudioData(arrayBuffer);
          const source  = ac.createBufferSource();
          source.buffer = decoded;
          source.connect(ac.destination);

          let rafId;
          function pulse() {
            if (audioRef.current !== source) return;
            speechPulseRef.current?.(0.8);
            rafId = requestAnimationFrame(pulse);
          }

          source.addEventListener('ended', () => {
            cancelAnimationFrame(rafId);
            if (audioRef.current === source) audioRef.current = null;
            onSpeakEnd();
          });

          audioRef.current = source;
          source.start(0);
          rafId = requestAnimationFrame(pulse);
        }

      } catch (err) {
        clearTimeout(timer);
        // Aborted intentionally (new speak() fired) — do not fall back to browser TTS
        if (err.name === 'AbortError' || controller.signal.aborted) return;
        console.warn('[Helena speak] ElevenLabs failed, using browser TTS:', err.message);
        const voices = speechSynthesis.getVoices();
        if (voices.length) doSpeakBrowser(text);
        else speechSynthesis.addEventListener('voiceschanged', () => doSpeakBrowser(text), { once: true });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clear history ─────────────────────────────────────────────────
  const clearHistory = useCallback(() => setMessages([]), []);

  // ── Send message ──────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text?.trim()) { setPhase('idle'); return; }

    // Fast-path: local command intercept
    const cmd = parseCommand(text);
    if (cmd) {
      let msg = null;
      if (cmd.action === 'task_add')      { const t = cmd.match[1]?.trim(); taskControlRef.current?.add(t); msg = t ? `Task added: "${t}"` : 'What task?'; }
      if (cmd.action === 'task_complete') { const t = cmd.match[1]?.trim(); taskControlRef.current?.completeByText(t); msg = t ? `Marked done: "${t}"` : 'Which task?'; }
      if (cmd.action === 'task_clear')    { taskControlRef.current?.clearDone(); msg = 'Cleared completed tasks.'; }
      if (cmd.action === 'task_list')     { msg = getTaskContext(); }
      if (!msg) msg = executeCommand(cmd, clearHistory);
      if (msg) {
        setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: msg }]);
        speak(msg);
        return;
      }
    }

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setPhase('processing');

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages:          [...messages, { role: 'user', content: text }].map(({ role, content }) => ({ role, content })),
          memoryContext:     memoryManager.getContext(),
          spotifyContext:    spotifyContextRef.current,
          taskContext:       getTaskContext(),
          calendarContext:   calendarContextRef.current,
          dashboardContext:  useAppStore.getState().dashboardAiContext
                             || dashboardContextRef.current
                             || (typeof window !== 'undefined' ? getContextForPath(window.location.pathname) : ''),
          moduleKey:        useAppStore.getState().activeModule || undefined,
          viewMode:         useAppStore.getState().viewMode || 'executive',
          department:       useAppStore.getState().activeDepartment || 'waste',
        }),
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'assistant', content: data.response,
        meta: {
          intent:     data.intent,
          action:     data.action,
          source:     data.source,
          analysis:   data.analysis   ?? null,
          agentName:  data.agentName  ?? null,
          routeType:  data.routeType  ?? null,
          confidence: data.confidence ?? null,
          findings:   data.findings   ?? [],
          warnings:   data.warnings   ?? [],
          evidence:   data.evidence   ?? null,
        },
      }]);

      speak(data.response);

      // ── Side effects (non-blocking) ───────────────────────────────
      if (data.action === 'scout_search' && data.target && data.target !== 'none') {
        useAppStore.getState().addCard({ id: Date.now(), type: 'HLNΛ ACTION', title: 'Data Scan running…', sub: `Searching: "${data.target}"`, time: 'now' });
        (async () => {
          try {
            const sr = await fetch('/api/agents/scout', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: data.target }),
            });
            const scout = await sr.json();
            const store = useAppStore.getState();
            if (scout.leads?.length) {
              scout.leads.forEach((lead, i) => store.addItem({ id: Date.now() + i, type: 'data_scan', title: lead.company || 'Data Scan result', sub: lead.signal ?? '', time: 'now', action: lead.action ?? '' }));
            } else {
              store.addItem({ id: Date.now(), type: 'data_scan', title: scout.summary ?? 'Data Scan complete', sub: `${scout.resultCount ?? 0} sources reviewed`, time: 'now' });
            }
          } catch (err) { console.warn('[DataScan]', err.message); }
        })();
      }

      if (data.action === 'note_create' && data.target && data.target !== 'none') {
        const parts = data.target.split('|');
        (async () => {
          try {
            const r = await fetch('/api/brain/note', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: parts[0]?.trim() || 'Untitled', folder: parts[1]?.trim() || '', body: parts.slice(2).join('|').trim() }),
            });
            const result = await r.json();
            if (result.ok) useAppStore.getState().addItem({ id: Date.now(), type: 'memory', title: `Note saved: ${parts[0]?.trim()}`, sub: result.fileName, time: 'now' });
          } catch (err) { console.warn('[Note]', err.message); }
        })();
      }

      if (data.action && !['none','scout_search','note_create','spotify_control'].includes(data.action)) {
        executeStructuredAction(data.action, data.target, clearHistory);
      }
      if (data.action === 'navigate' && data.target && data.target !== 'none') {
        navRef.current?.(data.target);
        const dashLabels = { waste:'Waste Dashboard', fleet:'Fleet Dashboard', 'service-requests':'Service Requests', overview:'Command Overview', analytics:'Analytics', settings:'Settings' };
        const label = dashLabels[data.target] ?? data.target.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
        useAppStore.getState().addCard({ id: Date.now(), type: 'HLNΛ ACTION', title: `Navigated to ${label}`, time: 'now' });
      }
      if (data.action === 'spotify_control') {
        const ctrl = spotifyControlRef.current;
        if (ctrl && data.target && typeof ctrl[data.target] === 'function') ctrl[data.target]();
      }
      if (data.action === 'task_add' && data.target && data.target !== 'none') {
        taskControlRef.current?.add(data.target);
        useAppStore.getState().addCard({ id: Date.now(), type: 'HLNΛ ACTION', title: 'Task added', sub: data.target, time: 'now' });
      }
      if (data.action === 'task_complete' && data.target && data.target !== 'none') taskControlRef.current?.completeByText(data.target);
      if (data.action === 'task_clear') taskControlRef.current?.clearDone();
      if (data.action === 'calendar_create' && data.target && data.target !== 'none') {
        const [title, date, time, dur] = data.target.split('|').map(s => s?.trim());
        calendarControlRef.current?.create({ title, date, time, duration: dur ? Number(dur) : 60 });
      }
      if (data.memory_update?.fact) {
        const { type, key, fact } = data.memory_update;
        memoryManager.remember(fact, type === 'short' ? 'short' : 'long');
        if (type === 'preference' && key) memoryManager.setPreference(key, fact);
      }
      useAppStore.getState().setLlmSource(data.source ?? null);
      memoryManager.logExchange(text, data.response);

    } catch (err) {
      console.error('[Helena] sendMessage error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting right now." }]);
      setPhase('idle');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, speak, clearHistory]);

  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // ── Main mic ──────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    console.log('[Helena] startListening — phase:', phase(), 'conversational:', conversationalRef.current);
    if (phase() !== 'idle') return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    primeTTS();
    setPhase('listening');
    setTranscript('');
    transcriptRef.current = '';

    function restartOrWake(noSpeech = false) {
      if (conversationalRef.current) {
        if (noSpeech) silenceCountRef.current += 1;
        // Drop out of conversation after 2 consecutive silent cycles (~14s)
        if (silenceCountRef.current >= 2) {
          silenceCountRef.current = 0;
          conversationalRef.current = false;
          setConversational(false);
          if (wakeEnabledRef.current) setTimeout(() => launchWakeRef.current?.(), 300);
          return;
        }
        setTimeout(() => {
          if (conversationalRef.current && phase() === 'idle' && !recogRef.current) {
            startListeningRef.current?.();
          }
        }, 300);
      } else if (wakeEnabledRef.current) {
        launchWakeRef.current?.();
      }
    }

    function doStart() {
      // Guard: if the user cancelled during the async wait, don't start
      if (phase() !== 'listening') return;

      const recog = new SR();
      recog.lang           = 'en-GB';
      recog.continuous     = false;
      recog.interimResults = true;
      recogRef.current     = recog;

      recog.onresult = (e) => {
        silenceCountRef.current = 0; // speech detected — reset silence counter
        const interim = Array.from(e.results).map(r => r[0].transcript).join('');
        setTranscript(interim);
        transcriptRef.current = interim;
      };

      recog.onend = () => {
        recogRef.current = null;
        const text = transcriptRef.current.trim();
        console.log('[Helena] recog.onend — text:', text || '(none)', 'phase:', phase());
        setTranscript('');
        transcriptRef.current = '';

        if (phase() !== 'listening') return; // was cancelled

        if (text) {
          sendMessageRef.current?.(text);
        } else {
          setPhase('idle');
          restartOrWake();
        }
      };

      recog.onerror = (e) => {
        console.log('[Helena] recog.onerror —', e.error);
        recogRef.current = null;
        setTranscript('');
        transcriptRef.current = '';

        if (e.error === 'no-speech') {
          setPhase('idle');
          restartOrWake(true); // pass noSpeech=true to increment silence counter
          return;
        }

        const errorMap = {
          'not-allowed':   'Microphone access denied.',
          'audio-capture': 'No microphone found.',
          'network':       'Network error during recognition.',
        };
        if (errorMap[e.error]) showMicError(errorMap[e.error]);
        setPhase('idle');
        if (wakeEnabledRef.current) launchWakeRef.current?.();
      };

      try {
        recog.start();
        console.log('[Helena] recognizer started');
      } catch (err) {
        console.error('[Helena] recog.start() failed:', err.message);
        recogRef.current = null;
        setPhase('idle');
        showMicError('Could not start microphone.');
      }
    }

    // Chrome has one audio session at a time. The wake recognizer's session is
    // still held until its onend fires — starting immediately causes "aborted".
    // We wait for the wake recog's own onend before calling doStart.
    if (wakeRecogRef.current) {
      const prev = wakeRecogRef.current;
      wakeRecogRef.current = null;
      setWakeActive(false);
      prev.onresult = null;
      prev.onerror  = null;
      prev.onend    = doStart; // Chrome releases the session before firing onend
      try { prev.stop(); } catch { doStart(); }
    } else {
      doStart();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Stop / push-to-talk send ──────────────────────────────────────
  const stopListening = useCallback(() => {
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch {}
      recogRef.current = null;
    }
    setPhase('idle');
    setTranscript('');
    transcriptRef.current = '';
    if (wakeEnabledRef.current) launchWakeRef.current?.();
  }, []);

  const stopAndSend = useCallback(() => {
    const text = transcriptRef.current.trim();
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch {}
      recogRef.current = null;
    }
    setTranscript('');
    transcriptRef.current = '';
    if (text) {
      sendMessageRef.current?.(text);
    } else {
      setPhase('idle');
    }
  }, []);

  // ── Wake word ─────────────────────────────────────────────────────
  const launchWakeRecog = useCallback(() => {
    if (!wakeEnabledRef.current || phase() !== 'idle') return;
    if (wakeRecogRef.current) return; // already running

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recog = new SR();
    recog.lang           = 'en-US'; // broader support than en-GB
    recog.continuous     = true;
    recog.interimResults = false;

    recog.onstart = () => {
      setWakeActive(true);
      wakeLastAliveRef.current = Date.now();
    };

    recog.onend = () => {
      setWakeActive(false);
      if (wakeRecogRef.current === recog) {
        wakeRecogRef.current = null;
        // Restart regardless of phase — watchdog will skip if not idle
        if (wakeEnabledRef.current) {
          setTimeout(() => {
            if (phase() === 'idle') launchWakeRef.current?.();
          }, 400);
        }
      }
    };

    recog.onerror = (e) => {
      if (e.error === 'no-speech') {
        wakeLastAliveRef.current = Date.now(); // still alive, just quiet
        return;
      }
      if (wakeRecogRef.current === recog) {
        wakeRecogRef.current = null;
        setWakeActive(false);
        if (wakeEnabledRef.current) {
          setTimeout(() => {
            if (phase() === 'idle') launchWakeRef.current?.();
          }, 800);
        }
      }
    };

    recog.onresult = (e) => {
      wakeLastAliveRef.current = Date.now();
      // Accumulate all results (interim + final) into one string for matching
      const t = Array.from(e.results).map(r => r[0].transcript).join(' ');
      // Broad pattern: catches misrecognitions like "hey Elena", "hey lena", "hi helena"
      if (/(hey|hi)\s*,?\s*(helena?|helen\b|hlna|lena\b|elena\b|h[\s.]*l[\s.]*n[\s.]*a\b)/i.test(t)) {
        conversationalRef.current = true;
        setConversational(true);
        startListeningRef.current?.();
      }
    };

    wakeRecogRef.current = recog;
    wakeLastAliveRef.current = Date.now();
    try { recog.start(); } catch {}
  }, []);

  useEffect(() => { launchWakeRef.current = launchWakeRecog; }, [launchWakeRecog]);

  // ── Conversation mode ─────────────────────────────────────────────
  const startConversation = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      useAppStore.getState().setChatOpen(true);
      return;
    }
    conversationalRef.current = true;
    setConversational(true);
    primeTTS();
    startListeningRef.current?.();
  }, []);

  const stopConversation = useCallback(() => {
    conversationalRef.current = false;
    setConversational(false);
    stopAll();
    if (wakeEnabledRef.current) setTimeout(() => launchWakeRef.current?.(), 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wake word lifecycle ───────────────────────────────────────────
  const enableWakeWord = useCallback(() => {
    wakeEnabledRef.current = true;
    launchWakeRecog();

    // Watchdog: Chrome's continuous recognizer silently dies after ~60s.
    // If no activity for 20s and we're idle, kill and restart it.
    if (wakeWatchdogRef.current) clearInterval(wakeWatchdogRef.current);
    wakeWatchdogRef.current = setInterval(() => {
      if (!wakeEnabledRef.current) return;
      if (phase() !== 'idle') { wakeLastAliveRef.current = Date.now(); return; }
      const stale = Date.now() - wakeLastAliveRef.current > 20_000;
      if (stale) {
        console.log('[Helena] wake watchdog — restarting stale recognizer');
        if (wakeRecogRef.current) {
          try { wakeRecogRef.current.stop(); } catch {}
          wakeRecogRef.current = null;
        }
        setWakeActive(false);
        launchWakeRef.current?.();
      }
    }, 10_000);
  }, [launchWakeRecog]);

  const disableWakeWord = useCallback(() => {
    wakeEnabledRef.current = false;
    if (wakeWatchdogRef.current) {
      clearInterval(wakeWatchdogRef.current);
      wakeWatchdogRef.current = null;
    }
    if (wakeRecogRef.current) {
      try { wakeRecogRef.current.stop(); } catch {}
      wakeRecogRef.current = null;
    }
    setWakeActive(false);
  }, []);

  return {
    messages, listening, responding, orbPhase, transcript, conversational, micError, wakeActive,
    startListening, stopListening, stopAndSend, sendMessage, clearHistory, speak,
    enableWakeWord, disableWakeWord, startConversation, stopConversation,
    speechPulseRef, spotifyContextRef, spotifyControlRef, taskControlRef,
    calendarContextRef, calendarControlRef, dashboardContextRef, navRef,
  };
}
