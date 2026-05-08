'use client';
import { useState } from 'react';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

const ZONES = [
  { id: 'A', label: 'North',    x: 60,  y: 30,  w: 100, h: 70,  status: 'critical', note: '2 incidents'  },
  { id: 'B', label: 'East',     x: 190, y: 30,  w: 90,  h: 70,  status: 'ok',       note: 'Normal'       },
  { id: 'C', label: 'CBD',      x: 120, y: 115, w: 80,  h: 60,  status: 'warning',  note: '1 alert'      },
  { id: 'D', label: 'West',     x: 30,  y: 115, w: 80,  h: 60,  status: 'warning',  note: 'Backlog'      },
  { id: 'E', label: 'South',    x: 120, y: 190, w: 100, h: 60,  status: 'critical', note: 'At capacity'  },
  { id: 'F', label: 'SE Ind.',  x: 240, y: 115, w: 70,  h: 90,  status: 'ok',       note: 'Normal'       },
];

const INCIDENTS = [
  { x: 95,  y: 62,  status: 'critical', label: 'Illegal dumping' },
  { x: 155, y: 142, status: 'warning',  label: 'Route delay'    },
  { x: 68,  y: 145, status: 'warning',  label: 'Driver shortage' },
  { x: 162, y: 215, status: 'critical', label: 'Transfer station at cap.' },
  { x: 230, y: 62,  status: 'ok',       label: 'Fleet depot'    },
];

const ROUTES = [
  { points: '95,62 120,90 155,142', status: 'warning'  },
  { points: '68,145 120,142 155,142', status: 'ok'      },
  { points: '155,142 162,175 162,215', status: 'critical' },
  { points: '230,62 200,90 200,142', status: 'ok'       },
];

const STATUS_COLORS = {
  critical: { fill: 'rgba(239,68,68,.12)',  border: '#EF4444', dot: '#EF4444',  glow: 'rgba(239,68,68,.5)'  },
  warning:  { fill: 'rgba(245,158,11,.10)', border: '#F59E0B', dot: '#F59E0B',  glow: 'rgba(245,158,11,.45)' },
  ok:       { fill: 'rgba(34,197,94,.06)',  border: '#22C55E', dot: '#22C55E',  glow: 'rgba(34,197,94,.4)'  },
};

const ROUTE_COLORS = { critical: '#EF444488', warning: '#F59E0B66', ok: '#22C55E55' };

export default function MapWidget() {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes map-pulse  { 0%,100%{r:4;opacity:.9} 50%{r:6.5;opacity:.4} }
        @keyframes map-ring   { 0%{r:5;opacity:.6} 100%{r:14;opacity:0} }
        @keyframes map-blink  { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}} />

      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: 14, overflow: 'hidden',
        background: 'rgba(5,6,9,.90)',
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,.70)" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>
              Operational Map
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ s: 'critical', l: 'Critical' }, { s: 'warning', l: 'Warn' }, { s: 'ok', l: 'Normal' }].map(({ s, l }) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_COLORS[s as keyof typeof STATUS_COLORS].dot }} />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.28)', letterSpacing: '.04em' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Map SVG */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Background grid */}
          <svg viewBox="0 0 320 260" style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="glow-critical"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter id="glow-warning"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter id="glow-ok"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>

            {/* Background */}
            <rect width="320" height="260" fill="#04050A" />

            {/* Subtle grid */}
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 28} y1={0} x2={i * 28} y2={260} stroke="rgba(255,255,255,.025)" strokeWidth="0.5" />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <line key={`h${i}`} x1={0} y1={i * 28} x2={320} y2={i * 28} stroke="rgba(255,255,255,.025)" strokeWidth="0.5" />
            ))}

            {/* Routes */}
            {ROUTES.map((r, i) => (
              <polyline key={i} points={r.points}
                fill="none" stroke={ROUTE_COLORS[r.status as keyof typeof ROUTE_COLORS]}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
            ))}

            {/* Zones */}
            {ZONES.map(z => {
              const c = STATUS_COLORS[z.status as keyof typeof STATUS_COLORS];
              const isHov = hovered === z.id;
              return (
                <g key={z.id} onMouseEnter={() => setHovered(z.id)} onMouseLeave={() => setHovered(null)}>
                  <rect x={z.x} y={z.y} width={z.w} height={z.h}
                    fill={isHov ? c.fill.replace(')', ', 0.22)').replace('rgba', 'rgba') : c.fill}
                    stroke={c.border} strokeWidth={isHov ? 1.2 : 0.6} strokeOpacity={isHov ? 0.9 : 0.45}
                    rx={3} style={{ cursor: 'pointer', transition: 'all .2s' }}
                  />
                  <text x={z.x + z.w / 2} y={z.y + z.h / 2 - 5}
                    textAnchor="middle" fill="rgba(255,255,255,.50)" fontSize="8" fontFamily={FONT} fontWeight="600">
                    {z.label}
                  </text>
                  <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 7}
                    textAnchor="middle" fill={c.border} fontSize="7" fontFamily={FONT} opacity="0.80">
                    {z.note}
                  </text>
                </g>
              );
            })}

            {/* Incident markers */}
            {INCIDENTS.map((inc, i) => {
              const c = STATUS_COLORS[inc.status as keyof typeof STATUS_COLORS];
              const isCrit = inc.status === 'critical';
              return (
                <g key={i} filter={`url(#glow-${inc.status})`}>
                  {isCrit && (
                    <circle cx={inc.x} cy={inc.y} r={5} fill="none" stroke={c.dot} strokeWidth="0.8" opacity="0.5">
                      <animate attributeName="r" values="5;14" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.5;0" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={inc.x} cy={inc.y} r={4} fill={c.dot} opacity="0.90">
                    {isCrit && <animate attributeName="r" values="3.5;5;3.5" dur="1.8s" repeatCount="indefinite" />}
                  </circle>
                </g>
              );
            })}

            {/* Compass */}
            <g transform="translate(292,22)">
              <circle cx={0} cy={0} r={10} fill="rgba(0,0,0,.50)" stroke="rgba(255,255,255,.10)" strokeWidth="0.6" />
              <text x={0} y={-3} textAnchor="middle" fill="rgba(255,255,255,.70)" fontSize="7" fontFamily={FONT} fontWeight="700">N</text>
              <line x1={0} y1={-1} x2={0} y2={-8} stroke="rgba(255,255,255,.55)" strokeWidth="0.8" />
              <line x1={0} y1={1}  x2={0} y2={8}  stroke="rgba(255,255,255,.22)" strokeWidth="0.8" />
            </g>

            {/* Scan line overlay */}
            <rect x={0} y={0} width={320} height={2} fill="rgba(139,92,246,.04)" opacity="0.4">
              <animateTransform attributeName="transform" type="translate" from="0,0" to="0,260" dur="6s" repeatCount="indefinite" />
            </rect>
          </svg>

          {/* Incident tooltip */}
          {hovered && (
            <div style={{
              position: 'absolute', bottom: 10, left: 10, right: 10,
              padding: '6px 10px', borderRadius: 6,
              background: 'rgba(0,0,0,.85)', border: '1px solid rgba(255,255,255,.10)',
              fontSize: 10.5, color: 'rgba(255,255,255,.80)',
              backdropFilter: 'blur(8px)', pointerEvents: 'none',
            }}>
              <span style={{ fontWeight: 600 }}>{ZONES.find(z => z.id === hovered)?.label}</span>
              {' — '}
              {ZONES.find(z => z.id === hovered)?.note}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '7px 14px', flexShrink: 0,
          borderTop: '1px solid rgba(255,255,255,.055)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', letterSpacing: '.04em' }}>
            Metro Council Area  ·  6 operational zones
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22C55E', animation: 'map-blink 2.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, color: 'rgba(34,197,94,.60)', letterSpacing: '.04em' }}>Live</span>
          </div>
        </div>
      </div>
    </>
  );
}
