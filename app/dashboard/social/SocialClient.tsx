'use client';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { generateReportHTML } from '../../../lib/evidence-report';
import {
  PageHeader, MetricStrip, Metric, Button, Badge, StateMessage, type SemanticState,
} from '@/components/ui/app';
import s from './Social.module.css';

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

// Confidence and sentiment are semantic: each renders as a Badge (written
// label + state shape), never as a raw hue on text.
const CONF_STATE: Record<string, SemanticState> = {
  high:   'success',
  medium: 'warning',
  low:    'error',
};

const SENT_STATE: Record<string, SemanticState> = {
  positive: 'success',
  neutral:  'inactive',
  negative: 'error',
  urgent:   'warning',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function InsightCard({ ins, idx }: { ins: Insight; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const bodyId = useId();
  const conf = ins.confidence?.toLowerCase() ?? 'medium';
  const confState = CONF_STATE[conf] ?? 'warning';

  return (
    <li className={s.insight} data-open={open}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className={s.insightToggle}
      >
        <span className={s.insightGlyph} aria-hidden="true">◎</span>
        <span className={s.insightTitle}>{ins.title}</span>
        <Badge state={confState}>{conf.toUpperCase()}</Badge>
        <span className={s.chevron} data-open={open} aria-hidden="true">▼</span>
      </button>
      {open && (
        <div id={bodyId} className={s.insightBody}>
          <p className={s.insightSummary}>{ins.summary}</p>
          {Array.isArray(ins.evidence_json) && ins.evidence_json.length > 0 && (
            <ul className={s.evidence}>
              {ins.evidence_json.map((e, i) => (
                <li key={i}>· {e}</li>
              ))}
            </ul>
          )}
          {ins.recommended_action && (
            <div className={s.recommend}>
              <p className={s.recommendLabel}>Recommended action</p>
              <p className={s.recommendText}>{ins.recommended_action}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PostCard({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const commentsId = useId();
  const likes    = post.like_count ?? post.likes_count ?? 0;
  const comments = post.comments_count ?? 0;
  const date     = post.posted_at ?? post.timestamp;
  const thumb    = post.thumbnail_url ?? post.media_url;
  const maxScore = 600;
  const engPct   = Math.min(100, Math.round((post.engagement_score / maxScore) * 100));
  const engTone  = engPct >= 60 ? 'success' : engPct >= 30 ? 'warning' : undefined;

  return (
    <li className={s.post}>
      <div className={s.postMain}>
        {/* Thumbnail */}
        <div className={s.thumb}>
          {thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={thumb} alt="" />
            : <div className={s.thumbEmpty} aria-hidden="true">📷</div>
          }
          {post.media_type === 'VIDEO' && (
            <div className={s.videoTag}>▶</div>
          )}
        </div>

        {/* Content */}
        <div className={s.postContent}>
          <p className={s.caption}>
            {post.caption ?? 'No caption'}
          </p>
          <div className={s.postStats}>
            <span>♥ {likes.toLocaleString()}</span>
            <span>💬 {comments}</span>
            <span className={s.score} data-tone={engTone}>▲ {post.engagement_score}</span>
            <span className={s.date}>{fmtDate(date)}</span>
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noreferrer" className={s.permalink}>↗ View</a>
            )}
          </div>
          {/* Engagement bar */}
          <div className={s.engTrack} aria-hidden="true">
            <div className={s.engFill} data-tone={engTone} style={{ width: `${engPct}%` }} />
          </div>
        </div>
      </div>

      {/* Comments */}
      {(post.comments?.length ?? 0) > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(p => !p)}
            aria-expanded={expanded}
            aria-controls={expanded ? commentsId : undefined}
            className={s.commentsToggle}
          >
            <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
            {post.comments!.length} comment{post.comments!.length !== 1 ? 's' : ''}
            {post.comments!.some(c => c.urgency) && <span className={s.urgentFlag}>⚠ urgent</span>}
          </button>
          {expanded && (
            <ul id={commentsId} className={s.commentList}>
              {post.comments!.slice(0, 5).map((c, ci) => (
                <li key={ci} className={s.comment}>
                  <div className={s.commentHead}>
                    <span className={s.author}>{c.author_name ?? c.username ?? 'user'}</span>
                    <Badge state={c.urgency ? 'warning' : (SENT_STATE[c.sentiment ?? 'neutral'] ?? 'inactive')}>
                      {c.urgency ? 'URGENT' : (c.sentiment ?? 'neutral').toUpperCase()}
                    </Badge>
                    <span className={s.when}>{timeAgo(c.created_at ?? c.timestamp)}</span>
                  </div>
                  <p className={s.commentText}>{c.text}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

function EmptyState({ onConnect, isDemo }: { onConnect: () => void; isDemo: boolean }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyGlyph} aria-hidden="true">📱</div>
      <h2 className={s.emptyTitle}>
        {isDemo ? 'Social Intelligence — Demo Mode' : 'Connect Instagram'}
      </h2>
      <p className={s.emptyText}>
        {isDemo
          ? 'META_APP_ID is not configured. Load demo data to explore the Social Intelligence dashboard with realistic sample content.'
          : 'Connect Instagram to let HLNA analyse public engagement, comments and content performance. Identify sentiment trends, urgent comments, and content opportunities automatically.'}
      </p>
      <div className={s.emptyActions}>
        {!isDemo && (
          <Button variant="primary" onClick={onConnect}>
            Connect Instagram
          </Button>
        )}
        <Button variant={isDemo ? 'primary' : 'secondary'} onClick={onConnect}>
          {isDemo ? 'Load Demo Data' : 'Load Demo Data Instead'}
        </Button>
      </div>
    </div>
  );
}

const TABS = ['insights', 'feed', 'comments'] as const;

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

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(activeTab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setActiveTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }

  const tabLabels = {
    insights: `Insights${insights.length > 0 ? ` (${insights.length})` : ''}`,
    feed:     `Feed (${posts.length})`,
    comments: `Comments${urgentCount > 0 ? ` — ${urgentCount} urgent` : ''}`,
  } as const;

  return (
    <main className={s.page}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerInner}>
          <PageHeader
            title="Social Intelligence"
            meta={isDemo ? <Badge state="warning">DEMO</Badge> : undefined}
            description={
              <>
                Public sentiment, engagement and content signals analysed by HLNA
                {lastSynced && (
                  <span className={s.synced}>
                    Last synced {timeAgo(lastSynced)}
                  </span>
                )}
              </>
            }
            actions={
              <div className={s.actions}>
                {!hasPosts && (
                  <Button variant="primary" onClick={handleConnect}>
                    {isDemo ? 'Load Demo Data' : '+ Connect Instagram'}
                  </Button>
                )}
                {hasPosts && (
                  <>
                    <Button variant="secondary" onClick={handleSync} disabled={syncing}>
                      {syncing ? 'Syncing…' : '↻ Sync Now'}
                    </Button>
                    <Button variant="primary" onClick={handleAnalyse} disabled={analysing}>
                      {analysing ? 'Analysing…' : '◎ Run HLNA Analysis'}
                    </Button>
                    {insights.length > 0 && (
                      <Button variant="secondary" onClick={exportInsightReport}>↗ Export Report</Button>
                    )}
                  </>
                )}
              </div>
            }
          />

          <div role="status">
            {notice && (
              <p className={s.notice} data-tone={/failed/i.test(notice) ? 'danger' : undefined}>
                {notice}
              </p>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <StateMessage kind="loading" title="Loading…" size="page" />
      ) : !hasPosts ? (
        <EmptyState onConnect={handleConnect} isDemo={isDemo} />
      ) : (
        <div className={s.body}>

          {/* KPI strip */}
          <MetricStrip>
            <Metric label="Posts analysed" value={stats.post_count ?? posts.length} />
            <Metric label="Avg engagement" value={avgEngagement.toFixed(0)} sub="likes + comments×2" />
            <Metric label="Avg likes" value={(stats.avg_likes ?? 0).toFixed(0)} />
            <Metric label="Avg comments" value={(stats.avg_comments ?? 0).toFixed(1)} />
            <Metric
              label="Sentiment score"
              value={sentimentScore != null ? `${sentimentScore}%` : '—'}
              sub="positive comments"
              tone={sentimentScore != null && sentimentScore >= 60 ? 'success' : sentimentScore != null && sentimentScore >= 40 ? 'warning' : sentimentScore != null ? 'danger' : undefined}
            />
            <Metric
              label="Need attention"
              value={urgentCount}
              sub="urgent / negative"
              tone={urgentCount > 0 ? 'danger' : 'success'}
            />
          </MetricStrip>

          {/* Tab bar */}
          <div role="tablist" aria-label="Social views" className={s.tabList} onKeyDown={onTabKeyDown}>
            {TABS.map((t, i) => (
              <button
                key={t}
                ref={el => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t}`}
                aria-selected={activeTab === t}
                aria-controls={`${baseId}-panel`}
                tabIndex={activeTab === t ? 0 : -1}
                onClick={() => setActiveTab(t)}
                className={s.tab}
              >
                {tabLabels[t]}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${activeTab}`}>
            {/* ── INSIGHTS tab ── */}
            {activeTab === 'insights' && (
              <div className={s.narrow}>
                {insights.length === 0 ? (
                  <div className={s.panelEmpty}>
                    <StateMessage kind="empty" title="No insights yet.">
                      Click <strong>Run HLNA Analysis</strong> to generate insights from your posts.
                    </StateMessage>
                  </div>
                ) : (
                  <ul className={s.stackList}>
                    {insights.map((ins, i) => <InsightCard key={ins.id ?? i} ins={ins} idx={i} />)}
                  </ul>
                )}
              </div>
            )}

            {/* ── FEED tab ── */}
            {activeTab === 'feed' && (
              <ul className={s.feed}>
                {posts.map((p, i) => <PostCard key={p.id ?? i} post={p} />)}
              </ul>
            )}

            {/* ── COMMENTS tab ── */}
            {activeTab === 'comments' && (
              <div className={s.narrow}>
                {urgentComments.length === 0 ? (
                  <div className={s.panelEmpty}>
                    <StateMessage kind="empty" title="No urgent or negative comments found." />
                  </div>
                ) : (
                  <>
                    <h2 className={s.attentionHead}>
                      {urgentComments.length} comment{urgentComments.length !== 1 ? 's' : ''} needing attention
                    </h2>
                    <ul className={s.stackList}>
                      {urgentComments.map((c, i) => {
                        const sentState = c.urgency ? 'warning' : (SENT_STATE[c.sentiment ?? 'neutral'] ?? 'inactive');
                        return (
                          <li key={i} className={s.attention} data-state={sentState}>
                            <div className={s.commentHead}>
                              <span className={s.author}>
                                {c.author_name ?? c.username ?? 'user'}
                              </span>
                              <Badge state={sentState}>
                                {c.urgency ? 'URGENT' : (c.sentiment ?? 'neutral').toUpperCase()}
                              </Badge>
                              <span className={s.when}>
                                {timeAgo(c.created_at ?? c.timestamp)}
                              </span>
                            </div>
                            <p className={s.attentionText}>{c.text}</p>
                            <p className={s.suggest}>
                              Suggested reply angle: {
                                c.urgency ? 'Acknowledge urgency, provide direct contact or timeline.' :
                                c.sentiment === 'negative' ? 'Apologise, offer explanation, direct to resolution channel.' :
                                'Respond with helpful information.'
                              }
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
