import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { Resend } from 'resend'
import sql from '@/lib/db'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  let body: { body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.body?.trim()) return NextResponse.json({ error: 'Message body required' }, { status: 400 })

  try {
    const owns = await sql`SELECT id, organisation_id, title, founder_note FROM client_pipeline WHERE id = ${id}::uuid`
    if (!owns[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await sql`
      INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
      VALUES (${id}::uuid, ${owns[0].organisation_id as string}, 'founder', ${body.body.trim()})
      RETURNING id, author_type, body, created_at
    `
    await sql`
      UPDATE client_pipeline SET status = 'awaiting_client', updated_at = NOW()
      WHERE id = ${id}::uuid AND status != 'resolved'
    `

    // Send email to client if their email is stored in founder_note
    const clientEmail = owns[0].founder_note as string | null
    if (clientEmail && clientEmail.includes('@')) {
      const subject = `Re: ${owns[0].title as string}`
      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
          <div style="background:#0a0a0a;padding:28px 32px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;color:#10b981;font-size:18px;font-weight:700;letter-spacing:-.02em">Brainbase</h1>
          </div>
          <div style="background:#111;padding:32px;border-radius:0 0 12px 12px;border:1px solid #1f1f1f;border-top:none">
            <p style="margin:0 0 20px;color:#a1a1aa;font-size:13px">Message regarding: <strong style="color:#ededed">${owns[0].title as string}</strong></p>
            <div style="padding:20px;background:#0d0d0d;border-radius:8px;border-left:3px solid #10b981;margin-bottom:28px">
              <p style="margin:0;color:#ededed;font-size:15px;line-height:1.7;white-space:pre-wrap">${body.body.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
            </div>
            <p style="margin:0;color:#52525b;font-size:12px">
              — The Brainbase Team<br/>
              <a href="mailto:${process.env.MAIL_TO ?? 'hello@hlna.com.au'}" style="color:#10b981;text-decoration:none">${process.env.MAIL_TO ?? 'hello@hlna.com.au'}</a>
            </p>
          </div>
        </div>`

      const { error } = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: clientEmail,
        replyTo: process.env.MAIL_TO ?? 'hello@hlna.com.au',
        subject,
        html,
      })

      if (error) console.error('[pipeline/messages] Resend:', error)
      else console.log('[pipeline/messages] reply emailed to', clientEmail)
    }

    return NextResponse.json({ message: rows[0] }, { status: 201 })
  } catch (err) {
    console.error('[admin/pipeline/messages POST]', err)
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const messages = await sql`
      SELECT id, author_type, body, created_at
      FROM pipeline_messages
      WHERE pipeline_id = ${id}::uuid
      ORDER BY created_at ASC
    `
    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[admin/pipeline/messages GET]', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
