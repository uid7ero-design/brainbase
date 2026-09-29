'use client';
import { useId, useRef, useState } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { useNews } from '../../hooks/useNews';
import { buttonProps } from '../ui/app/Button';
import { useOverlayFocus } from './useOverlayFocus';
import overlay from './PanelOverlay.module.css';
import styles from './NewsPanel.module.css';

// Visual (remaining visual islands pass): the near-black sheet, blurred
// header, white-alpha neutrals and neon category glows are replaced by app
// tokens (PanelOverlay.module.css + this module) so the feed reads in light
// and dark. The category hues are kept as a data encoding (dot + badge
// edge, see NewsPanel.module.css). The sheet carries dialog semantics, the
// filter row is a pressed-state toggle group and external links say they
// open a new tab. useNews, the filters and the close button are unchanged.

const TABS = [
  { key: 'all',   label: 'All' },
  { key: 'tech',  label: 'Tech' },
  { key: 'ai',    label: 'AI' },
  { key: 'cyber', label: 'Cyber' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NewsPanel() {
  const open    = useAppStore(s => s.newsOpen);
  const setOpen = useAppStore(s => s.setNewsOpen);
  const [tab, setTab] = useState('all');
  const panelRef = useRef(null);
  const titleId = useId();

  const { articles, loading, fetchedAt, refresh } = useNews();

  useOverlayFocus(open, panelRef);

  if (!open) return null;

  const filtered = tab === 'all' ? articles : articles.filter(a => a.category === tab);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={overlay.sheet}
      style={{ zIndex: 90 }}
    >

      {/* Header */}
      <div className={overlay.header}>
        <span className={overlay.headerIcon} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        </span>
        <h2 id={titleId} className={overlay.title}>NEWS FEED</h2>
        {fetchedAt && <span className={styles.meta}>updated {timeAgo(fetchedAt)}</span>}
        {loading && <span className={styles.meta} role="status">Refreshing…</span>}

        {/* Tabs */}
        <div className={styles.filters} role="group" aria-label="Filter by category">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={styles.filter}
            >{t.label}</button>
          ))}
        </div>

        <div className={overlay.headerActions}>
          <button type="button" onClick={refresh} {...buttonProps('secondary', 'sm')}>Refresh</button>
          <button type="button" onClick={() => setOpen(false)} {...buttonProps('secondary', 'sm')}>
            ESC<span className="sr-only"> — close news feed</span>
          </button>
        </div>
      </div>

      {/* Articles */}
      <ul className={styles.articles} data-dialog-body="">

        {loading && articles.length === 0 && (
          <li className={styles.state}>
            <span className={overlay.pulseDot} aria-hidden="true" />
            <span>Fetching feeds…</span>
          </li>
        )}

        {!loading && filtered.length === 0 && (
          <li className={styles.state}>
            <span>No articles found</span>
          </li>
        )}

        {filtered.map(article => (
          <li key={article.id}>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.article}
            >
              <span className={styles.dot} data-category={article.category} aria-hidden="true" />
              <div className={styles.articleText}>
                <h3 className={styles.title}>
                  {article.title}
                </h3>
                <div className={styles.facts}>
                  <span className={styles.badge} data-category={article.category}>
                    {article.category.toUpperCase()}
                  </span>
                  <span>{article.source}</span>
                  {article.time && <span>{timeAgo(article.time)}</span>}
                  {article.points != null && (
                    <span><span aria-hidden="true">▲</span> {article.points}</span>
                  )}
                  {article.comments != null && (
                    <span>{article.comments} comments</span>
                  )}
                </div>
              </div>
              <svg className={styles.external} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
