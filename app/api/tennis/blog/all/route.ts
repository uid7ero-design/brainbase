import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

// Auth: list all posts including drafts, for the dashboard editor
export async function GET() {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const posts = await prisma.blogPost.findMany({
    where: { organisation_id: session.organisationId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, title: true, slug: true, excerpt: true,
      cover_image_url: true, published: true, published_at: true,
      author_name: true, created_at: true,
    },
  });
  return NextResponse.json({ posts });
}
