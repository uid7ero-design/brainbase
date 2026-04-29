'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';

const FONT = "var(--font-inter), -apple-system, sans-serif";

type Briefing = {
  greeting: string;
  lines: string[];
  urgentCount: number;
  summary: string;
  modules: string[];
  hasData: boolean;
  timestamp: string;
};

type RankedAction = {
  rank: number;
  title: string;
  impact: 'high' | 'medium' | 'low';
  detail: string;
};

const IMPACT_COLOR = { high: '#F87171', medium: '#FBBF24', low: '#34D399' };
const IMPACT_BG    = { high: 'rgba(248,113,113,0.08)', medium: 'rgba(251,191,36,0.08)', low: 'rgba(52,211,153,0.08)' };
const IMPACT_BORDER= { high: 'rgba(248,113,113,0.20)', medium: 'rgba(251,191,36,0.18)', low: 'rgba(52,211,153,0.18)' };

function Shimmer() {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(167,139,250,0.12)', borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(167,139,250,0.45)', animation: 'agentPulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 9, width: 110, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ flex: 1 }} />
        <div style={{ height: 9, width: 60, borderRadius: 4, background: 'rgba(255,255,255,0.04)' }} />
      </div>
      {[80, 65, 72].map((w, i) => (
        <div key={i} style={{ height: 12, width: `${w}%`, borderRadius: 4, background: 'rgba(255,255,255,0.04)', marginBottom: 8 }} />
      ))}
    </div>
  );
}

export function MorningBriefing() {
  const [briefing, setBriefing]   = useState<Briefing | null>(null);
  const [actions,  setActions]    = useState<RankedAction[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [loadingAct, setLoadingAct] = useState(false);
  const [showAct,  setShowAct]    = useState(false);
  const [elapsed,  setElapsed]    = useState('');

  const { fireHelena, setChatOpen, activeModule } = useAppStore();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/hlna/briefing', { method: 'POST' });
      const data = await res.json() as Briefing;
      setBriefing(data);
    } catch { /* silent */ }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Relative timestamp
  useEffect(() => {
    if (!briefing?.timestamp) return;
    function tick() {
      const secs = Math.floor((Date.now() - new Date(briefing!.timestamp).getTime()) / 1000);
      if (secs < 60)        setElapsed(`${secs}s ago`);
      else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m ago`);
      else                  setElapsed(`${Math.floor(secs / 3600)}h ago`);
    }
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [briefing?.timestamp]);

  async function loadActions() {
    setLoadingAct(true);
    setShowAct(true);
    try {
      const res  = await fetch('/api/hlna/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey: activeModule ?? 'waste_recycling' }),
      });
      const data = await res.json() as { actions: RankedAction[] };
      setActions(data.actions ?? []);
    } catch { /* silent */ }
    finally  { setLoadingAct(false); }
  }

  function askHlna(q: string) {
    fireHelena(q);
    setChatOpen(true);
  }

  if (loading) return <Shimmer />;
  if (!briefing?.hasData) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(37,99,235,0.04) 100%)',
      border: '1px solid rgba(167,139,250,0.20)',
      borderRadius: 14,
      padding: '18px 20px',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: FONT,
    }}>
      {/* Left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, #A78BFA 0%, #38BDF8 100%)', borderRadius: '14px 0 0 14px' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA', boxShadow: '0 0 6px #A78BFA' }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(167,139,250,0.85)', textTransform: 'uppercase' }}>
          HLNΛ · Operations Briefing
        </span>
        <span style={{ flex: 1 }} />
        {briefing.urgentCount > 0 && (
          <span style={{
            padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800,
            background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.28)',
            color: '#FCA5A5', letterSpacing: '0.06em',
          }}>
            {briefing.urgentCount} URGENT
          </span>
        )}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.20)', letterSpacing: '0.04em' }}>{elapsed}</span>
        <button onClick={load} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.22)', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>↻</button>
      </div>

      {/* Greeting */}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(245,247,250,0.70)', marginBottom: 10, letterSpacing: '-0.01em' }}>
        {briefing.greeting}.
      </div>

      {/* Insight lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {briefing.lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: i === 0 ? '#A78BFA' : 'rgba(255,255,255,0.22)', marginTop: 5, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: i === 0 ? 'rgba(245,247,250,0.92)' : 'rgba(230,237,243,0.65)', lineHeight: 1.5 }}>{line}</span>
          </div>
        ))}
      </div>

      {/* Actions section */}
      {showAct && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 8 }}>
            Recommended Actions
          </div>
          {loadingAct ? (
            <div style={{ height: 11, width: '55%', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map(a => (
                <div
                  key={a.rank}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    background: IMPACT_BG[a.impact], border: `1px solid ${IMPACT_BORDER[a.impact]}`,
                    cursor: 'pointer', transition: 'opacity 0.15s',
                  }}
                  onClick={() => askHlna(`${a.title}: ${a.detail} Give me a step-by-step action plan.`)}
                >
                  <span style={{ fontSize: 10, fontWeight: 800, color: IMPACT_COLOR[a.impact], flexShrink: 0, paddingTop: 1 }}>
                    {a.rank}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(245,247,250,0.90)', marginBottom: 2 }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(230,237,243,0.55)', lineHeight: 1.4 }}>{a.detail}</div>
                  </div>
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                    color: IMPACT_COLOR[a.impact], flexShrink: 0, paddingTop: 2,
                  }}>{a.impact}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CTA row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!showAct && (
          <button
            onClick={loadActions}
            style={{
              padding: '5px 13px', borderRadius: 7, fontSize: 10, fontWeight: 700,
              background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.28)',
              color: '#FCA5A5', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.2s',
              fontFamily: FONT,
            }}
          >
            What should I do?
          </button>
        )}
        <button
          onClick={() => askHlna(`${briefing.greeting}. ${briefing.summary} Give me a detailed executive briefing covering all key metrics, risks, and the top 3 actions I should take today.`)}
          style={{
            padding: '5px 13px', borderRadius: 7, fontSize: 10, fontWeight: 700,
            background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.28)',
            color: '#C4B5FD', cursor: 'pointer', letterSpacing: '0.05em', transition: 'all 0.2s',
            fontFamily: FONT,
          }}
        >
          Ask HLNΛ →
        </button>
      </div>
    </div>
  );
}
