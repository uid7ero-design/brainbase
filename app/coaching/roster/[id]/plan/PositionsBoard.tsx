'use client';
import { useId, useState } from 'react';
import { layouts, type Drill, type Mark, type Player, type Point } from '@/lib/scheduling/trainingPlan';
import styles from './plan.module.css';

function Lines({ layout }: { layout: Drill['layout'] }) {
  if (layout === 'blank') return null;
  if (layout === 'court')
    return (
      <g fill="none" stroke="white" strokeWidth="2">
        <rect x="55" y="32" width="490" height="276" />
        <path d="M55 68H545 M55 272H545 M165 68V272 M435 68V272 M165 170H435" />
        <path d="M300 18V322" strokeWidth="4" strokeDasharray="6 3" />
      </g>
    );
  return (
    <g fill="none" stroke="#e6f6dd" strokeWidth="2">
      <rect x="18" y="16" width="564" height="308" />
      {layout === 'pitch' ? (
        <>
          <path d="M300 16V324 M18 84H100V256H18 M582 84H500V256H582 M18 130H48V210H18 M582 130H552V210H582" />
          <circle cx="300" cy="170" r="42" />
        </>
      ) : (
        <path d="M174 16V112H426V16 M244 16V53H356V16 M248 112Q300 165 352 112 M245 324A55 55 0 0 1 355 324" />
      )}
    </g>
  );
}

export default function PositionsBoard({
  drill,
  players,
  change,
}: {
  drill: Drill;
  players: Player[];
  change?: (patch: Partial<Drill>) => void;
}) {
  const [tool, setTool] = useState('cone');
  const [start, setStart] = useState<Point | null>(null);
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? 'Unavailable player';
  const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  function place(p: Point) {
    if (!change) return;
    const marks = drill.marks;
    if (tool === 'erase') {
      change({ marks: marks.filter((m) => !same(m, p) && !(m.kind === 'arrow' && same(m.end, p))) });
      return;
    }
    if (tool === 'arrow') {
      if (!start) {
        setStart(p);
        return;
      }
      if (!same(start, p) && marks.length < 80)
        change({ marks: [...marks, { ...start, kind: 'arrow', end: p }] });
      setStart(null);
      return;
    }
    const piece: Mark =
      tool === 'ball' || tool === 'cone' ? { ...p, kind: tool } : { ...p, kind: 'player', player: tool };
    const next = marks.filter(
      (m) => m.kind === 'arrow' || (!same(m, p) && !(m.kind === 'player' && m.player === tool)),
    );
    if (next.length < 80) change({ marks: [...next, piece] });
  }
  const playersPlaced = drill.marks.filter((m) => m.kind === 'player');
  return (
    <section className={styles.boardPanel} aria-label="Positions board">
      {change && (
        <div className={styles.tools}>
          <label>
            Ground layout
            <select
              value={drill.layout}
              onChange={(e) => change({ layout: e.target.value as Drill['layout'] })}
            >
              {Object.entries(layouts).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Place on board
            <select
              value={tool}
              onChange={(e) => {
                setTool(e.target.value);
                setStart(null);
              }}
            >
              <option value="cone">Cone</option>
              <option value="ball">Ball</option>
              <option value="arrow">Movement arrow</option>
              <option value="erase">Erase at position</option>
              {players
                .filter((p) => p.status === 'confirmed')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.attendance === 'absent' ? ' (absent)' : ''}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      {change && (
        <p aria-live="polite">
          {tool === 'arrow'
            ? start
              ? 'Choose the end of the arrow.'
              : 'Choose the start of the arrow.'
            : 'Select a player or equipment, then choose a spot.'}
        </p>
      )}
      <div className={styles.board}>
        <svg viewBox="0 0 600 340" role="img" aria-label={layouts[drill.layout] + ' diagram'}>
          <defs>
            <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0 0L7 3.5L0 7Z" fill="#ffd378" />
            </marker>
          </defs>
          <rect
            width="600"
            height="340"
            fill={drill.layout === 'court' ? '#245a86' : drill.layout === 'blank' ? '#32404c' : '#285a42'}
          />
          <Lines layout={drill.layout} />
          {drill.marks.map((m, i) => {
            const x = m.x * 6,
              y = m.y * 3.4;
            if (m.kind === 'arrow')
              return (
                <line
                  key={i}
                  x1={x}
                  y1={y}
                  x2={m.end.x * 6}
                  y2={m.end.y * 3.4}
                  stroke="#ffd378"
                  strokeWidth="3"
                  markerEnd={'url(#' + markerId + ')'}
                />
              );
            if (m.kind === 'cone')
              return <path key={i} d={`M${x} ${y - 10}l10 18h-20Z`} fill="#ffad52" stroke="#181e20" />;
            if (m.kind === 'ball')
              return <circle key={i} cx={x} cy={y} r="7" fill="#fff5cf" stroke="#272e37" strokeWidth="2" />;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="12" fill="#183046" stroke="#d8f3ff" strokeWidth="2" />
                <text x={x} y={y + 4} textAnchor="middle" fill="white" fontSize="12">
                  {m.kind === 'player' ? players.findIndex((p) => p.id === m.player) + 1 : 'P'}
                </text>
              </g>
            );
          })}
          {start && change && (
            <circle cx={start.x * 6} cy={start.y * 3.4} r="12" fill="none" stroke="#ffd378" strokeWidth="3" />
          )}
        </svg>
        {change && (
          <div className={styles.spots}>
            {Array.from({ length: 63 }, (_, i) => {
              const col = i % 9,
                row = Math.floor(i / 9);
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`Column ${col + 1}, row ${row + 1}`}
                  onClick={() =>
                    place({ x: Math.round(((col + 0.5) * 100) / 9), y: Math.round(((row + 0.5) * 100) / 7) })
                  }
                />
              );
            })}
          </div>
        )}
      </div>
      {playersPlaced.length > 0 && (
        <ul aria-label="Board players">
          {playersPlaced.map((m) => (
            <li key={m.player}>
              {players.findIndex((p) => p.id === m.player) + 1}. {playerName(m.player)}
              {players.find((p) => p.id === m.player)?.attendance === 'absent' ? ' · absent' : ''}
            </li>
          ))}
        </ul>
      )}
      {change && (
        <button
          type="button"
          disabled={!drill.marks.length}
          onClick={() => change({ marks: drill.marks.slice(0, -1) })}
        >
          Remove last marking
        </button>
      )}
    </section>
  );
}
