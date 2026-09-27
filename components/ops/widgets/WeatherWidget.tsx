'use client';
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/app';
import styles from './widgets.module.css';

// Phase D2 — on the shared panel surface and theme tokens (was dark-only
// glass with blur and glowing dots). Every value here is static sample
// content (see the audit's hard-coded data list) and is unchanged.
// Colour carries meaning only: impact level (also written) and rain.

const FORECAST = [
  { day: 'Thu', icon: '⛅', hi: 19, lo: 12, rain: 2  },
  { day: 'Fri', icon: '🌧', hi: 16, lo: 11, rain: 18 },
  { day: 'Sat', icon: '🌧', hi: 14, lo: 10, rain: 24 },
  { day: 'Sun', icon: '⛅', hi: 17, lo: 11, rain: 5  },
  { day: 'Mon', icon: '☀',  hi: 21, lo: 13, rain: 0  },
  { day: 'Tue', icon: '☀',  hi: 23, lo: 14, rain: 0  },
  { day: 'Wed', icon: '⛅', hi: 20, lo: 13, rain: 3  },
];

const OPERATIONAL_IMPACTS = [
  { area: 'Waste Collection',  impact: 'medium', note: 'Wet roads — 15% slower'    },
  { area: 'Fleet Routing',     impact: 'low',    note: 'Normal operations'          },
  { area: 'Parks & Gardens',   impact: 'high',   note: 'Flooding risk Zone 8'       },
  { area: 'Roads',             impact: 'medium', note: 'Ponding — 3 locations'      },
];

const IMPACT_STATE: Record<string, { status: 'danger' | 'warning' | 'success'; badge: 'error' | 'warning' | 'success' }> = {
  high:   { status: 'danger',  badge: 'error'   },
  medium: { status: 'warning', badge: 'warning' },
  low:    { status: 'success', badge: 'success' },
};

function RainBar({ pct }: { pct: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 100); return () => clearTimeout(t); }, [pct]);
  return (
    <div aria-hidden="true" style={{ height: 2, width: '100%', background: 'var(--bg-sunken)', borderRadius: 1, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ height: '100%', width: `${w}%`, background: 'var(--status-info)', borderRadius: 1, transition: 'width .8s ease' }} />
    </div>
  );
}

export default function WeatherWidget() {
  const maxRain = Math.max(...FORECAST.map(f => f.rain));

  return (
    <section className={styles.panel} aria-labelledby="wx-title">
      {/* Header */}
      <div className={styles.header}>
        <h2 id="wx-title" className={styles.title}>Weather Intelligence</h2>
        <Badge state="warning">Rain incoming</Badge>
      </div>

      <div className={styles.body} style={{ padding: 14 }}>

        {/* Current conditions */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <div>
            <span className={styles.temp}>19°</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>C</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>Partly Cloudy</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Feels like 17°  ·  Humidity 62%</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Wind SE  22 km/h  ·  UV Index: Low</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className={styles.label} style={{ marginBottom: 4 }}>Tonight</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--status-info)', fontVariantNumeric: 'tabular-nums' }}>8mm</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>rain forecast</div>
          </div>
        </div>

        {/* 7-day forecast */}
        <div style={{ marginBottom: 16 }}>
          <h3 className={styles.label}>7-Day Forecast</h3>
          <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
            {FORECAST.map((f, i) => (
              <li key={f.day} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)', marginBottom: 4 }}>
                  {i === 0 ? 'Today' : f.day}
                </div>
                <div style={{ fontSize: 16, marginBottom: 3 }} aria-hidden="true">{f.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{f.hi}°</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{f.lo}°</div>
                {f.rain > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--status-info)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{f.rain}mm</div>
                    <RainBar pct={Math.round((f.rain / maxRain) * 100)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Operational impact */}
        <div>
          <h3 className={styles.label}>Operational Impact</h3>
          <ul style={{ display: 'grid', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
            {OPERATIONAL_IMPACTS.map(item => {
              const s = IMPACT_STATE[item.impact];
              return (
                <li key={item.area} className={styles.tone} data-status={s.status} style={{
                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                  padding: '6px 10px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', background: 'var(--bg-base)',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{item.area}</span>
                  <span className={styles.statusText} style={{ fontSize: 12 }}>{item.note}</span>
                  <Badge state={s.badge}>{item.impact}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
