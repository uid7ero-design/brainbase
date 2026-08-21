import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
};

// Promoting an existing contact to 'active' — the same status value
// ContactsClient.tsx's "Active" tab already treats as "real Squad member" —
// is a deliberate, idempotent action. A contact already at 'active' is
// treated as already converted and left untouched (no overwrite of
// name/email/phone, which are only ever set when a contact has to be
// created from scratch below).
async function promoteToActive(contactId: string): Promise<Contact> {
  const rows = await sql`
    UPDATE contacts SET status = 'active'
    WHERE id = ${contactId}
    RETURNING id, name, email, phone, status
  `;
  return rows[0] as Contact;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Canonical lead, loaded strictly by id + the server-resolved session
  // organisation — never a client-supplied organisation id, and a lead
  // belonging to another organisation is indistinguishable from a
  // nonexistent one (404), exactly like every other /api/leads/[id] route.
  const leadRows = (await sql`
    SELECT id, name, email, phone, status
    FROM tennis_leads
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `) as unknown as Lead[];

  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const lead = leadRows[0];

  let contact: Contact;
  let alreadyConverted: boolean;

  try {
    // Safest existing identity link: organisation + email — the same pair
    // contacts' own unique constraint (@@unique([organisation_id, email]))
    // already enforces, and the same pair the public lead flow's own
    // `ON CONFLICT (organisation_id, email) DO NOTHING` upsert relies on.
    // No direct FK exists between tennis_leads and contacts, and none is
    // added here.
    const existingRows = (await sql`
      SELECT id, name, email, phone, status
      FROM contacts
      WHERE organisation_id = ${session.organisationId}
        AND LOWER(email) = LOWER(${lead.email})
      LIMIT 1
    `) as unknown as Contact[];

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.status === 'active') {
        // Second click (or the contact was independently already active) —
        // idempotent no-op: reuse as-is, no write, no duplicate.
        contact = existing;
        alreadyConverted = true;
      } else {
        contact = await promoteToActive(existing.id);
        alreadyConverted = false;
      }
    } else {
      // Contact unexpectedly missing (e.g. it predates this org being
      // configured, or its own insert failed at submission time) — create
      // it from the canonical lead, using the exact same columns the
      // public flow's own contacts upsert already writes.
      const insertedRows = (await sql`
        INSERT INTO contacts (organisation_id, name, email, phone, status)
        VALUES (${session.organisationId}, ${lead.name}, ${lead.email}, ${lead.phone}, 'active')
        ON CONFLICT (organisation_id, email) DO NOTHING
        RETURNING id, name, email, phone, status
      `) as unknown as Contact[];

      if (insertedRows.length > 0) {
        contact = insertedRows[0];
        alreadyConverted = false;
      } else {
        // Lost a race to a concurrent insert between the SELECT above and
        // this INSERT — the conflicting row now exists; reuse it exactly
        // like the "existing contact" branch rather than creating a
        // second row.
        const raceRows = (await sql`
          SELECT id, name, email, phone, status
          FROM contacts
          WHERE organisation_id = ${session.organisationId}
            AND LOWER(email) = LOWER(${lead.email})
          LIMIT 1
        `) as unknown as Contact[];
        const found = raceRows[0];
        if (found.status === 'active') {
          contact = found;
          alreadyConverted = true;
        } else {
          contact = await promoteToActive(found.id);
          alreadyConverted = false;
        }
      }
    }
  } catch (err) {
    console.error(`[/api/leads/${id}/convert] contact promotion failed:`, err);
    return NextResponse.json({ error: 'Failed to convert lead to Squad contact' }, { status: 500 });
  }

  // Lead status: only ever move new/contacted -> in_progress. Never touch
  // booked/closed/cancelled/in_progress, and never set 'booked' here — that
  // status is reserved for an actual booking/enrolment existing.
  let leadStatus = lead.status;
  if (!alreadyConverted && (lead.status === 'new' || lead.status === 'contacted')) {
    try {
      await sql`
        UPDATE tennis_leads SET status = 'in_progress'
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
      `;
      leadStatus = 'in_progress';
    } catch (err) {
      console.error(`[/api/leads/${id}/convert] lead status update failed:`, err);
    }
  }

  // Best-effort lineage note — uses the existing contact_journal table so
  // the conversion is traceable from the Squad contact's own journal
  // without adding a new lead<->contact link column.
  if (!alreadyConverted) {
    try {
      await sql`
        INSERT INTO contact_journal (contact_id, organisation_id, note)
        VALUES (
          ${contact.id},
          ${session.organisationId},
          ${`Added to Squad from website enquiry (lead ${lead.id}, submitted as "${lead.name}").`}
        )
      `;
    } catch (err) {
      console.error(`[/api/leads/${id}/convert] journal note failed:`, err);
    }
  }

  return NextResponse.json({ success: true, alreadyConverted, contact, leadStatus });
}
