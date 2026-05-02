'use client';
import { useState, useEffect, useCallback } from 'react';
import { generateReportHTML } from '../../../lib/evidence-report';

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ── Types ─────────────────────────────────────────────────────────────────────

type Post = {
  id: string;
  platform_post_id?: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  media_type?: string;
  like_count?: number;
  likes_count?: number;
  comments_count?: number;
  engagement_score: number;
  posted_at?: string;
  timestamp?: string;
  comments?: Comment[];
};

type Comment = {
  id?: string;
  text: string;
  author_name?: string;
  username?: string;
  sentiment?: string;
  urgency?: boolean;
  created_at?: string;
  timestamp?: string;
};

type Insight = {
  id?: string;
  title: string;
  summary: string;
  confidence: string;
  recommended_action?: string;
  evidence_json?: string[];
};

type Stats = {
  post_count?: number;
  avg_likes?: number;
  avg_comments?: number;
  avg_engagement?: number;
  posts_30d?: number;
};

type CommentStats = {
  total_comments?: number;
  urgent_count?: number;
  negative_count?: number;
  positive_count?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)     return 'just now';
  if (d < 3600)   return `${Math.floor(d / 60)}m ago`;
  if (d < 86400)  return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

const CONF_COLOR: Record<string, string> = {
  high:   '#34D399',
  medium: '#FBBF24',
  low:    '#F87171',
};

const SENT_COLOR: Record<string, string> = {
  positive: '#34D399',
  neutral:  '#94A3B8',
  negative: '#F87171',
  urgent:   '#FB923C',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = '#A78BFA' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '14px 18px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.30)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function InsightCard({ ins, idx }: { ins: Insight; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const conf = ins.confidence?.toLowerCase() ?? 'medium';
  const confColor = CONF_COLOR[conf] ?? '#FBBF24';

  return (
    <div style={{
      border: `1px solid ${open ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 10, overflow: 'hidden',
      background: open ? 'rgba(167,139,250,0.04)' : 'rgba(255,255,255,0.02)',
      transition: 'border-color 0.2s, background 0.2s',
    }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', fontFamily: FONT }}
      >
        <span style={{ fontSize: 14, color: confColor, flexShrink: 0 }}>◎</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)', lineHeight: 1.3 }}>{ins.title}</div>
        </div>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: `${confColor}18`, color: confColor, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0 }}>
          {conf.toUpperCase()}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.65, margin: '12px 0 0' }}>{ins.summary}</p>
          {Array.isArray(ins.evidence_json) && ins.evidence_json.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {ins.evidence_json.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 3 }}>· {e}</div>
              ))}
            </div>
          )}
          {ins.recommended_action && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.18)', borderRadius: 6 }}>
              <div style={{ fontSize: 9, color: 'rgba(167,139,250,0.70)', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3 }}>Recommended action</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{ins.recommended_action}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const likes    = post.like_count ?? post.likes_count ?? 0;
  const comments = post.comments_count ?? 0;
  const date     = post.posted_at ?? post.timestamp;
  const thumb    = post.thumbnail_url ?? post.media_url;
  const maxScore = 600;
  const engPct   = Math.min(100, Math.round((post.engagement_score / maxScore) * 100));
  const engColor = engPct >= 60 ? '#34D399' : engPct >= 30 ? '#FBBF24' : '#94A3B8';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', gap: 12, padding: 12 }}>
        {/* Thumbnail */}
        <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
          {thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'rgba(255,255,255,0.15)' }}>📷</div>
          }
          {post.media_type === 'VIDEO' && (
            <div style={{ position: 'absolute', bottom: 3, right: 3, fontSize: 8, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 4px', color: 'rgba(255,255,255,0.80)' }}>▶</div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
            {post.caption ?? 'No caption'}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>♥ {likes.toLocaleString()}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>💬 {comments}</span>
            <span style={{ fontSize: 10, color: engColor, fontWeight: 700 }}>▲ {post.engagement_score}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)' }}>{fmtDate(date)}</span>
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'rgba(167,139,250,0.60)', textDecoration: 'none', marginLeft: 'auto' }}>↗ View</a>
            )}
          </div>
          {/* Engagement bar */}
          <div style={{ marginTop: 8, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${engPct}%`, background: engColor, borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>
        </div>
      </div>

      {/* Comments */}
      {(post.comments?.length ?? 0) > 0 && (
        <>
          <button
            onClick={() => setExpanded(p => !p)}
            style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: FONT, fontSize: 10, color: 'rgba(255,255,255,0.30)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>{expanded ? '▲' : '▼'}</span>
            {post.comments!.length} comment{post.comments!.length !== 1 ? 's' : ''}
            {post.comments!.some(c => c.urgency) && <span style={{ color: '#FB923C', marginLeft: 6 }}>⚠ urgent</span>}
          </button>
          {expanded && (
            <div style={{ padding: '0 12px 10px' }}>
              {post.comments!.slice(0, 5).map((c, ci) => (
                <div key={ci} style={{ padding: '6px 0', borderBottom: ci < post.comments!.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.50)' }}>{c.author_name ?? c.username ?? 'user'}</span>
                    <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: `${SENT_COLOR[c.sentiment ?? 'neutral'] ?? '#94A3B8'}18`, color: SENT_COLOR[c.sentiment ?? 'neutral'] ?? '#94A3B8', fontWeight: 700 }}>
                      {c.urgency ? 'URGENT' : (c.sentiment ?? 'neutral').toUpperCase()}
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)', marginLeft: 'auto' }}>{timeAgo(c.created_at ?? c.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.60)', lineHeight: 1.5 }}>{c.text}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ onConnect, isDemo }: { onConnect: () => void; isDemo: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 40px' }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📱</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.80)', marginBottom: 8 }}>
        {isDemo ? 'Social Intelligence — Demo Mode' : 'Connect Instagram'}
      </h2>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.40)', maxWidth: 480, margin: '0 auto 24px', lineHeight: 1.65 }}>
        {isDemo
          ? 'META_APP_ID is not configured. Load demo data to explore the Social Intelligence dashboard with realistic sample content.'
          : 'Connect Instagram to let HLNA analyse public engagement, comments and content performance. Identify sentiment trends, urgent comments, and content opportunities automatically.'}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!isDemo && (
          <button onClick={onConnect} style={primaryBtn}>
            Connect Instagram
          </button>
        )}
        <button onClick={onConnect} style={isDemo ? primaryBtn : secondaryBtn}>
          {isDemo ? 'Load Demo Data' : 'Load Demo Data Instead'}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '9px 20px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
  background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.45)',
  color: '#C4B5FD', fontSize: 13, fontWeight: 700,
};
const secondaryBtn: React.CSSProperties = {
  padding: '9px 20px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
  color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600,
};

// ── Main component ────────────────────────────────────────────────────────────

export default function SocialClient({ isDemo }: { isDemo: boolean }) {
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [insights,     setInsights]     = useState<Insight[]>([]);
  const [stats,        setStats]        = useState<Stats>({});
  const [commentStats, setCommentStats] = useState<CommentStats>({});
  const [loading,      setLoading]      = useState(true);
  const [syncing,      setSyncing]      = useState(false);
  const [analysing,    setAnalysing]    = useState(false);
  const [lastSynced,   setLastSynced]   = useState<string | null>(null);
  const [hasPosts,     setHasPosts]     = useState(false);
  const [notice,       setNotice]       = useState('');
  const [activeTab,    setActiveTab]    = useState<'insights' | 'feed' | 'comments'>('insights');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [postsRes, insightsRes] = await Promise.all([
      fetch('/api/social/posts?limit=25'),
      fetch('/api/social/insights'),
    ]);
    if (postsRes.ok) {
      const d = await postsRes.json();
      setPosts(d.posts ?? []);
      setHasPosts((d.posts ?? []).length > 0);
      if (d.account?.updated_at) setLastSynced(d.account.updated_at as string);
    }
    if (insightsRes.ok) {
      const d = await insightsRes.json();
      setInsights(d.insights ?? []);
      setStats(d.stats ?? {});
      setCommentStats(d.commentStats ?? {});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    setNotice('');
    const res = await fetch('/api/social/sync', { method: 'POST' });
    const d   = await res.json();
    if (res.ok) {
      setNotice(`Synced ${d.synced} posts and ${d.comments} comments.`);
      setLastSynced(new Date().toISOString());
      await loadData();
    } else {
      setNotice(`Sync failed: ${d.error}`);
    }
    setSyncing(false);
  }

  async function handleAnalyse() {
    setAnalysing(true);
    setNotice('');
    const res = await fetch('/api/social/analyse', { method: 'POST' });
    const d   = await res.json();
    if (res.ok) {
      setNotice(`HLNA generated ${d.stored ?? 0} insights.`);
      await loadData();
    } else {
      setNotice(`Analysis failed: ${d.error}`);
    }
    setAnalysing(false);
  }

  async function handleConnect() {
    if (isDemo) {
      await handleSync();
    } else {
      window.location.href = '/api/social/connect';
    }
  }

  function exportInsightReport() {
    if (insights.length === 0) return;
    const content = insights.map(ins =>
      `${ins.title}\n${ins.summary}\nRecommended: ${ins.recommended_action ?? '—'}`
    ).join('\n\n---\n\n');
    const html = generateReportHTML({
      content,
      agentName:  'SocialAgent',
      routeType:  'social',
      confidence: null,
      evidence:   null,
      orgName:    null,
      timestamp:  new Date().toISOString(),
    });
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  }

  const urgentComments = posts.flatMap(p => (p.comments ?? []).filter(c => c.urgency || c.sentiment === 'negative' || c.sentiment === 'urgent'));
  const avgEngagement  = stats.avg_engagement ?? 0;
  const urgentCount    = commentStats.urgent_count ?? urgentComments.length;
  const sentimentScore = commentStats.total_comments
    ? Math.round(((commentStats.positive_count ?? 0) / commentStats.total_comments) * 100)
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#06070F', color: '#F4F4F5', fontFamily: FONT, paddingBottom: 60 }}>
      {/* Top accent */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.6), rgba(56,189,248,0.3), transparent)' }} />

      {/* Header */}
      <div style={{ padding: '28px 36px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: 'rgba(124,58,237,0.70)', fontWeight: 700, letterSpacing: '0.12em' }}>◈</div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.92)' }}>
                Social Intelligence
              </h1>
              {isDemo && (
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBBF24', fontWeight: 700 }}>
                  DEMO
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
              Public sentiment, engagement and content signals analysed by HLNA
            </p>
            {lastSynced && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>
                Last synced {timeAgo(lastSynced)}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!hasPosts && (
              <button onClick={handleConnect} style={primaryBtn}>
                {isDemo ? 'Load Demo Data' : '+ Connect Instagram'}
              </button>
            )}
            {hasPosts && (
              <>
                <button onClick={handleSync} disabled={syncing} style={{ ...secondaryBtn, opacity: syncing ? 0.5 : 1 }}>
                  {syncing ? 'Syncing…' : '↻ Sync Now'}
                </button>
                <button onClick={handleAnalyse} disabled={analysing} style={{ ...primaryBtn, opacity: analysing ? 0.5 : 1 }}>
                  {analysing ? 'Analysing…' : '◎ Run HLNA Analysis'}
                </button>
                {insights.length > 0 && (
                  <button onClick={exportInsightReport} style={secondaryBtn}>↗ Export Report</button>
                )}
              </>
            )}
          </div>
        </div>

        {notice && (
          <div style={{ marginTop: 12, padding: '8px 14px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.20)', borderRadius: 7, fontSize: 12, color: '#34D399' }}>
            {notice}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading…</div>
      ) : !hasPosts ? (
        <EmptyState onConnect={handleConnect} isDemo={isDemo} />
      ) : (
        <div style={{ padding: '24px 36px' }}>

          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 28 }}>
            <KpiCard label="Posts analysed" value={stats.post_count ?? posts.length} color="#A78BFA" />
            <KpiCard label="Avg engagement" value={avgEngagement.toFixed(0)} sub="likes + comments×2" color="#38BDF8" />
            <KpiCard label="Avg likes" value={(stats.avg_likes ?? 0).toFixed(0)} color="#34D399" />
            <KpiCard label="Avg comments" value={(stats.avg_comments ?? 0).toFixed(1)} color="#FBBF24" />
            <KpiCard
              label="Sentiment score"
              value={sentimentScore != null ? `${sentimentScore}%` : '—'}
              sub="positive comments"
              color={sentimentScore != null && sentimentScore >= 60 ? '#34D399' : sentimentScore != null && sentimentScore >= 40 ? '#FBBF24' : '#F87171'}
            />
            <KpiCard
              label="Need attention"
              value={urgentCount}
              sub="urgent / negative"
              color={urgentCount > 0 ? '#F87171' : '#34D399'}
            />
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 20 }}>
            {([
              { key: 'insights', label: `Insights${insights.length > 0 ? ` (${insights.length})` : ''}` },
              { key: 'feed',     label: `Feed (${posts.length})` },
              { key: 'comments', label: `Comments${urgentCount > 0 ? ` — ${urgentCount} urgent` : ''}` },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT,
                  borderBottom: activeTab === t.key ? '2px solid #8B5CF6' : '2px solid transparent',
                  color: activeTab === t.key ? '#C4B5FD' : 'rgba(255,255,255,0.40)',
                  fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
                  transition: 'color 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── INSIGHTS tab ── */}
          {activeTab === 'insights' && (
            <div style={{ maxWidth: 740 }}>
              {insights.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.30)', fontSize: 13 }}>
                  No insights yet. Click <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Run HLNA Analysis</strong> to generate insights from your posts.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {insights.map((ins, i) => <InsightCard key={ins.id ?? i} ins={ins} idx={i} />)}
                </div>
              )}
            </div>
          )}

          {/* ── FEED tab ── */}
          {activeTab === 'feed' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
              {posts.map((p, i) => <PostCard key={p.id ?? i} post={p} />)}
            </div>
          )}

          {/* ── COMMENTS tab ── */}
          {activeTab === 'comments' && (
            <div style={{ maxWidth: 740 }}>
              {urgentComments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.30)', fontSize: 13 }}>
                  No urgent or negative comments found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {urgentComments.length} comment{urgentComments.length !== 1 ? 's' : ''} needing attention
                  </div>
                  {urgentComments.map((c, i) => {
                    const sentColor = SENT_COLOR[c.urgency ? 'urgent' : (c.sentiment ?? 'neutral')] ?? '#94A3B8';
                    return (
                      <div key={i} style={{
                        padding: '12px 14px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.02)',
                        border: `1px solid ${sentColor}22`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>
                            {c.author_name ?? c.username ?? 'user'}
                          </span>
                          <span style={{ fontSize: 8, padding: '1px 6px', borderRadius: 3, background: `${sentColor}18`, color: sentColor, fontWeight: 700, letterSpacing: '0.06em' }}>
                            {c.urgency ? 'URGENT' : (c.sentiment ?? 'neutral').toUpperCase()}
                          </span>
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', marginLeft: 'auto' }}>
                            {timeAgo(c.created_at ?? c.timestamp)}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>{c.text}</div>
                        <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                          Suggested reply angle: {
                            c.urgency ? 'Acknowledge urgency, provide direct contact or timeline.' :
                            c.sentiment === 'negative' ? 'Apologise, offer explanation, direct to resolution channel.' :
                            'Respond with helpful information.'
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
