'use client';
import { useState, useEffect } from 'react';
import styles from './FloatingCard.module.css';

export function FloatingCard({ card, onDismiss }) {
  const [visible, setVisible] = useState(true);
  const [fading,  setFading]  = useState(false);

  useEffect(() => {
    const fadeTimer    = setTimeout(() => setFading(true),  5500);
    const removeTimer  = setTimeout(() => { setVisible(false); onDismiss?.(); }, 6200);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={styles.card}
      style={{ width: card.variant === "revenue" ? 290 : 240, opacity: fading ? 0 : 1 }}
    >
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.type}>{card.type}</span>
          <span className={styles.time}>{card.time}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className={styles.close}
            onClick={() => { setFading(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 400); }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className={styles.title}>{card.title}</div>
        <div className={styles.sub}>{card.sub || card.content}</div>
      </div>
    </div>
  );
}
