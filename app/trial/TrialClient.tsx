'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Briefing = {
  dataType: string;
  summary: string;
  findings: string[];
  risks: string[];
  recommendations: string[];
  keyMetric: { label: string; value: string; context: string };
  suggestedQuestions: string[];
  confidence: number;
};

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const steps = ['Upload data', 'Your first insights', 'Ask HLNA'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 40 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 90 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? '#7C3AED' : active ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${done ? '#7C3AED' : active ? 'rgba(124,58,237,0.60)' : 'rgba(255,255,255,0.12)'}`,
                fontSize: 11, fontWeight: 700,
                color: done ? '#fff' : active ? '#C4B5FD' : 'rgba(255,255,255,0.25)',
                transition: 'all 0.3s',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{
                fontSize: 10, fontWeight: active ? 600 : 400, letterSpacing: '0.04em',
                color: active ? '#C4B5FD' : done ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)',
                whiteSpace: 'nowrap',
              }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 1, margin: '-14px 8px 0',
                background: done ? 'rgba(124,58,237,0.50)' : 'rgba(255,255,255,0.08)',
                transition: 'background 0.3s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Upload ────────────────────────────────────────────────────────────

function UploadStep({ onUpload }: { onUpload: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setSelected(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.92)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        Upload your data
      </h2>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.40)', margin: '0 0 28px', lineHeight: 1.65 }}>
        Upload any operational CSV — waste, fleet, service requests, finance. HLNA will analyse it and generate your first insights automatically.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'rgba(124,58,237,0.70)' : selected ? 'rgba(52,211,153,0.50)' : 'rgba(255,255,255,0.12)'}`,
          borderRadius: 12, padding: '40px 24px', textAlign: 'center',
          cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s',
          background: dragOver ? 'rgba(124,58,237,0.05)' : selected ? 'rgba(52,211,153,0.04)' : 'rgba(255,255,255,0.02)',
          marginBottom: 20,
        }}
      >
        <input
          ref={inputRef} type="file" accept=".csv,.xlsx"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {selected ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#34D399', marginBottom: 4 }}>{selected.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              {(selected.size / 1024).toFixed(1)} KB · Click to change
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>↑</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.70)', marginBottom: 4 }}>
              Drop your CSV here
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>or click to browse · CSV or XLSX</div>
          </>
        )}
      </div>

      {/* Supported types */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
        {['Waste & recycling', 'Fleet management', 'Service requests', 'Finance', 'HR', 'Any operational data'].map(t => (
          <span key={t} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 12,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.40)',
          }}>{t}</span>
        ))}
      </div>

      <button
        onClick={() => selected && onUpload(selected)}
        disabled={!selected}
        style={{
          padding: '12px 28px', borderRadius: 8, border: 'none',
          background: selected ? '#7C3AED' : 'rgba(255,255,255,0.06)',
          color: selected ? '#fff' : 'rgba(255,255,255,0.25)',
          fontSize: 14, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed',
          fontFamily: FONT, transition: 'background 0.2s',
        }}
      >
        Analyse my data →
      </button>
    </div>
  );
}

// ── Step 2: Insights ──────────────────────────────────────────────────────────

function InsightsStep({ briefing, fileName, rowCount, onNext }: {
  briefing: Briefing; fileName: string; rowCount: number; onNext: () => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: '#34D399', fontWeight: 700, letterSpacing: '0.08em' }}>
          HLNA ANALYSIS COMPLETE
        </span>
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.92)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Your first insights
      </h2>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', margin: '0 0 24px' }}>
        {fileName} · {rowCount.toLocaleString()} rows analysed
      </p>

      {/* Key metric */}
      <div style={{
        padding: '18px 20px', borderRadius: 10, marginBottom: 16,
        background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.22)',
      }}>
        <div style={{ fontSize: 10, color: 'rgba(167,139,250,0.60)', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6 }}>
          {briefing.keyMetric.label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#C4B5FD', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 4 }}>
          {briefing.keyMetric.value}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>{briefing.keyMetric.context}</div>
      </div>

      {/* Summary */}
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, margin: '0 0 20px' }}>
        {briefing.summary}
      </p>

      {/* Findings */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 10 }}>Key findings</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {briefing.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.5 }}>
              <span style={{ color: '#A78BFA', flexShrink: 0, marginTop: 1 }}>◎</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Risks */}
      {briefing.risks?.length > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 16,
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)',
        }}>
          <div style={{ fontSize: 10, color: 'rgba(251,191,36,0.70)', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6 }}>Flags</div>
          {briefing.risks.map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)', lineHeight: 1.5 }}>⚠ {r}</div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 10 }}>Recommended actions</div>
        {briefing.recommendations.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, marginBottom: 6 }}>
            <span style={{ color: '#34D399', flexShrink: 0 }}>{i + 1}.</span>
            <span>{r}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        style={{
          padding: '12px 28px', borderRadius: 8, border: 'none',
          background: '#7C3AED', color: '#fff', fontSize: 14, fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT,
        }}
      >
        Ask HLNA questions →
      </button>
    </div>
  );
}

// ── Step 3: Embedded HLNA chat ────────────────────────────────────────────────

type ChatMsg = { role: 'user' | 'hlna'; text: string };

const FIXED_SUGGESTIONS = ['What changed?', 'Where are we losing money?', 'What should we do?'];

function AskStep({ briefing }: { briefing: Briefing | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput]       = useState('');
  const [thinking, setThinking] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const suggestions = [
    ...FIXED_SUGGESTIONS,
    ...(briefing?.suggestedQuestions?.slice(0, 2) ?? []),
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function send(text: string) {
    const query = text.trim();
    if (!query || thinking) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: query }]);
    setThinking(true);

    try {
      const dashboardContext = briefing
        ? [
            `Trial dataset analysis:`,
            briefing.summary,
            `Key metric — ${briefing.keyMetric.label}: ${briefing.keyMetric.value}. ${briefing.keyMetric.context}`,
            `Findings:\n${briefing.findings.map(f => `• ${f}`).join('\n')}`,
            briefing.risks.length ? `Flags:\n${briefing.risks.map(r => `⚠ ${r}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n')
        : '';

      const apiMessages = [
        ...messages.map(m => ({ role: m.role === 'hlna' ? 'assistant' : 'user', content: m.text })),
        { role: 'user', content: query },
      ];

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, dashboardContext }),
      });

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'hlna', text: data.response ?? 'Something went wrong.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'hlna', text: 'Could not reach HLNA. Please try again.' }]);
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function goToDashboard() {
    if (typeof window !== 'undefined') localStorage.setItem('trialWizardDone', '1');
    router.push('/dashboard');
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.92)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
        Ask HLNA anything
      </h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', margin: '0 0 20px', lineHeight: 1.6 }}>
        HLNA has read your data. Ask it anything — trends, anomalies, costs, actions.
      </p>

      {/* Suggested prompts — only before first message */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {suggestions.map((q, i) => (
            <button
              key={i}
              onClick={() => send(q)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(124,58,237,0.35)',
                background: 'rgba(124,58,237,0.10)', color: '#C4B5FD',
                fontSize: 12, cursor: 'pointer', fontFamily: FONT,
                transition: 'background 0.15s',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Message thread */}
      <div style={{
        minHeight: 160, maxHeight: 340, overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10,
        background: 'rgba(255,255,255,0.02)', padding: '12px 14px',
        marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && !thinking && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.20)', textAlign: 'center', margin: 'auto' }}>
            Type a question or pick a suggestion above
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: m.role === 'user' ? 'rgba(255,255,255,0.25)' : 'rgba(167,139,250,0.55)' }}>
              {m.role === 'user' ? 'YOU' : 'HLNA'}
            </span>
            <div style={{
              maxWidth: '88%', padding: '9px 13px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
              background: m.role === 'user' ? 'rgba(124,58,237,0.20)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${m.role === 'user' ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.07)'}`,
              fontSize: 13, color: 'rgba(255,255,255,0.82)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(167,139,250,0.55)' }}>HLNA</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#7C3AED',
                  animation: `trialPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask HLNA about your data…"
          disabled={thinking}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8, fontFamily: FONT,
            background: '#111318', border: '1px solid rgba(255,255,255,0.10)',
            color: '#f9fafb', fontSize: 13, outline: 'none',
            opacity: thinking ? 0.5 : 1,
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || thinking}
          style={{
            padding: '10px 16px', borderRadius: 8, border: 'none', fontFamily: FONT,
            background: input.trim() && !thinking ? '#7C3AED' : 'rgba(255,255,255,0.06)',
            color: input.trim() && !thinking ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize: 14, cursor: input.trim() && !thinking ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          →
        </button>
      </div>

      {/* Go to dashboard — always visible */}
      <button
        onClick={goToDashboard}
        style={{
          padding: '11px 24px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
          background: messages.length >= 2 ? '#7C3AED' : 'rgba(255,255,255,0.04)',
          color: messages.length >= 2 ? '#fff' : 'rgba(255,255,255,0.40)',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        {messages.length >= 2 ? 'Open full HLNA dashboard →' : 'Skip to dashboard'}
      </button>

      <style>{`
        @keyframes trialPulse {
          0%, 80%, 100% { opacity: .2; transform: scale(.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TrialClient({ userName }: { userName: string }) {
  const firstName = userName.split(' ')[0];
  const [step, setStep]       = useState<1 | 2 | 3>(1);
  const [uploading, setUploading] = useState(false);
  const [briefing, setBriefing]   = useState<Briefing | null>(null);
  const [uploadMeta, setUploadMeta] = useState<{ fileName: string; rowCount: number } | null>(null);
  const [uploadError, setUploadError] = useState('');

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/trial/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error ?? 'Upload failed.'); return; }
      setBriefing(data.briefing);
      setUploadMeta({ fileName: data.fileName, rowCount: data.rowCount });
      setStep(2);
    } finally {
      setUploading(false);
    }
  }

  function goToStep3() {
    setStep(3);
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#06070F',
      color: '#F4F4F5', fontFamily: FONT,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      {/* Top accent */}
      <div style={{ height: 1, width: '100%', background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.6), rgba(56,189,248,0.3), transparent)' }} />

      <div style={{ width: '100%', maxWidth: 580, padding: '48px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 10, color: 'rgba(124,58,237,0.70)', fontWeight: 700, letterSpacing: '0.12em', marginBottom: 6 }}>◈ HLNA · GETTING STARTED</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.88)', margin: 0, letterSpacing: '-0.01em' }}>
            Welcome, {firstName}
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>
            Let's get you to your first insight in under 10 minutes.
          </p>
        </div>

        {/* Steps */}
        <Steps current={step} />

        {/* Step content */}
        {step === 1 && !uploading && (
          <>
            <UploadStep onUpload={handleUpload} />
            {uploadError && (
              <p style={{ marginTop: 12, fontSize: 13, color: '#F87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px' }}>
                {uploadError}
              </p>
            )}
          </>
        )}

        {step === 1 && uploading && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 10, color: 'rgba(124,58,237,0.70)', fontWeight: 700, letterSpacing: '0.12em', marginBottom: 20 }}>◈ HLNA IS READING YOUR DATA…</div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#7C3AED',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
              Parsing and analysing — this takes about 15 seconds
            </p>
            <style>{`@keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
          </div>
        )}

        {step === 2 && briefing && uploadMeta && (
          <InsightsStep
            briefing={briefing}
            fileName={uploadMeta.fileName}
            rowCount={uploadMeta.rowCount}
            onNext={goToStep3}
          />
        )}

        {step === 3 && (
          <AskStep briefing={briefing} />
        )}
      </div>
    </div>
  );
}
