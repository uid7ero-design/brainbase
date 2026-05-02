import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { IS_DEMO_MODE } from '@/lib/social/demo';

export async function GET() {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oid = session.organisationId;

  const insights = await sql`
    SELECT id, insight_type, title, summary, evidence_json, confidence, recommended_action, created_at
    FROM social_insights
    WHERE organisation_id = ${oid}::uuid
    ORDER BY created_at DESC
    LIMIT 20
  `.catch(() => []);

  const [stats] = await sql`
    SELECT
      COUNT(*)::int                                                    AS post_count,
      ROUND(AVG(likes_count)::numeric, 1)::float                      AS avg_likes,
      ROUND(AVG(comments_count)::numeric, 1)::float                   AS avg_comments,
      ROUND(AVG(engagement_score)::numeric, 1)::float                 AS avg_engagement,
      COUNT(*) FILTER (WHERE posted_at >= NOW() - INTERVAL '30 days')::int AS posts_30d
    FROM social_posts
    WHERE organisation_id = ${oid}::uuid
  `.catch(() => [null]);

  const [commentStats] = await sql`
    SELECT
      COUNT(*)::int                                              AS total_comments,
      COUNT(*) FILTER (WHERE urgency = true)::int               AS urgent_count,
      COUNT(*) FILTER (WHERE sentiment = 'negative')::int       AS negative_count,
      COUNT(*) FILTER (WHERE sentiment = 'positive')::int       AS positive_count
    FROM social_comments
    WHERE organisation_id = ${oid}::uuid
  `.catch(() => [null]);

  return NextResponse.json({
    insights,
    stats: stats ?? {},
    commentStats: commentStats ?? {},
    demo: IS_DEMO_MODE,
  });
}
