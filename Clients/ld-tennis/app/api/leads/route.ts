import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import sql from '@/lib/db'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, message } = await req.json()

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const rows = await sql`
      INSERT INTO leads (name, email, phone, message, source)
      VALUES (${name}, ${email}, ${phone ?? null}, ${message ?? null}, 'tennis-landing')
      RETURNING id, created_at
    `

    await resend.emails.send({
      from: 'LD Tennis <noreply@ldtennis.com.au>',
      to: process.env.MAIL_TO!,
      subject: `New enquiry from ${name}`,
      html: `
        <h2>New Lead</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone ?? '—'}</p>
        <p><strong>Message:</strong> ${message ?? '—'}</p>
      `,
    }).catch(() => null) // don't fail the request if email fails

    return NextResponse.json({ success: true, id: rows[0].id }, { status: 201 })
  } catch (err) {
    console.error('POST /api/leads error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const leads = await sql`
      SELECT id, name, email, phone, message, source, created_at
      FROM leads
      ORDER BY created_at DESC
    `
    return NextResponse.json(leads)
  } catch (err) {
    console.error('GET /api/leads error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
