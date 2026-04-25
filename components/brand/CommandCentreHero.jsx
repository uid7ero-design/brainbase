'use client';

import { HlnaOrb } from './HlnaOrb';
import { HlnaWordmark } from './HlnaWordmark';

const INSIGHTS = [
  { label: 'Fleet availability at 88.4%', note: 'Below 92% target — action required', signal: 'warn' },
  { label: '3 service assets overdue',    note: 'Workshop review pending',            signal: 'risk' },
  { label: 'Cost-per-km trending up',     note: 'TRK-008 distorting average',         signal: 'warn' },
];

const SIGNAL_COLOR = {
  ok:   { dot: '#22C55E', text: 'rgba(34,197,94,.85)' },
  warn: { dot: '#F59E0B', text: 'rgba(245,158,11,.85)' },
  risk: { dot: '#EF4444', text: 'rgba(239,68,68,.85)'  },
};

export function CommandCentreHero({ insights = INSIGHTS, onReport = () => {}, onUpload = () => {}, onAsk = () => {} }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 32,
      padding: '32px 40px',
      borderRadius: 16,
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      marginBottom: 32,
      flexWrap: 'wrap',
    }}>

      {/* LEFT — identity + insights + actions */}
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '.14em',
          color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Command Centre
        </div>

        <h2 style={{
          fontSize: 'clamp(20px, 2.4vw, 28px)',
          fontWeight: 700,
          letterSpacing: '-.03em',
          color: '#F5F7FA',
          margin: '0 0 4px',
          lineHeight: 1.2,
        }}>
          Operational intelligence,<br />unified.
        </h2>
        <p style={{
          fontSize: 13,
          color: 'rgba(230,237,243,.45)',
          margin: '0 0 24px',
          lineHeight: 1.5,
        }}>
          Powered by HLNΛ — monitoring all systems
        </p>

        {/* Insights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {insights.map((item, i) => {
            const c = SIGNAL_COLOR[item.signal] ?? SIGNAL_COLOR.ok;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'rgba(230,237,243,.80)', fontWeight: 500 }}>
                  {item.label}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(230,237,243,.35)' }}>
                  — {item.note}
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={onReport}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.80)', cursor: 'pointer', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.06)'}
          >
            Generate Report
          </button>
          <button
            onClick={onUpload}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.80)', cursor: 'pointer', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.06)'}
          >
            Upload Data
          </button>
          <button
            onClick={onAsk}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(56,189,248,.18), rgba(139,92,246,.22))',
              border: '1px solid rgba(139,92,246,.35)',
              color: '#F5F7FA', cursor: 'pointer', letterSpacing: '.02em',
              transition: 'opacity .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.80'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Ask HLNΛ
          </button>
        </div>
      </div>

      {/* RIGHT — orb + identity */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <HlnaOrb size={140} state="idle" />

        <div style={{ textAlign: 'center' }}>
          <HlnaWordmark size="lg" style={{ justifyContent: 'center', marginBottom: 4 }} />
          <div style={{
            fontSize: 10, color: 'rgba(230,237,243,.35)', letterSpacing: '.10em',
            textTransform: 'uppercase', marginBottom: 10,
          }}>
            Hyper Learning Neural Agent
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E' }} />
            <span style={{ fontSize: 11, color: 'rgba(34,197,94,.75)', letterSpacing: '.06em' }}>
              Monitoring systems
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
