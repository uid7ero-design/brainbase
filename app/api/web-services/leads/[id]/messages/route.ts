import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthSession } from '@/lib/authSession';
import { getResendClient } from '@/lib/resendClient';
import { resolveEmailConfig } from '@/lib/emailConfig';

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

type Lead = { id: string; full_name: string; email: string };

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
        <h1 style="margin:0;color:#7C3AED;font-size:22px;font-weight:700;">BrainBase</h1>
        <p style="margin:6px 0 0;color:#71717a;font-size:14px;">${escHtml(subject)}</p>
      </div>
      <div style="background:#111;padding:32px;border-radius:0 0 12px 12px;border:1px solid #1f1f1f;border-top:none;">
        <p style="margin:0;color:#ededed;font-size:15px;line-height:1.7;white-space:pre-wrap;">${safeBody}</p>
        <p style="margin:24px 0 0;color:#52525b;font-size:12px;">— BrainBase</p>
      </div>
    </div>
  `;
}

// web_service_leads has no organisation_id column — it's BrainBase's own
// global sales-lead table, not a client org's data — so a lead is looked
// up purely by id, and access to this route is gated by role
// (super_admin) rather than tenant scoping.
async function loadLead(id: string): Promise<Lead | null> {
  const rows = (await sql`
    SELECT id, full_name, email FROM web_service_leads
    WHERE id = ${id}
    LIMIT 1
  `) as unknown as Lead[];
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // ── Auth: super_admin only (matches GET /api/web-services/leads and
  // DELETE /api/web-services/leads/[id]'s existing strictness) ───────────
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const lead = await loadLead(id);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Oldest-first, matching the existing tennis_lead_messages thread
  // convention (app/api/leads/[id]/messages/route.ts) for a familiar
  // reading order — a separate, isolated table, same visual pattern only.
  const messages = (await sql`
    SELECT
      m.id, m.direction, m.subject, m.body, m.from_address, m.to_address,
      m.resend_message_id, m.created_by, m.created_at,
      u.name AS sender_name
    FROM web_lead_messages m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.lead_id = ${id}
    ORDER BY m.created_at ASC
  `) as unknown as MessageRow[];

  return NextResponse.json({ messages, inboundCaptured: false });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // ── Auth: super_admin only (matches GET /api/web-services/leads and
  // DELETE /api/web-services/leads/[id]'s existing strictness) ───────────
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  // Only subject/body are ever read from the request body. Recipient,
  // sender, organisation, lead id, direction, created_by, and the
  // provider message id are all server-controlled below — there is no
  // code path through which a client-supplied value for any of them could
  // reach the send or the persisted row.
  let requestBody: Record<string, unknown>;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const subject = typeof requestBody.subject === 'string' ? requestBody.subject.trim() : '';
  const message = typeof requestBody.body === 'string' ? requestBody.body.trim() : '';

  if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
  if (subject.length > SUBJECT_MAX) {
    return NextResponse.json({ error: `Subject must be ${SUBJECT_MAX} characters or fewer` }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  if (message.length > BODY_MAX) {
    return NextResponse.json({ error: `Message must be ${BODY_MAX} characters or fewer` }, { status: 400 });
  }

  // Canonical lead, loaded strictly by the id in the URL path. Recipient
  // email comes from this row only — never from the request body, so a
  // caller cannot redirect the email elsewhere. A nonexistent lead id
  // returns 404 before any email is attempted.
  const lead = await loadLead(id);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Sender/reply-to come only from the generic BrainBase email config —
  // resolveEmailConfig(null) deterministically takes the generic branch,
  // never LD Tennis's dedicated config (which only matches an exact
  // LD_TENNIS_ORG_ID) — same call the existing intake-notification email
  // in app/api/web-services/lead/route.ts already makes. No organisation
  // id is ever read from the request body.
  const { from, to: replyTo } = resolveEmailConfig(null);

  const resend = getResendClient();
  if (!resend) {
    console.error(`[/api/web-services/leads/${id}/messages] RESEND_API_KEY not configured — message not sent`);
    return NextResponse.json({ error: 'Email is not configured. Please try again later.' }, { status: 500 });
  }

  let resendMessageId: string | null = null;
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: lead.email,
      replyTo,
      subject,
      html: buildMessageEmail(lead.full_name, subject, message),
    });

    if (error) {
      // Never log the message subject/body (customer PII) — only safe
      // identifiers and the error shape itself.
      console.error(`[/api/web-services/leads/${id}/messages] Resend rejected the send:`, error);
      return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 502 });
    }
    resendMessageId = data?.id ?? null;
  } catch (err) {
    console.error(`[/api/web-services/leads/${id}/messages] Resend send threw:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 502 });
  }

  // Resend has confirmed the send. Persist the history record — but a
  // failure here must never be reported as a failed send: the email is
  // already on its way to the customer, so this only ever degrades to a
  // warning, logged prominently (lead id + resend_message_id only, no
  // subject/body) rather than a false "send failed" response that could
  // prompt a double-send retry.
  try {
    const rows = (await sql`
      INSERT INTO web_lead_messages (
        lead_id, direction, subject, body,
        from_address, to_address, resend_message_id, created_by
      ) VALUES (
        ${id}, 'outbound', ${subject}, ${message},
        ${from}, ${lead.email}, ${resendMessageId}, ${session.userId}
      )
      RETURNING id, direction, subject, body, from_address, to_address, resend_message_id, created_by, created_at
    `) as unknown as MessageRow[];

    return NextResponse.json({ success: true, message: { ...rows[0], sender_name: session.name } }, { status: 201 });
  } catch (err) {
    console.error(
      `[/api/web-services/leads/${id}/messages] email sent (resend_message_id=${resendMessageId}) but saving to history FAILED:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      success: true,
      warning: 'Email sent, but saving it to this lead\'s history failed. It may not appear in the list below.',
      message: null,
    });
  }
}
