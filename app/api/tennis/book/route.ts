import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { isBookingCapacityError } from '@/lib/bookingCapacity'
import { checkRateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/clientIp'
import { publicTennisBooking } from '@/lib/scheduling/runtime'

const ORG_ID = process.env.LD_TENNIS_ORG_ID

export async function POST(req: NextRequest) {
  if (!ORG_ID) return NextResponse.json({ error: 'Booking not available' }, { status: 503 })

  if (!checkRateLimit(`tennis-book:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 })
  }

  let body: { session_instance_id: string; name: string; email: string; phone?: string; idempotencyKey?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  if (!body || typeof body.session_instance_id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.session_instance_id)
    || typeof body.name!=='string' || !body.name.trim() || body.name.length>200 || typeof body.email!=='string'
    || body.email.length>320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || (body.phone!==undefined && (typeof body.phone!=='string' || body.phone.length>80))) {
    return NextResponse.json({ error: 'session_instance_id, name and email are required' }, { status: 400 })
  }

  try {
    const service=publicTennisBooking(); const phase=await service.phase();
    if(phase==='frozen')return NextResponse.json({error:'Bookings are briefly paused for a system handover.',code:'HANDOVER_PAUSED'},{status:503,headers:{'cache-control':'no-store'}});
    if(phase==='scheduling') {
      if(typeof body.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.idempotencyKey))return NextResponse.json({error:'Reload the booking form before booking.',code:'INVALID_INPUT'},{status:400});
      return NextResponse.json(await service.book({...body,idempotencyKey:body.idempotencyKey}),{status:201,headers:{'cache-control':'no-store'}});
    }
  } catch(error) {
    const code=(error as {code?:string}).code;
    if(code==='STOFF')return NextResponse.json({error:'Bookings are currently paused.',code:'HANDOVER_PAUSED'},{status:503,headers:{'cache-control':'no-store'}});
    if(['SCCAP','23505','STCLS','SCARC','SCCLS','STKEY'].includes(code ?? ''))return NextResponse.json({error:'This session is unavailable, full or already booked.',code:'BOOKING_REFUSED'},{status:409,headers:{'cache-control':'no-store'}});
    return NextResponse.json({error:'The booking result is not confirmed. Check your saved request before booking again.',code:'OUTCOME_UNKNOWN'},{status:503,headers:{'cache-control':'no-store'}});
  }

  // Verify instance exists and is available
  const instances = await sql`
    SELECT si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity,
           s.name AS session_name, s.session_type
    FROM session_instances si
    JOIN sessions s ON s.id = si.session_id
    WHERE si.id = ${body.session_instance_id}
      AND s.organisation_id = ${ORG_ID}
      AND si.status = 'scheduled'
  `
  if (!instances[0]) return NextResponse.json({ error: 'Session not found or unavailable' }, { status: 404 })

  const inst = instances[0] as {
    id: string; session_id: string; date: string; start_time: string
    duration_minutes: number; max_capacity: number
    session_name: string; session_type: string
  }

  // Capacity check
  const enrolled = await sql`
    SELECT COUNT(*)::int AS count FROM bookings
    WHERE session_instance_id = ${body.session_instance_id} AND status != 'cancelled'
  `
  if ((enrolled[0].count as number) >= inst.max_capacity) {
    return NextResponse.json({ error: 'This session is full' }, { status: 409 })
  }

  // Duplicate check — same email already booked this instance
  const existing = await sql`
    SELECT id FROM bookings
    WHERE session_instance_id = ${body.session_instance_id}
      AND LOWER(client_email) = LOWER(${body.email.trim()})
      AND status != 'cancelled'
  `
  if (existing[0]) {
    return NextResponse.json({ error: 'You have already booked this session' }, { status: 409 })
  }

  try {
    // Create pipeline entry first (so we have its ID for the booking)
    const pipelineId = crypto.randomUUID()
    const dateLabel = new Date(inst.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    const pipelineTitle = `${inst.session_name} — ${dateLabel}`

    // No submitted_by_name column on client_pipeline (its only
    // submitter-linking column is submitted_by, a users.id FK — see
    // app/api/admin/pipeline/route.ts's `u.name AS submitted_by_name` JOIN
    // alias). There's no real user row for an anonymous public booking, so
    // the booker's name is folded into the description instead, since
    // pipelineTitle (session name + date) doesn't otherwise carry it.
    await sql`
      INSERT INTO client_pipeline (id, organisation_id, type, title, description, status, priority)
      VALUES (
        ${pipelineId}::uuid,
        ${ORG_ID},
        'request',
        ${pipelineTitle},
        ${`Booked by ${body.name.trim()} via website · ${inst.session_type} · ${inst.start_time}${body.phone ? ' · ' + body.phone : ''}`},
        'new',
        'medium'
      )
    `

    // Create booking
    const bookingId = crypto.randomUUID()
    try {
      await sql`
        INSERT INTO bookings (
          id, organisation_id, session_id, session_instance_id, pipeline_id,
          client_name, client_email, date, time, session_type, status
        ) VALUES (
          ${bookingId},
          ${ORG_ID},
          ${inst.session_id},
          ${body.session_instance_id},
          ${pipelineId},
          ${body.name.trim()},
          ${body.email.trim()},
          ${inst.date}::timestamp,
          ${inst.start_time},
          ${inst.session_type},
          'confirmed'
        )
      `
    } catch (err) {
      // The database capacity guard refused the insert: another request took the last place
      // between the capacity check above and this INSERT. Remove the pipeline request created
      // for this attempt so a refused booking leaves nothing behind, then answer exactly as
      // the pre-insert capacity check does.
      if (isBookingCapacityError(err)) {
        await sql`DELETE FROM client_pipeline WHERE id = ${pipelineId}::uuid AND organisation_id = ${ORG_ID}`
          .catch(e => console.error('[tennis/book] pipeline cleanup error:', e))
        return NextResponse.json({ error: 'This session is full' }, { status: 409 })
      }
      throw err
    }

    // Pipeline message
    await sql`
      INSERT INTO pipeline_messages (pipeline_id, organisation_id, author_type, body)
      VALUES (
        ${pipelineId}::uuid,
        ${ORG_ID},
        'client',
        ${`Booked online: ${inst.session_name} on ${dateLabel} at ${inst.start_time}`}
      )
    `.catch(err => console.error('[tennis/book] message error:', err))

    return NextResponse.json({
      success: true,
      booking: { id: bookingId, session_name: inst.session_name, date: inst.date, start_time: inst.start_time }
    }, { status: 201 })
  } catch (err) {
    console.error('[tennis/book POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}

export async function GET(req:NextRequest) {
  if(!ORG_ID)return NextResponse.json({error:'Booking not available'},{status:503});
  if(!checkRateLimit(`tennis-book-check:${getClientIp(req)}`,60,60_000))return NextResponse.json({error:'Please wait before checking again.'},{status:429});
  const q=new URL(req.url).searchParams;const key=q.get('key');
  if(!key || !/^[A-Za-z0-9_-]{16,80}$/.test(key) || [...q.keys()].some(k=>k!=='key') || q.getAll('key').length!==1)return NextResponse.json({error:'Invalid request'},{status:400});
  try {return NextResponse.json({result:await publicTennisBooking().saved(key)},{headers:{'cache-control':'private, no-store'}});}
  catch{return NextResponse.json({error:'The saved result could not be checked.'},{status:503,headers:{'cache-control':'private, no-store'}});}
}
