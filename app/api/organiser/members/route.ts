import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

// Phase D.4.6P — read-only listing of this organisation's ACTIVE members,
// for the real-user assignee picker in the Organiser item drawer (and the
// same identity source Helena's propose_organiser_assignee_change resolves
// assignee_name against — see lib/organiser/helenaWrite.ts). 'viewer' floor
// matches every other app/api/organiser/** read (list_organiser_boards,
// list_organiser_items) — seeing organisation member names to populate a
// picker is not a more sensitive operation than seeing board/item names.
// INACTIVE users are deliberately excluded — never a valid assignment
// target (see the PATCH route's own assignee_valid check for the
// authoritative, server-side version of this same rule).
export async function GET(_req: NextRequest) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const members = await sql`
    SELECT id, name FROM users
    WHERE organisation_id = ${session.organisationId} AND status = 'ACTIVE'
    ORDER BY name ASC
  `;

  return NextResponse.json({ members });
}
