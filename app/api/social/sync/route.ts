import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import { fetchPosts, fetchComments } from '@/lib/social/instagram';
import { decrypt } from '@/lib/social/crypto';
import { IS_DEMO_MODE, DEMO_POSTS, DEMO_COMMENTS } from '@/lib/social/demo';

export async function POST() {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oid = session.organisationId;

  // Demo mode: seed fake data into DB tables
  if (IS_DEMO_MODE) {
    let seeded = 0;
    for (const p of DEMO_POSTS) {
      await sql`
        INSERT INTO social_posts
          (organisation_id, platform, platform_post_id, caption, media_url, thumbnail_url,
           permalink, media_type, likes_count, comments_count, engagement_score, posted_at, updated_at)
        VALUES
          (${oid}::uuid, 'instagram', ${p.id}, ${p.caption}, ${p.media_url}, ${p.thumbnail_url},
           ${p.permalink}, ${p.media_type}, ${p.like_count}, ${p.comments_count}, ${p.engagement_score},
           ${p.timestamp}::timestamptz, NOW())
        ON CONFLICT (organisation_id, platform, platform_post_id)
        DO UPDATE SET
          likes_count       = EXCLUDED.likes_count,
          comments_count    = EXCLUDED.comments_count,
          engagement_score  = EXCLUDED.engagement_score,
          updated_at        = NOW()
        RETURNING id
      `.catch(() => []);
      seeded++;
    }

    // Seed comments linked to their posts
    for (const c of DEMO_COMMENTS) {
      const [post] = await sql`
        SELECT id FROM social_posts
        WHERE organisation_id = ${oid}::uuid AND platform_post_id = ${c.post_id}
        LIMIT 1
      `.catch(() => []);
      if (!post) continue;
      await sql`
        INSERT INTO social_comments
          (organisation_id, social_post_id, platform_comment_id, author_name, text, sentiment, urgency, updated_at)
        VALUES
          (${oid}::uuid, ${post.id as string}::uuid, ${c.id}, ${c.username}, ${c.text},
           ${c.sentiment}, ${c.urgency}, NOW())
        ON CONFLICT (organisation_id, platform_comment_id) DO NOTHING
      `.catch(() => []);
    }

    return NextResponse.json({ synced: seeded, comments: DEMO_COMMENTS.length, demo: true });
  }

  // Real mode: fetch from Instagram API
  const [account] = await sql`
    SELECT id, account_id, access_token_encrypted
    FROM social_accounts
    WHERE organisation_id = ${oid}::uuid AND platform = 'instagram'
    ORDER BY connected_at DESC LIMIT 1
  `.catch(() => []);

  if (!account) {
    return NextResponse.json({ error: 'No Instagram account connected.' }, { status: 404 });
  }

  let token: string;
  try {
    token = decrypt(account.access_token_encrypted as string);
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt access token.' }, { status: 500 });
  }

  const igUserId  = account.account_id as string;
  const accountId = account.id as string;

  try {
    const posts = await fetchPosts(igUserId, token, 25);
    let syncedPosts = 0;
    let syncedComments = 0;

    for (const post of posts) {
      const engagementScore = post.like_count + post.comments_count * 2;
      const [row] = await sql`
        INSERT INTO social_posts
          (organisation_id, social_account_id, platform, platform_post_id, caption,
           media_url, thumbnail_url, permalink, media_type, likes_count, comments_count,
           engagement_score, posted_at, updated_at)
        VALUES
          (${oid}::uuid, ${accountId}::uuid, 'instagram', ${post.id},
           ${post.caption ?? null}, ${post.media_url ?? post.thumbnail_url ?? null},
           ${post.thumbnail_url ?? post.media_url ?? null}, ${post.permalink ?? null},
           ${post.media_type}, ${post.like_count}, ${post.comments_count},
           ${engagementScore}, ${post.timestamp}::timestamptz, NOW())
        ON CONFLICT (organisation_id, platform, platform_post_id)
        DO UPDATE SET
          likes_count      = EXCLUDED.likes_count,
          comments_count   = EXCLUDED.comments_count,
          engagement_score = EXCLUDED.engagement_score,
          updated_at       = NOW()
        RETURNING id
      `.catch(() => []);

      syncedPosts++;

      if (row?.id && post.comments_count > 0) {
        const comments = await fetchComments(post.id, token);
        for (const c of comments) {
          await sql`
            INSERT INTO social_comments
              (organisation_id, social_post_id, platform_comment_id, author_name, text, updated_at)
            VALUES
              (${oid}::uuid, ${row.id as string}::uuid, ${c.id}, ${c.username ?? null}, ${c.text}, NOW())
            ON CONFLICT (organisation_id, platform_comment_id) DO NOTHING
          `.catch(() => []);
          syncedComments++;
        }
      }
    }

    await sql`UPDATE social_accounts SET updated_at = NOW() WHERE id = ${accountId}::uuid`;
    return NextResponse.json({ synced: syncedPosts, comments: syncedComments, demo: false });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
