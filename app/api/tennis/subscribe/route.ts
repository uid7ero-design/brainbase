import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const { email, orgId } = await req.json() as { email: string; orgId: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  try {
    await prisma.newsletterSubscriber.upsert({
      where: { organisation_id_email: { organisation_id: orgId, email } },
      create: { id: crypto.randomUUID(), organisation_id: orgId, email },
      update: {},
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
  }
}
