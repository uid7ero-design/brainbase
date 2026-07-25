import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (body.parent_item_id === itemId) {
    return NextResponse.json({ error: 'An item cannot be its own parent.' }, { status: 400 });
  }

  const name     = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const status   = typeof body.status === 'string' && body.status ? body.status : null;
  const priority = typeof body.priority === 'string' ? body.priority : null;
  const owner    = typeof body.owner === 'string' ? body.owner : null;
  const dueDate  = typeof body.due_date === 'string' && body.due_date ? body.due_date : (body.due_date === null ? null : undefined);
  const notes    = typeof body.notes === 'string' ? body.notes : null;
  const position = typeof body.position === 'number' ? body.position : null;

  const hasGroupId  = Object.prototype.hasOwnProperty.call(body, 'group_id');
  const groupIdVal  = hasGroupId ? (typeof body.group_id === 'string' ? body.group_id : null) : null;
  const hasParentId = Object.prototype.hasOwnProperty.call(body, 'parent_item_id');
  const parentIdVal = hasParentId ? (typeof body.parent_item_id === 'string' ? body.parent_item_id : null) : null;
  const hasDueDate  = Object.prototype.hasOwnProperty.call(body, 'due_date');

  // Merge (not replace) custom column values via jsonb `||` so editing one
  // cell never clobbers another column's value written by a concurrent edit.
  const customValues = body.custom_values && typeof body.custom_values === 'object' && !Array.isArray(body.custom_values)
    ? body.custom_values as Record<string, unknown>
    : null;

  const rows = await sql`
    UPDATE organiser_items SET
      group_id       = CASE WHEN ${hasGroupId}  THEN ${groupIdVal}  ELSE group_id       END,
      parent_item_id = CASE WHEN ${hasParentId} THEN ${parentIdVal} ELSE parent_item_id END,
      due_date       = CASE WHEN ${hasDueDate}  THEN ${dueDate ?? null}::date ELSE due_date END,
      name           = COALESCE(${name}, name),
      status         = COALESCE(${status}, status),
      priority       = COALESCE(${priority}, priority),
      owner          = COALESCE(${owner}, owner),
      notes          = COALESCE(${notes}, notes),
      position       = COALESCE(${position}, position),
      custom_values  = CASE WHEN ${customValues !== null} THEN custom_values || ${JSON.stringify(customValues ?? {})}::jsonb ELSE custom_values END,
      updated_at     = NOW()
    WHERE id = ${itemId} AND organisation_id = ${session.organisationId}
    RETURNING id, group_id, parent_item_id, name, status, priority, owner, due_date::text AS due_date, notes, fields, custom_values, position, created_at, updated_at
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ item: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await params;

  const rows = await sql`
    DELETE FROM organiser_items
    WHERE id = ${itemId} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
