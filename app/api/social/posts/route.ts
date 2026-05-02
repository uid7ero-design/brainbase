import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { IS_DEMO_MODE, DEMO_POSTS, DEMO_COMMENTS } from '@/lib/social/demo';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oid   = session.organisationId;
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') ?? '20'), 50);

  if (IS_DEMO_MODE) {
    const posts = DEMO_POSTS.slice(0, limit).map(p => ({
      ...p,
      comments: DEMO_COMMENTS.filter(c => c.post_id === p.id),
    }));
    return NextResponse.json({ posts, demo: true });
  }

  const [dbPosts, account] = await Promise.all([
    sql`
      SELECT sp.id, sp.platform_post_id, sp.caption, sp.media_url, sp.thumbnail_url,
             sp.permalink, sp.media_type, sp.likes_count, sp.comments_count,
             sp.engagement_score, sp.posted_at
      FROM social_posts sp
      WHERE sp.organisation_id = ${oid}::uuid
      ORDER BY sp.posted_at DESC
      LIMIT ${limit}
    `.catch(() => []),
    sql`
      SELECT account_name, account_id, connected_at, updated_at
      FROM social_accounts
      WHERE organisation_id = ${oid}::uuid AND platform = 'instagram'
      ORDER BY connected_at DESC LIMIT 1
    `.catch(() => []),
  ]);

  const postIds = dbPosts.map(p => p.id as string);
  const comments = postIds.length > 0
    ? await sql`
        SELECT social_post_id, text, author_name, sentiment, urgency, created_at
        FROM social_comments
        WHERE organisation_id = ${oid}::uuid AND social_post_id = ANY(${postIds}::uuid[])
        ORDER BY urgency DESC, created_at ASC
      `.catch(() => [])
    : [];

  const commentsByPost = comments.reduce<Record<string, typeof comments>>((acc, c) => {
    const pid = c.social_post_id as string;
    acc[pid] = acc[pid] ?? [];
    acc[pid].push(c);
    return acc;
  }, {});

  const posts = dbPosts.map(p => ({
    ...p,
    comments: commentsByPost[p.id as string] ?? [],
  }));

  return NextResponse.json({
    posts,
    account: account[0] ?? null,
    demo: false,
  });
}
