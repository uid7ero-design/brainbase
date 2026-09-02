import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

// Headers that map to first-class organiser_items columns. Everything else in
// the sheet is preserved verbatim in the `fields` JSONB column so no imported
// data is lost, regardless of which board's CSV shape shows up (TAFE vs. a
// work/home board with a totally different column set).
const KNOWN_HEADERS = new Set([
  'item name', 'subitems', 'group', 'status', 'priority', 'notes',
  'due date', 'week beginning', 'owner', 'assigned to',
]);

function normHeader(h: string): string {
  return h.trim().toLowerCase();
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { boardId } = await params;
  const boardRows = await sql`
    SELECT id FROM organiser_boards WHERE id = ${boardId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (boardRows.length === 0) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a CSV or Excel file.' }, { status: 400 });
  }

  const isCsv = ext === 'csv';
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellDates: !isCsv, raw: isCsv });

  // Multi-sheet workbooks (e.g. a full Monday.com export) need the caller to
  // say which sheet holds the actual items — sheet 0 is often a cover page
  // ("START_HERE") or a dashboard mockup, not data.
  const requestedSheet = typeof formData.get('sheet') === 'string' ? String(formData.get('sheet')) : null;
  if (workbook.SheetNames.length > 1 && (!requestedSheet || !workbook.SheetNames.includes(requestedSheet))) {
    const sheets = workbook.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: null, raw: isCsv });
      const headers = rows.length > 0 ? Object.keys(rows[0]).map(h => h.trim().toLowerCase()) : [];
      return { name, rowCount: rows.length, looksLikeData: headers.includes('item name') };
    });
    return NextResponse.json({ needsSheetSelection: true, sheets });
  }

  const sheetName = requestedSheet ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: isCsv });

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'File is empty.' }, { status: 422 });
  }

  // Existing groups on this board, keyed by lowercase name.
  const existingGroups = await sql`
    SELECT id, name, position FROM organiser_groups WHERE board_id = ${boardId} AND organisation_id = ${session.organisationId}
  `;
  const groupIdByName = new Map<string, string>(existingGroups.map(g => [String(g.name).toLowerCase(), g.id as string]));
  let nextGroupPos = existingGroups.reduce((max, g) => Math.max(max, (g.position as number) ?? 0), -1) + 1;

  const posRows = await sql`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_items WHERE board_id = ${boardId} AND parent_item_id IS NULL
  `;
  let nextItemPos = posRows[0].next as number;

  let groupsCreated = 0;
  let itemsCreated = 0;
  let subitemsLinked = 0;
  const unmatchedSubitems: string[] = [];

  const nameToId = new Map<string, string>();
  const pendingParentLinks: { itemId: string; parentName: string }[] = [];

  for (const raw of rawRows) {
    const entries = Object.entries(raw).map(([k, v]) => [normHeader(k), v] as const);
    const get = (key: string) => entries.find(([k]) => k === key)?.[1];

    const itemName = cellStr(get('item name'));
    if (!itemName) continue;

    const subitemsOf = cellStr(get('subitems'));
    const groupName  = cellStr(get('group'));
    const status      = cellStr(get('status')) || 'Not Started';
    const priority     = cellStr(get('priority')) || null;
    const notes        = cellStr(get('notes')) || null;
    const owner         = cellStr(get('owner')) || cellStr(get('assigned to')) || null;
    const dueDateRaw    = cellStr(get('due date')) || cellStr(get('week beginning')) || null;

    let groupId: string | null = null;
    if (groupName) {
      const key = groupName.toLowerCase();
      groupId = groupIdByName.get(key) ?? null;
      if (!groupId) {
        const gRows = await sql`
          INSERT INTO organiser_groups (board_id, organisation_id, name, position)
          VALUES (${boardId}, ${session.organisationId}, ${groupName}, ${nextGroupPos})
          RETURNING id
        `;
        groupId = gRows[0].id as string;
        groupIdByName.set(key, groupId);
        nextGroupPos += 1;
        groupsCreated += 1;
      }
    }

    // Extra columns not mapped to a first-class field.
    const fields: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (KNOWN_HEADERS.has(k)) continue;
      const str = cellStr(v);
      if (str) fields[k] = str;
    }

    const itemRows = await sql`
      INSERT INTO organiser_items (board_id, organisation_id, group_id, name, status, priority, owner, due_date, notes, fields, position)
      VALUES (${boardId}, ${session.organisationId}, ${groupId}, ${itemName}, ${status}, ${priority}, ${owner},
              ${dueDateRaw}::date, ${notes}, ${JSON.stringify(fields)}::jsonb, ${nextItemPos})
      RETURNING id
    `.catch(async () => {
      // Some "Due Date" values (e.g. "Due week only — confirm exact date") aren't valid dates; retry without one.
      return sql`
        INSERT INTO organiser_items (board_id, organisation_id, group_id, name, status, priority, owner, notes, fields, position)
        VALUES (${boardId}, ${session.organisationId}, ${groupId}, ${itemName}, ${status}, ${priority}, ${owner},
                ${notes}, ${JSON.stringify(fields)}::jsonb, ${nextItemPos})
        RETURNING id
      `;
    });

    const itemId = itemRows[0].id as string;
    nameToId.set(itemName, itemId);
    nextItemPos += 1;
    itemsCreated += 1;

    if (subitemsOf) pendingParentLinks.push({ itemId, parentName: subitemsOf });
  }

  for (const { itemId, parentName } of pendingParentLinks) {
    const parentId = nameToId.get(parentName);
    if (!parentId) { unmatchedSubitems.push(parentName); continue; }
    await sql`UPDATE organiser_items SET parent_item_id = ${parentId} WHERE id = ${itemId}`;
    subitemsLinked += 1;
  }

  return NextResponse.json({
    success: true,
    groupsCreated,
    itemsCreated,
    subitemsLinked,
    unmatchedSubitems: [...new Set(unmatchedSubitems)],
  });
}
