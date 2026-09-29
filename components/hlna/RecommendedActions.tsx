'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { type WasteAction, type Impact } from '@/lib/hlna/wasteIntelligence';
import { Badge, type SemanticState } from '@/components/ui/semantic';
import styles from './RecommendedActions.module.css';

// Visual (remaining visual islands pass): the white-alpha cards, violet
// hover/selected glow, raw impact/urgency hex badges and the local Inter
// stack are replaced by app tokens (RecommendedActions.module.css) and the
// shared semantic Badge. Each action card is now a real <button> (it was a
// clickable <div>) with the same onSelect effect: fireHelena + setChatOpen.

const LEVEL_STATE: Record<Impact, SemanticState> = { high: 'error', medium: 'warning', low: 'success' };

function ActionCard({ action, selected, onSelect }: { action: WasteAction; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={styles.card}
      data-selected={selected ? 'true' : 'false'}
    >
      {/* Title */}
      <span className={styles.cardTitle}>
        {action.title}
      </span>

      {/* Description */}
      <span className={styles.description}>
        {action.description}
      </span>

      {/* Badges + CTA */}
      <span className={styles.meta}>
        <Badge state={LEVEL_STATE[action.impact]}>
          <span aria-hidden="true">↑ </span>{action.impact} impact
        </Badge>
        <Badge state={LEVEL_STATE[action.urgency]}>
          <span aria-hidden="true">⚡ </span>{action.urgency} urgency
        </Badge>
        <span className={styles.spacer} />
        <span className={styles.cta}>
          {action.cta} <span aria-hidden="true">→</span>
        </span>
      </span>
    </button>
  );
}

export function RecommendedActions() {
  const [selected, setSelected] = useState<string | null>(null);
  const { fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const actions = getDeptConfig(activeDepartment).actions;

  function handleSelect(action: WasteAction) {
    setSelected(action.id);
    fireHelena(action.command);
    setChatOpen(true);
  }

  return (
    <div>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.rule} aria-hidden="true" />
        <h2 className={styles.title}>
          Recommended Actions
        </h2>
        <div className={styles.rule} aria-hidden="true" />
      </div>

      {/* 2-column grid */}
      <ul className={styles.grid}>
        {actions.map(action => (
          <li key={action.id}>
            <ActionCard
              action={action}
              selected={selected === action.id}
              onSelect={() => handleSelect(action)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
