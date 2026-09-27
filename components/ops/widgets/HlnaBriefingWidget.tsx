'use client';
import { useState, useEffect, useId } from 'react';
import Link from 'next/link';
import { Badge, Button, buttonProps } from '@/components/ui/app';
import { BrokenOrbitMark } from '@/components/brand/BrokenOrbitMark';
import styles from './widgets.module.css';

// Phase D2 — Command Centre HLNA briefing on the shared panel surface.
// Identity: the approved broken-orbit mark (HLNA context) + "HLNA" text,
// replacing the legacy hlna-wordmark.svg image. Removed as decoration: the
// ambient glow blob, blur, the blinking "online" dot, the breathing
// keyframes and the gradient confidence bar. Content, links, the typing
// reveal and the expand/collapse behaviour are unchanged. All figures
// below are static sample content (see the audit's hard-coded data list).

const WHAT_CHANGED = [
  { label: 'Missed bins', delta: '+12%', dir: 'up', impact: 'high' },
  { label: 'Route completion', delta: '−8%', dir: 'down', impact: 'high' },
  { label: 'Fuel expenditure', delta: '+5.2%', dir: 'up', impact: 'medium' },
  { label: 'Complaints filed', delta: '+8', dir: 'up', impact: 'medium' },
  { label: 'Recycling diversion', delta: '+1.4%', dir: 'down', impact: 'low' },
];

const RECOMMENDED = [
  { priority: 'critical', label: 'Reassign Routes 4 & 7 immediately', href: '/dashboard/waste' },
  { priority: 'high',     label: 'Schedule TRK-008 maintenance review', href: '/dashboard/fleet' },
  { priority: 'medium',   label: 'Brief Zone 3 crew on backlog targets', href: '/dashboard/waste' },
  { priority: 'low',      label: 'Review organics calendar for Q3',    href: '/reports' },
];

const AFFECTED = ['Southern Routes', 'Zone 3', 'Zone 8', 'Fleet TRK-008', 'Transfer Station N'];

const CONFIDENCE = 87;

// Priority → semantic badge state (the priority word is always shown).
const PRIORITY_STATE: Record<string, 'error' | 'warning' | 'info' | 'inactive'> = {
  critical: 'error',
  high:     'warning',
  medium:   'info',
  low:      'inactive',
};

interface Props {
  /** Assistant state from the page; accepted for API compatibility. */
  orbState?: 'idle' | 'thinking' | 'alert';
}

function useTyping(text: string, speed = 18) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setShown(''); setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { shown, done };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function HlnaBriefingWidget({ orbState = 'idle' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const summary = "Missed bins are up 12% today in the southern region. 2 routes are at risk of breaching KPI thresholds. Fuel trends indicate a projected 5% cost increase this month — TRK-008 is the primary contributor.";
  const { shown, done } = useTyping(summary, 18);

  return (
    <section className={styles.panel} aria-label="HLNA briefing">
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>
          <BrokenOrbitMark size={16} context="hlna" />
          <span className={styles.titleStrong}>HLNA</span>
          <span>· Live Analysis</span>
        </h2>
        <div className={styles.headerActions}>
          <Badge state="error">HIGH RISK</Badge>
          <Button size="sm" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(p => !p)}>
            {expanded ? '↑ Collapse' : '↓ Full Briefing'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className={styles.body}>

        {/* Summary — the typing reveal is visual only; assistive tech gets
            the complete sentence once, not a character stream. */}
        <div style={{ padding: '16px 18px 14px' }}>
          <p className={styles.summary}>
            <span className={styles.srOnly}>{summary}</span>
            <span aria-hidden="true">
              {done ? summary : <>{shown}<span className={styles.cursor} /></>}
            </span>
          </p>

          {/* Action buttons */}
          <div className={styles.actions}>
            <Link href="/dashboard/waste" {...buttonProps('secondary', 'sm')}>
              View routes →
            </Link>
            <Button size="sm" onClick={() => setExpanded(true)}>
              Resolve alerts
            </Button>
          </div>
        </div>

        {/* Expanded intelligence panel */}
        <div id={detailsId} hidden={!expanded} style={{ padding: '0 18px 18px' }}>
          {expanded && (
            <>
              <div className={styles.divider} />

              <div className={styles.twoCol}>

                {/* What changed */}
                <div>
                  <h3 className={styles.label}>What Changed</h3>
                  {WHAT_CHANGED.map(c => {
                    const bad = c.dir === 'up' && c.impact !== 'low';
                    const status = bad ? 'danger' : c.impact === 'low' ? 'success' : 'warning';
                    return (
                      <div key={c.label} className={`${styles.changeRow} ${styles.tone}`} data-status={status}>
                        <span className={styles.changeLabel}>{c.label}</span>
                        <span className={`${styles.changeDelta} ${styles.statusText}`}>{c.delta}</span>
                        <span className={styles.srOnly}>, {c.impact} impact</span>
                      </div>
                    );
                  })}
                </div>

                {/* Recommended actions */}
                <div>
                  <h3 className={styles.label}>Recommended Actions</h3>
                  <ul className={styles.recoList}>
                    {RECOMMENDED.map(r => (
                      <li key={r.label}>
                        <Link href={r.href} className={styles.recoLink}>
                          <Badge state={PRIORITY_STATE[r.priority]}>{r.priority}</Badge>
                          <span>{r.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Analysis row */}
              <div style={{ marginBottom: 16 }}>
                <h3 className={styles.label}>Why It Changed</h3>
                <p className={styles.prose}>
                  Southern route delays stem from a combination of driver shortages in Zone 3 and capacity pressure at the northern transfer station. TRK-008&apos;s above-average fuel burn correlates with its elevated mileage since its last service at 87,400km. Complaint volume increase mirrors the delayed organics backlog.
                </p>
              </div>

              {/* Bottom row: affected areas + confidence */}
              <div className={styles.twoCol} style={{ marginBottom: 0 }}>
                <div>
                  <h3 className={styles.label}>Affected Areas</h3>
                  <ul className={styles.tags}>
                    {AFFECTED.map(a => (
                      <li key={a} className={styles.tag}>{a}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className={styles.label}>Confidence</h3>
                  <div className={styles.confidenceValue}>{CONFIDENCE}%</div>
                  <div className={styles.meter} role="meter" aria-label="Confidence" aria-valuenow={CONFIDENCE} aria-valuemin={0} aria-valuemax={100}>
                    <div className={styles.meterFill} style={{ width: `${CONFIDENCE}%` }} />
                  </div>
                  <div className={styles.meterNote}>Based on 6 data sources</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
