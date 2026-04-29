'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';

type Insight = {
  headline: string;
  trend: string | null;
  trendDir: 'up' | 'down' | 'flat';
  trendPositive: boolean;
  anomaly: string | null;
  recommendation: string;
  confidence: 'High' | 'Medium' | 'Low';
  hasData: boolean;
  timestamp: string;
};

const CONF_COLOR = { High: '#34D399', Medium: '#FBBF24', Low: '#9CA3AF' };

function TrendBadge({ trend, trendDir, trendPositive }: Pick<Insight, 'trend' | 'trendDir' | 'trendPositive'>) {
  if (!trend) return null;
  const arrow = trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→';
  const good  = trendDir === 'flat' ? true : trendPositive === (trendDir === 'down');
  const color = good ? '#34D399' : '#F87171';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: color + '18', color, border: `1px solid ${color}30`,
      flexShrink: 0,
    }}>
      {arrow} {trend}
    </span>
  );
}

function Shimmer() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(167,139,250,0.12)',
      borderRadius: 12, padding: '14px 18px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(167,139,250,0.4)', animation: 'agentPulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 8, width: 90, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
      </div>
      <div style={{ height: 13, width: '72%', borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginBottom: 8 }} />
      <div style={{ height: 11, width: '50%', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }} />
    </div>
  );
}

export function HlnaInsightBanner({ dashboardType }: { dashboardType: string }) {
  const [insight, setInsight]   = useState<Insight | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(false);
  const [elapsed, setElapsed]   = useState('');
  const { fireHelena, setOrbAlert } = useAppStore();

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res  = await fetch('/api/hlna/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardType }),
      });
      const data: Insight = await res.json();
      setInsight(data);
      if (data.anomaly) setOrbAlert(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [dashboardType, setOrbAlert]);

  useEffect(() => { load(); }, [load]);

  // Relative timestamp
  useEffect(() => {
    if (!insight?.timestamp) return;
    function update() {
      const secs = Math.floor((Date.now() - new Date(insight!.timestamp).getTime()) / 1000);
      if (secs < 60)        setElapsed(`${secs}s ago`);
      else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m ago`);
      else                  setElapsed(`${Math.floor(secs / 3600)}h ago`);
    }
    update();
    const t = setInterval(update, 15_000);
    return () => clearInterval(t);
  }, [insight?.timestamp]);

  if (loading) return <Shimmer />;
  if (error || !insight || !insight.hasData) return null;

  const labelMap: Record<string, string> = {
    waste: 'Waste Operations',
    fleet: 'Fleet Operations',
    service_requests: 'Service Requests',
  };

  const sourceMap: Record<string, string> = {
    waste:            'waste_records',
    fleet:            'fleet_metrics',
    service_requests: 'service_requests',
  };

  const rangeMap: Record<string, string> = {
    waste:            'Full financial year',
    fleet:            'Full financial year',
    service_requests: 'All records',
  };

  const sourceTable = sourceMap[dashboardType] ?? dashboardType;
  const timeRange   = rangeMap[dashboardType] ?? 'Historical data';

  function askAbout(q: string) {
    fireHelena(q);
    useAppStore.getState().setChatOpen(true);
  }

  return (
    <div style={{
      background: 'rgba(167,139,250,0.04)',
      border: '1px solid rgba(167,139,250,0.18)',
      borderRadius: 12,
      padding: '14px 18px',
      marginBottom: 16,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle left accent */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, #A78BFA, #38BDF8)', borderRadius: '12px 0 0 12px' }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(167,139,250,0.80)', textTransform: 'uppercase' }}>◈ HLNΛ · {labelMap[dashboardType] ?? dashboardType} Insight</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.05em' }}>
          Updated {elapsed}
        </span>
        <button
          onClick={load}
          title="Refresh insight"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
        >
          ↻
        </button>
      </div>

      {/* Headline + trend */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: insight.anomaly ? 8 : 6 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'rgba(245,247,250,0.92)', lineHeight: 1.5, flex: 1, minWidth: 200 }}>
          {insight.headline}
        </p>
        {insight.trend && <TrendBadge trend={insight.trend} trendDir={insight.trendDir} trendPositive={insight.trendPositive} />}
      </div>

      {/* Anomaly flag */}
      {insight.anomaly && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          padding: '6px 10px', borderRadius: 7, marginBottom: 8,
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.20)',
        }}>
          <span style={{ fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}>⚠</span>
          <span style={{ fontSize: 11, color: 'rgba(253,224,120,0.90)', lineHeight: 1.4 }}>{insight.anomaly}</span>
        </div>
      )}

      {/* Trust metadata */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.26)', letterSpacing: '0.04em' }}>
          Source: <span style={{ color: 'rgba(255,255,255,0.40)' }}>{sourceTable}</span>
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.26)', letterSpacing: '0.04em' }}>
          Range: <span style={{ color: 'rgba(255,255,255,0.40)' }}>{timeRange}</span>
        </span>
        <span style={{ fontSize: 9, letterSpacing: '0.04em' }}>
          Confidence: <span style={{ color: CONF_COLOR[insight.confidence], fontWeight: 700 }}>{insight.confidence}</span>
        </span>
      </div>

      {/* Recommendation row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(56,189,248,0.70)', letterSpacing: '0.06em', flexShrink: 0, paddingTop: 1 }}>REC</span>
          <span style={{ fontSize: 11, color: 'rgba(230,237,243,0.65)', lineHeight: 1.4 }}>{insight.recommendation}</span>
        </div>
        <button
          onClick={() => askAbout(`Based on the current ${labelMap[dashboardType] ?? dashboardType} data, ${insight.headline.toLowerCase()} ${insight.anomaly ? `The main anomaly is: ${insight.anomaly}.` : ''} Give me a detailed analysis and recommended actions.`)}
          style={{
            flexShrink: 0, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
            background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.32)',
            color: '#C4B5FD', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.24)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.14)'; }}
        >
          Ask HLNΛ →
        </button>
      </div>
    </div>
  );
}
