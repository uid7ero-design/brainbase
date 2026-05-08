'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

const WHAT_CHANGED = [
  { label: 'Missed bins', delta: '+12%', dir: 'up', impact: 'high' },
  { label: 'Route completion', delta: '−8%', dir: 'down', impact: 'high' },
  { label: 'Fuel expenditure', delta: '+5.2%', dir: 'up', impact: 'medium' },
  { label: 'Complaints filed', delta: '+8', dir: 'up', impact: 'medium' },
  { label: 'Recycling diversion', delta: '+1.4%', dir: 'down', impact: 'low' },
];

const RECOMMENDED = [
  { priority: 'critical', label: 'Reassign Routes 4 & 7 immediately', href: '/dashboard/waste' },
  { priority: 'high',     label: 'Schedule TRK-008 maintenance review', href: '/dashboard/fleet' },
  { priority: 'medium',   label: 'Brief Zone 3 crew on backlog targets', href: '/dashboard/waste' },
  { priority: 'low',      label: 'Review organics calendar for Q3',    href: '/reports' },
];

const AFFECTED = ['Southern Routes', 'Zone 3', 'Zone 8', 'Fleet TRK-008', 'Transfer Station N'];

const CONFIDENCE = 87;

interface Props {
  orbState?: 'idle' | 'thinking' | 'alert';
}

function useTyping(text: string, speed = 18) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setShown(''); setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { shown, done };
}

export default function HlnaBriefingWidget({ orbState = 'idle' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const summary = "Missed bins are up 12% today in the southern region. 2 routes are at risk of breaching KPI thresholds. Fuel trends indicate a projected 5% cost increase this month — TRK-008 is the primary contributor.";
  const { shown, done } = useTyping(summary, 18);

  const PRIORITY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: '#EF4444', bg: 'rgba(239,68,68,.10)',  border: 'rgba(239,68,68,.22)'  },
    high:     { color: '#F59E0B', bg: 'rgba(245,158,11,.10)', border: 'rgba(245,158,11,.22)' },
    medium:   { color: '#60A5FA', bg: 'rgba(96,165,250,.10)', border: 'rgba(96,165,250,.22)' },
    low:      { color: 'rgba(255,255,255,.35)', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.10)' },
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes hlna-cursor { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes hlna-blink  { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes hlna-expand { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes orb-breathe { 0%,100%{filter:drop-shadow(0 0 12px rgba(139,92,246,.4))} 50%{filter:drop-shadow(0 0 22px rgba(139,92,246,.65))} }
      `}} />

      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: 14, overflow: 'hidden',
        background: 'rgba(139,92,246,.04)',
        border: '1px solid rgba(139,92,246,.14)',
        backdropFilter: 'blur(20px)',
        fontFamily: FONT,
        position: 'relative',
        boxShadow: 'inset 0 1px 0 rgba(139,92,246,.08), 0 0 40px rgba(139,92,246,.04)',
      }}>
        {/* Ambient glow blob */}
        <div style={{
          position: 'absolute', top: -80, right: -80, width: 280, height: 280,
          borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
          background: `radial-gradient(circle,rgba(139,92,246,${orbState === 'thinking' ? '.18' : '.10'}) 0%,transparent 65%)`,
          transition: 'opacity .8s',
        }} />

        {/* Header */}
        <div style={{
          padding: '12px 18px', flexShrink: 0,
          borderBottom: '1px solid rgba(139,92,246,.10)',
          background: 'rgba(139,92,246,.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'hlna-blink 2.4s ease-in-out infinite' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/brand/hlna-wordmark.svg" alt="HLNA" style={{ height: 11, width: 'auto', opacity: 0.85 }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(167,139,250,.75)', letterSpacing: '.10em', textTransform: 'uppercase' }}>
              · Live Analysis
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              padding: '2px 8px', borderRadius: 4,
              background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.22)',
              fontSize: 9, fontWeight: 700, color: '#EF4444', letterSpacing: '.08em', textTransform: 'uppercase',
            }}>
              HIGH RISK
            </div>
            <button
              onClick={() => setExpanded(p => !p)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600,
                background: expanded ? 'rgba(139,92,246,.20)' : 'rgba(139,92,246,.08)',
                border: `1px solid ${expanded ? 'rgba(139,92,246,.40)' : 'rgba(139,92,246,.18)'}`,
                color: '#C4B5FD', cursor: 'pointer', fontFamily: FONT,
                transition: 'all .15s', letterSpacing: '.02em',
              }}
            >
              {expanded ? '↑ Collapse' : '↓ Full Briefing'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden auto', position: 'relative', zIndex: 1 }}>

          {/* Summary */}
          <div style={{ padding: '18px 20px 14px' }}>
            <p style={{ fontSize: 'clamp(13px,1.3vw,16px)', lineHeight: 1.80, color: 'rgba(230,237,243,.88)', margin: 0 }}>
              {done
                ? summary
                : <>{shown}<span style={{ borderRight: '2px solid #A78BFA', animation: 'hlna-cursor .8s step-end infinite', marginLeft: 1 }} /></>
              }
            </p>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <Link href="/dashboard/waste" style={{
                padding: '7px 14px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.28)',
                color: '#FCA5A5', textDecoration: 'none', letterSpacing: '.02em', transition: 'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.22)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(239,68,68,.20)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,.12)'; e.currentTarget.style.boxShadow = 'none'; }}>
                View routes →
              </Link>
              <button onClick={() => setExpanded(true)} style={{
                padding: '7px 14px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                background: 'rgba(139,92,246,.10)', border: '1px solid rgba(139,92,246,.24)',
                color: '#C4B5FD', cursor: 'pointer', fontFamily: FONT, letterSpacing: '.02em', transition: 'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,.20)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.10)'; }}>
                Resolve alerts
              </button>
            </div>
          </div>

          {/* Expanded intelligence panel */}
          {expanded && (
            <div style={{ padding: '0 20px 20px', animation: 'hlna-expand .2s ease' }}>
              <div style={{ height: 1, background: 'rgba(139,92,246,.12)', margin: '0 0 18px' }} />

              {/* Grid layout for intelligence */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

                {/* What changed */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 8 }}>
                    What Changed
                  </div>
                  {WHAT_CHANGED.map(c => {
                    const bad = c.dir === 'up' && c.impact !== 'low';
                    const col = bad ? '#EF4444' : c.impact === 'low' ? '#22C55E' : '#F59E0B';
                    return (
                      <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <span style={{ fontSize: 11, color: 'rgba(230,237,243,.60)', flex: 1 }}>{c.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{c.delta}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Recommended actions */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Recommended Actions
                  </div>
                  {RECOMMENDED.map(r => {
                    const c = PRIORITY_COLORS[r.priority];
                    return (
                      <Link key={r.label} href={r.href} style={{ display: 'block', padding: '6px 8px', borderRadius: 6, background: c.bg, border: `1px solid ${c.border}`, marginBottom: 5, textDecoration: 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: c.color, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 2 }}>
                          {r.priority}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(230,237,243,.78)', lineHeight: 1.4 }}>{r.label}</div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Analysis row */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Why It Changed
                </div>
                <p style={{ fontSize: 12, lineHeight: 1.65, color: 'rgba(230,237,243,.55)', margin: 0 }}>
                  Southern route delays stem from a combination of driver shortages in Zone 3 and capacity pressure at the northern transfer station. TRK-008&apos;s above-average fuel burn correlates with its elevated mileage since its last service at 87,400km. Complaint volume increase mirrors the delayed organics backlog.
                </p>
              </div>

              {/* Bottom row: affected areas + confidence */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Affected Areas
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {AFFECTED.map(a => (
                      <span key={a} style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 500,
                        background: 'rgba(139,92,246,.10)', border: '1px solid rgba(139,92,246,.20)',
                        color: '#C4B5FD',
                      }}>{a}</span>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Confidence
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: '#C4B5FD', letterSpacing: '-.03em' }}>{CONFIDENCE}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${CONFIDENCE}%`, borderRadius: 2, background: 'linear-gradient(90deg,#6D28D9,#A78BFA)', transition: 'width .6s ease' }} />
                  </div>
                  <div style={{ fontSize: 9.5, color: 'rgba(167,139,250,.55)', marginTop: 4 }}>Based on 6 data sources</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
