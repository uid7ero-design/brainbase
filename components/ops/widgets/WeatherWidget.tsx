'use client';
import { useState, useEffect } from 'react';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

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

const IMPACT_COLORS: Record<string, { color: string; bg: string }> = {
  high:   { color: '#EF4444', bg: 'rgba(239,68,68,.10)'  },
  medium: { color: '#F59E0B', bg: 'rgba(245,158,11,.10)' },
  low:    { color: '#22C55E', bg: 'rgba(34,197,94,.08)'  },
};

function RainBar({ pct, color }: { pct: number; color: string }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 100); return () => clearTimeout(t); }, [pct]);
  return (
    <div style={{ height: 2, width: '100%', background: 'rgba(255,255,255,.08)', borderRadius: 1, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 1, transition: 'width .8s ease' }} />
    </div>
  );
}

export default function WeatherWidget() {
  const maxRain = Math.max(...FORECAST.map(f => f.rain));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes wx-blink{0%,100%{opacity:1}50%{opacity:.35}}` }} />

      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: 14, overflow: 'hidden',
        background: 'rgba(7,8,11,.75)',
        border: '1px solid rgba(255,255,255,.07)',
        backdropFilter: 'blur(16px)',
        fontFamily: FONT,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)',
      }}>
        {/* Header */}
        <div style={{
          padding: '10px 14px', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,.055)',
          background: 'rgba(255,255,255,.015)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,.70)" strokeWidth="2" strokeLinecap="round"><path d="M17 8C8 10 5.9 16.17 3.82 22"/><path d="M9.05 17.17C11 14.5 16 13 21 14"/><path d="M12 3a9 9 0 01-9 9"/></svg>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>
              Weather Intelligence
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 7px', borderRadius: 4, background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.20)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#F59E0B', animation: 'wx-blink 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', letterSpacing: '.06em', textTransform: 'uppercase' }}>Rain incoming</span>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden auto', padding: '14px' }}>

          {/* Current conditions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 42, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.04em', lineHeight: 1 }}>19°</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', fontWeight: 500 }}>C</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.72)', marginBottom: 3 }}>Partly Cloudy</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>Feels like 17°  ·  Humidity 62%</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.35)' }}>Wind SE  22 km/h  ·  UV Index: Low</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.25)', textTransform: 'uppercase', marginBottom: 4 }}>Tonight</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#60A5FA', letterSpacing: '-.02em' }}>8mm</div>
              <div style={{ fontSize: 9.5, color: 'rgba(96,165,250,.55)' }}>rain forecast</div>
            </div>
          </div>

          {/* 7-day forecast */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.20)', textTransform: 'uppercase', marginBottom: 8 }}>7-Day Forecast</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
              {FORECAST.map((f, i) => (
                <div key={f.day} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: i === 0 ? 'rgba(167,139,250,.80)' : 'rgba(255,255,255,.25)', marginBottom: 4, letterSpacing: '.04em' }}>
                    {i === 0 ? 'Today' : f.day}
                  </div>
                  <div style={{ fontSize: 16, marginBottom: 3 }}>{f.icon}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.72)' }}>{f.hi}°</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.28)' }}>{f.lo}°</div>
                  {f.rain > 0 && (
                    <>
                      <div style={{ fontSize: 9, color: '#60A5FA', marginTop: 2 }}>{f.rain}mm</div>
                      <RainBar pct={Math.round((f.rain / maxRain) * 100)} color="#3B82F6" />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Operational impact */}
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.20)', textTransform: 'uppercase', marginBottom: 8 }}>Operational Impact</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {OPERATIONAL_IMPACTS.map(item => {
                const c = IMPACT_COLORS[item.impact];
                return (
                  <div key={item.area} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 7,
                    background: c.bg, border: `1px solid ${c.color}20`,
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, boxShadow: `0 0 5px ${c.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.65)', flex: 1 }}>{item.area}</span>
                    <span style={{ fontSize: 10.5, color: c.color, fontWeight: 500 }}>{item.note}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
