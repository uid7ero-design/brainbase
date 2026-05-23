'use client'
import { useEffect, useState } from 'react'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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
    <div style={{
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 14, overflow: 'hidden', fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 22px',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(232,121,249,.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.40)' }}>
            Instagram
            {state.status === 'ready' && state.username && (
              <span style={{ color: 'rgba(232,121,249,.55)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>@{state.username}</span>
            )}
          </span>
        </div>
        {state.status === 'disconnected' && (
          <a
            href="/api/auth/instagram/connect"
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
              background: 'rgba(232,121,249,.12)', color: '#e879f9',
              border: '1px solid rgba(232,121,249,.25)', textDecoration: 'none',
            }}
          >
            Connect Instagram
          </a>
        )}
      </div>

      {/* Body */}
      {state.status === 'loading' && (
        <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.18)', fontSize: 12 }}>
          Loading…
        </div>
      )}

      {state.status === 'disconnected' && (
        <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 12, lineHeight: 1.7 }}>
          Connect your Instagram Business account to see your feed here.
        </div>
      )}

      {state.status === 'error' && (
        <div style={{ padding: '24px 22px', color: 'rgba(239,68,68,.7)', fontSize: 12 }}>
          {state.message}
        </div>
      )}

      {state.status === 'ready' && state.posts.length === 0 && (
        <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.18)', fontSize: 12 }}>
          No posts yet.
        </div>
      )}

      {state.status === 'ready' && state.posts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: 2 }}>
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
                  background: 'rgba(255,255,255,.04)',
                }}
              >
                {img && (
                  <img
                    src={img}
                    alt={post.caption?.slice(0, 60) ?? ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '20px 8px 6px',
                  background: 'linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 100%)',
                  fontSize: 10, color: 'rgba(255,255,255,.55)',
                }}>
                  {timeAgo(post.timestamp)}
                  {post.media_type === 'VIDEO' && <span style={{ marginLeft: 4 }}>▶</span>}
                  {post.media_type === 'CAROUSEL_ALBUM' && <span style={{ marginLeft: 4 }}>⊞</span>}
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
