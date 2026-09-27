'use client'
import { useEffect, useState } from 'react'
import { buttonProps } from '@/components/ui/app'

// Visual convergence (authenticated visual-completion pass): theme tokens
// only (app/globals.css) so the panel reads in light and dark, inherits the
// app font, and uses the shared button contract for its one action. Data
// loading, states and links are unchanged.

type Post = {
  id: string
  caption?: string
  media_url?: string
  thumbnail_url?: string
  timestamp: string
  permalink: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
}

type FeedState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'error'; message: string }
  | { status: 'ready'; posts: Post[]; username: string | null }

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export default function InstagramFeedPanel() {
  const [state, setState] = useState<FeedState>({ status: 'loading' })

  useEffect(() => {
    fetch('/api/instagram/feed', { credentials: 'include' })
      .then(r => {
        if (!r.ok) return r.text().then(() => { setState({ status: 'disconnected' }) })
        return r.json().then((data: { connected?: boolean; posts?: Post[]; username?: string | null; error?: string }) => {
          if (!data.connected) { setState({ status: 'disconnected' }); return }
          if (data.error) { setState({ status: 'disconnected' }); return }
          setState({ status: 'ready', posts: data.posts ?? [], username: data.username ?? null })
        })
      })
      .catch(() => setState({ status: 'disconnected' }))
  }, [])

  return (
    <section
      aria-labelledby="instagram-feed-title"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
          </svg>
          <h2 id="instagram-feed-title" style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Instagram
            {state.status === 'ready' && state.username && (
              <span style={{ color: 'var(--text-secondary)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>@{state.username}</span>
            )}
          </h2>
        </div>
        {state.status === 'disconnected' && (
          <a href="/api/auth/instagram/connect" {...buttonProps('secondary', 'sm')}>
            Connect Instagram
          </a>
        )}
      </div>

      {/* Body */}
      {state.status === 'loading' && (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading…
        </div>
      )}

      {state.status === 'disconnected' && (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.7 }}>
          Connect your Instagram Business account to see your feed here.
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" style={{ padding: '24px 16px', color: 'var(--status-danger)', fontSize: 12 }}>
          {state.message}
        </div>
      )}

      {state.status === 'ready' && state.posts.length === 0 && (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          No posts yet.
        </div>
      )}

      {state.status === 'ready' && state.posts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2, padding: 2 }}>
          {state.posts.map(post => {
            const img = post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url
            return (
              <a
                key={post.id}
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                title={post.caption ?? ''}
                style={{
                  display: 'block',
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  overflow: 'hidden',
                  background: 'var(--bg-sunken)',
                }}
              >
                {img && (
                  <img
                    src={img}
                    alt={post.caption?.slice(0, 60) ?? ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                {/* Post age on a small token chip (was a dark photo scrim with
                    white-alpha text, which only worked in dark mode). */}
                <div style={{
                  position: 'absolute', bottom: 6, left: 6,
                  padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-overlay)', border: '1px solid var(--border)',
                  fontSize: 11, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {timeAgo(post.timestamp)}
                  {post.media_type === 'VIDEO' && <span style={{ marginLeft: 4 }} role="img" aria-label="Video">▶</span>}
                  {post.media_type === 'CAROUSEL_ALBUM' && <span style={{ marginLeft: 4 }} role="img" aria-label="Carousel">⊞</span>}
                </div>
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}
