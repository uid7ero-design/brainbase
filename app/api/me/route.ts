import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ role: null, name: null }, { status: 401 });
  return NextResponse.json({
    userId: session.userId,
    organisationId: session.organisationId ?? null,
    role: session.role,
    name: session.name,
  });
}
