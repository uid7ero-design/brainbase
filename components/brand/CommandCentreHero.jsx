'use client';

import { BrokenOrbitMark } from './BrokenOrbitMark';
import { HlnaWordmark } from './HlnaWordmark';
import { buttonProps } from '../ui/app/Button';

// Visual (authenticated visual-completion pass): the idle HlnaOrb here was a
// product logo, not a functional state visual (it was hard-wired to
// state="idle"), so it is replaced by the approved BrokenOrbitMark in its
// HLNA context. The panel is a flat token surface; the "Ask HLNΛ" gradient
// became the primary button; signal dots keep their success/warning/danger
// meaning via status tokens with the label text in --text-primary.

const INSIGHTS = [
  { label: 'Fleet availability at 88.4%', note: 'Below 92% target — action required', signal: 'warn' },
  { label: '3 service assets overdue',    note: 'Workshop review pending',            signal: 'risk' },
  { label: 'Cost-per-km trending up',     note: 'TRK-008 distorting average',         signal: 'warn' },
];

const SIGNAL_COLOR = {
  ok:   { dot: 'var(--status-success)' },
  warn: { dot: 'var(--status-warning)' },
  risk: { dot: 'var(--status-danger)' },
};

export function CommandCentreHero({ insights = INSIGHTS, onReport = () => {}, onUpload = () => {}, onAsk = () => {} }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 32,
      padding: '28px 32px',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      marginBottom: 32,
      flexWrap: 'wrap',
      color: 'var(--text-primary)',
      fontFamily: 'var(--bb-font-sans)',
    }}>

      {/* LEFT — identity + insights + actions */}
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '.14em',
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Ops Hub
        </div>

        <h2 style={{
          fontSize: 'clamp(20px, 2.4vw, 28px)',
          fontWeight: 700,
          letterSpacing: '-.02em',
          color: 'var(--text-primary)',
          margin: '0 0 4px',
          lineHeight: 1.2,
        }}>
          All dashboards,<br />one place.
        </h2>
        <p style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          margin: '0 0 24px',
          lineHeight: 1.5,
        }}>
          Browse and drill into any intelligence module. Powered by HLNΛ.
        </p>

        {/* Insights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {insights.map((item, i) => {
            const c = SIGNAL_COLOR[item.signal] ?? SIGNAL_COLOR.ok;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {item.label}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  — {item.note}
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={onReport} {...buttonProps('secondary')}>
            Generate Report
          </button>
          <button type="button" onClick={onUpload} {...buttonProps('secondary')}>
            Upload Data
          </button>
          <button type="button" onClick={onAsk} {...buttonProps('primary')}>
            Ask HLNΛ
          </button>
        </div>
      </div>

      {/* RIGHT — HLNA identity mark */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <BrokenOrbitMark size={72} context="hlna" />

        <div style={{ textAlign: 'center' }}>
          <HlnaWordmark size="lg" style={{ justifyContent: 'center', marginBottom: 4 }} />
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.10em',
            textTransform: 'uppercase', marginBottom: 10,
          }}>
            Hyper Learning Neural Agent
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-success)' }} />
            <span style={{ fontSize: 12, color: 'var(--status-success)', letterSpacing: '.04em' }}>
              Monitoring systems
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
