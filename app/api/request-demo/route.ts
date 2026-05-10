import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import sql from '@/lib/db';
import { prisma } from '@/lib/prisma';

const resend = new Resend(process.env.RESEND_API_KEY);

function row(label: string, value: string | null | undefined) {
  if (!value) return '';
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #1f1f1f;color:#71717a;font-size:13px;width:190px;vertical-align:top">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #1f1f1f;color:#ededed;font-size:14px;line-height:1.6">${value}</td>
    </tr>`;
}

function buildEmail(d: {
  name: string; email: string; phone?: string;
  business_name: string; business_type?: string; description?: string;
  num_clients?: string; num_users?: string; goal?: string; referral?: string;
}) {
  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
      <div style="background:#0a0a0a;padding:32px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;color:#10b981;font-size:20px;font-weight:700;letter-spacing:-.02em">Brainbase</h1>
        <p style="margin:6px 0 0;color:#71717a;font-size:13px">New Demo Request</p>
      </div>
      <div style="background:#111;padding:32px;border-radius:0 0 12px 12px;border:1px solid #1f1f1f;border-top:none">
        <table style="width:100%;border-collapse:collapse">
          ${row('Full Name', d.name)}
          ${row('Email', `<a href="mailto:${d.email}" style="color:#10b981;text-decoration:none">${d.email}</a>`)}
          ${row('Phone', d.phone)}
          ${row('Business Name', d.business_name)}
          ${row('Business Type', d.business_type)}
          ${row('Description', d.description)}
          ${row('Clients / Participants', d.num_clients)}
          ${row('Team / Users', d.num_users)}
          ${row('What they want to achieve', d.goal)}
          ${row('How they heard about us', d.referral)}
        </table>
        <div style="margin-top:28px;padding:16px;background:#0d0d0d;border-radius:8px;border:1px solid #1f1f1f">
          <p style="margin:0;color:#71717a;font-size:12px">
            Reply to <a href="mailto:${d.email}" style="color:#10b981">${d.email}</a>
            ${d.phone ? ` · <strong style="color:#a1a1aa">${d.phone}</strong>` : ''}
          </p>
        </div>
      </div>
    </div>`;
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { name, email, phone, business_name, business_type, description, num_clients, num_users, goal, referral } = body;

  if (!name?.trim() || !email?.trim() || !business_name?.trim()) {
    return NextResponse.json({ error: 'Name, email, and business name are required.' }, { status: 400 });
  }

  const title = `Demo Request — ${business_name.trim()} (${name.trim()})`;

  const descriptionParts = [
    email.trim(),
    phone         && `📞 ${phone}`,
    business_type && `Type: ${business_type}`,
    description   && `About: ${description}`,
    num_clients   && `Clients: ${num_clients}`,
    num_users     && `Users: ${num_users}`,
    goal          && `Goal: ${goal}`,
    referral      && `Via: ${referral}`,
  ].filter(Boolean).join(' · ');

  // Look up super_admin org
  let adminOrgId: string | null = null;
  try {
    const [admin] = await sql`
      SELECT organisation_id FROM users
      WHERE role = 'super_admin' AND organisation_id IS NOT NULL
      ORDER BY created_at ASC LIMIT 1
    `;
    adminOrgId = admin?.organisation_id ?? null;
  } catch (err) {
    console.error('[/api/request-demo] admin lookup:', err);
  }

  if (!adminOrgId) {
    console.warn('[/api/request-demo] no super_admin org — skipping DB writes');
  }

  // 1. Admin pipeline — visible at /admin/pipeline (only columns guaranteed to exist)
  if (adminOrgId) {
    try {
      await sql`
        INSERT INTO client_pipeline (organisation_id, type, title, description, status, priority, founder_note)
        VALUES (
          ${adminOrgId},
          'request',
          ${title},
          ${descriptionParts},
          'new',
          'high',
          ${email.trim()}
        )
      `;
      console.log('[/api/request-demo] pipeline insert OK');
    } catch (err) {
      console.error('[/api/request-demo] pipeline insert FAILED:', err);
    }
  }

  // 2. Ops alert via Prisma — visible in Founder OS (/admin/founder)
  if (adminOrgId) {
    try {
      await prisma.alert.create({
        data: {
          organisation_id: adminOrgId,
          title,
          description: descriptionParts,
          severity: 'HIGH',
          rule_key: 'brainbase_demo_request',
          metadata: {
            name, email,
            phone:         phone         || null,
            business_name,
            business_type: business_type || null,
            num_clients:   num_clients   || null,
            num_users:     num_users     || null,
            goal:          goal          || null,
            referral:      referral      || null,
          },
        },
      });
      console.log('[/api/request-demo] alert create OK');
    } catch (err) {
      console.error('[/api/request-demo] alert create FAILED:', err);
    }
  }

  // 3. Email
  const { error } = await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: process.env.MAIL_TO ?? 'hello@hlna.com.au',
    replyTo: email.trim(),
    subject: `Demo Request — ${business_name} · ${name}`,
    html: buildEmail({ name, email, phone, business_name, business_type, description, num_clients, num_users, goal, referral }),
  });

  if (error) console.error('[/api/request-demo] Resend:', error);

  return NextResponse.json({ success: true });
}
