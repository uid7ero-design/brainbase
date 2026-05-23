import 'server-only';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import sql from '@/lib/db';
import { sendEmail, webServiceLeadEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rateLimit';

const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SERVICES = new Set(['website_design', 'ai_website', 'maintenance', 'integrations']);
const VALID_BUDGETS  = new Set(['under_2500', '2500_5000', '5000_10000', '10000_20000', '20000_plus', 'unsure']);

function clean(v: unknown, max = 200): string {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/[<>]/g, '').slice(0, max);
}

export async function POST(req: Request) {
  // ── Rate limit: 3 submissions per IP per hour ────────────────────────────
  const hdrs = await headers();
  const ip   = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`web-lead:${ip}`, 3, 60 * 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ── Required field validation ────────────────────────────────────────────
  const fullName = clean(body.full_name);
  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'full_name is required' }, { status: 400 });
  }

  const email = clean(body.email);
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  // ── Sanitise optional fields ─────────────────────────────────────────────
  const businessName = clean(body.business_name)   || null;
  const phone        = clean(body.phone)            || null;
  const websiteUrl   = clean(body.website_url, 500) || null;
  const businessType = clean(body.business_type)    || null;
  const projectDesc  = clean(body.project_description, 2000) || null;

  const rawBudget  = clean(body.budget_range);
  const budgetRange = rawBudget && VALID_BUDGETS.has(rawBudget) ? rawBudget : null;

  const rawServices = Array.isArray(body.service_interest) ? body.service_interest : [];
  const serviceInterest = rawServices.filter(
    (s): s is string => typeof s === 'string' && VALID_SERVICES.has(s),
  );

  // ── Persist ──────────────────────────────────────────────────────────────
  const rows = await sql`
    INSERT INTO web_service_leads (
      full_name, business_name, email, phone, website_url, business_type,
      service_interest, budget_range, project_description, source
    ) VALUES (
      ${fullName}, ${businessName}, ${email}, ${phone},
      ${websiteUrl}, ${businessType},
      ${serviceInterest}, ${budgetRange}, ${projectDesc},
      'website'
    )
    RETURNING id, created_at
  `;
  const lead = rows[0];

  // ── Email notification (fire-and-forget) ─────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL ?? 'uid7ero@gmail.com';
  sendEmail({
    to: adminEmail,
    ...webServiceLeadEmail({
      id:              lead.id as string,
      fullName,
      businessName:    businessName  ?? '',
      email,
      phone:           phone         ?? '',
      serviceInterest,
      budgetRange:     budgetRange   ?? '',
      projectDesc:     projectDesc   ?? '',
    }),
  }).catch(err => console.error('[web-lead] notification email failed:', err));

  return NextResponse.json({ success: true, id: lead.id }, { status: 201 });
}
