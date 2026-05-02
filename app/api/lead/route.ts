import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import sql from '@/lib/db';
import { validateBookingRequest } from '@/app/tennis/lib/booking';
import type { BookingRequest } from '@/app/tennis/lib/booking';

const resend = new Resend(process.env.RESEND_API_KEY);

const LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID;

function buildEmailHtml(data: BookingRequest): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #0a0a0a; padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; color: #22c55e; font-size: 22px; font-weight: 700;">LD Tennis</h1>
        <p style="margin: 6px 0 0; color: #71717a; font-size: 14px;">New Booking Request</p>
      </div>
      <div style="background: #111; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #1f1f1f; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #71717a; font-size: 13px; width: 140px;">Full Name</td><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #ededed; font-size: 14px; font-weight: 600;">${data.name}</td></tr>
          <tr><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #71717a; font-size: 13px;">Email</td><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #ededed; font-size: 14px;"><a href="mailto:${data.email}" style="color: #22c55e; text-decoration: none;">${data.email}</a></td></tr>
          <tr><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #71717a; font-size: 13px;">Phone</td><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #ededed; font-size: 14px;">${data.phone || 'Not provided'}</td></tr>
          <tr><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #71717a; font-size: 13px;">Session Type</td><td style="padding: 12px 0; border-bottom: 1px solid #1f1f1f; color: #ededed; font-size: 14px;">${data.sessionType || 'Not specified'}</td></tr>
          <tr><td style="padding: 12px 0; color: #71717a; font-size: 13px;">Message</td><td style="padding: 12px 0; color: #ededed; font-size: 14px; line-height: 1.6;">${data.message || 'No message provided'}</td></tr>
        </table>
        <div style="margin-top: 32px; padding: 16px; background: #0d0d0d; border-radius: 8px; border: 1px solid #1f1f1f;">
          <p style="margin: 0; color: #71717a; font-size: 12px;">Reply to <a href="mailto:${data.email}" style="color: #22c55e;">${data.email}</a>${data.phone ? ` or call <strong style="color: #a1a1aa;">${data.phone}</strong>` : ''}.</p>
        </div>
      </div>
    </div>
  `;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body.' }, { status: 400 });
  }

  if (!validateBookingRequest(body)) {
    return NextResponse.json({ success: false, message: 'Name, email, and preferred time are required.' }, { status: 422 });
  }

  // Store lead in DB if org is configured
  if (LD_TENNIS_ORG_ID) {
    try {
      await sql`
        INSERT INTO tennis_leads (organisation_id, name, email, phone, session_type, message)
        VALUES (${LD_TENNIS_ORG_ID}, ${body.name}, ${body.email}, ${body.phone ?? null}, ${body.sessionType ?? null}, ${body.message ?? null})
      `;
    } catch (err) {
      console.error('[/api/lead] DB insert error:', err);
    }
    try {
      await sql`
        INSERT INTO contacts (organisation_id, name, email, phone, status)
        VALUES (${LD_TENNIS_ORG_ID}, ${body.name}, ${body.email}, ${body.phone ?? null}, 'lead')
        ON CONFLICT (organisation_id, email) DO NOTHING
      `;
    } catch (err) {
      console.error('[/api/lead] contacts insert error:', err);
    }
  }

  // Send email notification
  const { error } = await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: process.env.MAIL_TO ?? 'uid7ero@gmail.com',
    replyTo: body.email,
    subject: `New Booking Request – ${body.name}`,
    html: buildEmailHtml(body),
  });

  if (error) {
    console.error('[/api/lead] Resend error:', error);
    return NextResponse.json({ success: false, message: 'Failed to send booking request. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: 'Booking request sent successfully.' });
}
