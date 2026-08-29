import { NextRequest, NextResponse } from 'next/server';
import { getPublicTicketDetail } from '@/lib/events/publicTicket';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';

type Ctx = { params: Promise<{ token: string }> };

// Fully anonymous — no session helper of any kind is called here,
// mirroring app/api/public/events/.../route.ts exactly. "Unknown
// token" and "token belongs to a different organisation" are
// indistinguishable from the caller's point of view (both 404) — see
// getPublicTicketDetail's own comment.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { token } = await params;

  // Rate limited like every other public Events endpoint — keyed by
  // IP, not by token (keying by token would let an attacker learn
  // "this exact token was rate-limited" as a side channel; keying by IP
  // does not). Generous relative to registration's 10/hour: legitimately
  // reloading one's own ticket many times is normal, low-risk traffic,
  // and the token's own 256 bits of entropy — not this limit — is what
  // actually makes guessing infeasible.
  const ip = getClientIp(req);
  if (!checkRateLimit(`public-ticket-lookup:${ip}`, 60, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const result = await getPublicTicketDetail(token);
  if (!result.ok) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  return NextResponse.json(result.detail);
}
