'use client';

import React from 'react';
import { DASHBOARD_TOKENS as th, TONE } from './tokens';

export interface BudgetVsActual {
  budget: number;
  actual: number;
}

export interface ExecutivePanelProps {
  budgetVsActual?:  BudgetVsActual;
  topCostDriver?:   string;
  biggestRisk?:     string;
  savingsIdentified?: number;
  confidence?:      number;
  lastUpdated?:     string;
  /** Accepted for API compatibility; kept only as the panel's top rule. */
  accentColor:      string;
  /** Accepted for API compatibility only — the panel follows the app theme. */
  theme?:           'light' | 'dark';
  loading?:         boolean;
  sticky?:          boolean;
}

// Executive snapshot (authenticated visual-completion pass): one flat token
// panel. Over/under budget uses the semantic danger/success tokens and is
// written out ("over"/"under budget"), not signalled by colour alone.
export default function ExecutivePanel({
  budgetVsActual, topCostDriver, biggestRisk,
  savingsIdentified, confidence, lastUpdated,
  accentColor, loading = false, sticky = false,
}: ExecutivePanelProps) {
  const variance      = budgetVsActual ? budgetVsActual.actual - budgetVsActual.budget : 0;
  const varianceColor = variance > 0 ? TONE.danger.fg : TONE.success.fg;
  const variancePct   = budgetVsActual && budgetVsActual.budget > 0
    ? Math.round((variance / budgetVsActual.budget) * 100)
    : 0;
  const actualPct     = budgetVsActual && budgetVsActual.budget > 0
    ? Math.min(100, Math.round((budgetVsActual.actual / budgetVsActual.budget) * 100))
    : 0;

  const frame: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderTop: `2px solid ${accentColor}`,
    borderRadius: 'var(--radius-lg)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    position: sticky ? 'sticky' : 'static',
    top: sticky ? 0 : undefined,
  };

  if (loading) {
    return (
      <div style={frame} aria-busy="true">
        {[80, 60, 60, 80, 50].map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: 10, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: th.t3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={frame}>
      <div style={{ fontSize: 11, fontWeight: 600, color: th.t2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
        Executive Snapshot
      </div>

      {/* Budget vs Actual */}
      {budgetVsActual && budgetVsActual.budget > 0 && (
        <Row label="Budget vs Actual">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: varianceColor, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
              ${budgetVsActual.actual.toLocaleString()}
            </span>
            <span style={{ fontSize: 11, color: th.t3 }}>of ${budgetVsActual.budget.toLocaleString()}</span>
          </div>
          <div aria-hidden="true" style={{ height: 5, background: 'var(--bg-sunken)', borderRadius: 3 }}>
            <div style={{ height: '100%', width: `${actualPct}%`, background: varianceColor, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11, color: varianceColor, fontWeight: 700, marginTop: 3 }}>
            <span aria-hidden="true">{variance > 0 ? '▲' : '▼'} </span>{Math.abs(variancePct)}% {variance > 0 ? 'over' : 'under'} budget
          </div>
        </Row>
      )}

      {/* Top Cost Driver */}
      {topCostDriver && (
        <Row label="Top Cost Driver">
          <div style={{ fontSize: 12, color: th.t1, lineHeight: 1.4, fontWeight: 500 }}>{topCostDriver}</div>
        </Row>
      )}

      {/* Biggest Risk */}
      {biggestRisk && (
        <Row label="Biggest Risk">
          <div style={{ fontSize: 12, color: TONE.danger.fg, lineHeight: 1.4, fontWeight: 500 }}>{biggestRisk}</div>
        </Row>
      )}

      {/* Projected Savings */}
      {savingsIdentified !== undefined && savingsIdentified > 0 && (
        <Row label="Projected Savings">
          <div style={{ fontSize: 18, fontWeight: 700, color: th.t1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            ${savingsIdentified.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: th.t3 }}>identified by AI analysis</div>
        </Row>
      )}

      {/* AI Confidence */}
      {confidence !== undefined && (
        <Row label="AI Confidence">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: th.t1 }}>{confidence}%</span>
            <span style={{ fontSize: 11, color: th.t3 }}>{lastUpdated ?? ''}</span>
          </div>
          <div aria-hidden="true" style={{ height: 4, background: 'var(--bg-sunken)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${confidence}%`, background: 'var(--brand-brainbase-accent)', borderRadius: 2 }} />
          </div>
        </Row>
      )}
    </div>
  );
}
