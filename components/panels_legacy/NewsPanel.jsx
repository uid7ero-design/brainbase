'use client';
import { useState } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { useNews } from '../../hooks/useNews';

const TABS = [
  { key: 'all',   label: 'All' },
  { key: 'tech',  label: 'Tech' },
  { key: 'ai',    label: 'AI' },
  { key: 'cyber', label: 'Cyber' },
];

const CATEGORY_COLORS = {
  tech:  { dot: 'rgba(0,207,234,1)',   bg: 'rgba(0,207,234,.08)',   border: 'rgba(0,207,234,.22)',   text: 'rgba(0,207,234,.85)'  },
  ai:    { dot: 'rgba(130,180,255,1)', bg: 'rgba(130,180,255,.08)', border: 'rgba(130,180,255,.22)', text: 'rgba(130,180,255,.85)' },
  cyber: { dot: 'rgba(255,120,80,1)',  bg: 'rgba(255,120,80,.08)',  border: 'rgba(255,120,80,.22)',  text: 'rgba(255,120,80,.85)'  },
};

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

  const { articles, loading, fetchedAt, refresh } = useNews();

  if (!open) return null;

  const filtered = tab === 'all' ? articles : articles.filter(a => a.category === tab);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#020408', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.05)', flexShrink: 0, background: 'rgba(2,4,8,.94)', backdropFilter: 'blur(12px)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,207,234,.8)" strokeWidth="2"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.80)', letterSpacing: '.04em' }}>NEWS FEED</span>
        {fetchedAt && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>updated {timeAgo(fetchedAt)}</span>}
        {loading && <span style={{ fontSize: 10, color: 'rgba(0,212,255,.5)' }}>Refreshing…</span>}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: tab === t.key ? 'rgba(0,207,234,.10)' : 'transparent',
                border: tab === t.key ? '1px solid rgba(0,207,234,.25)' : '1px solid rgba(255,255,255,.06)',
                color: tab === t.key ? 'rgba(0,207,234,.90)' : 'rgba(255,255,255,.35)',
                transition: 'all .15s',
              }}
            >{t.label}</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={refresh} style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(0,212,255,.06)', border: '1px solid rgba(0,212,255,.18)', color: 'rgba(0,212,255,.65)', fontSize: 10, cursor: 'pointer' }}>Refresh</button>
          <button onClick={() => setOpen(false)} style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', color: 'rgba(255,255,255,.35)', fontSize: 10, cursor: 'pointer' }}>ESC</button>
        </div>
      </div>

      {/* Articles */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {loading && articles.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, gap: 10 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(0,207,234,.4)', animation: 'agentPulse 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.28)' }}>Fetching feeds…</span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.22)' }}>No articles found</span>
          </div>
        )}

        {filtered.map(article => {
          const c = CATEGORY_COLORS[article.category];
          return (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              <div style={{
                padding: '12px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,.025)',
                border: '1px solid rgba(255,255,255,.05)',
                transition: 'border-color .15s, background .15s',
                cursor: 'pointer',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.045)'; e.currentTarget.style.borderColor = c.border; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flexShrink: 0, marginTop: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, boxShadow: `0 0 6px ${c.dot}` }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.82)', lineHeight: 1.4, marginBottom: 6 }}>
                      {article.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 600, letterSpacing: '.04em' }}>
                        {article.category.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,.30)' }}>{article.source}</span>
                      {article.time && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>{timeAgo(article.time)}</span>}
                      {article.points != null && (
                        <span style={{ fontSize: 10, color: 'rgba(255,180,0,.45)' }}>▲ {article.points}</span>
                      )}
                      {article.comments != null && (
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.20)' }}>{article.comments} comments</span>
                      )}
                    </div>
                  </div>
                  <svg style={{ flexShrink: 0, marginTop: 2 }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.20)" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
