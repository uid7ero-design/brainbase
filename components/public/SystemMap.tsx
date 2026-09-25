import styles from './SystemMap.module.css';

// The homepage hero visual: BrainBase's orbital motif redrawn as a calm,
// architectural map — one shared core, the platform's real capabilities on
// a single orbit, HLNΛ on the inner orbit, and one example connected
// external system outside it. Static except a slow data-flow dash on two
// links, which stops under prefers-reduced-motion.
//
// Only capabilities the homepage already lists are shown; Microsoft 365 is
// labelled as an external system (as the homepage copy already does).

const CX = 280;
const CY = 214;
const ORBIT = 152;
const INNER = 86;

const CAPABILITIES: { label: string; angle: number; flow?: boolean }[] = [
  { label: 'Clients & CRM', angle: -90, flow: true },
  { label: 'Leads', angle: -38 },
  { label: 'Bookings', angle: 12, flow: true },
  { label: 'Workflows', angle: 64 },
  { label: 'Dashboards', angle: 116 },
  { label: 'Web Systems', angle: 168 },
  { label: 'Events', angle: 218 },
];

function polar(radius: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
}

function pillWidth(label: string) {
  return Math.round(label.length * 6.9 + 26);
}

export function SystemMap({ idPrefix = 'bb-map' }: { idPrefix?: string }) {
  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const hlna = polar(INNER, 193);
  const bookings = polar(ORBIT, 12);
  const external = { x: 488, y: 382 };

  return (
    <svg
      viewBox="0 0 560 440"
      className={styles.map}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <title id={titleId}>BRΛINBΛSE platform map</title>
      <desc id={descId}>
        Clients and CRM, Leads, Bookings, Workflows, Dashboards, Web Systems and Events connect to one shared
        BRΛINBΛSE core, with HLNΛ as the intelligence layer and Microsoft 365 shown as an example connected external
        system.
      </desc>

      <defs>
        <radialGradient id={`${idPrefix}-core`} cx="35%" cy="30%" r="75%">
          <stop offset="0" style={{ stopColor: 'var(--bb-purple-300)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--bb-purple-500)' }} />
          <stop offset="1" style={{ stopColor: 'var(--bb-cyan-400)' }} />
        </radialGradient>
      </defs>

      {/* Orbits */}
      <circle cx={CX} cy={CY} r={ORBIT} className={styles.orbit} />
      <circle cx={CX} cy={CY} r={INNER} className={styles.orbitDashed} />
      <circle cx={CX} cy={CY} r={ORBIT + 38} className={styles.orbitFaint} />

      {/* Links: core → each capability */}
      {CAPABILITIES.map(c => {
        const from = polar(30, c.angle);
        const to = polar(ORBIT - 12, c.angle);
        return (
          <line
            key={c.label}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className={c.flow ? styles.linkFlow : styles.link}
          />
        );
      })}

      {/* External system link (dashed) */}
      <path
        d={`M ${bookings.x + 28} ${bookings.y + 14} C ${bookings.x + 60} ${bookings.y + 90}, ${external.x - 40} ${external.y - 60}, ${external.x - 8} ${external.y - 16}`}
        className={styles.externalLink}
      />

      {/* Core */}
      <circle cx={CX} cy={CY} r={30} className={styles.coreRing} />
      <circle cx={CX} cy={CY} r={9} fill={`url(#${idPrefix}-core)`} />
      <text x={CX} y={CY + 52} textAnchor="middle" className={styles.coreLabel}>
        BRΛINBΛSE
      </text>

      {/* HLNΛ on the inner orbit */}
      <circle cx={hlna.x} cy={hlna.y} r={4.5} className={styles.hlnaNode} />
      <text x={hlna.x - 10} y={hlna.y + 4} textAnchor="end" className={styles.hlnaLabel}>
        HLNΛ
      </text>

      {/* Capability nodes */}
      {CAPABILITIES.map(c => {
        const p = polar(ORBIT, c.angle);
        const w = pillWidth(c.label);
        return (
          <g key={c.label}>
            <rect x={p.x - w / 2} y={p.y - 13} width={w} height={26} rx={5} className={styles.node} />
            <circle cx={p.x - w / 2 + 11} cy={p.y} r={2.6} className={styles.nodeDot} />
            <text x={p.x - w / 2 + 19} y={p.y + 4} className={styles.nodeLabel}>
              {c.label}
            </text>
          </g>
        );
      })}

      {/* External system */}
      <g>
        <rect
          x={external.x - 62}
          y={external.y - 16}
          width={124}
          height={30}
          rx={5}
          className={styles.externalNode}
        />
        <text x={external.x} y={external.y + 3.5} textAnchor="middle" className={styles.nodeLabel}>
          Microsoft 365
        </text>
      </g>

      {/* Legend */}
      <g className={styles.legend}>
        <line x1={20} y1={408} x2={40} y2={408} className={styles.link} />
        <text x={48} y={412}>capability</text>
        <line x1={128} y1={408} x2={148} y2={408} className={styles.externalLink} />
        <text x={156} y={412}>connected system</text>
      </g>
    </svg>
  );
}
