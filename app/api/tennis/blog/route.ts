import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Public: list published posts for an org
export async function GET(req: NextRequest) {
  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  const posts = await prisma.blogPost.findMany({
    where: { organisation_id: orgId, published: true },
    orderBy: { published_at: 'desc' },
    select: { id: true, title: true, slug: true, excerpt: true, cover_image_url: true, published_at: true, author_name: true },
  });
  return NextResponse.json({ posts });
}

// Auth: create post
export async function POST(req: NextRequest) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    title: string; content: string; excerpt?: string;
    cover_image_url?: string; published?: boolean; author_name?: string;
  };

  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: 'title and content required' }, { status: 400 });
  }

  const baseSlug = slug(body.title);
  const existing = await prisma.blogPost.count({ where: { organisation_id: session.organisationId, slug: baseSlug } });
  const finalSlug = existing > 0 ? `${baseSlug}-${Date.now()}` : baseSlug;

  const post = await prisma.blogPost.create({
    data: {
      id: crypto.randomUUID(),
      organisation_id: session.organisationId,
      title: body.title.trim(),
      slug: finalSlug,
      excerpt: body.excerpt?.trim() ?? null,
      content: body.content.trim(),
      cover_image_url: body.cover_image_url?.trim() ?? null,
      published: body.published ?? false,
      published_at: body.published ? new Date() : null,
      author_name: body.author_name?.trim() ?? 'Luke Doughty',
    },
  });
  return NextResponse.json({ post }, { status: 201 });
}
