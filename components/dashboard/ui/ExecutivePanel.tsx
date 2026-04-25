'use client';

import React from 'react';
import { getTheme } from './tokens';

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
  accentColor:      string;
  theme?:           'light' | 'dark';
  loading?:         boolean;
  sticky?:          boolean;
}

export default function ExecutivePanel({
  budgetVsActual, topCostDriver, biggestRisk,
  savingsIdentified, confidence, lastUpdated,
  accentColor, theme = 'dark', loading = false, sticky = false,
}: ExecutivePanelProps) {
  const th = getTheme(theme);
  const L  = theme === 'light';

  const variance      = budgetVsActual ? budgetVsActual.actual - budgetVsActual.budget : 0;
  const varianceColor = variance > 0 ? '#ef4444' : '#10b981';
  const variancePct   = budgetVsActual && budgetVsActual.budget > 0
    ? Math.round((variance / budgetVsActual.budget) * 100)
    : 0;
  const actualPct     = budgetVsActual && budgetVsActual.budget > 0
    ? Math.min(100, Math.round((budgetVsActual.actual / budgetVsActual.budget) * 100))
    : 0;

  if (loading) {
    return (
      <div style={{ background: L ? '#f8fafc' : 'rgba(255,255,255,0.025)', border: `1px solid ${th.bdr}`, borderRadius: 10, padding: '14px 16px', position: sticky ? 'sticky' : 'static', top: sticky ? 0 : undefined }}>
        {[80, 60, 60, 80, 50].map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: 10, background: th.bdr, borderRadius: 4, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: th.t3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={{
      background: L
        ? `linear-gradient(160deg, ${accentColor}07 0%, #ffffff 50%)`
        : `linear-gradient(160deg, ${accentColor}10 0%, rgba(255,255,255,0.04) 70%)`,
      border: `1.5px solid ${L ? accentColor + '28' : accentColor + '20'}`,
      borderTop: `3px solid ${accentColor}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      boxShadow: L
        ? `0 1px 3px rgba(0,0,0,0.05), 0 6px 20px ${accentColor}14, 0 0 0 1px ${accentColor}10`
        : `0 2px 12px rgba(0,0,0,0.35), 0 4px 20px ${accentColor}18`,
      position: sticky ? 'sticky' : 'static',
      top: sticky ? 0 : undefined,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        Executive Snapshot
      </div>

      {/* Budget vs Actual */}
      {budgetVsActual && budgetVsActual.budget > 0 && (
        <Row label="Budget vs Actual">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: varianceColor, letterSpacing: '-0.02em' }}>
              ${budgetVsActual.actual.toLocaleString()}
            </span>
            <span style={{ fontSize: 10, color: th.t3 }}>of ${budgetVsActual.budget.toLocaleString()}</span>
          </div>
          <div style={{ height: 5, background: th.sub, borderRadius: 3 }}>
            <div style={{ height: '100%', width: `${actualPct}%`, background: varianceColor, borderRadius: 3, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ fontSize: 10, color: varianceColor, fontWeight: 700, marginTop: 3 }}>
            {variance > 0 ? '▲' : '▼'} {Math.abs(variancePct)}% {variance > 0 ? 'over' : 'under'} budget
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
          <div style={{ fontSize: 11.5, color: '#ef4444', lineHeight: 1.4, fontWeight: 500 }}>{biggestRisk}</div>
        </Row>
      )}

      {/* Projected Savings */}
      {savingsIdentified !== undefined && savingsIdentified > 0 && (
        <Row label="Projected Savings">
          <div style={{ fontSize: 18, fontWeight: 800, color: accentColor, letterSpacing: '-0.02em' }}>
            ${savingsIdentified.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: th.t3 }}>identified by AI analysis</div>
        </Row>
      )}

      {/* AI Confidence */}
      {confidence !== undefined && (
        <Row label="AI Confidence">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: accentColor }}>{confidence}%</span>
            <span style={{ fontSize: 10, color: th.t3 }}>{lastUpdated ?? ''}</span>
          </div>
          <div style={{ height: 4, background: th.sub, borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${confidence}%`, background: `linear-gradient(90deg, ${accentColor}80, ${accentColor})`, borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>
        </Row>
      )}
    </div>
  );
}
