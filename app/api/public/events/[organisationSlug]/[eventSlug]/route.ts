import { NextResponse } from 'next/server';
import { getPublicEventDetail } from '@/lib/events/publicEventDetail';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// Fully anonymous — no session helper of any kind is called here. Every
// failure mode (org doesn't exist, Events capability not entitled, event
// doesn't exist, event isn't PUBLISHED) collapses to the same 404 via
// getPublicEventDetail()/resolvePublicEvent(), so a caller can never
// distinguish "doesn't exist" from "exists but unavailable".
export async function GET(_req: Request, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;
  const result = await getPublicEventDetail(organisationSlug, eventSlug);
  if (!result.ok) return NextResponse.json({ error: 'Event not available.' }, { status: 404 });
  return NextResponse.json(result.detail);
}
