import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

const resend = new Resend(process.env.RESEND_API_KEY);

const VALID_STATUSES = ['new', 'contacted', 'in_progress', 'booked', 'closed', 'cancelled'] as const;

const STATUS_LABELS: Record<string, string> = {
  new:         'New',
  contacted:   'Contacted',
  in_progress: 'In Progress',
  booked:      'Booked',
  closed:      'Closed',
  cancelled:   'Cancelled',
};

const APP_URL = process.env.APP_URL ?? 'https://brainbase.com.au'

type Lead = {
  id: string
  status: string
  name: string
  email: string
  notes: string | null
  client_token: string | null
};

function buildClientEmail(
  name: string,
  status: string | null,
  note: string | null,
  cancelToken: string | null,
): string {
  const statusLine = status
    ? `<p style="margin:0 0 12px;color:#71717a;font-size:13px;">Status: <strong style="color:#ededed">${STATUS_LABELS[status] ?? status}</strong></p>`
    : '';
  const noteLine = note
    ? `<div style="margin-top:16px;padding:16px;background:#111;border-radius:8px;border:1px solid #1f1f1f;"><p style="margin:0;color:#ededed;font-size:14px;line-height:1.7;white-space:pre-wrap;">${note}</p></div>`
    : '';
  const cancelLine = cancelToken
    ? `<p style="margin:28px 0 0;font-size:12px;color:#52525b;">If you'd like to withdraw your enquiry, <a href="${APP_URL}/tennis/cancel?t=${cancelToken}" style="color:#71717a;">click here to cancel your request</a>.</p>`
    : '';
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#0a0a0a;padding:32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;color:#22c55e;font-size:22px;font-weight:700;">LD Tennis Coaching</h1>
        <p style="margin:6px 0 0;color:#71717a;font-size:14px;">Update on your enquiry</p>
      </div>
      <div style="background:#111;padding:32px;border-radius:0 0 12px 12px;border:1px solid #1f1f1f;border-top:none;">
        <p style="margin:0 0 16px;color:#ededed;font-size:15px;">Hi ${name},</p>
        <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;">Luke has an update on your coaching enquiry.</p>
        ${statusLine}
        ${noteLine}
        <p style="margin:24px 0 0;color:#52525b;font-size:12px;">— Luke Doughty, LD Tennis Coaching</p>
        ${cancelLine}
      </div>
    </div>
  `;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json() as { status?: string; note?: string; notify?: boolean };

  if (body.status && !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  let rows: Lead[] = [];

  try {
    if (body.status && body.note !== undefined) {
      rows = (await sql`
        UPDATE tennis_leads SET status = ${body.status}, notes = ${body.note}
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING id, status, name, email, notes, client_token::text AS client_token
      `) as unknown as Lead[];
    } else if (body.status) {
      rows = (await sql`
        UPDATE tennis_leads SET status = ${body.status}
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING id, status, name, email, notes, client_token::text AS client_token
      `) as unknown as Lead[];
    } else if (body.note !== undefined) {
      rows = (await sql`
        UPDATE tennis_leads SET notes = ${body.note}
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING id, status, name, email, notes, client_token::text AS client_token
      `) as unknown as Lead[];
    } else {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
  } catch (err) {
    console.error('[leads PATCH] SQL error:', err);
    return NextResponse.json({ error: 'Database error — check server logs' }, { status: 500 });
  }

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const lead = rows[0];

  if (body.notify && lead.email) {
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: lead.email,
        replyTo: process.env.MAIL_TO ?? 'uid7ero@gmail.com',
        subject: `Update from LD Tennis Coaching`,
        html: buildClientEmail(lead.name, body.status ?? null, body.note ?? null, lead.client_token),
      });
    } catch (err) {
      console.error('[leads PATCH] email error:', err);
    }
  }

  return NextResponse.json({ success: true, status: lead.status, notes: lead.notes });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let rows;
  try {
    rows = await sql`
      DELETE FROM tennis_leads
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id
    `;
  } catch (err) {
    console.error('[leads DELETE] SQL error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
