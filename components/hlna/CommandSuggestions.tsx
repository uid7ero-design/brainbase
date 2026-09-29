'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { HLNA_MODULES } from '@/lib/hlna/modules';
import styles from './CommandSuggestions.module.css';

// Visual (remaining visual islands pass): the white-alpha pill chips, violet
// hover/active glow and the local Inter stack are replaced by bordered chips
// on app tokens (CommandSuggestions.module.css); hover lives in CSS instead
// of inline style mutation. Chip selection, fireHelena + setChatOpen and the
// 2s active reset are unchanged.

const MAX_PANEL = 4;

interface Props {
  panelMode?: boolean;
}

export function CommandSuggestions({ panelMode = false }: Props) {
  const { activeModule, fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const [active, setActive] = useState<number | null>(null);

  const mod = activeModule ? HLNA_MODULES[activeModule] : null;

  const chips: { icon: string; label: string; command: string }[] =
    (mod && mod.key !== 'waste_recycling')
      ? mod.questions.slice(0, 6).map((q: string) => ({ icon: '→', label: q, command: q }))
      : getDeptConfig(activeDepartment).commands;

  const visible = panelMode ? chips.slice(0, MAX_PANEL) : chips.slice(0, 6);
  const overflow = panelMode ? Math.max(0, chips.length - MAX_PANEL) : 0;

  function send(i: number, command: string) {
    setActive(i);
    fireHelena(command);
    setChatOpen(true);
    setTimeout(() => setActive(null), 2000);
  }

  return (
    <div className={styles.root}>
      {!panelMode && (
        <div className={styles.heading}>
          Command Suggestions
        </div>
      )}
      <div className={styles.chips} data-panel={panelMode ? 'true' : 'false'} role="group" aria-label="Command suggestions">
        {visible.map((chip, i) => {
          const isActive = active === i;
          return (
            <button
              type="button"
              key={i}
              onClick={() => send(i, chip.command)}
              className={styles.chip}
              data-active={isActive ? 'true' : 'false'}
            >
              <span className={styles.icon} aria-hidden="true">{chip.icon}</span>
              <span>{chip.label}</span>
            </button>
          );
        })}

        {overflow > 0 && (
          <span className={styles.overflow}>
            +{overflow}<span className="sr-only"> more suggestions</span>
          </span>
        )}
      </div>
    </div>
  );
}
