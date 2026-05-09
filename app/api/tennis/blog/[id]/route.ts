import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

// Public: get single post by slug or id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await prisma.blogPost.findFirst({
    where: { OR: [{ id }, { slug: id }], published: true },
  });
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json() as Partial<{
    title: string; content: string; excerpt: string;
    cover_image_url: string; published: boolean; author_name: string;
  }>;

  const existing = await prisma.blogPost.findFirst({ where: { id, organisation_id: session.organisationId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wasPublished = existing.published;
  const post = await prisma.blogPost.update({
    where: { id },
    data: {
      ...(body.title    !== undefined ? { title: body.title.trim() }     : {}),
      ...(body.content  !== undefined ? { content: body.content.trim() } : {}),
      ...(body.excerpt  !== undefined ? { excerpt: body.excerpt?.trim() ?? null } : {}),
      ...(body.cover_image_url !== undefined ? { cover_image_url: body.cover_image_url?.trim() ?? null } : {}),
      ...(body.author_name !== undefined ? { author_name: body.author_name?.trim() ?? null } : {}),
      ...(body.published !== undefined ? {
        published: body.published,
        published_at: body.published && !wasPublished ? new Date() : existing.published_at,
      } : {}),
      updated_at: new Date(),
    },
  });
  return NextResponse.json({ post });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await getAuthSession(); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const existing = await prisma.blogPost.findFirst({ where: { id, organisation_id: session.organisationId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.blogPost.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
