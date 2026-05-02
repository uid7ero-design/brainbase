import Anthropic from '@anthropic-ai/sdk';
import sql from '@/lib/db';
import { DEMO_POSTS, DEMO_COMMENTS, IS_DEMO_MODE } from '@/lib/social/demo';
import type { AgentInput, AgentOutput, Evidence } from './types';

const anthropic = new Anthropic();

const SYSTEM = `You are a social media intelligence analyst for a municipal council.

You receive Instagram post data, engagement metrics, and comment samples.
Your job is to produce 5–8 structured insights that give a council communications team real, actionable intelligence.

Each insight MUST follow this exact format:
{
  "title": "Short, specific headline — include numbers where possible",
  "summary": "2–3 sentences. Name specific posts, themes, or patterns. Cite actual numbers.",
  "confidence": "high | medium | low",
  "evidence": ["Fact 1 with number", "Fact 2 with number", "Fact 3"],
  "recommended_action": "One concrete next step with named owner and timeframe."
}

Insight types to cover (use as many as are supported by the data):
- ENGAGEMENT_WINNER: Best performing post(s) and why
- ENGAGEMENT_RISK: Worst performing or declining posts
- SENTIMENT_TREND: Overall sentiment shift across comments
- URGENT_COMMENTS: Comments that need a reply (questions, complaints, urgency)
- CONTENT_PATTERN: Topics or formats that consistently over/underperform
- POSTING_WINDOW: Time-of-day or day-of-week patterns (if inferable)
- REPUTATION_RISK: Negative sentiment concentration or complaint clusters
- NEXT_POST: Suggested content based on what's working

RULES:
- Every claim must reference data from the input — no generic advice.
- Use specific post IDs, caption excerpts, or comment quotes as evidence.
- Confidence = high if ≥20 posts, medium if 10–19, low if <10.
- Recommended actions must name who should act (e.g., "Comms team", "Council", "Social media manager").

Return valid JSON only:
{
  "insights": [ ...array of insight objects... ],
  "topFinding": "One sentence: the single most critical finding with a specific number or entity.",
  "overallSentiment": "positive | mixed | negative",
  "urgentCommentCount": 0,
  "confidence": 0.0-1.0,
  "evidenceSummary": "What data was analysed (post count, date range, comment count).",
  "calculationUsed": "Key metrics used: engagement formula, sentiment method, comparison periods."
}`;

async function fetchPostData(oid: string) {
  const [posts, comments, stats] = await Promise.all([
    sql`
      SELECT id, caption, permalink, likes_count, comments_count, engagement_score,
             media_type, posted_at
      FROM social_posts
      WHERE organisation_id = ${oid}::uuid
      ORDER BY posted_at DESC
      LIMIT 30
    `,
    sql`
      SELECT sc.text, sc.author_name, sc.sentiment, sc.urgency, sc.created_at,
             sp.caption AS post_caption, sp.permalink AS post_permalink
      FROM social_comments sc
      JOIN social_posts sp ON sp.id = sc.social_post_id
      WHERE sc.organisation_id = ${oid}::uuid
      ORDER BY sc.urgency DESC, sc.created_at DESC
      LIMIT 60
    `,
    sql`
      SELECT
        COUNT(*)::int                                                   AS post_count,
        ROUND(AVG(likes_count)::numeric, 1)::float                     AS avg_likes,
        ROUND(AVG(comments_count)::numeric, 1)::float                  AS avg_comments,
        ROUND(AVG(engagement_score)::numeric, 1)::float                AS avg_engagement,
        MAX(engagement_score)::int                                      AS max_engagement,
        MIN(posted_at)                                                  AS oldest_post,
        MAX(posted_at)                                                  AS newest_post
      FROM social_posts
      WHERE organisation_id = ${oid}::uuid
    `,
  ]);
  return { posts, comments, stats };
}

export async function run(input: AgentInput): Promise<AgentOutput> {
  const { organisationId: oid } = input;

  let posts: unknown[];
  let comments: unknown[];
  let stats: unknown[];
  let isDemo = false;

  if (IS_DEMO_MODE) {
    isDemo = true;
    posts    = DEMO_POSTS;
    comments = DEMO_COMMENTS;
    stats    = [{
      post_count:      DEMO_POSTS.length,
      avg_likes:       +(DEMO_POSTS.reduce((s, p) => s + p.like_count, 0) / DEMO_POSTS.length).toFixed(1),
      avg_comments:    +(DEMO_POSTS.reduce((s, p) => s + p.comments_count, 0) / DEMO_POSTS.length).toFixed(1),
      avg_engagement:  +(DEMO_POSTS.reduce((s, p) => s + p.engagement_score, 0) / DEMO_POSTS.length).toFixed(1),
      max_engagement:  Math.max(...DEMO_POSTS.map(p => p.engagement_score)),
      oldest_post:     DEMO_POSTS[DEMO_POSTS.length - 1].timestamp,
      newest_post:     DEMO_POSTS[0].timestamp,
    }];
  } else {
    try {
      const data = await fetchPostData(oid);
      posts    = data.posts;
      comments = data.comments;
      stats    = data.stats;
    } catch {
      posts = []; comments = []; stats = [];
    }
  }

  if (posts.length === 0) {
    return {
      agentName: 'SocialAgent',
      summary: 'No social posts found. Connect an Instagram account and sync to enable social intelligence.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Connect Instagram via Settings → Social to enable analysis.'],
      sourceRows: [],
      warnings: ['No social data available.'],
    };
  }

  const postSample = JSON.stringify(posts.slice(0, 25));
  const commentSample = JSON.stringify(comments.slice(0, 50));
  const statsSummary = JSON.stringify(stats[0] ?? {});

  const prompt = `Analyse the following Instagram data for this council account and generate insights.

=== ACCOUNT STATS ===
${statsSummary}

=== RECENT POSTS (up to 25, newest first) ===
${postSample}

=== RECENT COMMENTS (up to 50, urgent first) ===
${commentSample}

${isDemo ? '\n[NOTE: This is demo data for illustration purposes.]\n' : ''}

Generate the structured insights JSON now.`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]) as {
      insights: Array<{
        title: string;
        summary: string;
        confidence: string;
        evidence: string[];
        recommended_action: string;
      }>;
      topFinding: string;
      overallSentiment: string;
      urgentCommentCount: number;
      confidence: number;
      evidenceSummary?: string;
      calculationUsed?: string;
    };

    const findings = (parsed.insights ?? []).flatMap(ins => [
      `[${ins.title}] ${ins.summary}`,
      ...ins.evidence.map(e => `  · ${e}`),
    ]);

    const actions = (parsed.insights ?? []).map(ins => ins.recommended_action);

    const evidence: Evidence = {
      sourceDataset:   ['social_posts', 'social_comments'],
      sourceColumns:   ['caption', 'likes_count', 'comments_count', 'engagement_score', 'posted_at', 'sentiment', 'urgency'],
      evidenceSummary: parsed.evidenceSummary ?? `Analysed ${posts.length} posts and ${comments.length} comments.`,
      calculationUsed: parsed.calculationUsed ?? 'Engagement score = likes + (comments × 2). Sentiment from comment text.',
      confidenceReason: `Based on ${posts.length} posts — confidence is ${parsed.confidence >= 0.7 ? 'high' : parsed.confidence >= 0.5 ? 'medium' : 'low'}.`,
      sampleRows: posts.slice(0, 5),
    };

    return {
      agentName: 'SocialAgent',
      summary: parsed.topFinding,
      findings,
      confidence: parsed.confidence ?? 0.7,
      recommendedActions: actions,
      sourceRows: posts,
      warnings: parsed.urgentCommentCount > 0
        ? [`${parsed.urgentCommentCount} comment(s) require urgent attention.`]
        : [],
      evidence,
    };
  } catch (err) {
    return {
      agentName: 'SocialAgent',
      summary: 'Social analysis failed.',
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: posts,
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
