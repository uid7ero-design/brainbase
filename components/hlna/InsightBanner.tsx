'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { buttonProps } from '@/components/ui/app';
import styles from './InsightBanner.module.css';

type Insight = {
  headline: string;
  trend: string | null;
  trendDir: 'up' | 'down' | 'flat';
  trendPositive: boolean;
  anomaly: string | null;
  recommendation: string;
  confidence: 'High' | 'Medium' | 'Low';
  rowsAnalysed?: number;
  hasData: boolean;
  timestamp: string;
};

const CONF_CLASS = { High: styles.confHigh, Medium: styles.confMedium, Low: styles.confLow };

function TrendBadge({ trend, trendDir, trendPositive }: Pick<Insight, 'trend' | 'trendDir' | 'trendPositive'>) {
  if (!trend) return null;
  const arrow = trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→';
  const good  = trendDir === 'flat' ? true : trendPositive === (trendDir === 'down');
  return (
    <span className={`${styles.trend} ${good ? styles.trendGood : styles.trendBad}`}>
      {arrow} {trend}
    </span>
  );
}

function Shimmer() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skRow}>
        <div className={styles.skDot} />
        <div className={styles.skBar} style={{ height: 8, width: 90 }} />
      </div>
      <div className={styles.skBar} style={{ height: 13, width: '72%', marginBottom: 8 }} />
      <div className={styles.skBar} style={{ height: 11, width: '50%' }} />
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
    <div className={styles.banner}>
      {/* Header row */}
      <div className={styles.head}>
        <span className={styles.eyebrow}>◈ HLNΛ · {labelMap[dashboardType] ?? dashboardType} Insight</span>
        <span className={styles.spacer} />
        <span className={styles.updated}>
          Updated {elapsed}
        </span>
        <button
          type="button"
          onClick={load}
          title="Refresh insight"
          aria-label="Refresh insight"
          className={styles.refresh}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      {/* Headline + trend */}
      <div className={styles.headlineRow} style={{ marginBottom: insight.anomaly ? 8 : 6 }}>
        <p className={styles.headline}>
          {insight.headline}
        </p>
        {insight.trend && <TrendBadge trend={insight.trend} trendDir={insight.trendDir} trendPositive={insight.trendPositive} />}
      </div>

      {/* Anomaly flag */}
      {insight.anomaly && (
        <div className={styles.anomaly}>
          <span className={styles.anomalyIcon}>⚠</span>
          <span>{insight.anomaly}</span>
        </div>
      )}

      {/* Trust metadata */}
      <div className={styles.meta}>
        <span>
          Source: <span className={styles.metaValueMono}>{sourceTable}</span>
        </span>
        <span>
          Range: <span className={styles.metaValue}>{timeRange}</span>
        </span>
        {insight.rowsAnalysed != null && insight.rowsAnalysed > 0 && (
          <span>
            Rows: <span className={styles.metaValue}>{insight.rowsAnalysed.toLocaleString()}</span>
          </span>
        )}
        <span>
          Confidence: <span className={`${styles.confidence} ${CONF_CLASS[insight.confidence]}`}>{insight.confidence}</span>
        </span>
      </div>

      {/* Recommendation row */}
      <div className={styles.recRow}>
        <div className={styles.rec}>
          <span className={styles.recLabel}>REC</span>
          <span className={styles.recText}>{insight.recommendation}</span>
        </div>
        <button
          type="button"
          {...buttonProps('secondary', 'sm')}
          onClick={() => askAbout(`Based on the current ${labelMap[dashboardType] ?? dashboardType} data, ${insight.headline.toLowerCase()} ${insight.anomaly ? `The main anomaly is: ${insight.anomaly}.` : ''} Give me a detailed analysis and recommended actions.`)}
        >
          Ask HLNΛ →
        </button>
      </div>
    </div>
  );
}
