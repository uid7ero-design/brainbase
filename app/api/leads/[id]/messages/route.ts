import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';
import { getResendClient } from '@/lib/resendClient';
import { resolveEmailConfig } from '@/lib/emailConfig';

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

type Lead = { id: string; name: string; email: string };

type MessageRow = {
  id: string;
  direction: string;
  subject: string;
  body: string;
  from_address: string;
  to_address: string;
  resend_message_id: string | null;
  created_by: string | null;
  created_at: string;
  sender_name: string | null;
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMessageEmail(leadName: string, subject: string, body: string): string {
  const safeBody = escHtml(body).replace(/\n/g, '<br>');
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#0a0a0a;padding:32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;color:#22c55e;font-size:22px;font-weight:700;">LD Tennis Coaching</h1>
        <p style="margin:6px 0 0;color:#71717a;font-size:14px;">${escHtml(subject)}</p>
      </div>
      <div style="background:#111;padding:32px;border-radius:0 0 12px 12px;border:1px solid #1f1f1f;border-top:none;">
        <p style="margin:0;color:#ededed;font-size:15px;line-height:1.7;white-space:pre-wrap;">${safeBody}</p>
        <p style="margin:24px 0 0;color:#52525b;font-size:12px;">— Luke Doughty, LD Tennis Coaching</p>
      </div>
    </div>
  `;
}

async function loadLead(id: string, organisationId: string): Promise<Lead | null> {
  const rows = (await sql`
    SELECT id, name, email FROM tennis_leads
    WHERE id = ${id} AND organisation_id = ${organisationId}
    LIMIT 1
  `) as unknown as Lead[];
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const lead = await loadLead(id, session.organisationId);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Oldest-first, matching the existing pipeline_messages thread
  // convention (app/api/pipeline/[id]/messages, app/api/admin/pipeline/[id]/messages)
  // for a familiar reading order — a different table, same visual pattern.
  const messages = (await sql`
    SELECT
      m.id, m.direction, m.subject, m.body, m.from_address, m.to_address,
      m.resend_message_id, m.created_by, m.created_at,
      u.name AS sender_name
    FROM tennis_lead_messages m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.lead_id = ${id} AND m.organisation_id = ${session.organisationId}
    ORDER BY m.created_at ASC
  `) as unknown as MessageRow[];

  return NextResponse.json({ messages, inboundCaptured: false });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, SUBJECT_MAX) : '';
  const message = typeof body.body === 'string' ? body.body.trim().slice(0, BODY_MAX) : '';

  if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  // Canonical lead, loaded strictly by id + the server-resolved session
  // organisation. Recipient email comes from this row only — never from
  // the request body, so a caller cannot redirect the email elsewhere. A
  // lead belonging to another organisation is indistinguishable from a
  // nonexistent one (404).
  const lead = await loadLead(id, session.organisationId);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Sender/reply-to come only from server-side config, resolved from the
  // session's own organisation — never from the request body, so a caller
  // cannot spoof the From address or redirect replies.
  const { from, to: replyTo } = resolveEmailConfig(session.organisationId);

  const resend = getResendClient();
  if (!resend) {
    console.error(`[/api/leads/${id}/messages] RESEND_API_KEY not configured — message not sent`);
    return NextResponse.json({ error: 'Email is not configured. Please try again later.' }, { status: 500 });
  }

  let resendMessageId: string | null = null;
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: lead.email,
      replyTo,
      subject,
      html: buildMessageEmail(lead.name, subject, message),
    });

    if (error) {
      // Never log the message body/subject (customer PII) — only safe
      // identifiers and the error shape itself.
      console.error(`[/api/leads/${id}/messages] Resend rejected the send:`, error);
      return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 502 });
    }
    resendMessageId = data?.id ?? null;
  } catch (err) {
    console.error(`[/api/leads/${id}/messages] Resend send threw:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 502 });
  }

  // Resend has confirmed the send. Persist the history record — but a
  // failure here must never be reported as a failed send: the email is
  // already on its way to the customer, so this only ever degrades to a
  // warning, logged prominently (lead id + resend_message_id only, no
  // body/subject) rather than a false "send failed" response.
  try {
    const rows = (await sql`
      INSERT INTO tennis_lead_messages (
        organisation_id, lead_id, direction, subject, body,
        from_address, to_address, resend_message_id, created_by
      ) VALUES (
        ${session.organisationId}, ${id}, 'outbound', ${subject}, ${message},
        ${from}, ${lead.email}, ${resendMessageId}, ${session.userId}
      )
      RETURNING id, direction, subject, body, from_address, to_address, resend_message_id, created_by, created_at
    `) as unknown as MessageRow[];

    return NextResponse.json({ success: true, message: { ...rows[0], sender_name: session.name } }, { status: 201 });
  } catch (err) {
    console.error(
      `[/api/leads/${id}/messages] email sent (resend_message_id=${resendMessageId}) but saving to history FAILED:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      success: true,
      warning: 'Email sent, but saving it to this lead\'s history failed. It may not appear in the list below.',
      message: null,
    });
  }
}
