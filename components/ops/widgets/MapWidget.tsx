'use client';
import { useState } from 'react';
import { useChartPalette } from '@/components/ui/app/chartPalette';
import styles from './widgets.module.css';

// Phase D2 — the operational map on the shared panel surface. SVG colours
// come from the JS chart palette (theme-aware; SVG attributes cannot rely
// on CSS variables), so zones, routes and markers keep contrast in both
// themes. Removed as decoration: the forced-black canvas, Gaussian-blur
// glow filters, pulsing/ringing markers, the scan-line sweep and the
// blinking dot. The zone hover read-out is kept (and its invalid rgba fill
// on hover is now a plain fill-opacity change). All zones, incidents and
// routes are static sample content, unchanged.

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

type MapStatus = 'critical' | 'warning' | 'ok';

const STATUS_LABEL: Record<MapStatus, string> = { critical: 'Critical', warning: 'Warning', ok: 'Normal' };
const STATUS_TONE: Record<MapStatus, 'danger' | 'warning' | 'success'> = { critical: 'danger', warning: 'warning', ok: 'success' };

export default function MapWidget() {
  const [hovered, setHovered] = useState<string | null>(null);
  const chart = useChartPalette();
  const colour = (s: string) => chart[STATUS_TONE[s as MapStatus]];
  const hoveredZone = ZONES.find(z => z.id === hovered);

  return (
    <section className={styles.panel} aria-labelledby="map-title">
      {/* Header */}
      <div className={styles.header}>
        <h2 id="map-title" className={styles.title}>Operational Map</h2>
      </div>

      {/* Map SVG */}
      <div className={styles.mapWrap}>
        <svg viewBox="0 0 320 260" className={styles.mapSvg} preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="map-title map-desc">
          <desc id="map-desc">
            {ZONES.map(z => `${z.label}: ${STATUS_LABEL[z.status as MapStatus]}, ${z.note}.`).join(' ')}
          </desc>

          {/* Subtle grid */}
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 28} y1={0} x2={i * 28} y2={260} stroke={chart.grid} strokeWidth="0.5" />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 28} x2={320} y2={i * 28} stroke={chart.grid} strokeWidth="0.5" />
          ))}

          {/* Routes */}
          {ROUTES.map((r, i) => (
            <polyline key={i} points={r.points}
              fill="none" stroke={colour(r.status)} strokeOpacity={0.7}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
          ))}

          {/* Zones */}
          {ZONES.map(z => {
            const c = colour(z.status);
            const isHov = hovered === z.id;
            return (
              <g key={z.id} onMouseEnter={() => setHovered(z.id)} onMouseLeave={() => setHovered(null)}>
                <rect x={z.x} y={z.y} width={z.w} height={z.h}
                  fill={c} fillOpacity={isHov ? 0.2 : 0.08}
                  stroke={c} strokeWidth={isHov ? 1.2 : 0.8} strokeOpacity={isHov ? 1 : 0.6}
                  rx={3} style={{ cursor: 'pointer' }}
                />
                <text x={z.x + z.w / 2} y={z.y + z.h / 2 - 5}
                  textAnchor="middle" fill={chart.tooltipText} fontSize="8" fontFamily={FONT} fontWeight="600">
                  {z.label}
                </text>
                <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 7}
                  textAnchor="middle" fill={chart.axis} fontSize="7" fontFamily={FONT}>
                  {z.note}
                </text>
              </g>
            );
          })}

          {/* Incident markers */}
          {INCIDENTS.map((inc, i) => (
            <circle key={i} cx={inc.x} cy={inc.y} r={4} fill={colour(inc.status)} stroke={chart.tooltipBg} strokeWidth="1">
              <title>{`${inc.label} — ${STATUS_LABEL[inc.status as MapStatus]}`}</title>
            </circle>
          ))}

          {/* Compass */}
          <g transform="translate(292,22)" aria-hidden="true">
            <circle cx={0} cy={0} r={10} fill={chart.tooltipBg} stroke={chart.grid} strokeWidth="0.6" />
            <text x={0} y={-3} textAnchor="middle" fill={chart.tooltipText} fontSize="7" fontFamily={FONT} fontWeight="700">N</text>
            <line x1={0} y1={-1} x2={0} y2={-8} stroke={chart.axis} strokeWidth="0.8" />
            <line x1={0} y1={1}  x2={0} y2={8}  stroke={chart.neutral} strokeWidth="0.8" />
          </g>
        </svg>

        {/* Zone read-out on hover */}
        {hoveredZone && (
          <div aria-hidden="true" style={{
            position: 'absolute', bottom: 10, left: 10, right: 10,
            padding: '6px 10px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-overlay)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-menu)',
            fontSize: 12, color: 'var(--text-primary)', pointerEvents: 'none',
          }}>
            <span style={{ fontWeight: 600 }}>{hoveredZone.label}</span>
            {' — '}
            {hoveredZone.note}
          </div>
        )}
      </div>

      {/* Legend + footer */}
      <ul className={styles.legend}>
        {(['critical', 'warning', 'ok'] as MapStatus[]).map(s => (
          <li key={s} className={`${styles.legendItem} ${styles.tone}`} data-status={STATUS_TONE[s]}>
            <span className={styles.swatch} aria-hidden="true" />
            {STATUS_LABEL[s]}
          </li>
        ))}
        <li style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          Metro Council Area  ·  6 operational zones  ·  Live
        </li>
      </ul>
    </section>
  );
}
